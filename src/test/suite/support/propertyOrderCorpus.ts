import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { META_TYPES, type MetaKind } from '../../../domain/MetaTypes';
import { extractTopLevelPropertiesChildren } from '../../../infra/xml/MetadataPropertiesXml';
import { detectRootObjectKind } from '../../../infra/xml/XmlUtils';
import { collectPropertyBlocks, findPropertiesRange } from '../../../infra/xml/typedField/PropertyBlockEditor';
import { EXAMPLE_GENERATIONS, EXAMPLE_ROOT } from './corpus';
import { tryRequireProductionModule } from './tryRequireProductionModule';

/**
 * Разведочный доступ к эталонному корпусу `example/` для задачи «канон порядка
 * свойств в `<Properties>` КОРНЕВОГО объекта» (`infra/xml/properties/`).
 *
 * Метод снятия правила — тот же, что у `CHILD_OBJECTS_ORDER`: прямые дети
 * `<Properties>` корня каждого файла выгрузки, сканом КОНТРПРИМЕРОВ, а не
 * «сто подтверждений». Обходятся ровно три корня выгрузки (`EXAMPLE_GENERATIONS`):
 * остальное содержимое `example/2.20` (`examples`, `fixtures`, `tests`) — не
 * платформенная выгрузка, а рабочие материалы, и порядок там не эталонный.
 *
 * Скан корпуса и оракулы ниже намеренно НЕ читают production-таблицу порядка:
 * гейты, снимающие правило с корпуса, обязаны оставаться независимыми от переноса
 * таблицы (иначе баг переноса не будет пойман — тест сверял бы таблицу сам с собой).
 * Production-модули здесь только ЗАГРУЖАЮТСЯ лениво (см. `requirePropertyOrder`).
 */

export { EXAMPLE_GENERATIONS };

export type CorpusRootName = keyof typeof EXAMPLE_GENERATIONS;

/** Один файл корпуса: корень XML, вид, прямые дети `<Properties>` в порядке документа. */
export interface RootPropertyFile {
  readonly file: string;
  readonly root: CorpusRootName;
  /** Корневой тег XML (`Catalog`, `Configuration`, …) — вход `detectRootObjectKind`. */
  readonly xmlRoot: string;
  readonly children: readonly { readonly tag: string; readonly inner: string }[];
  /** Теги прямых детей — то же, что `children.map(c => c.tag)`. */
  readonly keys: readonly string[];
}

export interface XmlRootFacts {
  readonly xmlRoot: string;
  readonly files: RootPropertyFile[];
  /** Тег → сколько файлов вида его несут и пример (первый встреченный файл). */
  readonly tags: Map<string, { count: number; example: string }>;
}

/**
 * Корневой тег XML → `MetaKind`. Строится ИЗ `META_TYPES` (`englishKind ?? kind`),
 * а не пишется руками — как и должен строиться резолв в production-модуле.
 * Совпадение имён у большинства видов — следствие `englishKind`, а не правило:
 * корень конфигурации и расширения — тег `Configuration` (вид `configuration`).
 */
const KIND_BY_XML_ROOT: ReadonlyMap<string, MetaKind> = new Map(
  (Object.values(META_TYPES) as { kind: MetaKind; englishKind?: string }[]).map(
    (def) => [def.englishKind ?? def.kind, def.kind] as const
  )
);

export function metaKindOfXmlRoot(xmlRoot: string): MetaKind | undefined {
  return KIND_BY_XML_ROOT.get(xmlRoot);
}

/** Обратное отображение: `MetaKind` → корневой тег XML. */
export function xmlRootOfMetaKind(kind: MetaKind): string {
  return META_TYPES[kind].englishKind ?? kind;
}

function walkXmlFiles(root: string, sink: string[]): void {
  // example/ лежит в .gitignore — на чистом клоне корня нет, и обход обязан
  // вернуть пустой список, а не рушить загрузку модуля (см. support/corpus.ts).
  if (!fs.existsSync(root)) {
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkXmlFiles(full, sink);
    } else if (entry.isFile() && entry.name.endsWith('.xml')) {
      sink.push(full);
    }
  }
}

let cachedFacts: ReadonlyMap<string, XmlRootFacts> | undefined;

