import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildMetadataCacheSnapshot, type MetadataCacheNode } from '../../infra/cache/MetadataCache';
import { resolveChildFormXml, resolveFormXmlByDescriptor } from '../../infra/fs/MetaPathResolver';
import { isFormRootXml } from '../../infra/xml/form/FormShared';
import { getObjectHandler } from '../../ui/tree/nodeBuilders';
import type { MetadataNode } from '../../ui/tree/TreeNode';
import { EXAMPLE_ROOT, hasFormCorpus } from './support/formFixtures';
import {
  createFormFixtureExport,
  createFormMcpHarnessOverEntry,
  type FormFixtureExport,
} from './support/mcpFormToolsHarness';

/**
 * T1. Сшивка дерева навигатора и MCP: контракт узла формы.
 *
 * Узел формы объекта несёт `xmlPath` ОБЪЕКТА-владельца — это сознательный адрес открытия по
 * клику (`resolveLeafXmlPath`), а не путь формы. MCP-резолвер строит путь тела формы из
 * `metaContext.ownerObjectXmlPath` + имени узла. Тест ловит будущую смену `resolveLeafXmlPath`,
 * которая тихо сломала бы MCP: такое изменение обязано сопровождаться правкой резолвера.
 *
 * Деревьев два источника (CLAUDE.md требует симметрии): нативный билдер `metaObjectTreeBuilder`
 * и JSON-кэш `MetadataCache` (из него строится навигатор и MCP). Оба фиксируются одним контрактом.
 */

function collectNative(node: MetadataNode, predicate: (n: MetadataNode) => boolean, out: MetadataNode[] = []): MetadataNode[] {
  if (predicate(node)) {
    out.push(node);
  }
  for (const child of node.childrenLoader?.() ?? []) {
    collectNative(child, predicate, out);
  }
  return out;
}

function collectCache(node: MetadataCacheNode, predicate: (n: MetadataCacheNode) => boolean, out: MetadataCacheNode[] = []): MetadataCacheNode[] {
  if (predicate(node)) {
    out.push(node);
  }
  for (const child of node.children) {
    collectCache(child, predicate, out);
  }
  return out;
}

/**
 * Общие формы кэша берутся ДЕТЬМИ узла-коллекции, а не фильтром `type === 'CommonForm'`.
 * Узел коллекции («Общие формы») несёт тот же `type`, что и её объекты (`MetadataCache`
 * строит его как `{ type: def.kind, name: def.kind }`), поэтому плоский фильтр по типу
 * возвращает коллекцию наравне с формами. Отсеивать её по `xmlPath !== undefined` нельзя:
 * ровно отсутствие `xmlPath` у формы — тот дефект, который этот тест обязан ловить.
 */
function collectCacheCommonForms(root: MetadataCacheNode): MetadataCacheNode[] {
  const collections = collectCache(root, (n) => n.type === 'CommonForm' && n.name === 'CommonForm');
  return collections.flatMap((c) => c.children);
}

function buildNativeNodes(fixture: FormFixtureExport, kind: 'Catalog' | 'CommonForm', name: string): MetadataNode[] {
  const handler = getObjectHandler(kind);
  assert.ok(handler, `для ${kind} должен быть зарегистрирован обработчик дерева`);
  return handler.buildTreeNodes({ configRoot: fixture.configRoot, configKind: 'cf', namePrefix: '', names: [name] });
}

