/**
 * Пространства нумерации `id` управляемой формы 1С.
 *
 * Платформа (8.3.27) требует уникальности `id` НЕ по всему файлу, а внутри
 * своего пространства нумерации. Правило снято с эталонного корпуса `example/`
 * (обе генерации формата, cf и cfe) и здесь оформлено данными, а не россыпью
 * условий:
 *
 * 1. Элементы формы — ОДНО общее пространство, определяется структурно: любой
 *    тег, несущий атрибут `id`, кроме `Attribute`/`Column`/`Command`. Сюда
 *    попадают и служебные теги (ExtendedTooltip, ContextMenu, AutoCommandBar,
 *    SearchStringAddition, ViewStatusAddition, SearchControlAddition,
 *    ColumnGroup), и «широкие» поля (SpreadSheetDocumentField, ChartField, …) —
 *    именно поэтому список тегов не перечисляется: любой новый вид поля 1С
 *    учитывается автоматически.
 * 2. Реквизиты (`<Attribute>`) — отдельное пространство.
 * 3. Команды (`<Command>`) — отдельное пространство.
 * 4. Колонки (`<Column>`) — пространство равно НЕПОСРЕДСТВЕННОМУ контейнеру:
 *    либо `<Columns>`, либо каждый отдельный `<AdditionalColumns table="…">`.
 *    Плоский подсчёт колонок по реквизиту даёт ложные срабатывания.
 * 5. `<BaseForm>` (копия базовой формы в расширении) — отдельный регион,
 *    см. {@link splitBaseForm}.
 *
 * `id="-1"` (служебное «нет идентификатора») из проверки дублей и из счётчиков
 * исключается.
 *
 * Модуль чистый: строка на входе — данные на выходе, без `fs`/`path`/`vscode`.
 */

export type IdSpaceKind = 'element' | 'attribute' | 'command' | 'column';

export interface FormIdEntry {
  /** Имя тега ровно как в XML (`InputField`, `ColumnGroup`, `Attribute`, …). */
  readonly tag: string;
  /** Значение атрибута `name` или пустая строка, если атрибута нет. */
  readonly name: string;
  /** Значение собственного атрибута `id`; пусто, если это чужой `xr:id`/`v8:id`. */
  readonly id: string;
  /** Смещение открывающего тега в разобранном регионе — задаёт документный порядок. */
  readonly offset: number;
}

export interface FormIdSpace {
  readonly kind: IdSpaceKind;
  /** Ключ пространства: для колонок — смещение контейнера, иначе сам вид. */
  readonly key: string;
  /** Человекочитаемое описание пространства для сообщений валидатора. */
  readonly label: string;
  readonly entries: FormIdEntry[];
}

export interface FormIdDuplicate {
  readonly id: string;
  readonly current: FormIdEntry;
  readonly previous: FormIdEntry;
}

export interface FormMaxIds {
  element: number;
  attribute: number;
  command: number;
}

/** Три исключения из структурного правила «тег с id — элемент формы». */
const ID_SPACE_BY_TAG: Readonly<Record<string, IdSpaceKind | undefined>> = {
  Attribute: 'attribute',
  Command: 'command',
  Column: 'column',
};

/** Контейнеры, задающие пространство нумерации колонок. */
const COLUMN_CONTAINER_TAGS: ReadonlySet<string> = new Set(['Columns', 'AdditionalColumns']);

/** Служебный «пустой» идентификатор: в дублях и счётчиках не участвует. */
const ABSENT_ID = '-1';

/**
 * Токенайзер XML: комментарий, CDATA, пролог/PI, декларация (`<!DOCTYPE`) —
 * пропускаются целиком (содержимое комментария не должно давать записей),
 * последняя альтернатива — открывающий/закрывающий тег с блоком атрибутов, в
 * котором кавычки учитываются, а хвостовой `>` необязателен (обрезанный файл).
 */