/**
 * Факты корпуса по корневому тегу XML. Кэшируются на процесс: скан ~20 тыс.
 * файлов повторять в каждом тесте нельзя. Файл без обёртки `<MetaDataObject>`
 * (тело формы, макет, `ConfigDumpInfo.xml`) — не корень объекта, пропускается.
 */
export function scanRootPropertyFacts(): ReadonlyMap<string, XmlRootFacts> {
  if (cachedFacts) {
    return cachedFacts;
  }
  const facts = new Map<string, XmlRootFacts>();
  for (const root of Object.keys(EXAMPLE_GENERATIONS) as CorpusRootName[]) {
    const files: string[] = [];
    walkXmlFiles(EXAMPLE_GENERATIONS[root], files);
    for (const file of files) {
      const xml = fs.readFileSync(file, 'utf-8');
      const xmlRoot = detectRootObjectKind(xml);
      if (!xmlRoot) {
        continue;
      }
      const children = extractTopLevelPropertiesChildren(xml);
      const bucket: XmlRootFacts = facts.get(xmlRoot) ?? { xmlRoot, files: [], tags: new Map() };
      facts.set(xmlRoot, bucket);
      bucket.files.push({ file, root, xmlRoot, children, keys: children.map((child) => child.tag) });
      for (const child of children) {
        const fact = bucket.tags.get(child.tag) ?? { count: 0, example: file };
        fact.count++;
        bucket.tags.set(child.tag, fact);
      }
    }
  }
  cachedFacts = facts;
  return facts;
}

/** Относительный путь файла корпуса — для сообщений об ошибках. */
export function relativeToCorpus(file: string): string {
  return path.relative(EXAMPLE_ROOT, file);
}

/**
 * Контракт production-модуля `infra/xml/properties/PropertyOrder.ts`. Модуля на
 * фазе «красный» ещё нет: загрузка ленивая через `tryRequireProductionModule`,
 * иначе `MODULE_NOT_FOUND` на верхнем уровне файла рушит загрузку ВСЕХ тестов
 * раннера (см. JSDoc `tryRequireProductionModule`).
 */
export interface PropertyOrderModule {
  readonly ROOT_PROPERTY_ORDER: Partial<Record<MetaKind, readonly string[]>>;
  rootPropertyRank(ownerKind: string | undefined, key: string): number | null;
  hasRootPropertyOrderRule(ownerKind: string | undefined): boolean;
}

/** Контракт механики вставки `infra/xml/properties/PropertyInsert.ts`. */
export interface PropertyInsertModule {
  insertPropertyBlockInOrder(
    propsInner: string,
    ownerKind: string | undefined,
    propertyKey: string,
    valueBlock: string
  ): string;
}

export function loadPropertyOrderModule(): PropertyOrderModule | undefined {
  return tryRequireProductionModule('../../../infra/xml/properties/PropertyOrder') as PropertyOrderModule | undefined;
}

export function loadPropertyInsertModule(): PropertyInsertModule | undefined {
  return tryRequireProductionModule('../../../infra/xml/properties/PropertyInsert') as PropertyInsertModule | undefined;
}

/** Модуль таблицы порядка или осмысленный провал теста (а не `TypeError` на `undefined`). */
export function requirePropertyOrder(): PropertyOrderModule {
  const loaded = loadPropertyOrderModule();
  if (!loaded) {
    assert.fail('infra/xml/properties/PropertyOrder.ts не реализован (ожидаемо на фазе «красный» TDD)');
  }
  return loaded;
}

/** Модуль механики вставки или осмысленный провал теста. */
export function requirePropertyInsert(): PropertyInsertModule {
  const loaded = loadPropertyInsertModule();
  if (!loaded) {
    assert.fail('infra/xml/properties/PropertyInsert.ts не реализован (ожидаемо на фазе «красный» TDD)');
  }
  return loaded;
}

/**
 * Вид и значение, с которыми блок свойства можно записать обратно писателем ТАК ЖЕ, как
 * он лежит в файле: однострочный `<K>текст</K>`/`<K/>` либо стандартный локализованный
 * блок с одним `ru`-элементом. Остальное (многострочные списки, xsi:nil, атрибуты) —
 * не «восстановимо» без потери формата, и в этот тест не берётся.
 */
