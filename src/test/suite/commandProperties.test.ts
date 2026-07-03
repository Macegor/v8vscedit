import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { createLeafMetaObjectHandler } from '../../ui/tree/nodeBuilders/createLeafMetaObjectHandler';
import { structuredMetaChildHandler } from '../../ui/tree/nodeBuilders/structuredMetaChildHandler';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { buildCommandProperties } from '../../ui/views/properties/PropertyBuilder';
import { TypeRegistryService } from '../../ui/views/properties/TypeRegistryService';
import type { EnumPropertyValue } from '../../ui/views/properties/_types';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

// Возвращает путь к первому XML объекта в указанной папке корня конфигурации.
function findFirstXmlInGroup(group: string): string | null {
  const dir = path.join(EXAMPLE_CF, group);
  if (!fs.existsSync(dir)) {
    return null;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.xml')) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

suite('Properties — команды', () => {
  test('Показывает свойства команды объекта из XML владельца', function () {
    // Тест требует наличие документа с Command внутри. В минимальной выгрузке example/
    // может не быть подходящего объекта — тогда тест неприменим.
    const documentsDir = path.join(EXAMPLE_CF, 'Documents');
    if (!fs.existsSync(documentsDir)) {
      this.skip();
    }
    let xmlPath: string | null = null;
    let commandName: string | null = null;
    for (const entry of fs.readdirSync(documentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.xml')) {
        continue;
      }
      const file = path.join(documentsDir, entry.name);
      const xml = fs.readFileSync(file, 'utf-8');
      const match = /<Command>[\s\S]*?<Name>([^<]+)<\/Name>/.exec(xml);
      if (match) {
        xmlPath = file;
        commandName = match[1];
        break;
      }
    }
    if (!xmlPath || !commandName) {
      this.skip();
    }
    const node = new MetadataNode({
      label: commandName,
      nodeKind: 'Command',
      xmlPath,
      metaContext: {
        rootMetaKind: 'Document',
        ownerObjectXmlPath: xmlPath,
      },
    }, vscode.TreeItemCollapsibleState.None);

    if (!structuredMetaChildHandler.getProperties) {
      assert.fail('Обработчик свойств команды не найден');
    }
    const props = structuredMetaChildHandler.getProperties(node);

    // Проверяем структуру свойств команды (имена и порядок основных полей),
    // без привязки к конкретным значениям, которых нет в произвольной выгрузке.
    const keys = props.map((item) => item.key);
    const expectedPrefix = [
      'Name',
      'Synonym',
      'Comment',
      'Group',
      'CommandParameterType',
      'ParameterUseMode',
      'ModifiesData',
    ];
    for (const key of expectedPrefix) {
      assert.ok(keys.includes(key), `Свойство команды ${key} не найдено`);
    }

    const group = props.find((item) => item.key === 'Group');
    assert.ok(group, 'Group не найден');
    assert.strictEqual(group.kind, 'enum');

    const commandParameterType = props.find((item) => item.key === 'CommandParameterType');
    assert.ok(commandParameterType, 'CommandParameterType не найден');
    assert.strictEqual(commandParameterType.kind, 'metadataType');

    const modifiesData = props.find((item) => item.key === 'ModifiesData');
    assert.ok(modifiesData, 'ModifiesData не найден');
    assert.strictEqual(modifiesData.kind, 'boolean');
  });

  test('Строит enum для группы командного интерфейса общей команды', function () {
    // Требуется CommonCommand в example/2.20/src/cf/CommonCommands; в минимальной выгрузке
    // их может не быть — тогда тест неприменим.
    const xmlPath = findFirstXmlInGroup('CommonCommands');
    if (!xmlPath) {
      this.skip();
    }
    const label = path.basename(xmlPath, '.xml');
    const node = new MetadataNode({
      label,
      nodeKind: 'CommonCommand',
      xmlPath,
    }, vscode.TreeItemCollapsibleState.None);
    const handler = createLeafMetaObjectHandler('CommonCommand');
    const props = handler.getProperties
      ? handler.getProperties(node)
      : assert.fail('Обработчик свойств общей команды не найден');
    const group = props.find((item) => item.key === 'Group');

    assert.ok(group, 'Group не найден');
    assert.strictEqual(group.kind, 'enum');

    const value = group.value as EnumPropertyValue;
    assert.ok(value.allowedValues.length > 0, 'Список допустимых групп пуст');
    assert.ok(value.allowedValues.some((item) => item.value === 'FormCommandBarCreateBasedOn'));
  });

  test('Показывает пользовательскую группу команд как выбор с русским представлением', () => {
    // Собираем минимальный XML команды вручную, не завися от наличия конкретных объектов в example/.
    const customXml = [
      '<Properties>',
      '<Name>Календарь</Name>',
      '<Synonym/>',
      '<Comment/>',
      '<Group>CommandGroup.Сервис</Group>',
      '<CommandParameterType/>',
      '<ModifiesData>false</ModifiesData>',
      '</Properties>',
    ].join('\n');
    const props = buildCommandProperties(customXml);
    const group = props.find((item) => item.key === 'Group');

    assert.ok(group, 'Group не найден');
    assert.strictEqual(group.kind, 'enum');

    const value = group.value as EnumPropertyValue;
    assert.strictEqual(value.current, 'CommandGroup.Сервис');
    assert.strictEqual(value.currentLabel, 'Группа команд: Сервис');
  });

  test('Фильтрует типы для реквизитов, команд и подписок через общий реестр', () => {
    // Используем любой Catalog как источник — достаточно валидного пути в example/2.20/src/cf.
    const registry = new TypeRegistryService();
    const sourceXmlPath = findFirstXmlInGroup('Catalogs');
    assert.ok(sourceXmlPath, 'В example/2.20/src/cf нет ни одного справочника для теста реестра типов');

    const valueTypes = flattenTypeGroups(registry.getAvailableTypes(sourceXmlPath, 'value'));
    assert.ok(valueTypes.includes('String'));

    const commandParameterTypes = flattenTypeGroups(registry.getAvailableTypes(sourceXmlPath, 'commandParameter'));
    assert.ok(!commandParameterTypes.includes('String'));
    assert.ok(!commandParameterTypes.some((item) => item.includes('Object')));
    assert.ok(!commandParameterTypes.some((item) => item.includes('Manager')));

    const eventSourceTypes = flattenTypeGroups(registry.getAvailableTypes(sourceXmlPath, 'eventSource'));
    assert.ok(!eventSourceTypes.includes('String'));
  });

  test('Записывает тип параметра встроенной команды в XML объекта', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-command-'));
    const xmlPath = path.join(dir, 'Document.xml');
    fs.writeFileSync(
      xmlPath,
      [
        '<MetaDataObject>',
        '<Document>',
        '<Properties><Name>Документ</Name></Properties>',
        '<ChildObjects>',
        '<Command>',
        '<Properties>',
        '<Name>ОткрытьСвязанныйОбъект</Name>',
        '<CommandParameterType/>',
        '</Properties>',
        '</Command>',
        '</ChildObjects>',
        '</Document>',
        '</MetaDataObject>',
      ].join('\n'),
      'utf-8'
    );

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Command',
      targetName: 'ОткрытьСвязанныйОбъект',
      propertyName: 'CommandParameterType',
      typeInnerXml: '<v8:Type>cfg:DocumentRef.Заказ</v8:Type>',
    });

    assert.strictEqual(changed, true);
    const saved = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(saved.includes('<CommandParameterType>'));
    assert.ok(saved.includes('<v8:Type>cfg:DocumentRef.Заказ</v8:Type>'));
  });
});

function flattenTypeGroups(groups: ReturnType<TypeRegistryService['getAvailableTypes']>): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.canonical));
}
