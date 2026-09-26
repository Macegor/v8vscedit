import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { META_TYPES, type MetaKind } from '../../../domain/MetaTypes';

/**
 * Разведочный доступ к эталонному корпусу `example/` для тестов задачи
 * «состав свойств типизированного поля = вид владельца × роль поля».
 *
 * ВАЖНО: `example/` не отслеживается git и может быть локально изменяем
 * (см. CLAUDE.md) — поэтому корпус не считается заведомо чистым. Каждый файл
 * проходит предфильтр {@link isUncorruptedObjectXml} перед использованием в
 * тестах, снимающих правило с эталона. Единственное подтверждённое
 * исключение — `example/2.20/src/cf/DataProcessors/ПосчитатьТест.xml`,
 * испорченный тем же дефектом, который чинит эта задача (смешанная разметка +
 * лишние свойства заполнения у реквизита обработки); он используется отдельно
 * как вход теста «повреждённый файл», а не как эталон.
 */

// Компилированный `out/test/suite/support/typedFieldCorpus.js` лежит на 4
// уровня глубже корня проекта (support→suite→test→out→корень) — раньше здесь
// было 5 `../`, что уводило на каталог ВЫШЕ `v8vscedit` (существующий, но
// чужой `example/` рядом с проектом) и приводило к «пустому корпусу» без
// единого файла на любой машине, где такого соседнего каталога нет.
const EXAMPLE_ROOT = path.resolve(__dirname, '../../../../example');

export const EXAMPLE_GENERATIONS = {
  cf20: path.join(EXAMPLE_ROOT, '2.20/src/cf'),
  cf21: path.join(EXAMPLE_ROOT, '2.21/src/cf'),
  cfe21: path.join(EXAMPLE_ROOT, '2.21/src/cfe/EVOLC'),
} as const;

/**
 * Доступен ли эталонный корпус. `example/` не отслеживается git (см. CLAUDE.md),
 * поэтому на чистом клоне его просто нет — тесты, снимающие правило с эталона,
 * в этом случае ПРОПУСКАЮТСЯ (suite-level `this.skip()`), а не падают: красный
 * прогон без корпуса — не дефект кода. Ослаблением ассертов это не является:
 * когда корпус есть, проверки на его полноту (`fields.length > 1000` и т.п.)
 * работают в полную силу.
 */
export function hasExampleCorpus(): boolean {
  return fs.existsSync(EXAMPLE_GENERATIONS.cf20) && fs.existsSync(EXAMPLE_GENERATIONS.cf21);
}

/** Заведомо испорченный нашим же дефектом файл — вход для теста «повреждённый файл», не эталон. */
export const KNOWN_CORRUPTED_FIXTURE = path.join(EXAMPLE_GENERATIONS.cf20, 'DataProcessors/ПосчитатьТест.xml');

export const TYPED_FIELD_ROLES = [
  'Attribute',
  'AddressingAttribute',
  'Dimension',
  'Resource',
  'Column',
  'Constant',
  'CommonAttribute',
] as const;
export type TypedFieldRole = (typeof TYPED_FIELD_ROLES)[number];

const ROLE_CHILD_TAGS = new Set(['Attribute', 'AddressingAttribute', 'Dimension', 'Resource']);

/**
 * Владельцы типизированных полей верхнего уровня — выводятся из
 * `META_TYPES.childTags`, а не перечисляются руками (иначе новый вид-владелец,
 * добавленный единственной записью в реестр, сюда бы не попал).
 */
export function fieldOwnerKinds(): MetaKind[] {
  return Object.values(META_TYPES)
    .filter((def) => def.childTags?.some((tag) => ROLE_CHILD_TAGS.has(tag)))
    .map((def) => def.kind);
}