export function asRestorableBlock(
  blockXml: string,
  key: string,
  indent: string,
  eol: string
): { kind: 'string' | 'localizedString'; value: string } | undefined {
  if (blockXml === `<${key}/>`) {
    return { kind: 'string', value: '' };
  }
  const single = new RegExp(`^<${key}>([^<>&\\r\\n]+)</${key}>$`).exec(blockXml);
  if (single) {
    return { kind: 'string', value: single[1] };
  }
  const localized = new RegExp(
    `^<${key}>${eol}${indent}\\t<v8:item>${eol}${indent}\\t\\t<v8:lang>ru</v8:lang>${eol}${indent}\\t\\t<v8:content>([^<>&\\r\\n]+)</v8:content>${eol}${indent}\\t</v8:item>${eol}${indent}</${key}>$`
  ).exec(blockXml);
  return localized ? { kind: 'localizedString', value: localized[1] } : undefined;
}


/**
 * Оракул ожидаемой вставки: независимая от production-таблицы реализация правила
 * «перед первым старшим по документу якорем, иначе после последнего младшего,
 * иначе в конец» поверх ЭТАЛОННОГО порядка ключей (`canonicalKeys`, снят с файла
 * корпуса другого поколения), а не поверх `ROOT_PROPERTY_ORDER`. Так тест ловит
 * ошибку таблицы, а не сверяет её сама с собой.
 *
 * Возвращает исходный текст с ОДНОЙ вставленной строкой `line` — с отступом
 * соседа и переводом строки файла; ключи, которых нет в `canonicalKeys`, якорями
 * не считаются.
 */
export function expectedXmlAfterInsert(xml: string, canonicalKeys: readonly string[], key: string, line: string): string {
  const range = findPropertiesRange(xml);
  assert.ok(range, 'в файле нет непустого <Properties>');
  const eol = xml.includes('\r\n') ? '\r\n' : '\n';
  const target = canonicalKeys.indexOf(key);
  assert.ok(target >= 0, `«${key}» нет в эталонном порядке`);
  const ranked = collectPropertyBlocks(range.inner)
    .map((block) => ({ block, rank: canonicalKeys.indexOf(block.key) }))
    .filter((item) => item.rank >= 0);
  const senior = ranked.find((item) => item.rank > target);
  if (senior) {
    const at = range.start + senior.block.start;
    return `${xml.slice(0, at)}${line}${eol}${senior.block.indent}${xml.slice(at)}`;
  }
  const junior = [...ranked].reverse().find((item) => item.rank < target);
  assert.ok(junior, 'у вставки нет ни одного якоря в документе');
  const at = range.start + junior.block.end;
  return `${xml.slice(0, at)}${eol}${junior.block.indent}${line}${xml.slice(at)}`;
}

/** Убирает пробельные символы между тегами — для сравнения блоков независимо от отступов и EOL. */
export function stripWhitespaceBetweenTags(xml: string): string {
  return xml.replace(/>\s+</g, '><').replace(/\r\n/g, '\n');
}

/**
 * Сравнение результата записи с ожидаемым текстом. Часть эталонных файлов содержит
 * СМЕШАННЫЙ перевод строки (одиночный LF внутри CRLF-файла: `<ChildObjects>` у
 * Configuration.xml расширения, `<v8:content>` у отдельных документов), а писатель
 * приводит весь файл к преобладающему стилю — это существующее поведение
 * `writeTextFilePreservingBomAndEol`, к порядку свойств не относящееся. Поэтому для
 * файлов со смешанным EOL сравнение идёт с точностью до перевода строки (положение и
 * отступ вставки проверяются по-прежнему точно), а для однородных — побайтово.
 */
export function assertSameModuloMixedEol(actual: string, expected: string, label: string): void {
  const mixed = expected.includes('\r\n') && /(?<!\r)\n/.test(expected);
  if (!mixed) {
    assert.strictEqual(actual, expected, label);
    return;
  }
  const normalize = (value: string): string => value.replace(/\r\n/g, '\n');
  assert.strictEqual(normalize(actual), normalize(expected), `${label} (файл эталона со смешанным EOL, сравнение с точностью до перевода строки)`);
}

/** Булев вариант {@link assertSameModuloMixedEol} — для циклов, копящих список расхождений. */
export function sameModuloMixedEol(actual: string, expected: string): boolean {
  try {
    assertSameModuloMixedEol(actual, expected, '');
    return true;
  } catch {
    return false;
  }
}
