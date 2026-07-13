import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigEntry } from '../../domain/Configuration';
import {
  buildMetadataCacheScopeKey,
  buildMetadataCacheSnapshot,
  type MetadataCacheNode,
  saveMetadataCache,
  updateMetadataCacheForChangedFiles,
} from '../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../infra/fs/MetaPathResolver';
import { parseConfigXml } from '../../infra/xml';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';

const EXAMPLE_CFE_ROOT = path.resolve(__dirname, '../../../example/2.21/src/cfe');
const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

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
    // Проверяем инвариант на любой доступной конфигурации: либо CFE из example/2.21/src/cfe,
    // либо CF из example/2.20/src/cf — оба сценария содержат плоские XML объекты с боковым каталогом.
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

  test('HTTP-сервис: URL-шаблоны и методы висят прямо на узлах, без промежуточных групп (flatChildren)', () => {
    const snapshot = buildMetadataCacheSnapshot('test-http-service-flat', { rootPath: EXAMPLE_CF, kind: 'cf' });

    const service = findNode(snapshot.root, (node) => node.type === 'HTTPService' && node.name === 'ОписанияТоваров');
    assert.ok(service, 'HTTP-сервис ОписанияТоваров найден в кэше');

    // Никакой группы-обёртки «URL-шаблоны» под сервисом быть не должно.
    assert.ok(
      !service.children.some((child) => child.type === 'group-type'),
      'под HTTP-сервисом не должно быть group-type узлов (URL-шаблоны не оборачиваются в группу)'
    );
    // Кнопка «Добавить» URL-шаблон живёт на самом узле сервиса.
    const svcTarget = service.addMetadataTarget;
    assert.ok(svcTarget?.kind === 'child', 'на узле сервиса — цель добавления дочернего элемента');
    assert.strictEqual(svcTarget.childTag, 'URLTemplate');

    // URL-шаблон — прямой ребёнок сервиса; метод — прямой ребёнок шаблона.
    const template = service.children.find((child) => child.type === 'URLTemplate' && child.name === 'V1_ВызовМетода');
    assert.ok(template, 'URL-шаблон V1_ВызовМетода — прямой ребёнок сервиса');
    assert.ok(
      !template.children.some((child) => child.type === 'group-type'),
      'под URL-шаблоном не должно быть group-type узлов (методы не оборачиваются в группу)'
    );
    const method = template.children.find((child) => child.type === 'Method' && child.name === 'POST');
    assert.ok(method, 'метод POST — прямой ребёнок URL-шаблона');
    const tmplTarget = template.addMetadataTarget;
    assert.ok(tmplTarget?.kind === 'child', 'на узле URL-шаблона — цель добавления метода');
    assert.strictEqual(
      tmplTarget.childTag,
      'Method',
      'на узле URL-шаблона — цель добавления метода'
    );
  });

  test('РЕГРЕСС: добавление метода не возвращает группу «URL-шаблоны» (инкрементальное обновление flat-объекта)', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cache-http-add-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cache-http-proj-'));
    try {
      copyDirSync(EXAMPLE_CF, configRoot);
      const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
      const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
      assert.ok(info);
      const scopeKey = buildMetadataCacheScopeKey(entry, info);
      // Персистим исходный (плоский) снимок — как в рабочем расширении до мутации.
      saveMetadataCache(projectRoot, buildMetadataCacheSnapshot(scopeKey, entry));

      // Реальная мутация: добавляем метод в URL-шаблон V1_ВызовМетода.
      const serviceXml = path.join(configRoot, 'HTTPServices', 'ОписанияТоваров.xml');
      const added = new MetadataXmlCreator().addChildElement({
        ownerObjectXmlPath: serviceXml,
        childTag: 'Method',
        name: 'РегрессДобавленияМетода',
        urlTemplateName: 'V1_ВызовМетода',
      });
      assert.ok(added.success, added.errors.join('; '));

      // Инкрементальное обновление кэша по изменённому файлу сервиса (путь, который
      // раньше терял flatChildren и возвращал группу «URL-шаблоны»).
      const result = updateMetadataCacheForChangedFiles(projectRoot, entry, [serviceXml]);
      assert.ok(result, 'инкрементальное обновление вернуло снимок');

      const service = findNode(result.snapshot.root, (n) => n.type === 'HTTPService' && n.name === 'ОписанияТоваров');
      assert.ok(service);
      assert.ok(
        !service.children.some((c) => c.type === 'group-type'),
        'после добавления метода под сервисом НЕ должно появиться группы «URL-шаблоны»'
      );
      const template = service.children.find((c) => c.type === 'URLTemplate' && c.name === 'V1_ВызовМетода');
      assert.ok(template, 'URL-шаблон остаётся прямым ребёнком сервиса');
      assert.ok(
        template.children.some((c) => c.type === 'Method' && c.name === 'РегрессДобавленияМетода'),
        'новый метод виден в дереве под шаблоном'
      );
    } finally {
      fs.rmSync(configRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

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
