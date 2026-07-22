import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { structuredMetaChildHandler } from '../../ui/tree/nodeBuilders/structuredMetaChildHandler';
import { MetadataNode, type NodeKind } from '../../ui/tree/TreeNode';
import type { MetaKind } from '../../domain/MetaTypes';

/**
 * Панель свойств рисует недостающие ключи редактируемыми полями и дописывает их
 * в XML при первом вводе. Поэтому её состав обязан считаться по виду владельца
 * (`metaContext.rootMetaKind`), иначе один клик вернул бы в файл свойство чужого
 * вида метаданных — ровно тот дефект, из-за которого конфигурация не грузилась.
 */
suite('typedFieldPanelOwnerKind — состав панели свойств по виду владельца', () => {
  test('измерение и ресурс регистра сведений: без UseInTotals/Balance, с Master', () => {
    const xmlPath = writeInformationRegister(createTempConfigRoot());

    const dimensionKeys = propertyKeys(xmlPath, 'Dimension', 'Изм', 'InformationRegister');
    assert.ok(dimensionKeys.includes('Master'));
    assert.ok(dimensionKeys.includes('TypeReductionMode'));
    for (const alien of ['UseInTotals', 'Balance', 'AccountingFlag']) {
      assert.ok(!dimensionKeys.includes(alien), `панель не должна предлагать ${alien} измерению РС`);
    }

    const resourceKeys = propertyKeys(xmlPath, 'Resource', 'Рес', 'InformationRegister');
    for (const alien of ['Balance', 'AccountingFlag', 'UseInTotals', 'Master']) {
      assert.ok(!resourceKeys.includes(alien), `панель не должна предлагать ${alien} ресурсу РС`);
    }
    assert.ok(resourceKeys.includes('FullTextSearch'));
  });

  test('измерение регистра накопления получает UseInTotals, но не Master', () => {
    const xmlPath = writeInformationRegister(createTempConfigRoot(), 'AccumulationRegister');
    const keys = propertyKeys(xmlPath, 'Dimension', 'Изм', 'AccumulationRegister');
    assert.ok(keys.includes('UseInTotals'));
    for (const alien of ['Master', 'MainFilter', 'TypeReductionMode', 'DataHistory']) {
      assert.ok(!keys.includes(alien), `панель не должна предлагать ${alien} измерению РН`);
    }
  });

  test('реквизит и адресный реквизит считаются по виду владельца', () => {
    const configRoot = createTempConfigRoot();
    const registerPath = writeInformationRegister(configRoot, 'AccumulationRegister');
    const attributeKeys = propertyKeys(registerPath, 'Attribute', 'Рекв', 'AccumulationRegister');
    for (const alien of ['FillFromFillingValue', 'FillValue', 'DataHistory']) {
      assert.ok(!attributeKeys.includes(alien), `реквизит РН не имеет ${alien}`);
    }

    const taskPath = writeTask(configRoot);
    const addressingKeys = propertyKeys(taskPath, 'AddressingAttribute', 'Исполнитель', 'Task');
    assert.ok(addressingKeys.includes('AddressingDimension'));
    assert.ok(!addressingKeys.includes('UseInTotals'));
  });

  test('колонка табличной части: типозависимые свойства и ролевых свойств регистра нет', () => {
    const xmlPath = writeCatalogWithTabularSection(createTempConfigRoot());
    const keys = propertyKeys(xmlPath, 'Column', 'Количество', 'Catalog', 'Состав');
    assert.ok(keys.includes('Indexing'));
    assert.ok(keys.includes('MarkNegatives'), 'числовой тип даёт свойства числа');
    for (const alien of ['UseInTotals', 'Balance', 'Master']) {
      assert.ok(!keys.includes(alien), `колонка ТЧ не имеет ${alien}`);
    }
    // Без имени табличной части узел колонки неразрешим.
    assert.deepStrictEqual(propertyKeys(xmlPath, 'Column', 'Количество', 'Catalog'), []);
  });

  test('заимствованный объект расширения: состав считается по тому же владельцу', () => {
    // Ветка с наследуемым XML основной конфигурации: значения свойств
    // подмешиваются из родителя, но состав ключей остаётся составом владельца.
    const { cfeRoot } = buildBorrowedProject();
    const borrowedPath = writeInformationRegister(cfeRoot, 'InformationRegister', true);

    const keys = propertyKeys(borrowedPath, 'Dimension', 'Изм', 'InformationRegister');
    assert.ok(keys.includes('Master'));
    assert.ok(!keys.includes('UseInTotals'));

    const resourceKeys = propertyKeys(borrowedPath, 'Resource', 'Рес', 'InformationRegister');
    assert.ok(!resourceKeys.includes('Balance'));

    const attributeKeys = propertyKeys(borrowedPath, 'Attribute', 'Рекв', 'InformationRegister');
    assert.ok(attributeKeys.includes('DataHistory'), 'у реквизита РС свойства заполнения есть');
  });

  test('заимствованные адресный реквизит и колонка ТЧ берут состав из родителя', () => {
    // Элемент есть только в основной конфигурации: расширение заимствовало объект,
    // но не сам реквизит. Панель обязана показать его состав, а не пустой список.
    const { cfRoot, cfeRoot } = buildBorrowedProject();

    writeTask(cfRoot);
    const borrowedTaskPath = writeBorrowedShell(cfeRoot, 'Tasks', 'ее_Задача', 'Task');
    const addressingKeys = propertyKeys(borrowedTaskPath, 'AddressingAttribute', 'Исполнитель', 'Task');
    assert.ok(addressingKeys.includes('AddressingDimension'));

    writeCatalogWithTabularSection(cfRoot);
    const borrowedCatalogPath = writeBorrowedShell(cfeRoot, 'Catalogs', 'ее_Товары', 'Catalog');
    const columnKeys = propertyKeys(borrowedCatalogPath, 'Column', 'Количество', 'Catalog', 'Состав');
    assert.ok(columnKeys.includes('MarkNegatives'));
  });
});