// parseTagValue не отключён по умолчанию (true) — `fast-xml-parser` тогда
// отдаёт "false"/числа как boolean/number, а не строку, и `#text` перестаёт
// быть `string` на практике (падение `node['#text'].trim is not a function`
// на реальных значениях вроде `<PasswordMode>false</PasswordMode>`). Отключаем
// явно — тип `XmlTextNode['#text']: string` остаётся правдой, а не подавлением.
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, trimValues: false, parseTagValue: false });

interface XmlTextNode { '#text': string }
type XmlElementNode = Record<string, XmlNodeList>;
type XmlNode = XmlTextNode | XmlElementNode;
type XmlNodeList = XmlNode[];

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
function directChildren(nodes: XmlNodeList, tag: string): XmlElementNode[] {
  return nodes.filter((n): n is XmlElementNode => elementName(n) === tag);
}
function firstDirect(nodes: XmlNodeList, tag: string): XmlElementNode | null {
  return directChildren(nodes, tag)[0] ?? null;
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
function collectText(nodes: XmlNodeList): string {
  let result = '';
  for (const node of nodes) {
    if (isTextNode(node)) {
      result += node['#text'];
    }
  }
  return result.trim();
}

/**
 * Прямые дети ОДНОГО блока `<Tag>…</Tag>` (аналог `collectPropertyBlocks` из
 * продакшена): депт-агностичный проход, не спускающийся во вложенные
 * одноимённые структуры. Используется и для содержимого `<Properties>`
 * (снятие ключей поля), и для проверки индентации при поиске повреждённых
 * объектов.
 */
function directChildTagStarts(inner: string): number[] {
  const starts: number[] = [];
  let index = 0;
  while (index < inner.length) {
    const open = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?\/?>/.exec(inner.slice(index));
    if (!open) {
      break;
    }
    const tag = open[1];
    // exec() всегда возвращает индекс совпадения (RegExpExecArray.index — number,
    // не может быть nullish) — раньше здесь стоял избыточный `?? 0`.
    const start = index + open.index;
    const openEnd = start + open[0].length;
    starts.push(start);
    if (open[0].endsWith('/>')) {
      index = openEnd;
      continue;
    }
    const closeTag = `</${tag}>`;
    const closeStart = inner.indexOf(closeTag, openEnd);
    if (closeStart < 0) {
      index = openEnd;
      continue;
    }
    index = closeStart + closeTag.length;
  }
  return starts;
}

function checkPropertiesIndentConsistent(inner: string): boolean {
  const starts = directChildTagStarts(inner);
  const indents = starts.map((pos) => {
    const before = inner.slice(0, pos);
    const lineStart = before.lastIndexOf('\n') + 1;
    return before.slice(lineStart).replace(/\r/g, '');
  });
  const tabOnly = indents.filter((value) => /^\t*$/.test(value));
  if (tabOnly.length === 0) {
    return true;
  }
  const [first] = tabOnly;
  return tabOnly.every((value) => value === first);
}

/**
 * Предфильтр «объект не повреждён»: у ВСЕХ прямых детей КАЖДОГО блока
 * `<Properties>` файла (не только корневого) одинаковый ведущий отступ.
 * `<Properties>` не вкладывается сама в себя, поэтому блоки не перекрываются
 * и их можно находить последовательным сканированием без полного парсинга.
 */
export function isUncorruptedObjectXml(xml: string): boolean {
  const re = /<Properties>([\s\S]*?)<\/Properties>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    if (!checkPropertiesIndentConsistent(match[1])) {
      return false;
    }
  }
  return true;
}

/** Прямые дети `<Properties>` typed-поля без namespace-префикса (только «свои» теги владельца). */
export function directPropertyKeys(fieldElement: XmlElementNode): string[] {
  const properties = firstDirect(elementChildren(fieldElement), 'Properties');
  if (!properties) {
    return [];
  }
  return elementChildren(properties)
    .map(elementName)
    // `name !== null` (а не `Boolean(name)`) — TS сужает `name` до `string` внутри
    // этого же `&&`, поэтому `!name.includes(':')` дальше не нуждается в `!`.
    .filter((name): name is string => name !== null && !name.includes(':'));
}

