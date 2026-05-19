import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigEntry } from '../../domain/Configuration';
import { buildMetadataCacheSnapshot, type MetadataCacheNode } from '../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';

const EXAMPLE_CFE = path.resolve(process.cwd(), 'example/src/cfe/EVOLC');

suite('MetadataCache', () => {
  test('Для объектов с плоским XML Git-декорация учитывает XML и каталог объекта', () => {
    const entry: ConfigEntry = { rootPath: EXAMPLE_CFE, kind: 'cfe' };
    const snapshot = buildMetadataCacheSnapshot('test-common-module-decoration', entry);

    const moduleNode = findNode(snapshot.root, (node) =>
      node.type === 'CommonModule' && node.name === 'ев_Действия'
    );
    assert.ok(moduleNode, 'Узел общего модуля ев_Действия не найден');
    assert.deepStrictEqual(moduleNode.gitDecorationTarget, {
      kind: 'paths',
      ownerXmlPath: path.join(EXAMPLE_CFE, 'CommonModules', 'ев_Действия.xml'),
      childKind: 'CommonModule',
      paths: [
        path.join(EXAMPLE_CFE, 'CommonModules', 'ев_Действия.xml'),
        path.join(EXAMPLE_CFE, 'CommonModules', 'ев_Действия'),
      ],
    });

    const roleNode = findNode(snapshot.root, (node) =>
      node.type === 'Role' && node.name === 'ев_ОсновнаяРоль'
    );
    assert.ok(roleNode, 'Узел роли ев_ОсновнаяРоль не найден');
    assert.deepStrictEqual(roleNode.gitDecorationTarget, {
      kind: 'paths',
      ownerXmlPath: path.join(EXAMPLE_CFE, 'Roles', 'ев_ОсновнаяРоль.xml'),
      childKind: 'Role',
      paths: [
        path.join(EXAMPLE_CFE, 'Roles', 'ев_ОсновнаяРоль.xml'),
        path.join(EXAMPLE_CFE, 'Roles', 'ев_ОсновнаяРоль'),
      ],
    });

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
