import { extractSimpleTag } from '../ConfigParser';
import { LocalizedStringValue } from '../handlers/_types';

/**
 * Разбор XML-выгрузки метаданных 1С для панели свойств:
 * секция `<Properties>`, локализованные строки, блок `<Type>`.
 */

/**
 * Возвращает верхнеуровневые дочерние элементы секции `<Properties>` в порядке XML.
 * Учитывает вложенность (тело элемента — всё до парного закрывающего тега).
 */
export function extractTopLevelPropertiesChildren(xml: string): Array<{ tag: string; inner: string }> {
  const block = extractFirstBalancedBlock(xml, 'Properties');
  if (!block) {
    return [];
  }

  const result: Array<{ tag: string; inner: string }> = [];
  let pos = 0;
  const s = block;

  while (pos < s.length) {
    while (pos < s.length && /\s/.test(s[pos])) {
      pos++;
    }
    if (pos >= s.length) {
      break;
    }
    if (s[pos] !== '<') {
      pos++;
      continue;
    }
    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4);
      pos = end >= 0 ? end + 3 : s.length;
      continue;
    }

    const openMatch = /^<([^\s>/]+)(\s[^>]*)?>/.exec(s.slice(pos));
    if (!openMatch) {
      pos++;
      continue;
    }

    const tagName = openMatch[1];
    const openFullLen = openMatch[0].length;
    const isEmptyElement = openMatch[0].trimEnd().endsWith('/>');

    if (isEmptyElement) {
      result.push({ tag: tagName, inner: '' });
      pos += openFullLen;
      continue;
    }

    const innerStart = pos + openFullLen;
    const innerEnd = findClosingTagIndex(s, innerStart, tagName);
    if (innerEnd < 0) {
      break;
    }

    result.push({ tag: tagName, inner: s.slice(innerStart, innerEnd) });
    pos = innerEnd + `</${tagName}>`.length;
  }

  return result;
}

/** Первое вхождение `<tagName>...</tagName>` с учётом вложенных одноимённых тегов */
export function extractFirstBalancedBlock(xml: string, tagName: string): string | null {
  const openRe = new RegExp(`<${tagName}\\b[^>]*>`, 'm');
  const openM = openRe.exec(xml);
  if (!openM) {
    return null;
  }
  const innerStart = openM.index + openM[0].length;
  const end = findClosingTagIndex(xml, innerStart, tagName);
  if (end < 0) {
    return null;
  }
  return xml.slice(innerStart, end);
}

/** Парсит тело секции Synonym (и аналогичных локализованных полей) для панели свойств */
export function parseLocalizedStringSection(inner: string): LocalizedStringValue {
  const values = Array.from(
    inner.matchAll(/<v8:item>\s*<v8:lang>([^<]*)<\/v8:lang>\s*<v8:content>([\s\S]*?)<\/v8:content>\s*<\/v8:item>/g)
  ).map((match) => ({
    lang: match[1].trim(),
    content: match[2].trim(),
  }));

  return {
    presentation: values[0]?.content ?? '',
    values,
  };
}

/**
 * Человекочитаемое описание блока типа (`<Type>` реквизита, параметра сеанса и т.п.):
 * список ссылок/примитивов и при наличии — квалификаторы строки, числа, даты.
 */
export function formatMetadataTypeDescription(typeInner: string): string {
  const lines: string[] = [];

  const types = Array.from(typeInner.matchAll(/<v8:Type>([^<]*)<\/v8:Type>/g)).map((m) => m[1].trim());
  if (types.length > 0) {
    lines.push(types.join('\n'));
  }

  const stringQ = extractFirstBalancedBlock(typeInner, 'v8:StringQualifiers');
  if (stringQ) {
    const len = extractSimpleTag(stringQ, 'v8:Length');
    const allowed = extractSimpleTag(stringQ, 'v8:AllowedLength');
    const parts = [`Строка: длина=${len ?? '—'}`, `допустимая длина=${allowed ?? '—'}`];
    lines.push(parts.join(', '));
  }

  const numQ = extractFirstBalancedBlock(typeInner, 'v8:NumberQualifiers');
  if (numQ) {
    const digits = extractSimpleTag(numQ, 'v8:Digits');
    const frac = extractSimpleTag(numQ, 'v8:FractionDigits');
    const allowedSign = extractSimpleTag(numQ, 'v8:AllowedSign');
    lines.push(`Число: разрядов=${digits ?? '—'}, дробных=${frac ?? '—'}, знак=${allowedSign ?? '—'}`);
  }

  const dateQ = extractFirstBalancedBlock(typeInner, 'v8:DateQualifiers');
  if (dateQ) {
    const datePortions = extractSimpleTag(dateQ, 'v8:DateFractions');
    lines.push(`Дата: состав даты=${datePortions ?? '—'}`);
  }

  if (lines.length === 0) {
    return typeInner.replace(/\s+/g, ' ').trim();
  }

  return lines.join('\n\n');
}

/** Сжимает произвольное XML-содержимое свойства для отображения в одной строке */
export function formatUnknownPropertyInner(inner: string): string {
  const collapsed = inner.replace(/\s+/g, ' ').trim();
  return collapsed.length > 2000 ? `${collapsed.slice(0, 2000)}…` : collapsed;
}

/** Индекс начала `</tagName>` для блока, начинающегося с innerStart */
function findClosingTagIndex(xml: string, innerStart: number, tagName: string): number {
  const openTag = new RegExp(`<${tagName}\\b[^>]*>`, 'g');
  const closeTag = `</${tagName}>`;
  let depth = 1;
  let pos = innerStart;

  openTag.lastIndex = 0;

  while (depth > 0 && pos < xml.length) {
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose < 0) {
      return -1;
    }

    openTag.lastIndex = pos;
    const nextOpen = openTag.exec(xml);
    if (nextOpen != null && nextOpen.index < nextClose) {
      depth++;
      pos = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return nextClose;
      }
      pos = nextClose + closeTag.length;
    }
  }

  return -1;
}
