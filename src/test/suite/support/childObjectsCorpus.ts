import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { META_TYPES } from '../../../domain/MetaTypes';
import { EXAMPLE_GENERATIONS, hasExampleCorpus } from './typedFieldCorpus';

/**
 * Разведочный доступ к эталонному корпусу `example/` для задачи «порядок
 * дочерних элементов в `<ChildObjects>` по виду владельца + регистр `UTF-8`
 * в XML-декларации». Написан по образцу `support/typedFieldCorpus.ts`:
 * переиспользует его `EXAMPLE_GENERATIONS`/`hasExampleCorpus` (один и тот же
 * физический корпус, нет смысла заводить вторую копию путей).
 */
export { EXAMPLE_GENERATIONS, hasExampleCorpus };

/**
 * Известные загрязнённые эталоны — материализованы РАНЕЕ нашим же (ещё не
 * исправленным на момент написания задачи) генератором, поэтому несут ОБА
 * дефекта этой задачи разом (строчная декларация `utf-8` + порядок,
 * определяемый порядком вызовов агента, а не каноном). Используются как вход
 * «повреждённый файл», а не как эталон — исключаются из ОБЕИХ корпусных
 * проверок (T-1 порядок, T-2 декларация). `DataProcessors/ПосчитатьТест.xml`
 * уже отмечен `KNOWN_CORRUPTED_FIXTURE` в `typedFieldCorpus.ts` по НЕЗАВИСИМОМУ
 * дефекту состава свойств типизированного поля — совпадение файла лишь
 * подтверждает, что оба дефекта производит один и тот же неисправленный
 * генератор, а не два разных повреждения.
 */
export const KNOWN_POLLUTED_FIXTURES: readonly string[] = [
  path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs', 'Тестовый.xml'),
  path.join(EXAMPLE_GENERATIONS.cf20, 'DataProcessors', 'ПосчитатьТест.xml'),
  path.join(EXAMPLE_GENERATIONS.cf20, 'HTTPServices', 'Заказы.xml'),
];

const KNOWN_POLLUTED_SET = new Set(KNOWN_POLLUTED_FIXTURES.map((p) => path.normalize(p)));

/**
 * Канон порядка ПРЯМЫХ детей `<ChildObjects>` по виду владельца — снят с
 * эталона `fast-xml-parser` (`preserveOrder: true`) в РАМКАХ ЭТОЙ задачи:
 * 0 контрпримеров по ВСЕМУ корпусу `example/2.20` + `example/2.21` (cf и
 * cfe/EVOLC) на КАЖДУЮ пару тегов внутри строки (не только соседних — весь
 * корпус проверен полным попарным сравнением, не только цепочкой соседей).
 *
 * ЭТО ЕДИНСТВЕННЫЙ ИСТОЧНИК ПРАВДЫ для тестов T-1/T-4/T-5/T-6/T-17 — а НЕ
 * продакшен-модуль `infra/xml/childObjects/ChildObjectsOrder.ts` (которого на
 * момент написания тестов ещё нет). Тесты, снимающие правило с эталона,
 * обязаны оставаться валидными НЕЗАВИСИМО от того, правильно ли developer
 * впоследствии перенёс эту же таблицу в продакшен — иначе баг в переносе не
 * будет пойман (тест сверял бы продакшен сам с собой).
 *
 * Тонкие виды (представлены в `example/` буквально 1-3 файлами: Task,
 * AccountingRegister, ChartOfAccounts, CalculationRegister,
 * ChartOfCharacteristicTypes, ChartOfCalculationTypes, BusinessProcess,
 * DocumentJournal, Enum(частично), ExchangePlan(частично)) — согласие по ним
 * ПОЛНОЕ (0 контрпримеров), но статистическая мощность ниже; это отражено в
 * {@link MIN_FILES_FOR_KIND} и должно быть явно упомянуто в отчёте задачи.
 */
export const CANON_CHILD_ORDER: Readonly<Record<string, readonly string[]>> = {
  Catalog: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  ChartOfCharacteristicTypes: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  ChartOfCalculationTypes: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  BusinessProcess: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  ExchangePlan: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  Report: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  DataProcessor: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  Document: ['Attribute', 'Form', 'TabularSection', 'Template', 'Command'],
  ChartOfAccounts: ['Attribute', 'TabularSection', 'AccountingFlag', 'ExtDimensionAccountingFlag', 'Form', 'Template', 'Command'],
  Task: ['Attribute', 'TabularSection', 'Form', 'AddressingAttribute', 'Template', 'Command'],
  InformationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  AccumulationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  CalculationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  AccountingRegister: ['Dimension', 'Resource', 'Attribute', 'Form', 'Template', 'Command'],
  Enum: ['EnumValue', 'Form', 'Template', 'Command'],
  DocumentJournal: ['Column', 'Form', 'Template', 'Command'],
  HTTPService: ['URLTemplate'],
};