function propertyKeys(
  xmlPath: string,
  nodeKind: NodeKind,
  label: string,
  rootMetaKind: MetaKind,
  tabularSectionName?: string
): string[] {
  const node = new MetadataNode({
    label,
    nodeKind,
    xmlPath,
    metaContext: {
      rootMetaKind,
      ownerObjectXmlPath: xmlPath,
      ...(tabularSectionName ? { tabularSectionName } : {}),
    },
  }, vscode.TreeItemCollapsibleState.None);

  if (!structuredMetaChildHandler.getProperties) {
    assert.fail('Обработчик свойств дочерних элементов не найден');
  }
  return structuredMetaChildHandler.getProperties(node).map((item) => item.key);
}

function createTempConfigRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-panel-owner-'));
}

/** Проект с основной конфигурацией и расширением рядом — иначе родитель не резолвится. */
function buildBorrowedProject(): { cfRoot: string; cfeRoot: string } {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-borrowed-'));
  const cfRoot = path.join(projectRoot, 'src', 'cf');
  fs.mkdirSync(cfRoot, { recursive: true });
  fs.writeFileSync(
    path.join(cfRoot, 'Configuration.xml'),
    '<MetaDataObject><Configuration><Properties><Name>Основная</Name></Properties></Configuration></MetaDataObject>',
    'utf-8'
  );
  writeInformationRegister(cfRoot);

  const cfeRoot = path.join(projectRoot, 'src', 'cfe', 'EVOLC');
  fs.mkdirSync(cfeRoot, { recursive: true });
  return { cfRoot, cfeRoot };
}

/** Заимствованный объект расширения без собственных дочерних элементов. */
function writeBorrowedShell(cfeRoot: string, folder: string, name: string, kind: string): string {
  const dir = path.join(cfeRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, `${name}.xml`);
  fs.writeFileSync(xmlPath, [
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
    `\t<${kind} uuid="60000000-0000-0000-0000-000000000000">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${name}</Name>`,
    '\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>',
    `\t\t\t<ExtendedConfigurationObject>${name}</ExtendedConfigurationObject>`,
    '\t\t</Properties>',
    '\t\t<ChildObjects/>',
    `\t</${kind}>`,
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

function writeInformationRegister(configRoot: string, kind = 'InformationRegister', borrowed = false): string {
  const dir = path.join(configRoot, `${kind}s`);
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, 'ее_Тест.xml');
  const belonging = borrowed
    ? '\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>\n\t\t\t<ExtendedConfigurationObject>ее_Тест</ExtendedConfigurationObject>'
    : '';
  fs.writeFileSync(xmlPath, [
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
    `\t<${kind} uuid="10000000-0000-0000-0000-000000000000">`,
    '\t\t<Properties>',
    '\t\t\t<Name>ее_Тест</Name>',
    ...(belonging ? [belonging] : []),
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    typedField('Dimension', 'Изм'),
    typedField('Resource', 'Рес'),
    typedField('Attribute', 'Рекв'),
    '\t\t</ChildObjects>',
    `\t</${kind}>`,
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

function writeTask(configRoot: string): string {
  const dir = path.join(configRoot, 'Tasks');
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, 'ее_Задача.xml');
  fs.writeFileSync(xmlPath, [
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
    '\t<Task uuid="20000000-0000-0000-0000-000000000000">',
    '\t\t<Properties>',
    '\t\t\t<Name>ее_Задача</Name>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    typedField('AddressingAttribute', 'Исполнитель'),
    '\t\t</ChildObjects>',
    '\t</Task>',
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

function writeCatalogWithTabularSection(configRoot: string): string {
  const dir = path.join(configRoot, 'Catalogs');
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, 'ее_Товары.xml');
  fs.writeFileSync(xmlPath, [
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
    '\t<Catalog uuid="30000000-0000-0000-0000-000000000000">',
    '\t\t<Properties>',
    '\t\t\t<Name>ее_Товары</Name>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<TabularSection uuid="40000000-0000-0000-0000-000000000000">',
    '\t\t\t\t<Properties>',
    '\t\t\t\t\t<Name>Состав</Name>',
    '\t\t\t\t</Properties>',
    '\t\t\t\t<ChildObjects>',
    typedField('Attribute', 'Количество', '\t\t'),
    '\t\t\t\t</ChildObjects>',
    '\t\t\t</TabularSection>',
    '\t\t</ChildObjects>',
    '\t</Catalog>',
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

function typedField(tag: string, name: string, extraIndent = ''): string {
  const indent = `${extraIndent}\t\t\t`;
  return [
    `${indent}<${tag} uuid="50000000-0000-0000-0000-00000000000${String(tag.length % 10)}">`,
    `${indent}\t<Properties>`,
    `${indent}\t\t<Name>${name}</Name>`,
    `${indent}\t\t<Type>`,
    `${indent}\t\t\t<v8:Type>xs:decimal</v8:Type>`,
    `${indent}\t\t</Type>`,
    `${indent}\t\t<FullTextSearch>Use</FullTextSearch>`,
    `${indent}\t</Properties>`,
    `${indent}</${tag}>`,
  ].join('\n');
}