suite('Контракт узла формы в дереве: нативный билдер и MetadataCache (T1)', () => {
  let fixture: FormFixtureExport;

  suiteSetup(() => {
    fixture = createFormFixtureExport();
  });
  suiteTeardown(() => {
    fs.rmSync(fixture.configRoot, { recursive: true, force: true });
  });

  test('нативный билдер: узел Form — xmlPath и ownerObjectXmlPath это XML объекта-владельца, textLabel — имя формы', () => {
    const [catalog] = buildNativeNodes(fixture, 'Catalog', fixture.catalogName);
    const forms = collectNative(catalog, (n) => n.nodeKind === 'Form');
    assert.strictEqual(forms.length, 1, 'у справочника одна форма');
    const form = forms[0];
    assert.strictEqual(form.nodeKind, 'Form');
    assert.strictEqual(form.xmlPath, fixture.catalogXml, 'xmlPath формы — XML объекта (адрес открытия по клику)');
    const context = form.metaContext;
    assert.ok(context, 'у формы объекта есть контекст владельца');
    assert.strictEqual(context.ownerObjectXmlPath, fixture.catalogXml);
    assert.strictEqual(context.rootMetaKind, 'Catalog');
    assert.strictEqual(form.textLabel, fixture.catalogFormName);
    assert.notStrictEqual(form.xmlPath, fixture.catalogFormBody, 'xmlPath формы объекта не должен быть телом формы');
    assert.notStrictEqual(form.xmlPath, fixture.catalogFormDescriptor, 'xmlPath формы объекта не должен быть дескриптором формы');
  });

  test('нативный билдер: узел CommonForm — xmlPath это дескриптор CommonForms/X.xml, metaContext нет', () => {
    const [commonForm] = buildNativeNodes(fixture, 'CommonForm', fixture.commonFormName);
    assert.strictEqual(commonForm.nodeKind, 'CommonForm');
    assert.strictEqual(commonForm.xmlPath, fixture.commonFormXml);
    assert.strictEqual(commonForm.metaContext, undefined, 'общая форма — корневой объект, контекст владельца отсутствует');
    assert.strictEqual(commonForm.textLabel, fixture.commonFormName);
  });

  test('MetadataCache: узел Form — тот же контракт (type, xmlPath, ownerObjectXmlPath, label)', () => {
    const snapshot = buildMetadataCacheSnapshot('form-node-contract', { rootPath: fixture.configRoot, kind: 'cf' });
    const forms = collectCache(snapshot.root, (n) => n.type === 'Form');
    assert.strictEqual(forms.length, 1);
    const form = forms[0];
    assert.strictEqual(form.xmlPath, fixture.catalogXml);
    const context = form.metaContext;
    assert.ok(context, 'у формы объекта есть контекст владельца');
    assert.strictEqual(context.ownerObjectXmlPath, fixture.catalogXml);
    assert.strictEqual(context.rootMetaKind, 'Catalog');
    assert.strictEqual(form.label, fixture.catalogFormName);
  });

  test('MetadataCache: узел CommonForm — xmlPath это дескриптор, metaContext нет', () => {
    const snapshot = buildMetadataCacheSnapshot('form-node-contract-common', { rootPath: fixture.configRoot, kind: 'cf' });
    const commonForms = collectCacheCommonForms(snapshot.root);
    assert.strictEqual(commonForms.length, 1);
    assert.strictEqual(commonForms[0].xmlPath, fixture.commonFormXml);
    assert.strictEqual(commonForms[0].metaContext, undefined);
    assert.strictEqual(commonForms[0].label, fixture.commonFormName);
  });

  test('симметрия двух источников дерева: узел формы совпадает по всем полям контракта', () => {
    const [catalog] = buildNativeNodes(fixture, 'Catalog', fixture.catalogName);
    const native = collectNative(catalog, (n) => n.nodeKind === 'Form')[0];
    const snapshot = buildMetadataCacheSnapshot('form-node-contract-sym', { rootPath: fixture.configRoot, kind: 'cf' });
    const cached = collectCache(snapshot.root, (n) => n.type === 'Form')[0];
    assert.deepStrictEqual(
      { kind: native.nodeKind, xmlPath: native.xmlPath, owner: native.metaContext?.ownerObjectXmlPath, label: native.textLabel },
      { kind: cached.type, xmlPath: cached.xmlPath, owner: cached.metaContext?.ownerObjectXmlPath, label: cached.label },
    );
  });

  test('реальный MetadataTreeProvider + McpMetadataPathService отдают агенту узлы с тем же контрактом', function () {
    this.timeout(30_000);
    const harness = createFormMcpHarnessOverEntry({ rootPath: fixture.configRoot, kind: 'cf' });
    try {
      const form = harness.paths.resolveNode(`Справочники.${fixture.catalogName}.Форма.${fixture.catalogFormName}`);
      assert.strictEqual(form.nodeKind, 'Form');
      assert.strictEqual(form.xmlPath, fixture.catalogXml);
      assert.strictEqual(form.metaContext?.ownerObjectXmlPath, fixture.catalogXml);
      assert.strictEqual(form.textLabel, fixture.catalogFormName);

      const common = harness.paths.resolveNode(`ОбщиеФормы.${fixture.commonFormName}`);
      assert.strictEqual(common.nodeKind, 'CommonForm');
      assert.strictEqual(common.xmlPath, fixture.commonFormXml);
      assert.strictEqual(common.metaContext, undefined);
    } finally {
      harness.dispose();
    }
  });
});

