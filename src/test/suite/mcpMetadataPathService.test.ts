import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpMetadataPathService } from '../../ui/mcp/McpMetadataPathService';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { MetadataNode } from '../../ui/tree/TreeNode';

suite('McpMetadataPathService', () => {
  test('разрешает предметные пути без nodeId', () => {
    const provider = createProvider();
    const service = new McpMetadataPathService(provider);

    assert.strictEqual(service.resolveNode('Справочники.Пользователи').nodeKind, 'Catalog');
    assert.strictEqual(service.resolveNode('Catalog.Пользователи.Фамилия').nodeKind, 'Attribute');
    assert.strictEqual(service.resolveNode('Справочники.Пользователи.Формы.ФормаСписка').nodeKind, 'Form');
    assert.strictEqual(service.resolveNode('Справочники.Пользователи.ДополнительныеРеквизиты.Ссылка').nodeKind, 'Column');
    assert.strictEqual(service.resolveNode('Справочники.Пользователи.ТабличныеЧасти.ДополнительныеРеквизиты').nodeKind, 'TabularSection');
  });

  test('строит цель добавления по пути', () => {
    const service = new McpMetadataPathService(createProvider());

    const attr = service.resolveAddTarget({ path: 'Справочники.Пользователи.Отчество' });
    assert.strictEqual(attr.target.kind, 'child');
    assert.strictEqual(attr.target.kind === 'child' ? attr.target.childTag : undefined, 'Attribute');
    assert.strictEqual(attr.name, 'Отчество');

    const form = service.resolveAddTarget({ path: 'Справочники.Пользователи.Формы.ФормаЭлемента' });
    assert.strictEqual(form.target.kind === 'child' ? form.target.childTag : undefined, 'Form');
    assert.strictEqual(form.name, 'ФормаЭлемента');

    const column = service.resolveAddTarget({ path: 'Справочники.Пользователи.ДополнительныеРеквизиты.Значение' });
    assert.strictEqual(column.target.kind === 'child' ? column.target.childTag : undefined, 'Column');
    assert.strictEqual(column.target.kind === 'child' ? column.target.tabularSectionName : undefined, 'ДополнительныеРеквизиты');
    assert.strictEqual(column.name, 'Значение');

    const groupedColumn = service.resolveAddTarget({ path: 'Справочники.Пользователи.ТабличныеЧасти.ДополнительныеРеквизиты.Реквизиты.Сумма' });
    assert.strictEqual(groupedColumn.target.kind === 'child' ? groupedColumn.target.childTag : undefined, 'Column');
    assert.strictEqual(groupedColumn.target.kind === 'child' ? groupedColumn.target.tabularSectionName : undefined, 'ДополнительныеРеквизиты');
    assert.strictEqual(groupedColumn.name, 'Сумма');

    const tabularSection = service.resolveAddTarget({ path: 'Справочники.Пользователи.ТабличныеЧасти.Состав' });
    assert.strictEqual(tabularSection.target.kind === 'child' ? tabularSection.target.childTag : undefined, 'TabularSection');
    assert.strictEqual(tabularSection.name, 'Состав');

    const tabularSectionByUiLabel = service.resolveAddTarget({ path: 'Справочники.Пользователи.Табличные части.Состав' });
    assert.strictEqual(tabularSectionByUiLabel.target.kind === 'child' ? tabularSectionByUiLabel.target.childTag : undefined, 'TabularSection');
  });

  test('требует указать конфигурацию при нескольких корнях', () => {
    const service = new McpMetadataPathService(createProvider({ withExtension: true }));

    assert.throws(
      () => service.search({ query: 'Польз' }),
      /Укажите configuration/
    );
    assert.ok(service.search({ query: 'Польз', configuration: 'Конфигурация' }).length > 0);
  });

  test('быстро ищет корневые объекты по русскому виду метаданных', () => {
    const service = new McpMetadataPathService(createProvider());

    const found = service.search({
      query: 'Редактор схемы процессов',
      configuration: 'Конфигурация',
      kind: 'Обработки',
    });

    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].path, 'Обработки.ев_РедакторСхемыПроцессов');
    assert.strictEqual(found[0].nodeKind, 'DataProcessor');

    const withoutKind = service.search({
      query: 'Редактор схемы процессов',
      configuration: 'Конфигурация',
    });
    assert.strictEqual(withoutKind[0].path, 'Обработки.ев_РедакторСхемыПроцессов');
  });

  test('возвращает список корневой группы без обхода дочерних элементов', () => {
    const service = new McpMetadataPathService(createProvider());

    const found = service.list({
      configuration: 'Конфигурация',
      kind: 'DataProcessor',
    });

    assert.deepStrictEqual(found.map((item) => item.path), ['Обработки.ев_РедакторСхемыПроцессов']);
  });
});