export const ORDERED_OWNER_KINDS: readonly string[] = Object.keys(CANON_CHILD_ORDER);

/**
 * Минимум файлов КОРПУСА (across cf20+cf21+cfe21, за вычетом
 * {@link KNOWN_POLLUTED_FIXTURES}) для вида, при котором проверка полноты
 * выборки (T-1) считается пройденной, а не «зелёной на пустом корпусе».
 * Значения для Catalog/Document/InformationRegister/DataProcessor/Enum взяты
 * с заметным запасом от фактического счёта (см. отчёт задачи); для видов,
 * реально представленных единицами файлов — порог 1.
 */
export const MIN_FILES_FOR_KIND: Readonly<Record<string, number>> = {
  Catalog: 100,
  Document: 100,
  InformationRegister: 100,
  DataProcessor: 100,
  Report: 100,
  Enum: 100,
  AccumulationRegister: 100,
  AccountingRegister: 1,
  Task: 1,
  ChartOfAccounts: 1,
  CalculationRegister: 1,
  ChartOfCharacteristicTypes: 1,
  ChartOfCalculationTypes: 1,
  BusinessProcess: 1,
  ExchangePlan: 1,
  DocumentJournal: 1,
  HTTPService: 1,
};

// ── Мини-парсинг XML (preserveOrder) — тот же приём, что и typedFieldCorpus.ts ──

interface XmlTextNode { '#text': string }
type XmlElementNode = Record<string, XmlNodeList>;
type XmlNode = XmlTextNode | XmlElementNode;
type XmlNodeList = XmlNode[];

const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false });

function isTextNode(node: XmlNode): node is XmlTextNode {
  return Object.prototype.hasOwnProperty.call(node, '#text');
}
function elementName(node: XmlNode): string | null {
  return isTextNode(node) ? null : Object.keys(node)[0];
}
function elementChildren(node: XmlNode): XmlNodeList {
  const name = elementName(node);
  return name ? ((node as XmlElementNode)[name] ?? []) : [];
}
function firstDirect(nodes: XmlNodeList, tag: string): XmlElementNode | null {
  for (const node of nodes) {
    if (elementName(node) === tag) {
      return node as XmlElementNode;
    }
  }
  return null;
}
function findFirst(nodes: XmlNodeList, tag: string): XmlElementNode | null {
  for (const node of nodes) {
    if (elementName(node) === tag) {
      return node as XmlElementNode;
    }
    const found = findFirst(elementChildren(node), tag);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Возвращает ИМЕНА прямых детей ПЕРВОГО верхнеуровневого `<ChildObjects>`
 * владельца `ownerRootTag` (например `Catalog`), В ПОРЯДКЕ появления в файле.
 * `null` — не удалось найти `<MetaDataObject>`/владельца/`<ChildObjects>`
 * (например, версия XML нестандартна); `[]` — `<ChildObjects>` пуст/самозакрыт.
 *
 * Депт-безопасно по построению: `firstDirect`/`findFirst` работают по ДЕРЕВУ
 * `preserveOrder`, а не по regex, поэтому вложенный `<ChildObjects>` табличной
 * части (тот самый нежадный-regex капкан из брифа) НЕ подмешивается — это
 * просто дети другого узла дерева (`TabularSection`), а не текущего.
 */
export function directChildObjectsTagSequence(xml: string, ownerRootTag: string): string[] | null {
  let nodes: XmlNodeList;
  try {
    nodes = parser.parse(xml) as XmlNodeList;
  } catch {
    return null;
  }
  const metaDataObject = findFirst(nodes, 'MetaDataObject');
  if (!metaDataObject) {
    return null;
  }
  const rootEl = firstDirect(elementChildren(metaDataObject), ownerRootTag);
  if (!rootEl) {
    return null;
  }
  const childObjects = firstDirect(elementChildren(rootEl), 'ChildObjects');
  if (!childObjects) {
    return null;
  }
  return elementChildren(childObjects)
    .map(elementName)
    .filter((name): name is string => name !== null);
}

function collectText(nodes: XmlNodeList): string {
  let result = '';
  for (const node of nodes) {
    if (isTextNode(node)) {
      result += node['#text'];
      continue;
    }
    result += collectText(elementChildren(node));
  }
  return result.trim();
}

export interface ChildObjectsEntry {
  readonly tag: string;
  readonly name: string;
}

/**
 * Как {@link directChildObjectsTagSequence}, но вместе с ИМЕНЕМ каждого
 * элемента (`<Properties><Name>` для полных блоков, текст узла — для
 * ссылочных `<Form>Имя</Form>`/`<Template>Имя</Template>`). Нужен тестам,
 * различающим КОНКРЕТНЫЙ добавленный элемент среди уже существующих
 * одноимённых по тегу (T-4/T-5/T-6: «где именно оказался НОВЫЙ элемент»).
 */
export function directChildObjectsEntries(xml: string, ownerRootTag: string): ChildObjectsEntry[] | null {
  let nodes: XmlNodeList;
  try {
    nodes = parser.parse(xml) as XmlNodeList;
  } catch {
    return null;
  }
  const metaDataObject = findFirst(nodes, 'MetaDataObject');
  if (!metaDataObject) {
    return null;
  }
  const rootEl = firstDirect(elementChildren(metaDataObject), ownerRootTag);
  if (!rootEl) {
    return null;
  }
  const childObjects = firstDirect(elementChildren(rootEl), 'ChildObjects');
  if (!childObjects) {
    return null;
  }
  return elementChildren(childObjects)
    .map((node): ChildObjectsEntry | null => {
      const tag = elementName(node);
      if (!tag) {
        return null;
      }
      const properties = firstDirect(elementChildren(node), 'Properties');
      const nameNode = properties ? firstDirect(elementChildren(properties), 'Name') : null;
      const name = nameNode ? collectText(elementChildren(nameNode)) : collectText(elementChildren(node));
      return { tag, name };
    })
    .filter((entry): entry is ChildObjectsEntry => entry !== null);
}

/** Извлекает значение атрибута `encoding` XML-декларации (без учёта регистра значения — сравнение делает вызывающий). */
export function declaredEncoding(xml: string): string | undefined {
  return /<\?xml[^>]*\bencoding="([^"]+)"/.exec(xml)?.[1];
}

