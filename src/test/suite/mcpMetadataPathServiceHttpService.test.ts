/**
 * `McpMetadataPathService` — резолв и индексация путей третьего уровня
 * вложенности HTTP-сервиса (`HTTPService → URLTemplate → Method`), по образцу
 * существующего покрытия `TabularSection → Column` в mcpMetadataPathService.test.ts.
 *
 * До реализации домена (`CHILD_TAG_CONFIG.URLTemplate/Method`, ветки
 * `canonicalChildPath`/`parseAfterRoot` для `urlTemplateName`) и индексации
 * (`McpMetadataPathService.collectChildNode` — рекурсия во вложенную группу
 * методов, аналог ветки `childTag === 'TabularSection'`) эти тесты либо бросают
 * исключение при построении индекса (`CHILD_TAG_CONFIG['URLTemplate']`
 * не определён), либо не находят узел/цель добавления.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpMetadataPathService } from '../../ui/mcp/McpMetadataPathService';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { MetadataNode } from '../../ui/tree/TreeNode';

suite('McpMetadataPathService — HTTP-сервис: URLTemplate → Method', () => {
  test('Справочники.* регресс: обычный узел резолвится, дерево с HTTPService не ломает существующую навигацию', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('HTTPСервисы.ServiceEntry');
    assert.strictEqual(node.nodeKind, 'HTTPService');
  });

  test('HTTPСервисы.X.URLШаблон.Y — узел URLTemplate резолвится по канону', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries');
    assert.strictEqual(node.nodeKind, 'URLTemplate');
    assert.strictEqual(node.textLabel, 'PostEntries');
  });

  test('HTTPСервисы.X.URLШаблон.Y.Метод.Z — узел Method резолвится (третий уровень вложенности)', () => {
    const service = new McpMetadataPathService(createProvider());
    const node = service.resolveNode('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.POST');
    assert.strictEqual(node.nodeKind, 'Method');
    assert.strictEqual(node.textLabel, 'POST');
  });

  test('Одноимённые Method в разных URLTemplate резолвятся в РАЗНЫЕ узлы', () => {
    const service = new McpMetadataPathService(createProvider({ duplicateMethodName: true }));
    const inPostEntries = service.resolveNode('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.GET');
    const inPing = service.resolveNode('HTTPСервисы.ServiceEntry.URLШаблон.ping.Метод.GET');
    assert.notStrictEqual(inPostEntries, inPing, 'одноимённые методы в разных шаблонах — разные узлы дерева');
  });

  test('resolveAddTarget — новый URLTemplate в существующем HTTPService', () => {
    const service = new McpMetadataPathService(createProvider());
    const target = service.resolveAddTarget({ path: 'HTTPСервисы.ServiceEntry.URLШаблон.NewTemplate' });
    assert.strictEqual(target.target.kind, 'child');
    assert.strictEqual(target.target.childTag, 'URLTemplate');
    assert.strictEqual(target.name, 'NewTemplate');
  });

  test('resolveAddTarget — новый Method в существующем URLTemplate несёт urlTemplateName цели', () => {
    const service = new McpMetadataPathService(createProvider());
    const target = service.resolveAddTarget({
      path: 'HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.NewMethod',
    });
    assert.strictEqual(target.target.kind, 'child');
    assert.strictEqual(target.target.childTag, 'Method');
    assert.strictEqual(
      target.target.urlTemplateName,
      'PostEntries',
      'цель добавления Method должна нести имя контейнера-владельца urlTemplateName'
    );
    assert.strictEqual(target.name, 'NewMethod');
  });

  test('listTreePaths(depth=children) содержит канонический путь метода третьего уровня вложенности', () => {
    const service = new McpMetadataPathService(createProvider());
    const result = service.listTreePaths({ depth: 'children' });
    assert.ok(
      result.paths.includes('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.POST'),
      `ожидался путь метода в выдаче, получено: ${result.paths.filter((p) => p.startsWith('HTTPСервисы')).join(', ')}`
    );
  });

  test('listTreePaths(depth=objects) НЕ содержит URLTemplate/Method — это дочерние элементы, а не объекты', () => {
    const service = new McpMetadataPathService(createProvider());
    const result = service.listTreePaths({ depth: 'objects' });
    assert.ok(result.paths.includes('HTTPСервисы.ServiceEntry'));
    assert.ok(!result.paths.includes('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries'));
  });
});

// ─── Тестовые утилиты ─────────────────────────────────────────────────────

/**
 * Строит дерево HTTPService → URLTemplate → Method, по образцу
 * `createProvider` из mcpMetadataPathService.test.ts (Catalog → TabularSection → Column).
 */
