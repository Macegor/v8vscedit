import { findNestingAwareElementRange } from '../XmlUtils';

/**
 * Механика точечной правки блока `<Properties>` типизированного поля — БЕЗ
 * каких-либо правил состава (правила живут в `TypedFieldOwnerRules`).
 *
 * Почему точечно, а не пересборкой: пересобранный из «разрешённых ключей» блок
 * терял ведущие отступы переиспользованных фрагментов (`collectPropertyBlocks`
 * их не захватывал, а `join('\n')` не восполнял), и git-дифф смены типа
 * выглядел как полная перезапись объекта. Splice по диапазонам сохраняет всё,
 * чего мы не трогали, байт-в-байт — включая многострочные `Synonym`/`ToolTip`/
 * `ChoiceParameterLinks` и незнакомые теги будущих версий платформы.
 */

/** Прямой дочерний блок `<Properties>` со своими границами и ведущим отступом. */
export interface PropertyBlock {
  readonly key: string;
  /** Индекс `<` открывающего тега внутри `propertiesInner`. */
  readonly start: number;
  /** Индекс сразу за закрывающим тегом (или за `/>`). */
  readonly end: number;
  /** Отступ строки, на которой начинается блок (пустой, если блок не с начала строки). */
  readonly indent: string;
  /** Содержимое блока целиком, без ведущего отступа. */
  readonly xml: string;
}

/** Диапазон содержимого `<Properties>` внутри XML элемента. */
export interface PropertiesRange {
  readonly inner: string;
  readonly start: number;
  readonly end: number;
}

/** Находит содержимое `<Properties>` элемента; `null`, если блока нет или он пуст. */
export function findPropertiesRange(elementXml: string): PropertiesRange | null {
  const range = findNestingAwareElementRange(elementXml, 'Properties');
  if (!range) {
    return null;
  }
  const inner = elementXml.slice(range.openEnd, range.closeStart);
  if (!inner.trim()) {
    // Самозакрытый `<Properties/>` (closeStart === openEnd) или пустой блок:
    // вставлять свойства некуда, а разворачивать пустой тег — уже не правка
    // состава, а переформатирование чужого файла.
    return null;
  }
  return { inner, start: range.openEnd, end: range.closeStart };
}

/** Прямые дочерние блоки `<Properties>` в порядке следования в документе. */
export function collectPropertyBlocks(propertiesInner: string): PropertyBlock[] {
  const blocks: PropertyBlock[] = [];
  let index = 0;
  while (index < propertiesInner.length) {
    const open = /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?\/?>/.exec(propertiesInner.slice(index));
    if (!open) {
      break;
    }
    const key = open[1];
    const start = index + open.index;
    const openEnd = start + open[0].length;
    if (open[0].endsWith('/>')) {
      blocks.push(makeBlock(propertiesInner, key, start, openEnd));
      index = openEnd;
      continue;
    }
    const closeTag = `</${key}>`;
    const closeStart = propertiesInner.indexOf(closeTag, openEnd);
    if (closeStart < 0) {
      // Незакрытый тег (испорченный файл): пропускаем, не пытаясь угадать конец.
      index = openEnd;
      continue;
    }
    blocks.push(makeBlock(propertiesInner, key, start, closeStart + closeTag.length));
    index = closeStart + closeTag.length;
  }
  return blocks;
}

function makeBlock(inner: string, key: string, start: number, end: number): PropertyBlock {
  return { key, start, end, indent: leadingIndent(inner, start), xml: inner.slice(start, end) };
}

/** Ведущий отступ строки, на которой начинается блок (пустая строка, если перед ним есть текст). */
function leadingIndent(inner: string, start: number): string {
  const lineStart = inner.lastIndexOf('\n', start - 1) + 1;
  const prefix = inner.slice(lineStart, start);
  return /^[ \t]*$/.test(prefix) ? prefix : '';
}

/** Преобладающий перевод строки фрагмента (CRLF-файл не должен получить LF-вставку). */
export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Отступ свойств блока: берётся у первого блока, начинающегося со строки. */
export function detectPropertyIndent(blocks: readonly PropertyBlock[], fallback = '\t\t\t'): string {
  return blocks.find((block) => block.indent.length > 0)?.indent ?? fallback;
}

/**
 * Удаляет блоки вместе с их ведущим переводом строки и отступом. Порядок правок —
 * от конца к началу, чтобы ранее вычисленные индексы оставались валидными.
 */
export function removeBlocks(propertiesInner: string, blocks: readonly PropertyBlock[]): string {
  let result = propertiesInner;
  for (const block of [...blocks].sort((a, b) => b.start - a.start)) {
    const from = lineStartWithEol(result, block.start - block.indent.length);
    result = result.slice(0, from) + result.slice(block.end);
  }
  return result;
}

/** Начало строки блока вместе с переводом строки перед ней (если он есть). */
function lineStartWithEol(inner: string, indentStart: number): number {
  if (inner.startsWith('\r\n', indentStart - 2)) {
    return indentStart - 2;
  }
  return inner.startsWith('\n', indentStart - 1) ? indentStart - 1 : indentStart;
}

/** Заменяет содержимое блока целиком (тег и его внутренности) на готовый XML. */
export function replaceBlock(propertiesInner: string, block: PropertyBlock, xml: string): string {
  return propertiesInner.slice(0, block.start) + xml + propertiesInner.slice(block.end);
}

/**
 * Вставляет готовый блок в каноническую позицию: перед первым свойством,
 * которое по порядку `xs:sequence` идёт ПОЗЖЕ вставляемого, иначе — после
 * последнего, которое идёт раньше, иначе — в конец блока свойств.
 *
 * Якорь ищется по документу, а не по каноническому порядку: между свойствами
 * могут стоять неуправляемые теги (`Use` у реквизита справочника), и новый блок
 * обязан лечь по нужную сторону от них, а сами они — остаться на месте.
 */
export function insertBlockInCanonicalPosition(
  propertiesInner: string,
  blocks: readonly PropertyBlock[],
  orderOf: (key: string) => number | undefined,
  order: number,
  xml: string,
  eol: string
): string {
  const ordered = blocks
    .map((block) => ({ block, order: orderOf(block.key) }))
    .filter((item): item is { block: PropertyBlock; order: number } => item.order !== undefined);

  const after = ordered.find((item) => item.order > order);
  if (after) {
    return insertBefore(propertiesInner, after.block, xml, eol);
  }
  const before = [...ordered].reverse().find((item) => item.order < order);
  if (before) {
    return insertAfter(propertiesInner, before.block, xml, eol);
  }
  /* c8 ignore next 3 -- `<Properties>` без единого тега не существует: пустой
     блок отсекает findPropertiesRange, а текст без тегов не является XML 1С;
     ветка оставлена, чтобы испорченный файл не приводил к исключению. */
  const last = blocks.at(-1);
  return last ? insertAfter(propertiesInner, last, xml, eol) : propertiesInner;
}

function insertBefore(propertiesInner: string, anchor: PropertyBlock, xml: string, eol: string): string {
  return `${propertiesInner.slice(0, anchor.start)}${xml}${eol}${anchor.indent}${propertiesInner.slice(anchor.start)}`;
}

function insertAfter(propertiesInner: string, anchor: PropertyBlock, xml: string, eol: string): string {
  return `${propertiesInner.slice(0, anchor.end)}${eol}${anchor.indent}${xml}${propertiesInner.slice(anchor.end)}`;
}
