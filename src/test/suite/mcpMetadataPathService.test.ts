import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { McpMetadataPathService } from '../../ui/mcp/McpMetadataPathService';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { MetadataNode } from '../../ui/tree/TreeNode';

suite('McpMetadataPathService — каноническая навигация', () => {
  // ── Позитивные сценарии: каноничные русские пути ────────────────────────

  test('Конфигурация — корневой узел', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('Конфигурация');
    assert.strictEqual(node.nodeKind, 'configuration');
    assert.strictEqual(node.xmlPath, '/tmp/cf/Configuration.xml');
  });

  test('Расширение — корневой узел с явной конфигурацией', () => {
    const service = new McpMetadataPathService(createProvider({ withExtension: true }));
    const node = service.resolveNode('Расширение', 'EVOLC');
    assert.strictEqual(node.nodeKind, 'extension');
    assert.strictEqual(node.xmlPath, '/tmp/cfe/EVOLC/Configuration.xml');
  });

  test('Справочники.X — корневой объект', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('Справочники.Пользователи');
    assert.strictEqual(node.nodeKind, 'Catalog');
  });

  test('Справочники.X.Y — прямой реквизит без сегмента', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('Справочники.Пользователи.Фамилия');
    assert.strictEqual(node.nodeKind, 'Attribute');
  });

  test('Справочники.X.Y — прямая табличная часть без сегмента', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('Справочники.Пользователи.ДополнительныеРеквизиты');
    assert.strictEqual(node.nodeKind, 'TabularSection');
  });

  test('Справочники.X.ТабличнаяЧасть.Имя.Реквизит.Y — колонка ТЧ с сегментом', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('Справочники.Пользователи.ТабличнаяЧасть.ДополнительныеРеквизиты.Реквизит.Ссылка');
    assert.strictEqual(node.nodeKind, 'Column');
  });

  test('Справочники.X.Форма.Y — форма с сегментом', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('Справочники.Пользователи.Форма.ФормаСписка');
    assert.strictEqual(node.nodeKind, 'Form');
  });

  test('Справочники.X.СтандартныйРеквизит.Y — стандартный реквизит', () => {
    const service = new McpMetadataPathService(createProvider({ withStandardAttribute: true }));
    const node = service.resolveNode('Справочники.Пользователи.СтандартныйРеквизит.Код');
    assert.strictEqual(node.nodeKind, 'StandardAttribute');
  });

  test('Подсистема.А.Б — вложенная подсистема без удвоения', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const node = service.resolveNode('Подсистема.Продажи.Розница');
    assert.strictEqual(node.nodeKind, 'Subsystem');
    assert.strictEqual(node.textLabel, 'Розница');
  });

  test('search — выдаёт ТОЛЬКО канонические пути', () => {
    const service = new McpMetadataPathService(createProvider());
    const results = service.search({ query: 'Польз', configuration: 'Конфигурация' });
    assert.ok(results.length > 0, 'должен найти Пользователи');
    for (const item of results) {
      assert.ok(
        item.path.startsWith('Справочники.')
          || item.path.startsWith('Документы.')
          || item.path === 'Конфигурация'
          || item.path.startsWith('Обработки.'),
        `канон, получено "${item.path}"`,
      );
    }
  });

  test('search — kind принимает русский label типа', () => {
    const service = new McpMetadataPathService(createProvider());
    const results = service.search({
      query: 'Редактор',
      configuration: 'Конфигурация',
      kind: 'Обработка',
    });
    assert.ok(results.length > 0);
    for (const item of results) {
      assert.strictEqual(item.nodeKind, 'DataProcessor');
      assert.ok(item.path.startsWith('Обработки.'));
    }
  });

  test('list — корневая группа объектов выдаёт канонические пути', () => {
    const service = new McpMetadataPathService(createProvider());
    const found = service.list({
      configuration: 'Конфигурация',
      kind: 'DataProcessor',
    });
    assert.deepStrictEqual(found.map((item) => item.path), ['Обработки.ев_РедакторСхемыПроцессов']);
  });

  // ── resolveAddTarget: канонические формы ────────────────────────────────

  test('resolveAddTarget — прямой реквизит к существующему объекту', () => {
    const service = new McpMetadataPathService(createProvider());
    const attr = service.resolveAddTarget({ path: 'Справочники.Пользователи.Отчество' });
    if (attr.target.kind !== 'child') {
      assert.fail(`Ожидался target.kind === 'child', получено ${attr.target.kind}`);
    }
    assert.strictEqual(attr.target.childTag, 'Attribute');
    assert.strictEqual(attr.name, 'Отчество');
  });

  test('resolveAddTarget — форма к существующему объекту через сегмент', () => {
    const service = new McpMetadataPathService(createProvider());
    const form = service.resolveAddTarget({ path: 'Справочники.Пользователи.Форма.ФормаЭлемента' });
    assert.strictEqual(form.target.kind === 'child' ? form.target.childTag : undefined, 'Form');
    assert.strictEqual(form.name, 'ФормаЭлемента');
  });

  test('resolveAddTarget — колонка ТЧ через канон.форму ТабличнаяЧасть.X.Реквизит.Y', () => {
    const service = new McpMetadataPathService(createProvider());
    const column = service.resolveAddTarget({
      path: 'Справочники.Пользователи.ТабличнаяЧасть.ДополнительныеРеквизиты.Реквизит.Сумма',
    });
    assert.strictEqual(column.target.kind === 'child' ? column.target.childTag : undefined, 'Column');
    assert.strictEqual(
      column.target.kind === 'child' ? column.target.tabularSectionName : undefined,
      'ДополнительныеРеквизиты',
    );
    assert.strictEqual(column.name, 'Сумма');
  });

  test('resolveAddTarget — новый корневой объект по канону', () => {
    const service = new McpMetadataPathService(createProvider());
    const root = service.resolveAddTarget({ path: 'Справочники.НовыйСправочник' });
    if (root.target.kind !== 'root') {
      assert.fail(`Ожидался target.kind === 'root', получено ${root.target.kind}`);
    }
    assert.strictEqual(root.target.targetKind, 'Catalog');
    assert.strictEqual(root.name, 'НовыйСправочник');
  });

  // ── Многокорневые рабочие области ───────────────────────────────────────

  test('Несколько корней — требуется configuration', () => {
    const service = new McpMetadataPathService(createProvider({ withExtension: true }));
    assert.throws(
      () => service.search({ query: 'Польз', configuration: '' }),
      /Укажите configuration/,
    );
    assert.ok(service.search({ query: 'Польз', configuration: 'Конфигурация' }).length > 0);
  });

  // ── resolveObjectXmlPath: канон + абсолютный путь, без relative-from-root ──

  test('resolveObjectXmlPath — абсолютный путь к файлу', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-resolve-canonical-'));
    const catalogsDir = path.join(root, 'Catalogs');
    fs.mkdirSync(catalogsDir, { recursive: true });
    const catalogXml = path.join(catalogsDir, 'Задачи.xml');
    fs.writeFileSync(catalogXml, '<MetaDataObject/>', 'utf-8');

    const provider = {
      getAutomationRoots: () => [],
      getEntries: () => [{ rootPath: root, kind: 'cf' as const }],
    } as unknown as MetadataTreeProvider;
    const service = new McpMetadataPathService(provider);

    assert.strictEqual(service.resolveObjectXmlPath(catalogXml), catalogXml);
  });

  test('resolveObjectXmlPath — относительный путь от корня НЕ поддерживается', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-resolve-rel-'));
    const catalogsDir = path.join(root, 'Catalogs');
    fs.mkdirSync(catalogsDir, { recursive: true });
    fs.writeFileSync(path.join(catalogsDir, 'Задачи.xml'), '<MetaDataObject/>', 'utf-8');

    const provider = {
      getAutomationRoots: () => [],
      getEntries: () => [{ rootPath: root, kind: 'cf' as const }],
    } as unknown as MetadataTreeProvider;
    const service = new McpMetadataPathService(provider);

    assert.strictEqual(service.resolveObjectXmlPath('Catalogs/Задачи.xml'), null);
  });

  // ── Негативные тесты: alias-формы отбиваются ────────────────────────────

  test('Catalog.X — английский алиас отвергается с подсказкой канона', () => {
    const service = new McpMetadataPathService(createProvider());
    assert.throws(
      () => service.resolveNode('Catalog.Пользователи'),
      /Справочники/,
    );
  });

  test('Catalogs.X — английская папка отвергается', () => {
    const service = new McpMetadataPathService(createProvider());
    assert.throws(
      () => service.resolveNode('Catalogs.Пользователи'),
      /Справочники/,
    );
  });

  test('Справочник.X (ед. ч.) — отвергается', () => {
    const service = new McpMetadataPathService(createProvider());
    assert.throws(
      () => service.resolveNode('Справочник.Пользователи'),
      /Справочники/,
    );
  });

  test('Справочники.X.Реквизиты.Y — старая «грязная» форма отвергается', () => {
    const service = new McpMetadataPathService(createProvider());
    assert.throws(
      () => service.resolveNode('Справочники.Пользователи.Реквизиты.Фамилия'),
      /сегмент-роль|сегмент/i,
    );
  });

  test('Подсистема.А.Подсистема.Б — удвоение сегмента отвергается', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    assert.throws(
      () => service.resolveNode('Подсистема.Продажи.Подсистема.Розница'),
      /Подсистема|не найден/i,
    );
  });

  // ── listTreePaths: плоский список путей ────────────────────────────────

  test('listTreePaths(scope=all, depth=roots) — содержит корни Справочники.X, Обработки.X, Подсистема.X', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ scope: 'all', depth: 'roots' });
    assert.ok(result.paths.includes('Справочники.Пользователи'), 'должен быть Справочники.Пользователи');
    assert.ok(result.paths.includes('Обработки.ев_РедакторСхемыПроцессов'), 'должен быть Обработки.ев_РедакторСхемыПроцессов');
    assert.ok(result.paths.includes('Подсистема.Продажи'), 'должна быть корневая подсистема Подсистема.Продажи');
    // depth=roots для подсистем НЕ должен включать дочерние
    assert.ok(!result.paths.includes('Подсистема.Продажи.Розница'), 'вложенная подсистема не должна быть в roots');
  });

  test('listTreePaths(depth=objects) — есть объекты, нет реквизитов', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ depth: 'objects' });
    assert.ok(result.paths.includes('Справочники.Пользователи'));
    // Реквизиты и табличные части НЕ должны попадать
    assert.ok(!result.paths.includes('Справочники.Пользователи.Фамилия'), 'реквизит не должен быть в objects');
    assert.ok(!result.paths.includes('Справочники.Пользователи.ДополнительныеРеквизиты'), 'ТЧ не должна быть в objects');
    assert.ok(!result.paths.includes('Справочники.Пользователи.Форма.ФормаСписка'), 'формы не должны быть в objects');
    // Подсистемы — это объекты, должны попадать на всех уровнях иерархии
    assert.ok(result.paths.includes('Подсистема.Продажи.Розница'));
  });

  test('listTreePaths(depth=children) — есть прямые реквизиты, формы и вложенные подсистемы', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ depth: 'children' });
    assert.ok(result.paths.includes('Справочники.Пользователи.Фамилия'), 'прямой реквизит');
    assert.ok(result.paths.includes('Справочники.Пользователи.Форма.ФормаСписка'), 'форма с сегментом');
    assert.ok(result.paths.includes('Подсистема.Продажи.Розница.Возвраты'), 'вложенная подсистема');
  });

  test('listTreePaths(include=[Справочники]) — фильтр по корневому сегменту', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ depth: 'objects', include: ['Справочники'] });
    assert.ok(result.paths.length > 0);
    for (const value of result.paths) {
      assert.ok(value.startsWith('Справочники.') || value === 'Справочники', `путь "${value}" должен начинаться со Справочники`);
    }
  });

  test('listTreePaths — подсистемы без удвоения сегмента', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ depth: 'children' });
    const subsystemPaths = result.paths.filter((p) => p.startsWith('Подсистема.'));
    // Должна быть Подсистема.Продажи.Розница, и НЕ должно быть Подсистема.Продажи.Подсистема.Розница.
    assert.ok(subsystemPaths.includes('Подсистема.Продажи.Розница'));
    assert.ok(!subsystemPaths.some((p) => p.includes('Подсистема.Продажи.Подсистема')),
      `подсистемы не должны удваивать сегмент: ${subsystemPaths.join(', ')}`);
  });

  test('listTreePaths(scope=subsystems) — только подсистемы', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ scope: 'subsystems', depth: 'children' });
    for (const value of result.paths) {
      assert.ok(value.startsWith('Подсистема.'), `должно быть только Подсистема.*, получено "${value}"`);
    }
  });

  test('listTreePaths(limit) — обрезает выдачу и выставляет truncated', () => {
    const service = new McpMetadataPathService(createProvider({ withSubsystems: true }));
    const result = service.listTreePaths({ depth: 'children', limit: 2 });
    assert.strictEqual(result.paths.length, 2);
    assert.strictEqual(result.truncated, true);
    assert.ok(result.total >= 2);
  });

  // ── resolveNodeSafe: для tool v8vscedit_resolve_path ──────────────────

  test('resolveNodeSafe — существующий узел: exists=true, node заполнен', () => {
    const service = new McpMetadataPathService(createProvider());
    const result = service.resolveNodeSafe('Справочники.Пользователи');
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.canonical, 'Справочники.Пользователи');
    assert.strictEqual(result.node?.nodeKind, 'Catalog');
  });

  test('resolveNodeSafe — валидный синтаксис, узла нет: exists=false без ошибки', () => {
    const service = new McpMetadataPathService(createProvider());
    const result = service.resolveNodeSafe('Справочники.НетТакого');
    assert.strictEqual(result.exists, false);
    assert.strictEqual(result.canonical, 'Справочники.НетТакого');
    assert.strictEqual(result.node, undefined);
  });

  test('resolveNodeSafe — невалидный синтаксис (английский алиас) → бросает ошибку', () => {
    const service = new McpMetadataPathService(createProvider());
    assert.throws(
      () => service.resolveNodeSafe('Catalog.Пользователи'),
      /Справочники|канонические/i,
    );
  });

  // ── Мемоизация buildIndex ─────────────────────────────────────────────

  test('buildIndex — повторный вызов возвращает идентичный массив (memo hit)', () => {
    const provider = createProvider();
    const service = new McpMetadataPathService(provider);

    let calls = 0;
    const original = provider.getAutomationRoots.bind(provider);
    (provider as unknown as { getAutomationRoots: () => MetadataNode[] }).getAutomationRoots = () => {
      calls++;
      return original();
    };

    service.resolveNode('Справочники.Пользователи');
    const after1 = calls;
    service.resolveNode('Справочники.Пользователи');
    const after2 = calls;

    // При мемоизации повторный resolveNode не должен снова запрашивать корни дерева.
    assert.strictEqual(after1, 1, `первый resolveNode: ожидался 1 вызов getAutomationRoots, получено ${String(after1)}`);
    assert.strictEqual(after2, 1, `второй resolveNode: дополнительные вызовы не ожидались, получено ${String(after2)}`);
  });

  test('buildIndex — onDidChangeTreeData сбрасывает кэш', () => {
    const emitter = new vscode.EventEmitter<MetadataNode | undefined | null>();
    const provider = createProvider();
    (provider as unknown as { onDidChangeTreeData: vscode.Event<MetadataNode | undefined | null> })
      .onDidChangeTreeData = emitter.event;

    const service = new McpMetadataPathService(provider);

    let calls = 0;
    const original = provider.getAutomationRoots.bind(provider);
    (provider as unknown as { getAutomationRoots: () => MetadataNode[] }).getAutomationRoots = () => {
      calls++;
      return original();
    };

    service.resolveNode('Справочники.Пользователи');
    assert.strictEqual(calls, 1);

    service.resolveNode('Справочники.Пользователи');
    assert.strictEqual(calls, 1, 'memo hit без событий');

    emitter.fire(undefined);

    service.resolveNode('Справочники.Пользователи');
    assert.strictEqual(calls, 2, 'после onDidChangeTreeData индекс должен перестроиться');

    emitter.dispose();
  });
});