const XML_TOKEN_RE = new RegExp(
  '<!--[\\s\\S]*?(?:-->|$)' +
  '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>|$)' +
  '|<\\?[\\s\\S]*?(?:\\?>|$)' +
  '|<![^>]*(?:>|$)' +
  '|<(/?)([A-Za-z_][A-Za-z0-9_.:-]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>?',
  'g',
);

/** Собственный `id` элемента: `xr:id`/`v8:id` сюда намеренно не попадают. */
const OWN_ID_RE = /(?:^|\s)id\s*=\s*"([^"]*)"/;
/** Тег «несёт id» — в том числе в пространственно-квалифицированной форме. */
const ANY_ID_RE = /(?:^|\s)(?:[A-Za-z_][A-Za-z0-9_.-]*:)?id\s*=\s*"/;
const NAME_RE = /(?:^|\s)name\s*=\s*"([^"]*)"/;
const TABLE_RE = /(?:^|\s)table\s*=\s*"([^"]*)"/;
const NUMERIC_ID_RE = /^\d+$/;
const BASE_FORM_OPEN_RE = /<BaseForm(?=[\s/>])[^>]*>/;
const BASE_FORM_CLOSE = '</BaseForm>';

interface OpenTag {
  readonly tag: string;
  readonly attrs: string;
  readonly offset: number;
}

/**
 * Делит XML формы на собственный регион и регион `<BaseForm>` (копию базовой
 * формы, добавляемую расширением). Их id живут в разных пространствах, поэтому
 * зеркальные значения id — норма, а не дубль.
 *
 * При незакрытом `<BaseForm>` весь остаток файла консервативно считается
 * базовым: лучше не проверить чужие id, чем выдать ложную ошибку.
 */
export function splitBaseForm(xml: string): { own: string; baseForm: string | null } {
  const open = BASE_FORM_OPEN_RE.exec(xml);
  if (open === null) {
    return { own: xml, baseForm: null };
  }
  const start = open.index;
  const openEnd = start + open[0].length;
  if (open[0].endsWith('/>')) {
    return { own: xml.slice(0, start) + xml.slice(openEnd), baseForm: open[0] };
  }
  const closeAt = xml.indexOf(BASE_FORM_CLOSE, openEnd);
  if (closeAt < 0) {
    return { own: xml.slice(0, start), baseForm: xml.slice(start) };
  }
  const end = closeAt + BASE_FORM_CLOSE.length;
  return { own: xml.slice(0, start) + xml.slice(end), baseForm: xml.slice(start, end) };
}

/**
 * Однопроходно собирает все пространства нумерации региона формы.
 *
 * Порядок результата фиксирован: element → attribute → command → колоночные
 * контейнеры в порядке появления. Пустые пространства не создаются.
 */
export function collectIdSpaces(region: string): FormIdSpace[] {
  const singles = new Map<IdSpaceKind, FormIdSpace>();
  const columns = new Map<string, FormIdSpace>();
  const stack: OpenTag[] = [];
  XML_TOKEN_RE.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = XML_TOKEN_RE.exec(region)) !== null) {
    // Комментарий/CDATA/пролог/декларация: содержимое игнорируется целиком,
    // закомментированный тег записи не даёт.
    if (token[0].startsWith('<!') || token[0].startsWith('<?')) {
      continue;
    }
    const tag = token[2];
    if (token[1] === '/') {
      // Формы 1С — well-formed XML, поэтому закрывающему тегу всегда
      // соответствует вершина стека; рассинхронизация невозможна.
      stack.pop();
      continue;
    }
    const attrs = token[3];
    if (ANY_ID_RE.test(attrs)) {
      const entry: FormIdEntry = {
        tag,
        name: NAME_RE.exec(attrs)?.[1] ?? '',
        id: OWN_ID_RE.exec(attrs)?.[1] ?? '',
        offset: token.index,
      };
      const kind = ID_SPACE_BY_TAG[tag] ?? 'element';
      if (kind === 'column') {
        addColumnEntry(columns, stack, entry);
      } else {
        spaceOf(singles, kind).entries.push(entry);
      }
    }
    if (!attrs.trimEnd().endsWith('/')) {
      stack.push({ tag, attrs, offset: token.index });
    }
  }
  const result: FormIdSpace[] = [];
  for (const kind of ['element', 'attribute', 'command'] as const) {
    const space = singles.get(kind);
    if (space !== undefined) {
      result.push(space);
    }
  }
  result.push(...columns.values());
  return result;
}

