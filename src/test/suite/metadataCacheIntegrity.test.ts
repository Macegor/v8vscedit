import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ConfigEntry } from '../../domain/Configuration';
import {
  buildMetadataCacheScopeKey,
  buildMetadataCacheSnapshot,
  loadMetadataCache,
  saveMetadataCache,
  updateMetadataCacheForChangedFiles,
  type MetadataCacheNode,
  type MetadataCacheSnapshot,
} from '../../infra/cache/MetadataCache';
import { parseConfigXml } from '../../infra/xml';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';

/**
 * Суб-волна 3b: корректность кэша метаданных.
 *  C3 — свежесть кэша (снимок должен инвалидироваться при расхождении с ФС);
 *  M4 — атомарность записи (temp+rename, без голого writeFileSync);
 *  M5 — дедуп удаляемых узлов (splice по устаревшим индексам не должен задевать соседей).
 *
 * Все сценарии строятся на реальных temp-выгрузках, создаваемых через
 * MetadataXmlCreator (тот же генератор, что использует production-код),
 * без фиктивных ассёртов.
 */

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

function makeTempConfigRoot(prefix: string): string {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
  return configRoot;
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

function countNodes(node: MetadataCacheNode, predicate: (node: MetadataCacheNode) => boolean): number {
  let count = predicate(node) ? 1 : 0;
  for (const child of node.children) {
    count += countNodes(child, predicate);
  }
  return count;
}

/** Каталог служебного кэша `.v8vscedit/meta` относительно корня проекта (temp-корня в тестах). */
function metaCacheDir(projectRoot: string): string {
  return path.join(projectRoot, '.v8vscedit', 'meta');
}

function listCacheFiles(projectRoot: string): string[] {
  const dir = metaCacheDir(projectRoot);
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir);
}