// ─── Тестовые утилиты ─────────────────────────────────────────────────────

function createProvider(options: {
  readonly withExtension?: boolean;
  readonly withSubsystems?: boolean;
  readonly withStandardAttribute?: boolean;
} = {}): MetadataTreeProvider {
  const attribute = node('Фамилия', 'Attribute', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    owner: '/tmp/cf/Catalogs/Пользователи.xml',
  });
  const form = node('ФормаСписка', 'Form', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    owner: '/tmp/cf/Catalogs/Пользователи.xml',
  });
  const standardAttribute = node('Код', 'StandardAttribute', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    owner: '/tmp/cf/Catalogs/Пользователи.xml',
  });
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

  const catalogGroups: MetadataNode[] = [];
  if (options.withStandardAttribute) {
    catalogGroups.push(group('Стандартные реквизиты', 'StandardAttribute', [standardAttribute]));
  }
  catalogGroups.push(
    group('Реквизиты', 'Attribute', [attribute]),
    group('Табличные части', 'TabularSection', [tabularSection]),
    group('Формы', 'Form', [form]),
  );

  const catalog = node('Пользователи', 'Catalog', {
    xmlPath: '/tmp/cf/Catalogs/Пользователи.xml',
    children: catalogGroups,
  });
  const catalogs = node('Справочники', 'group-type', {
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
  const dataProcessors = node('Обработки', 'group-type', {
    children: [dataProcessor],
    addMetadataTarget: {
      kind: 'root',
      configRoot: '/tmp/cf',
      configKind: 'cf',
      targetKind: 'DataProcessor',
    },
  });

  const rootChildren: MetadataNode[] = [catalogs, dataProcessors];

  if (options.withSubsystems) {
    const subsystemReturns = node('Возвраты', 'Subsystem', {
      xmlPath: '/tmp/cf/Subsystems/Возвраты.xml',
    });
    const subsystemRetail = node('Розница', 'Subsystem', {
      xmlPath: '/tmp/cf/Subsystems/Розница.xml',
      children: [subsystemReturns],
    });
    const subsystemSales = node('Продажи', 'Subsystem', {
      xmlPath: '/tmp/cf/Subsystems/Продажи.xml',
      children: [subsystemRetail],
    });
    const subsystemsGroup = node('Подсистемы', 'group-type', {
      children: [subsystemSales],
      addMetadataTarget: {
        kind: 'root',
        configRoot: '/tmp/cf',
        configKind: 'cf',
        targetKind: 'Subsystem',
      },
    });
    rootChildren.push(subsystemsGroup);
  }

  const root = node('Конфигурация', 'configuration', {
    xmlPath: '/tmp/cf/Configuration.xml',
    children: rootChildren,
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
      { rootPath: '/tmp/cf', kind: 'cf' as const },
      ...(options.withExtension ? [{ rootPath: '/tmp/cfe/EVOLC', kind: 'cfe' as const }] : []),
    ],
  } as unknown as MetadataTreeProvider;
}

function group(
  label: string,
  childTag: 'Attribute' | 'TabularSection' | 'Form' | 'Template' | 'StandardAttribute',
  children: MetadataNode[],
): MetadataNode {
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
  } = {},
): MetadataNode {
  const children = options.children;
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
    childrenLoader: children ? () => children : undefined,
    addMetadataTarget: options.addMetadataTarget,
  }, children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
}