suite('Контракт узла формы на корпусе example/ (T1, cf и cfe)', () => {
  suiteSetup(function () {
    if (!hasFormCorpus()) {
      this.skip();
    }
  });

  // 2.21/cf — 4 ГБ, полный снимок на нём непозволительно долог; 2.20/cf (37 МБ) и реальное
  // расширение EVOLC (2.21) покрывают обе генерации и оба вида конфигураций.
  const scopes: readonly { readonly label: string; readonly root: string; readonly kind: 'cf' | 'cfe' }[] = [
    { label: '2.20 cf', root: path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf'), kind: 'cf' },
    { label: '2.21 cfe EVOLC', root: path.join(EXAMPLE_ROOT, '2.21', 'src', 'cfe', 'EVOLC'), kind: 'cfe' },
  ];

  for (const scope of scopes) {
    test(`${scope.label}: у КАЖДОЙ формы xmlPath == ownerObjectXmlPath, а тело формы вычисляется арифметикой и существует`, function () {
      this.timeout(120_000);
      if (!fs.existsSync(scope.root)) {
        this.skip();
      }
      const snapshot = buildMetadataCacheSnapshot(`form-corpus-${scope.label}`, { rootPath: scope.root, kind: scope.kind });
      const forms = collectCache(snapshot.root, (n) => n.type === 'Form');
      assert.ok(forms.length > 0, 'в корпусе должны быть формы объектов');
      const violations: string[] = [];
      for (const form of forms) {
        const owner = form.metaContext?.ownerObjectXmlPath;
        if (owner === undefined || form.xmlPath !== owner) {
          violations.push(`${form.label}: xmlPath=${String(form.xmlPath)} owner=${String(owner)}`);
          continue;
        }
        const body = resolveChildFormXml(owner, form.label);
        if (!fs.existsSync(body) || !isFormRootXml(fs.readFileSync(body, 'utf-8').slice(0, 4096))) {
          violations.push(`${form.label}: тело формы не найдено арифметикой: ${body}`);
        }
      }
      assert.deepStrictEqual(violations, []);
    });

    test(`${scope.label}: у КАЖДОЙ общей формы xmlPath — дескриптор, а тело вычисляется арифметикой и существует`, function () {
      this.timeout(120_000);
      if (!fs.existsSync(scope.root)) {
        this.skip();
      }
      const snapshot = buildMetadataCacheSnapshot(`form-corpus-common-${scope.label}`, { rootPath: scope.root, kind: scope.kind });
      const commonForms = collectCacheCommonForms(snapshot.root);
      assert.ok(commonForms.length > 0, 'в корпусе должны быть общие формы');
      const violations: string[] = [];
      for (const form of commonForms) {
        const descriptor = form.xmlPath;
        if (descriptor === undefined || form.metaContext !== undefined) {
          violations.push(`${form.label}: xmlPath=${String(descriptor)} metaContext=${JSON.stringify(form.metaContext)}`);
          continue;
        }
        const body = resolveFormXmlByDescriptor(descriptor);
        if (!fs.existsSync(body) || !isFormRootXml(fs.readFileSync(body, 'utf-8').slice(0, 4096))) {
          violations.push(`${form.label}: тело общей формы не найдено арифметикой: ${body}`);
        }
      }
      assert.deepStrictEqual(violations, []);
    });
  }
});