export interface CorpusField {
  readonly ownerKind: string;
  readonly role: 'Attribute' | 'Dimension' | 'Resource' | 'AddressingAttribute' | 'Column';
  readonly filePath: string;
  readonly name: string;
  /** Полный XML блока поля — `<Attribute uuid=…>…</Attribute>` (нужен для GOLDEN A). */
  readonly fieldXml: string;
  readonly propertyKeys: string[];
}

function fieldFullXml(xml: string, uuid: string, tag: string): string {
  const open = new RegExp(`<${tag} uuid="${uuid}"[^>]*>`).exec(xml);
  if (!open) {
    return '';
  }
  const close = `</${tag}>`;
  const closeIdx = xml.indexOf(close, open.index + open[0].length);
  if (closeIdx < 0) {
    return '';
  }
  return xml.slice(open.index, closeIdx + close.length);
}

function attrOf(element: XmlElementNode, name: string): string | undefined {
  const attrs = (element as Record<string, unknown>)[':@'] as Record<string, string> | undefined;
  return attrs?.[`@_${name}`];
}

function scanObjectFile(xmlPath: string, ownerKind: string, out: CorpusField[]): void {
  let xml: string;
  try {
    xml = fs.readFileSync(xmlPath, 'utf-8');
  } catch {
    return;
  }
  if (!isUncorruptedObjectXml(xml)) {
    return;
  }
  let nodes: XmlNodeList;
  try {
    nodes = parser.parse(xml) as XmlNodeList;
  } catch {
    return;
  }
  const metaDataObject = findFirst(nodes, 'MetaDataObject');
  if (!metaDataObject) {
    return;
  }
  const rootEl = elementChildren(metaDataObject).find((n) => elementName(n));
  if (!rootEl || elementName(rootEl) !== ownerKind) {
    return;
  }
  const rootChildObjects = firstDirect(elementChildren(rootEl), 'ChildObjects');
  if (!rootChildObjects) {
    return;
  }
  const rootKids = elementChildren(rootChildObjects);

  for (const roleTag of ['Attribute', 'Dimension', 'Resource', 'AddressingAttribute'] as const) {
    for (const el of directChildren(rootKids, roleTag)) {
      const uuid = attrOf(el, 'uuid');
      const fieldXml = uuid ? fieldFullXml(xml, uuid, roleTag) : '';
      const name = readFieldName(el);
      if (!fieldXml) {
        continue;
      }
      out.push({ ownerKind, role: roleTag, filePath: xmlPath, name, fieldXml, propertyKeys: directPropertyKeys(el) });
    }
  }

  for (const ts of directChildren(rootKids, 'TabularSection')) {
    const tsChildObjects = firstDirect(elementChildren(ts), 'ChildObjects');
    if (!tsChildObjects) {
      continue;
    }
    for (const col of directChildren(elementChildren(tsChildObjects), 'Attribute')) {
      const uuid = attrOf(col, 'uuid');
      const fieldXml = uuid ? fieldFullXml(xml, uuid, 'Attribute') : '';
      const name = readFieldName(col);
      if (!fieldXml) {
        continue;
      }
      out.push({ ownerKind, role: 'Column', filePath: xmlPath, name, fieldXml, propertyKeys: directPropertyKeys(col) });
    }
  }
}

/**
 * Имя поля из его `<Properties><Name>…</Name></Properties>`. Раньше здесь был
 * `firstDirect(...) ?? []`, что типово некорректно (`firstDirect` возвращает
 * `XmlElementNode | null`, а `[]` — не заменитель отсутствующего элемента для
 * `elementChildren`) и на практике маскировало отсутствие `<Name>` пустой
 * строкой без явной причины — выражаем это через явную проверку `null`.
 */
function readFieldName(fieldElement: XmlElementNode): string {
  const properties = firstDirect(elementChildren(fieldElement), 'Properties');
  if (!properties) {
    return '';
  }
  const nameElement = firstDirect(elementChildren(properties), 'Name');
  return nameElement ? collectText(elementChildren(nameElement)) : '';
}

function listXmlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

let cache: readonly CorpusField[] | null = null;

/**
 * Полный скан корпуса (~2-3с, кэшируется на процесс — все тестовые файлы,
 * требующие корпус, переиспользуют один и тот же результат благодаря
 * `require`-кэшу Node). Полный обход, без подвыборки: единичный проход по
 * `example/2.20` + `example/2.21` (cf и cfe/EVOLC) укладывается в секунды —
 * подвыборка не требуется (см. CLAUDE.md про ~20с порог).
 */
export function scanCorpusFields(): readonly CorpusField[] {
  if (cache) {
    return cache;
  }
  const result: CorpusField[] = [];
  const roots = [EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21, EXAMPLE_GENERATIONS.cfe21];
  for (const root of roots) {
    for (const ownerKind of fieldOwnerKinds()) {
      const folder = META_TYPES[ownerKind].folder;
      if (!folder) {
        continue;
      }
      for (const xmlPath of listXmlFiles(path.join(root, folder))) {
        scanObjectFile(xmlPath, ownerKind, result);
      }
    }
  }
  cache = result;
  return result;
}

/** Свойства из {@link TYPED_FIELD_CONTROLLED_KEYS_FOR_TESTS}, зависящие от владельца по эталону (зеркало fill/DataHistory/…). */
export const OWNER_MIRROR_KEYS = ['FillFromFillingValue', 'FillValue', 'DataHistory', 'Indexing', 'FullTextSearch'] as const;

// ── Инвариант структурного round-trip после мутации XML ────────────────────
//
// Главный критерий качества (см. бриф): сгенерированный XML обязан ВСЕГДА
// читаться платформой 1С без ошибок. Битый XML одного поля делает нечитаемой
// ВСЮ конфигурацию, а не портит одно поле — поэтому построчного диффа
// («выглядит правильно») недостаточно: он не заметит, например, незакрытый
// или задвоенный тег, если тот попал в «ожидаемо изменившиеся» строки.
// Инварианты (проверяются вместе, но независимо от построчного сравнения):
//  1) результат мутации обязан парситься как well-formed XML;
//  2) множество прямых детей `<Properties>` целевого элемента меняется РОВНО
//     в ожидаемых ключах — остальные (включая их текст/атрибуты и порядок)
//     идентичны позиционно (построчный дифф ловит косметику вроде отступов,
//     структурный — семантику: значение неизменившегося свойства);
//  3) корневой тег элемента, его `uuid` и `<Name>` после мутации неизменны.

/** Проверяет, что `xml` — well-formed XML (нет незакрытых/задвоенных тегов и т.п.). */
export function assertWellFormedXml(xml: string, label: string): void {
  const result = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  assert.strictEqual(
    result === true,
    true,
    `${label}: результат мутации не является well-formed XML: ${result === true ? '' : JSON.stringify((result as { err: unknown }).err)}`
  );
}

/** Текстовый узел или узел-элемент без «шумовых» whitespace-only текстовых детей — рекурсивно. */
type CanonicalNode =
  | { readonly text: string }
  | { readonly tag: string; readonly attrs: Readonly<Record<string, string>>; readonly children: readonly CanonicalNode[] };

function canonicalizeNode(node: XmlNode): CanonicalNode | null {
  if (isTextNode(node)) {
    const text = node['#text'].trim();
    return text.length > 0 ? { text } : null;
  }
  const tag = elementName(node);
  if (!tag) {
    return null;
  }
  const attrs = ((node as Record<string, unknown>)[':@'] as Record<string, string> | undefined) ?? {};
  const children = elementChildren(node)
    .map(canonicalizeNode)
    .filter((child): child is CanonicalNode => child !== null);
  return { tag, attrs, children };
}

