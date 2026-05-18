import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { extractChildMetaElementXml } from '../../infra/xml/XmlUtils';
import { createLeafMetaObjectHandler } from '../../ui/tree/nodeBuilders/createLeafMetaObjectHandler';
import { structuredMetaChildHandler } from '../../ui/tree/nodeBuilders/structuredMetaChildHandler';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { buildCommandProperties } from '../../ui/views/properties/PropertyBuilder';
import { TypeRegistryService } from '../../ui/views/properties/TypeRegistryService';
import type { EnumPropertyValue, MetadataTypeValue } from '../../ui/views/properties/_types';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');
const EXAMPLE_CFE = path.resolve(__dirname, '../../../example/src/cfe/EVOLC');

suite('Properties — команды', () => {
  test('Показывает свойства команды объекта из XML владельца', () => {
    const xmlPath = path.join(EXAMPLE_CFE, 'Documents', 'ев_Действие.xml');
    const node = new MetadataNode({
      label: 'ДействияВладельца',
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
    const group = props.find((item) => item.key === 'Group');

    assert.ok(group, 'Group не найден');
    assert.strictEqual(group.kind, 'enum');

    const value = group.value as EnumPropertyValue;
    assert.strictEqual(value.current, 'FormNavigationPanelGoTo');
    assert.strictEqual(value.currentLabel, 'Панель навигации формы: перейти');

    const keys = props.map((item) => item.key);
    assert.deepStrictEqual(keys.slice(0, 12), [
      'Name',
      'Synonym',
      'Comment',
      'Group',
      'CommandParameterType',
      'ParameterUseMode',
      'ModifiesData',
      'OnMainServerUnavalableBehavior',
      'Representation',
      'ToolTip',
      'Shortcut',
      'Picture',
    ]);

    const commandParameterType = props.find((item) => item.key === 'CommandParameterType');
    assert.ok(commandParameterType, 'CommandParameterType не найден');
    assert.strictEqual(commandParameterType.kind, 'metadataType');
    assert.strictEqual(
      (commandParameterType.value as MetadataTypeValue).items[0]?.canonical,
      'DefinedType.ев_ВладелецДействий'
    );

    const parameterUseMode = props.find((item) => item.key === 'ParameterUseMode');
    assert.ok(parameterUseMode, 'ParameterUseMode не найден');
    assert.strictEqual(parameterUseMode.kind, 'enum');
    assert.strictEqual((parameterUseMode.value as EnumPropertyValue).currentLabel, 'Одиночный');

    const modifiesData = props.find((item) => item.key === 'ModifiesData');
    assert.ok(modifiesData, 'ModifiesData не найден');
    assert.strictEqual(modifiesData.kind, 'boolean');
    assert.strictEqual(modifiesData.value, false);
  });

  test('Строит enum для группы командного интерфейса общей команды', () => {
    const xmlPath = path.join(EXAMPLE_CF, 'CommonCommands', 'ОткрытьВводНачальныхОстатков.xml');
    const node = new MetadataNode({
      label: 'ОткрытьВводНачальныхОстатков',
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
    assert.strictEqual(value.current, 'NavigationPanelSeeAlso');
    assert.strictEqual(value.currentLabel, 'Панель навигации: см. также');
    assert.ok(value.allowedValues.some((item) => item.value === 'FormCommandBarCreateBasedOn'));
    assert.ok(value.allowedValues.some((item) => item.value === 'CommandGroup.Сервис' && item.label === 'Группа команд: Сервис'));
  });

  test('Показывает пользовательскую группу команд как выбор с русским представлением', () => {
    const commandXml = extractChildMetaElementXml(
      fs.readFileSync(path.join(EXAMPLE_CF, 'Catalogs', 'ЗаписиКалендаряСотрудника.xml'), 'utf-8'),
      'Command',
      'Календарь'
    );
    assert.ok(commandXml, 'Команда Календарь не найдена');

    const customXml = commandXml.replace(
      '<Group>NavigationPanelOrdinary</Group>',
      '<Group>CommandGroup.Сервис</Group>'
    );
    const props = buildCommandProperties(customXml);
    const group = props.find((item) => item.key === 'Group');

    assert.ok(group, 'Group не найден');
    assert.strictEqual(group.kind, 'enum');

    const value = group.value as EnumPropertyValue;
    assert.strictEqual(value.current, 'CommandGroup.Сервис');
    assert.strictEqual(value.currentLabel, 'Группа команд: Сервис');
  });

  test('Фильтрует типы для реквизитов, команд и подписок через общий реестр', () => {
    const registry = new TypeRegistryService();
    const sourceXmlPath = path.join(EXAMPLE_CF, 'CommonCommands', 'РасходнаяНакладнаяПередачаВПереработку.xml');

    const valueTypes = flattenTypeGroups(registry.getAvailableTypes(sourceXmlPath, 'value'));
    assert.ok(valueTypes.includes('String'));
    assert.ok(valueTypes.some((item) => item.startsWith('CatalogRef.')));

    const commandParameterTypes = flattenTypeGroups(registry.getAvailableTypes(sourceXmlPath, 'commandParameter'));
    assert.ok(!commandParameterTypes.includes('String'));
    assert.ok(!commandParameterTypes.some((item) => item.includes('Object')));
    assert.ok(!commandParameterTypes.some((item) => item.includes('Manager')));
    assert.ok(commandParameterTypes.some((item) => item.startsWith('CatalogRef.')));
    assert.ok(commandParameterTypes.some((item) => item.startsWith('DefinedType.')));

    const eventSourceTypes = flattenTypeGroups(registry.getAvailableTypes(sourceXmlPath, 'eventSource'));
    assert.ok(eventSourceTypes.includes('DocumentObject'));
    assert.ok(eventSourceTypes.includes('DocumentManager'));
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