/** Дубли внутри ОДНОГО пространства; `id="-1"` и отсутствующий id пропускаются. */
export function findDuplicateIds(space: FormIdSpace): FormIdDuplicate[] {
  const seen = new Map<string, FormIdEntry>();
  const result: FormIdDuplicate[] = [];
  for (const entry of space.entries) {
    if (!isCheckedId(entry.id)) {
      continue;
    }
    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      result.push({ id: entry.id, current: entry, previous });
      continue;
    }
    seen.set(entry.id, entry);
  }
  return result;
}

/** Число записей пространства, реально участвующих в проверке уникальности. */
export function countCheckedEntries(space: FormIdSpace): number {
  return space.entries.filter((entry) => isCheckedId(entry.id)).length;
}

/**
 * Максимальные числовые id по видам ВСЕГО документа (включая `<BaseForm>`):
 * аллокатору новых id выгодно быть консервативным и не пересекаться даже с
 * базовой формой. Колонки в максимум не входят — у них своя нумерация.
 */
export function maxIdByKind(xml: string): FormMaxIds {
  const result: FormMaxIds = { element: 0, attribute: 0, command: 0 };
  for (const space of collectIdSpaces(xml)) {
    const kind = space.kind;
    if (kind === 'column') {
      continue;
    }
    for (const entry of space.entries) {
      if (!NUMERIC_ID_RE.test(entry.id)) {
        continue;
      }
      const value = Number(entry.id);
      if (value > result[kind]) {
        result[kind] = value;
      }
    }
  }
  return result;
}

function isCheckedId(id: string): boolean {
  return id !== '' && id !== ABSENT_ID;
}

function spaceOf(singles: Map<IdSpaceKind, FormIdSpace>, kind: IdSpaceKind): FormIdSpace {
  const existing = singles.get(kind);
  if (existing !== undefined) {
    return existing;
  }
  const created: FormIdSpace = { kind, key: kind, label: kind, entries: [] };
  singles.set(kind, created);
  return created;
}

/**
 * Кладёт колонку в пространство её НЕПОСРЕДСТВЕННОГО контейнера. Владелец-
 * реквизит (ближайший `<Attribute name="…">`) участвует только в метке: ключом
 * он быть не может, т.к. у одного реквизита бывает несколько контейнеров
 * `<AdditionalColumns>` с независимой нумерацией.
 */
function addColumnEntry(columns: Map<string, FormIdSpace>, stack: readonly OpenTag[], entry: FormIdEntry): void {
  const container = findAncestor(stack, (tag) => COLUMN_CONTAINER_TAGS.has(tag));
  if (container === undefined) {
    // Колонка вне контейнера — пространства нумерации у неё нет; проверять
    // такую запись не с чем (в корректной выгрузке 1С не встречается).
    return;
  }
  const key = `column@${String(container.offset)}`;
  const existing = columns.get(key);
  if (existing !== undefined) {
    existing.entries.push(entry);
    return;
  }
  columns.set(key, { kind: 'column', key, label: buildColumnLabel(stack, container), entries: [entry] });
}

function buildColumnLabel(stack: readonly OpenTag[], container: OpenTag): string {
  const table = TABLE_RE.exec(container.attrs)?.[1];
  const containerLabel = table !== undefined ? `${container.tag} table="${table}"` : container.tag;
  const owner = findAncestor(stack, (tag) => tag === 'Attribute');
  const ownerName = owner !== undefined ? NAME_RE.exec(owner.attrs)?.[1] : undefined;
  return ownerName ? `'${ownerName}' / ${containerLabel}` : containerLabel;
}

function findAncestor(stack: readonly OpenTag[], accept: (tag: string) => boolean): OpenTag | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (accept(stack[i].tag)) {
      return stack[i];
    }
  }
  return undefined;
}