/**
 * Детерминированная «подпись» значения свойства — не зависит от отступов и
 * переводов строк (canonicalizeNode отбрасывает whitespace-only текстовые
 * узлы), но чувствительна к реальному изменению содержимого/атрибутов/тегов
 * на любой глубине (например, внутри многострочного `<ChoiceParameterLinks>`).
 */
function propertySignature(node: XmlNode): string {
  return JSON.stringify(canonicalizeNode(node));
}

function parseSingleRoot(xml: string, label: string): XmlElementNode {
  const nodes = parser.parse(xml) as XmlNodeList;
  const root = nodes.find((node) => elementName(node));
  assert.ok(root, `${label}: не удалось найти корневой элемент для структурного сравнения`);
  return root as XmlElementNode;
}

interface PropertyEntry { readonly key: string; readonly signature: string }

function propertiesEntries(root: XmlElementNode): PropertyEntry[] {
  const properties = firstDirect(elementChildren(root), 'Properties');
  if (!properties) {
    return [];
  }
  return elementChildren(properties)
    .map((child): PropertyEntry | null => {
      const key = elementName(child);
      return key ? { key, signature: propertySignature(child) } : null;
    })
    .filter((entry): entry is PropertyEntry => entry !== null);
}

/**
 * Структурный round-trip ОДНОГО элемента типизированного поля (например,
 * `<Attribute uuid="…">…</Attribute>`): well-formedness + «изменились ровно
 * ожидаемые ключи `<Properties>`, корень/uuid/<Name> — нет». Используется
 * после каждой мутации, где есть чёткое «было / стало» одного и того же
 * элемента (GOLDEN B, смена типа, add-путь для уже существующего владельца).
 */
export function assertStructuralRoundTrip(
  beforeElementXml: string,
  afterElementXml: string,
  expectedChangedKeys: readonly string[],
  label = 'структурный round-trip'
): void {
  assertWellFormedXml(beforeElementXml, `${label}: до мутации`);
  assertWellFormedXml(afterElementXml, `${label}: после мутации`);

  const beforeRoot = parseSingleRoot(beforeElementXml, `${label}: до мутации`);
  const afterRoot = parseSingleRoot(afterElementXml, `${label}: после мутации`);

  assert.strictEqual(elementName(afterRoot), elementName(beforeRoot), `${label}: корневой тег элемента не должен меняться`);
  assert.strictEqual(attrOf(afterRoot, 'uuid'), attrOf(beforeRoot, 'uuid'), `${label}: uuid элемента не должен меняться`);

  const beforeProps = propertiesEntries(beforeRoot);
  const afterProps = propertiesEntries(afterRoot);
  const beforeByKey = new Map(beforeProps.map((entry) => [entry.key, entry.signature]));
  const afterByKey = new Map(afterProps.map((entry) => [entry.key, entry.signature]));

  assert.strictEqual(
    afterByKey.get('Name'),
    beforeByKey.get('Name'),
    `${label}: <Name> элемента не должен меняться от смены типа/состава свойств`
  );

  const allKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const actuallyChanged = [...allKeys].filter((key) => beforeByKey.get(key) !== afterByKey.get(key));
  assert.deepStrictEqual(
    actuallyChanged.sort(),
    [...expectedChangedKeys].sort(),
    `${label}: изменились не те ключи <Properties> — ожидалось ${JSON.stringify(expectedChangedKeys)}, ` +
    `фактически ${JSON.stringify(actuallyChanged)}`
  );

  // Порядок неизменившихся ключей не должен «плавать» (независимое от
  // построчного дифф-помощника подтверждение стабильности позиции).
  const expectedSet = new Set(expectedChangedKeys);
  const beforeOrder = beforeProps.map((entry) => entry.key).filter((key) => !expectedSet.has(key));
  const afterOrder = afterProps.map((entry) => entry.key).filter((key) => !expectedSet.has(key));
  assert.deepStrictEqual(afterOrder, beforeOrder, `${label}: порядок неизменившихся свойств не должен меняться`);
}