function createProvider(options: { readonly duplicateMethodName?: boolean } = {}): MetadataTreeProvider {
  const xmlPath = '/tmp/cf/HTTPServices/ServiceEntry.xml';

  const methodPost = urlTemplateMethodNode('POST', xmlPath, 'PostEntries');
  const methodGetPing = urlTemplateMethodNode(options.duplicateMethodName ? 'GET' : 'GET', xmlPath, 'ping');
  const methodGetPostEntries = options.duplicateMethodName
    ? urlTemplateMethodNode('GET', xmlPath, 'PostEntries')
    : undefined;

  const postEntriesMethods = [methodPost, ...(methodGetPostEntries ? [methodGetPostEntries] : [])];
  // flatChildren: методы висят прямо на узле URL-шаблона (без группы «Методы»),
  // а URL-шаблоны — прямо на узле HTTP-сервиса (без группы «URL-шаблоны»), как в конфигураторе.
  const postEntries = urlTemplateNode('PostEntries', xmlPath, postEntriesMethods);
  const ping = urlTemplateNode('ping', xmlPath, [methodGetPing]);

  const httpService = node('ServiceEntry', 'HTTPService', {
    xmlPath,
    children: [postEntries, ping],
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: xmlPath,
      childTag: 'URLTemplate',
    },
  });
  const httpServicesGroup = node('HTTP-сервисы', 'group-type', {
    children: [httpService],
    addMetadataTarget: {
      kind: 'root',
      configRoot: '/tmp/cf',
      configKind: 'cf',
      targetKind: 'HTTPService',
    },
  });

  const root = node('Конфигурация', 'configuration', {
    xmlPath: '/tmp/cf/Configuration.xml',
    children: [httpServicesGroup],
  });

  return {
    getAutomationRoots: () => [root],
    getEntries: () => [{ rootPath: '/tmp/cf', kind: 'cf' as const }],
  } as unknown as MetadataTreeProvider;
}

function urlTemplateNode(name: string, xmlPath: string, children: MetadataNode[]): MetadataNode {
  return node(name, 'URLTemplate', {
    xmlPath,
    children,
    metaContext: {
      rootMetaKind: 'HTTPService',
      ownerObjectXmlPath: xmlPath,
    },
    // urlTemplateName — имя контейнера-родителя для методов (аналог tabularSectionName у колонок).
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: xmlPath,
      childTag: 'Method',
      urlTemplateName: name,
    },
  });
}

function urlTemplateMethodNode(name: string, xmlPath: string, urlTemplateName: string): MetadataNode {
  return node(name, 'Method', {
    xmlPath,
    metaContext: {
      rootMetaKind: 'HTTPService',
      ownerObjectXmlPath: xmlPath,
      urlTemplateName,
    },
  });
}

function node(
  label: string,
  nodeKind: MetadataNode['nodeKind'],
  options: {
    readonly xmlPath?: string;
    readonly children?: MetadataNode[];
    readonly metaContext?: MetadataNode['metaContext'];
    readonly addMetadataTarget?: MetadataNode['addMetadataTarget'];
  } = {},
): MetadataNode {
  const children = options.children;
  return new MetadataNode({
    label,
    nodeKind,
    xmlPath: options.xmlPath,
    metaContext: options.metaContext,
    childrenLoader: children ? () => children : undefined,
    addMetadataTarget: options.addMetadataTarget,
  }, children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
}