/** Рекурсивно перечисляет ВСЕ `.xml` файлы дерева (для T-2 — проверка декларации целиком по корпусу). */
export function listXmlFilesRecursive(rootDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(rootDir)) {
    return out;
  }
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listXmlFilesRecursive(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.xml')) {
      out.push(fullPath);
    }
  }
  return out;
}

function listXmlFilesDirect(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

export interface CorpusOwnerFile {
  readonly filePath: string;
  readonly xml: string;
  readonly tags: string[] | null;
}

const scanCache = new Map<string, readonly CorpusOwnerFile[]>();

/**
 * Все файлы владельца `kind` из корпуса (cf20+cf21+cfe21), за вычетом
 * {@link KNOWN_POLLUTED_FIXTURES}, с уже извлечённой последовательностью
 * прямых тегов `<ChildObjects>`. Кэшируется по виду на процесс (корпус не
 * меняется между тестами одного прогона).
 */
export function scanOwnerFiles(kind: string): readonly CorpusOwnerFile[] {
  const cached = scanCache.get(kind);
  if (cached) {
    return cached;
  }
  // Индексация по произвольной строке (не обязательно валидному MetaKind) —
  // явный Partial-каст, а не `as keyof typeof META_TYPES`: последний "лжёт"
  // компилятору, что индекс всегда существует, из-за чего `?.` ниже линтер
  // считает избыточным, хотя рантайм-защита от неизвестного вида нужна.
  const folder = (META_TYPES as Partial<Record<string, { folder?: string }>>)[kind]?.folder;
  const result: CorpusOwnerFile[] = [];
  if (folder) {
    for (const root of [EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21, EXAMPLE_GENERATIONS.cfe21]) {
      for (const filePath of listXmlFilesDirect(path.join(root, folder))) {
        if (KNOWN_POLLUTED_SET.has(path.normalize(filePath))) {
          continue;
        }
        const xml = fs.readFileSync(filePath, 'utf-8');
        result.push({ filePath, xml, tags: directChildObjectsTagSequence(xml, kind) });
      }
    }
  }
  scanCache.set(kind, result);
  return result;
}

export interface PairCheckResult {
  /** Число файлов, где ОБА тега присутствуют среди прямых детей (доказательная база пары). */
  readonly checked: number;
  /** Файлы, где `b` встретился раньше последнего `a` (нарушение канона). */
  readonly violations: readonly string[];
}

/** Проверяет, что `tagA` встречается раньше `tagB` во ВСЕХ файлах владельца, где оба присутствуют. */
export function checkPairOrder(files: readonly CorpusOwnerFile[], tagA: string, tagB: string): PairCheckResult {
  const violations: string[] = [];
  let checked = 0;
  for (const { filePath, tags } of files) {
    if (!tags) {
      continue;
    }
    const indicesA = tags.reduce<number[]>((acc, t, i) => (t === tagA ? [...acc, i] : acc), []);
    const indicesB = tags.reduce<number[]>((acc, t, i) => (t === tagB ? [...acc, i] : acc), []);
    if (indicesA.length === 0 || indicesB.length === 0) {
      continue;
    }
    checked += 1;
    if (Math.min(...indicesB) < Math.max(...indicesA)) {
      violations.push(filePath);
    }
  }
  return { checked, violations };
}

/** Все пары `(a, b)` с `a` строго раньше `b` в эталонной строке порядка (не только соседние). */
export function allOrderedPairs(order: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      pairs.push([order[i], order[j]]);
    }
  }
  return pairs;
}