suite('MetadataCache — целостность (C3/M4/M5)', () => {
  suite('C3 — свежесть кэша', () => {
    test('loadMetadataCache возвращает снимок, если ФС не менялась с момента сохранения', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-fresh-ok-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info, 'Configuration.xml должен парситься');
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Без изменений в ФС кэш обязан отдаваться повторно и одинаково —
        // иначе каждое обращение будет пересобирать дерево заново.
        const loadedFirst = loadMetadataCache(configRoot, scopeKey);
        const loadedSecond = loadMetadataCache(configRoot, scopeKey);
        assert.ok(loadedFirst, 'Первая загрузка должна вернуть снимок при неизменной ФС');
        assert.ok(loadedSecond, 'Повторная загрузка без изменений ФС тоже должна вернуть снимок');
        assert.strictEqual(loadedFirst.scopeKey, scopeKey);
        assert.strictEqual(loadedSecond.scopeKey, scopeKey);
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('loadMetadataCache возвращает null, если Configuration.xml изменилась после сохранения снимка', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-stale-configxml-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Дописываем Configuration.xml — типичный сценарий добавления нового
        // корневого типа в ChildObjects в обход перехваченного добавления через кэш.
        const configXmlPath = path.join(configRoot, 'Configuration.xml');
        const original = fs.readFileSync(configXmlPath, 'utf-8');
        // Сдвигаем mtime на секунду вперёд для детерминизма (гранулярность ФС может
        // не заметить правку в ту же секунду) и одновременно меняем содержимое.
        fs.writeFileSync(configXmlPath, original.replace('ТестоваяКонфигурация', 'ТестоваяКонфигурацияИзменена'), 'utf-8');
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(configXmlPath, future, future);

        const loaded = loadMetadataCache(configRoot, scopeKey);
        assert.strictEqual(loaded, null, 'Кэш должен инвалидироваться при расхождении отпечатка Configuration.xml с ФС');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('loadMetadataCache возвращает null, если корневой каталог выгрузки изменился после сохранения снимка', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-stale-rootdir-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Добавление нового объекта в выгрузку меняет mtime корневого каталога
        // (появляется новая папка Catalogs), но не трогает Configuration.xml —
        // отпечаток должен реагировать и на это расхождение.
        const creator = new MetadataXmlCreator();
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
        const future = new Date(Date.now() + 5000);
        fs.utimesSync(configRoot, future, future);

        const loaded = loadMetadataCache(configRoot, scopeKey);
        assert.strictEqual(loaded, null, 'Кэш должен инвалидироваться при расхождении отпечатка корневого каталога с ФС');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('loadMetadataCache возвращает null для снимка с устаревшей версией схемы', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-old-schema-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Эмулируем кэш, оставшийся от прежней версии расширения: без нового
        // поля fingerprint и со старым schemaVersion (13, было до подъёма до 14).
        const filePath = path.join(metaCacheDir(configRoot), fs.readdirSync(metaCacheDir(configRoot))[0]);
        const stale = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MetadataCacheSnapshot;
        (stale as unknown as { schemaVersion: number }).schemaVersion = 13;
        delete (stale as unknown as { fingerprint?: unknown }).fingerprint;
        fs.writeFileSync(filePath, JSON.stringify(stale), 'utf-8');

        const loaded = loadMetadataCache(configRoot, scopeKey);
        assert.strictEqual(loaded, null, 'Кэш со старой schemaVersion должен считаться недействительным независимо от ФС');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('loadMetadataCache возвращает null, если весь корень выгрузки удалён с диска (statSync падает для обоих путей)', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-stale-rootdir-gone-');
      const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
      const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
      assert.ok(info);
      const scopeKey = buildMetadataCacheScopeKey(entry, info);
      const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
      // Сохраняем в ОТДЕЛЬНЫЙ каталог проекта, а не внутрь самой выгрузки —
      // иначе rmSync ниже удалит и файл кэша, который нужен для loadMetadataCache.
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cache-project-'));
      try {
        saveMetadataCache(projectRoot, snapshot);

        // Удаляем весь корень выгрузки целиком: и Configuration.xml, и сам каталог
        // перестают существовать — statSafe должен поймать ENOENT для обоих путей
        // (веточные fallback `?? 0`/`?? -1` в computeFingerprint) без падения процесса.
        fs.rmSync(configRoot, { recursive: true, force: true });

        const loaded = loadMetadataCache(projectRoot, scopeKey);
        assert.strictEqual(loaded, null, 'Кэш должен инвалидироваться, если корень выгрузки исчез целиком');
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('loadMetadataCache возвращает null, если в сохранённом снимке rootPath не строка (испорченный чужой формат)', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-bad-rootpath-type-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Подделываем сохранённый JSON так, будто rootPath повреждён внешним
        // инструментом (число вместо строки) — ветка `typeof ... === 'string'`
        // должна отработать fallback на пустую строку и не бросить исключение.
        const filePath = path.join(metaCacheDir(configRoot), fs.readdirSync(metaCacheDir(configRoot))[0]);
        const stale = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
        stale.rootPath = 12345;
        fs.writeFileSync(filePath, JSON.stringify(stale), 'utf-8');

        const loaded = loadMetadataCache(configRoot, scopeKey);
        assert.strictEqual(loaded, null, 'Кэш с нестроковым rootPath должен считаться недействительным, а не падать исключением');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('loadMetadataCache возвращает null для файла кэша с испорченным JSON (JSON.parse кидает исключение)', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-broken-json-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Реальная порча файла (обрезанный JSON) — типичный результат прерванной
        // записи на диске сторонним процессом в обход атомарного saveMetadataCache.
        const filePath = path.join(metaCacheDir(configRoot), fs.readdirSync(metaCacheDir(configRoot))[0]);
        fs.writeFileSync(filePath, '{"schemaVersion": 14, "root": ', 'utf-8');

        const loaded = loadMetadataCache(configRoot, scopeKey);
        assert.strictEqual(loaded, null, 'Испорченный JSON кэша должен обрабатываться как отсутствие кэша, без падения исключением');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('текущий schemaVersion снимка поднят минимум до 14 (введён fingerprint)', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-schema-version-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);

        assert.ok(
          (snapshot.schemaVersion as unknown as number) >= 14,
          `schemaVersion снимка должен быть поднят до 14+ при введении fingerprint, получено ${String(snapshot.schemaVersion)}`
        );
        assert.ok(
          'fingerprint' in snapshot,
          'MetadataCacheSnapshot должен содержать поле fingerprint для проверки свежести'
        );
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });
  });

  suite('M4 — атомарность записи кэша', () => {
    test('после saveMetadataCache в каталоге кэша не остаётся временных *.tmp файлов', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-atomic-ok-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        const files = listCacheFiles(configRoot);
        assert.ok(files.length > 0, 'Файл кэша должен быть создан');
        const tmpFiles = files.filter((name) => name.endsWith('.tmp'));
        assert.deepStrictEqual(tmpFiles, [], 'После сохранения кэша не должно оставаться временных .tmp файлов');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('saveMetadataCache пишет через временный файл и rename, а не напрямую writeFileSync в целевой путь', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-atomic-rename-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);

        // Мокаем fs.writeFileSync, чтобы зафиксировать, что запись идёт НЕ напрямую
        // в целевой файл кэша (иначе прерывание процесса между записью и flush
        // оставит битый JSON, который потом не пройдёт JSON.parse при loadMetadataCache).
        // Это единственный обоснованный mock — имитация внешнего сбоя/особенности ФС,
        // сам факт вызова нельзя пронаблюдать иначе без порчи реального диска.
        // Мутируем сам CJS-модуль `fs` через require — импорт `import * as fs` в
        // скомпилированном коде превращается в getter-обёртку (__importStar),
        // не позволяющую подменить метод локально.
        const fsModule = require('fs') as Record<string, unknown>;
        const originalWriteFileSync = fs.writeFileSync;
        const writtenPaths: string[] = [];
        fsModule.writeFileSync = (
          targetPath: fs.PathOrFileDescriptor,
          data: Parameters<typeof fs.writeFileSync>[1],
          options?: Parameters<typeof fs.writeFileSync>[2]
        ): void => {
          writtenPaths.push(String(targetPath));
          originalWriteFileSync(targetPath, data, options);
        };

        try {
          saveMetadataCache(configRoot, snapshot);
        } finally {
          fsModule.writeFileSync = originalWriteFileSync;
        }

        const targetFile = path.join(metaCacheDir(configRoot), fs.readdirSync(metaCacheDir(configRoot))[0]);
        assert.ok(
          writtenPaths.every((p) => p !== targetFile),
          'writeFileSync не должен писать напрямую в целевой файл кэша — только во временный файл с последующим rename'
        );
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('запись идёт через промежуточный файл: сбой при записи НАПРЯМУЮ в целевой путь не должен портить кэш', () => {
      // Ключевой тест атомарности: мокаем writeFileSync так, чтобы падать именно
      // при попытке записать НАПРЯМУЮ в целевой файл кэша (без ".tmp" в пути),
      // но разрешаем запись в любой временный файл. Атомарная реализация
      // (temp+rename, как в HashCache.saveHashCache) пройдёт успешно — она пишет
      // во временный файл и только потом переименовывает. Голая реализация
      // `fs.writeFileSync(filePath, ...)` упадёт, потому что пишет прямо в
      // целевой путь. Это единственный способ различить два поведения без
      // реального повреждения диска — обоснованный mock внешнего сбоя ФС.
      const configRoot = makeTempConfigRoot('v8vscedit-cache-atomic-direct-write-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        const cacheDir = metaCacheDir(configRoot);
        const expectedTargetFile = path.join(
          cacheDir,
          `${crypto.createHash('sha1').update(scopeKey).digest('hex')}.json`
        );

        const fsModule = require('fs') as Record<string, unknown>;
        const originalWriteFileSync = fs.writeFileSync;
        fsModule.writeFileSync = (
          targetPath: fs.PathOrFileDescriptor,
          data: Parameters<typeof fs.writeFileSync>[1],
          options?: Parameters<typeof fs.writeFileSync>[2]
        ): void => {
          if (path.resolve(String(targetPath)) === path.resolve(expectedTargetFile)) {
            throw new Error('EACCES: имитация сбоя прямой записи в целевой файл кэша');
          }
          originalWriteFileSync(targetPath, data, options);
        };

        try {
          saveMetadataCache(configRoot, snapshot);
        } finally {
          fsModule.writeFileSync = originalWriteFileSync;
        }

        // Если реализация атомарна (пишет во временный файл и делает rename),
        // прямая запись в целевой путь ни разу не понадобится и кэш сохранится.
        assert.ok(fs.existsSync(expectedTargetFile), 'Итоговый файл кэша должен быть создан через temp+rename, а не напрямую');
        const saved = JSON.parse(fs.readFileSync(expectedTargetFile, 'utf-8')) as MetadataCacheSnapshot;
        assert.strictEqual(saved.scopeKey, scopeKey);

        const leftoverTmp = fs.existsSync(cacheDir)
          ? fs.readdirSync(cacheDir).filter((name) => name.endsWith('.tmp'))
          : [];
        assert.deepStrictEqual(leftoverTmp, [], 'После успешной атомарной записи не должно оставаться временных .tmp файлов');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('сбой записи ВО ВРЕМЕННЫЙ файл пробрасывается наружу и не оставляет .tmp мусора (catch-ветка atomic-write)', () => {
      // Единственный обоснованный mock в этом наборе: реальный сбой ФС при записи
      // временного файла нельзя детерминированно воспроизвести без порчи диска
      // (нет прав/нет места). Проверяем, что catch-ветка saveMetadataCache
      // (fs.rmSync(tempPath) + throw error) действительно вызывается: подделываем
      // именно временный путь (содержащий ".tmp"), оставляя реальную запись
      // в остальные пути нетронутой.
      const configRoot = makeTempConfigRoot('v8vscedit-cache-atomic-catch-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        const cacheDir = metaCacheDir(configRoot);
        const targetFile = path.join(cacheDir, `${crypto.createHash('sha1').update(scopeKey).digest('hex')}.json`);

        const fsModule = require('fs') as Record<string, unknown>;
        const originalWriteFileSync = fs.writeFileSync;
        let rmSyncCalledForTemp = false;
        const originalRmSync = fs.rmSync;
        fsModule.writeFileSync = (
          targetPath: fs.PathOrFileDescriptor,
          data: Parameters<typeof fs.writeFileSync>[1],
          options?: Parameters<typeof fs.writeFileSync>[2]
        ): void => {
          if (String(targetPath).endsWith('.tmp')) {
            throw new Error('ENOSPC: имитация сбоя записи временного файла кэша');
          }
          originalWriteFileSync(targetPath, data, options);
        };
        fsModule.rmSync = (targetPath: fs.PathLike, options?: fs.RmOptions): void => {
          if (String(targetPath).endsWith('.tmp')) {
            rmSyncCalledForTemp = true;
          }
          originalRmSync(targetPath, options);
        };

        try {
          assert.throws(
            () => saveMetadataCache(configRoot, snapshot),
            /ENOSPC/,
            'Сбой записи временного файла должен пробрасываться наружу, а не проглатываться'
          );
        } finally {
          fsModule.writeFileSync = originalWriteFileSync;
          fsModule.rmSync = originalRmSync;
        }

        assert.strictEqual(rmSyncCalledForTemp, true, 'catch-ветка должна подчищать временный файл через fs.rmSync перед повторным throw');
        assert.strictEqual(fs.existsSync(targetFile), false, 'Целевой файл кэша не должен появиться при сбое записи временного файла');
        const leftoverTmp = fs.existsSync(cacheDir)
          ? fs.readdirSync(cacheDir).filter((name) => name.endsWith('.tmp'))
          : [];
        assert.deepStrictEqual(leftoverTmp, [], 'После проброса ошибки временный файл не должен оставаться на диске');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });
  });

  suite('M5 — дедуп удаляемых узлов при точечном обновлении кэша', () => {
    test('удаление одного объекта не задевает соседа в той же группе при relatedFiles = [Object.xml, Ext/ObjectModule.bsl]', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-dedup-remove-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const creator = new MetadataXmlCreator();
        // Два справочника в одной группе META_TYPES('Catalog') — оба создают
        // Ext/ObjectModule.bsl, поэтому relatedFiles для удаляемого объекта
        // содержит два файла, резолвящихся в ОДИН и тот же узел дерева.
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Авввв' }).success, true);
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Бгггг' }).success, true);

        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Оба объекта должны присутствовать в свежепостроенном снимке.
        assert.ok(findNode(snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Авввв'));
        assert.ok(findNode(snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Бгггг'));

        // Удаляем «Авввв» с диска целиком (имитация внешнего удаления файлов вне кэша).
        const removedXmlPath = path.join(configRoot, 'Catalogs', 'Авввв.xml');
        const removedObjectDir = path.join(configRoot, 'Catalogs', 'Авввв');
        const removedModulePath = path.join(removedObjectDir, 'Ext', 'ObjectModule.bsl');
        fs.rmSync(removedXmlPath, { force: true });
        fs.rmSync(removedObjectDir, { recursive: true, force: true });

        const result = updateMetadataCacheForChangedFiles(configRoot, entry, [removedXmlPath, removedModulePath]);
        assert.ok(result, 'updateMetadataCacheForChangedFiles должен вернуть результат обновления');
        assert.strictEqual(result.updatedPartially, true, 'Обновление должно быть точечным, без полной пересборки');

        const survivingNeighbour = findNode(result.snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Бгггг');
        const removedNode = findNode(result.snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Авввв');

        assert.ok(survivingNeighbour, 'Сосед «Бгггг» не должен быть задет удалением «Авввв» — баг задваивания splice');
        assert.strictEqual(removedNode, undefined, 'Удалённый узел «Авввв» не должен оставаться в снимке кэша');

        // Дополнительная защита: количество ЛИСТОВЫХ узлов-справочников (с xmlPath,
        // т.е. без группового контейнера «Catalog») после удаления ровно на один
        // меньше, чем было — ни один третий узел не потерян.
        const catalogCountAfter = countNodes(
          result.snapshot.root,
          (n) => n.type === 'Catalog' && Boolean(n.xmlPath)
        );
        assert.strictEqual(catalogCountAfter, 1, 'После удаления одного из двух справочников должен остаться ровно один листовой узел');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('перестройка узла по нескольким relatedFiles (объект не удалён) не задваивает узел объекта', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-dedup-rebuild-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const creator = new MetadataXmlCreator();
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Ввввв' }).success, true);
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Гдддд' }).success, true);

        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Объект «Ввввв» остаётся на диске — оба relatedFiles резолвятся в один
        // и тот же существующий узел, который должен быть перестроен один раз,
        // а не удалён/задвоен.
        const xmlPath = path.join(configRoot, 'Catalogs', 'Ввввв.xml');
        const modulePath = path.join(configRoot, 'Catalogs', 'Ввввв', 'Ext', 'ObjectModule.bsl');
        assert.ok(fs.existsSync(xmlPath));
        assert.ok(fs.existsSync(modulePath));

        const result = updateMetadataCacheForChangedFiles(configRoot, entry, [xmlPath, modulePath]);
        assert.ok(result);
        assert.strictEqual(result.updatedPartially, true);

        const nodeCount = countNodes(result.snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Ввввв');
        assert.strictEqual(nodeCount, 1, 'Узел объекта не должен задваиваться при нескольких relatedFiles на один объект');

        const neighbourCount = countNodes(result.snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Гдддд');
        assert.strictEqual(neighbourCount, 1, 'Сосед не должен быть затронут перестройкой другого объекта');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('дедуп нескольких .xml путей одного объекта: Object.xml и путь внутри его каталога схлопываются в один узел', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-dedup-two-xml-paths-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const creator = new MetadataXmlCreator();
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Дежжж' }).success, true);
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Езиии' }).success, true);

        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Два РАЗНЫХ .xml-пути одного объекта: сам Object.xml и произвольный .xml
        // внутри его каталога (isPathOwnedByObject матчит оба через startsWith objectDir).
        // Оба должны схлопнуться в targetsByNode по идентичности узла — вторая ветка
        // условия `targetsByNode.has(target.node)` в updateMetadataCacheForChangedFiles.
        const xmlPath = path.join(configRoot, 'Catalogs', 'Дежжж.xml');
        const secondaryXmlInsideObjectDir = path.join(configRoot, 'Catalogs', 'Дежжж', 'Forms', 'ФормаЭлемента.xml');
        assert.ok(fs.existsSync(xmlPath));

        const result = updateMetadataCacheForChangedFiles(configRoot, entry, [xmlPath, secondaryXmlInsideObjectDir]);
        assert.ok(result);
        assert.strictEqual(result.updatedPartially, true);

        const nodeCount = countNodes(result.snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Дежжж');
        assert.strictEqual(nodeCount, 1, 'Два .xml-пути одного объекта не должны создавать два узла или задваивать перестройку');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('пустой пересечения relatedFiles с rootPath — updateMetadataCacheForChangedFiles возвращает null без обращения к кэшу', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-unrelated-files-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cache-outside-'));
        try {
          // Все переданные пути лежат ВНЕ rootPath выгрузки — relatedFiles пуст,
          // функция обязана вернуть null сразу, не пытаясь даже прочитать Configuration.xml.
          const result = updateMetadataCacheForChangedFiles(configRoot, entry, [path.join(outsideRoot, 'чужой.xml')]);
          assert.strictEqual(result, null, 'Файлы вне rootPath не должны инициировать обновление кэша');
        } finally {
          fs.rmSync(outsideRoot, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('кэш ещё не создан — updateMetadataCacheForChangedFiles строит полный снимок и сохраняет его', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-no-cache-yet-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        assert.deepStrictEqual(listCacheFiles(configRoot), [], 'Перед первым вызовом кэш не должен существовать');

        const changedFile = path.join(configRoot, 'Configuration.xml');
        const result = updateMetadataCacheForChangedFiles(configRoot, entry, [changedFile]);

        assert.ok(result, 'При отсутствующем кэше функция обязана построить снимок с нуля');
        assert.strictEqual(result.updatedPartially, false, 'Полная пересборка при отсутствии кэша — не точечное обновление');
        assert.ok(listCacheFiles(configRoot).length > 0, 'Полная пересборка должна сохранить кэш на диск');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('Configuration.xml в списке изменённых файлов форсирует полную пересборку, даже если кэш ещё свежий', () => {
      // Кэш должен остаться СВЕЖИМ по fingerprint (Configuration.xml физически не
      // менялся после saveMetadataCache) — иначе сработает более ранняя ветка
      // `!cached` (инвалидация по C3), а не именно проверяемая здесь ветка
      // `relatedFiles.some(isConfigurationXml)`. Наблюдатель ФС (watcher) может
      // прислать событие по Configuration.xml независимо от факта реального
      // изменения контента — точечный дедуп сознательно не пытается разбирать
      // такие события точечно и всегда уходит в полную пересборку.
      const configRoot = makeTempConfigRoot('v8vscedit-cache-changed-configxml-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const creator = new MetadataXmlCreator();
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Жзииии' }).success, true);

        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);
        assert.ok(loadMetadataCache(configRoot, scopeKey), 'Кэш обязан быть свежим сразу после сохранения');

        const configXmlPath = path.join(configRoot, 'Configuration.xml');
        const result = updateMetadataCacheForChangedFiles(configRoot, entry, [configXmlPath]);
        assert.ok(result);
        assert.strictEqual(
          result.updatedPartially,
          false,
          'Configuration.xml в relatedFiles должен приводить к полной пересборке, а не точечному обновлению'
        );
        assert.ok(
          findNode(result.snapshot.root, (n) => n.type === 'Catalog' && n.name === 'Жзииии'),
          'Полная пересборка обязана сохранить уже присутствующий в дереве объект'
        );
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });

    test('.xml файл внутри rootPath, не относящийся ни к одному объекту дерева — targetsByNode пуст, возвращается null', () => {
      const configRoot = makeTempConfigRoot('v8vscedit-cache-unmatched-xml-');
      try {
        const entry: ConfigEntry = { rootPath: configRoot, kind: 'cf' };
        const creator = new MetadataXmlCreator();
        assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Клммм' }).success, true);

        const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
        assert.ok(info);
        const scopeKey = buildMetadataCacheScopeKey(entry, info);
        const snapshot = buildMetadataCacheSnapshot(scopeKey, entry);
        saveMetadataCache(configRoot, snapshot);

        // Служебный .xml внутри rootPath, но вне дерева метаданных (например,
        // случайно оказавшийся сторонний файл) — findObjectNodeByChangedPath не
        // находит владельца ни для одного пути, targetsByNode остаётся пустым.
        // Файл намеренно НЕ создаём физически: любая правка ФС внутри rootPath
        // меняет mtime каталога и сама по себе инвалидирует кэш по fingerprint
        // (C3), из-за чего сработает полная пересборка раньше, чем дедуп-логика —
        // здесь же важно проверить именно ветку targetsByNode.size === 0.
        const strayXmlPath = path.join(configRoot, 'Сторон£.xml');

        const result = updateMetadataCacheForChangedFiles(configRoot, entry, [strayXmlPath]);
        assert.strictEqual(result, null, 'Изменение .xml вне дерева метаданных не должно порождать точечное обновление');
      } finally {
        fs.rmSync(configRoot, { recursive: true, force: true });
      }
    });
  });
});