function createProvider(options: { readonly withExtension?: boolean } = {}): MetadataTreeProvider {
  const attribute = node('Фамилия', 'Attribute', { xmlPath: '/tmp/cf/Catalogs/Пользователи.xml', owner: '/tmp/cf/Catalogs/Пользователи.xml' });
  const form = node('ФормаСписка', 'Form', { xmlPath: '/tmp/cf/Catalogs/Пользователи.xml', owner: '/tmp/cf/Catalogs/Пользователи.xml' });
  const column = node('Ссылка', 'Column', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    owner: '/tmp/cf/Catalogs/Пользователи.xml',
    tabularSectionName: 'ДополнительныеРеквизиты',
  });
  const tabularSection = node('ДополнительныеРеквизиты', 'TabularSection', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    owner: '/tmp/cf/Catalogs/Пользователи.xml',
    children: [column],
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
      childTag: 'Column',
      tabularSectionName: 'ДополнительныеРеквизиты',
    },
  });
  const catalog = node('Пользователи', 'Catalog', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    children: [
      group('Реквизиты', 'Attribute', [attribute]),
      group('Табличные части', 'TabularSection', [tabularSection]),
      group('Формы', 'Form', [form]),
    ],
  });
  const catalogs = node('Справочники', 'Catalog', {
    children: [catalog],
    addMetadataTarget: {
      kind: 'root',
      configRoot: '/tmp/cf',
      configKind: 'cf',
      targetKind: 'Catalog',
    },
  });
  const dataProcessor = node('ев_РедакторСхемыПроцессов', 'DataProcessor', {
    xmlPath: '/tmp/cf/DataProcessors/ев_РедакторСхемыПроцессов.xml',
    children: [
      group('Макеты', 'Template', []),
    ],
  });
  const dataProcessors = node('Обработки', 'DataProcessor', {
    children: [dataProcessor],
    addMetadataTarget: {
      kind: 'root',
      configRoot: '/tmp/cf',
      configKind: 'cf',
      targetKind: 'DataProcessor',
    },
  });
  const root = node('Конфигурация', 'configuration', {
    xmlPath: '/tmp/cf/Configuration.xml',
    children: [catalogs, dataProcessors],
  });
  const roots = options.withExtension
    ? [
      root,
      node('EVOLC', 'extension', {
        xmlPath: '/tmp/cfe/EVOLC/Configuration.xml',
        children: [],
      }),
    ]
    : [root];

  return {
    getAutomationRoots: () => roots,
    getEntries: () => [
      { rootPath: '/tmp/cf', kind: 'cf' },
      ...(options.withExtension ? [{ rootPath: '/tmp/cfe/EVOLC', kind: 'cfe' as const }] : []),
    ],
  } as unknown as MetadataTreeProvider;
}

function group(label: string, childTag: 'Attribute' | 'TabularSection' | 'Form' | 'Template', children: MetadataNode[]): MetadataNode {
  return node(label, 'group-type', {
    children,
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
      childTag,
    },
  });
}

function node(
  label: string,
  nodeKind: MetadataNode['nodeKind'],
  options: {
    readonly xmlPath?: string;
    readonly owner?: string;
    readonly tabularSectionName?: string;
    readonly children?: MetadataNode[];
    readonly addMetadataTarget?: MetadataNode['addMetadataTarget'];
  } = {}
): MetadataNode {
  return new MetadataNode({
    label,
    nodeKind,
    xmlPath: options.xmlPath,
    metaContext: options.owner
      ? {
        rootMetaKind: 'Catalog',
        ownerObjectXmlPath: options.owner,
        tabularSectionName: options.tabularSectionName,
      }
      : undefined,
    childrenLoader: options.children ? () => options.children ?? [] : undefined,
    addMetadataTarget: options.addMetadataTarget,
  }, options.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
}
