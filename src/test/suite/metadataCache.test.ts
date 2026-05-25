import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigEntry } from '../../domain/Configuration';
import { buildMetadataCacheSnapshot, type MetadataCacheNode } from '../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';

const EXAMPLE_CFE_ROOT = path.resolve(__dirname, '../../../example/src/cfe');
const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');

function findFirstCfeRoot(): string | null {
  if (!fs.existsSync(EXAMPLE_CFE_ROOT)) {
    return null;
  }
  for (const entry of fs.readdirSync(EXAMPLE_CFE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(EXAMPLE_CFE_ROOT, entry.name);
    if (fs.existsSync(path.join(candidate, 'Configuration.xml'))) {
      return candidate;
    }
  }
  return null;
}

suite('MetadataCache', () => {
  test('Для объектов с плоским XML Git-декорация учитывает XML и каталог объекта', function () {
    // Проверяем инвариант на любой доступной конфигурации: либо CFE из example/src/cfe,
    // либо CF из example/src/cf — оба сценария содержат плоские XML объекты с боковым каталогом.
    const cfeRoot = findFirstCfeRoot();
    const entry: ConfigEntry = cfeRoot
      ? { rootPath: cfeRoot, kind: 'cfe' }
      : { rootPath: EXAMPLE_CF, kind: 'cf' };
    const snapshot = buildMetadataCacheSnapshot('test-common-module-decoration', entry);

    const flatNode = findNode(snapshot.root, (node) => {
      if (!node.xmlPath) {
        return false;
      }
      const loc = getObjectLocationFromXml(node.xmlPath);
      return path.resolve(path.dirname(node.xmlPath)) !== path.resolve(loc.objectDir)
        && fs.existsSync(loc.objectDir);
    });
    assert.ok(flatNode, 'Не найден ни один плоский объект с боковым каталогом');
    const target = flatNode.gitDecorationTarget;
    assert.ok(target, 'gitDecorationTarget пуст');
    assert.strictEqual(target.kind, 'paths');
    const paths = target.paths ?? [];
    assert.ok(
      flatNode.xmlPath && paths.includes(flatNode.xmlPath),
      'paths gitDecorationTarget не содержит сам XML'
    );
    const loc = flatNode.xmlPath ? getObjectLocationFromXml(flatNode.xmlPath) : null;
    assert.ok(loc && paths.includes(loc.objectDir),
      'paths gitDecorationTarget не содержит каталог объекта');

    assert.deepStrictEqual(collectMissingFlatObjectTargets(snapshot.root), []);
  });

  test('Текстовые макеты получают команду открытия содержимого по клику', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-template-cache-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'DataProcessor', name: 'Обработка' }).success, true);
    assert.strictEqual(creator.addRootObject({
      configRoot,
      kind: 'CommonTemplate',
      name: 'ОбщийТекст',
      templateType: 'TextDocument',
    }).success, true);
    const ownerXmlPath = path.join(configRoot, 'DataProcessors', 'Обработка.xml');
    assert.strictEqual(creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Текст',
      templateType: 'TextDocument',
    }).success, true);
    assert.strictEqual(creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Таблица',
      templateType: 'SpreadsheetDocument',
    }).success, true);

    const snapshot = buildMetadataCacheSnapshot('test-text-template-click', { rootPath: configRoot, kind: 'cf' });
    const textTemplate = findNode(snapshot.root, (node) => node.type === 'Template' && node.name === 'Текст');
    const spreadsheetTemplate = findNode(snapshot.root, (node) => node.type === 'Template' && node.name === 'Таблица');
    const commonTemplate = findNode(snapshot.root, (node) => node.type === 'CommonTemplate' && node.name === 'ОбщийТекст');

    assert.strictEqual(textTemplate?.singleClickAction, 'openTemplateContent');
    assert.strictEqual(commonTemplate?.singleClickAction, 'openTemplateContent');
    assert.strictEqual(spreadsheetTemplate?.singleClickAction, undefined);
  });

  test('Макеты справочника отображаются в дереве после табличных частей', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-catalog-template-cache-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
    const ownerXmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXmlPath, childTag: 'TabularSection', name: 'Состав' }).success, true);
    assert.strictEqual(creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Печать',
      templateType: 'TextDocument',
    }).success, true);

    const snapshot = buildMetadataCacheSnapshot('test-catalog-template-after-tabular-section', { rootPath: configRoot, kind: 'cf' });
    const template = findNode(snapshot.root, (node) => node.type === 'Template' && node.name === 'Печать');
    assert.ok(template, 'Макет справочника не найден в дереве');
    assert.strictEqual(template.singleClickAction, 'openTemplateContent');
  });
});

function findNode(
  node: MetadataCacheNode,
  predicate: (node: MetadataCacheNode) => boolean
): MetadataCacheNode | undefined {
  if (predicate(node)) {
    return node;
  }

  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function collectMissingFlatObjectTargets(node: MetadataCacheNode): string[] {
  const result: string[] = [];

  if (node.xmlPath && node.decorationPath) {
    const loc = getObjectLocationFromXml(node.xmlPath);
    const xmlDir = path.resolve(path.dirname(node.xmlPath));
    const objectDir = path.resolve(loc.objectDir);
    if (xmlDir !== objectDir && fs.existsSync(loc.objectDir)) {
      const targetPaths = node.gitDecorationTarget?.kind === 'paths'
        ? node.gitDecorationTarget.paths ?? []
        : [];
      if (!targetPaths.includes(node.xmlPath) || !targetPaths.includes(loc.objectDir)) {
        result.push(`${node.type}:${node.name}`);
      }
    }
  }

  for (const child of node.children) {
    result.push(...collectMissingFlatObjectTargets(child));
  }

  return result;
}

function buildConfigXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`;
}
