import * as fs from 'fs';
import {
  findDirectElementRanges,
  findNestingAwareElementRange,
  writeTextFilePreservingBomAndEol,
} from '../XmlUtils';
import {
  buildAttributeXml,
  buildCommandXml,
  buildElementXml,
} from './FormBuilders';
import {
  createIdAllocator,
  escapeRegExp,
  escapeXml,
  resolveFormXmlPath,
} from './FormShared';
import type {
  EditFormOptions,
  ElementEventPatch,
  FormEventPatch,
  FormMutationResult,
} from './types';

export class FormEditService {
  edit(options: EditFormOptions): FormMutationResult {
    const formPath = resolveFormXmlPath(options.formPath);
    const original = fs.readFileSync(formPath, 'utf-8');
    let next = original;
    const id = createIdAllocator(original);
    const warnings: string[] = [];
    if (options.definition.attributes?.length) {
      next = appendIntoContainer(next, 'Attributes', options.definition.attributes.map((attr) => buildAttributeXml(attr, '\t\t', id.nextAttribute())).join('\n'));
    }
    if (options.definition.commands?.length) {
      next = appendIntoContainer(next, 'Commands', options.definition.commands.map((cmd) => buildCommandXml(cmd, '\t\t', id.nextCommand())).join('\n'));
    }
    if (options.definition.elements?.length) {
      const elementXml = options.definition.elements.map((el) => buildElementXml(el, '\t\t', id)).join('\n');
      const intoName = options.definition.into;
      const afterName = options.definition.after;
      if (intoName && afterName) {
        next = appendAfterInNamedElementChildItems(next, intoName, afterName, elementXml, warnings);
      } else if (afterName) {
        next = appendAfterInRootChildItems(next, afterName, elementXml, warnings);
      } else if (intoName) {
        next = appendIntoNamedElementChildItems(next, intoName, elementXml);
      } else {
        next = appendIntoRootContainer(next, 'ChildItems', elementXml);
      }
    }
    if (options.definition.formEvents?.length) {
      next = appendFormEvents(next, options.definition.formEvents);
    }
    if (options.definition.elementEvents?.length) {
      for (const event of options.definition.elementEvents) {
        next = appendElementEvent(next, event);
      }
    }
    writeTextFilePreservingBomAndEol(formPath, original, next);
    return { changedFiles: [formPath], warnings };
  }
}

/** Найти диапазон элемента с заданным `name=` внутри XML — возвращает индекс закрывающего тега. */
function findNamedElementCloseEnd(xml: string, name: string, fromIndex = 0): number | null {
  const re = new RegExp(`<([A-Za-z]+)\\b[^>]*\\bname="${escapeRegExp(name)}"[^>]*?(\\/?)>`, 'g');
  re.lastIndex = fromIndex;
  const match = re.exec(xml);
  if (!match) {return null;}
  const tag = match[1];
  if (match[2] === '/') {
    return match.index + match[0].length;
  }
  const closeTag = `</${tag}>`;
  // Учёт вложенности
  const openRe = new RegExp(`<${tag}\\b[^/>]*>`, 'g');
  let depth = 1;
  let pos = match.index + match[0].length;
  while (depth > 0 && pos < xml.length) {
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose < 0) {return null;}
    openRe.lastIndex = pos;
    let nextOpen = -1;
    for (;;) {
      const o = openRe.exec(xml);
      if (!o || o.index > nextClose) {break;}
      nextOpen = o.index;
      depth++;
      openRe.lastIndex = o.index + o[0].length;
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      pos = openRe.lastIndex;
      continue;
    }
    depth--;
    pos = nextClose + closeTag.length;
  }
  return pos;
}

export function appendIntoContainer(xml: string, containerTag: string, content: string): string {
  if (!content.trim()) {
    return xml;
  }
  const selfClosing = new RegExp(`<${containerTag}\\s*\\/>`);
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, () => `<${containerTag}>\n${content}\n\t</${containerTag}>`);
  }
  const re = new RegExp(`(<${containerTag}>)([\\s\\S]*?)(<\\/${containerTag}>)`);
  if (re.test(xml)) {
    return xml.replace(re, (_, open: string, inner: string, close: string) => `${open}${inner.trimEnd()}\n${content}\n\t${close}`);
  }
  const before = /<\/Form>\s*$/.exec(xml);
  if (!before) {
    return `${xml}\n<${containerTag}>\n${content}\n</${containerTag}>\n`;
  }
  return `${xml.slice(0, before.index)}\t<${containerTag}>\n${content}\n\t</${containerTag}>\n${xml.slice(before.index)}`;
}

/**
 * Возвращает абсолютный диапазон КОРНЕВОГО контейнера формы (`<ChildItems>`/`<Events>` —
 * прямой потомок корневого `<Form>`). Без этого первый текстовый матч `<ChildItems>`
 * нередко попадает во вложенный `<AutoCommandBar>`, а не в корень формы.
 */
function findRootFormContainerRange(xml: string, containerTag: string): { start: number; end: number } | null {
  const formRange = findNestingAwareElementRange(xml, 'Form');
  if (!formRange) {
    return null;
  }
  const inner = xml.slice(formRange.openEnd, formRange.closeStart);
  const direct = findDirectElementRanges(inner, containerTag).at(0);
  if (!direct) {
    return null;
  }
  return { start: formRange.openEnd + direct.start, end: formRange.openEnd + direct.end };
}

/**
 * Вставляет content в КОРНЕВОЙ контейнер формы (прямой потомок `<Form>`), а не в
 * первый встретившийся по тексту. Если корневой контейнер отсутствует или само-закрыт —
 * откатывается к универсальному `appendIntoContainer`.
 */
export function appendIntoRootContainer(xml: string, containerTag: string, content: string): string {
  if (!content.trim()) {
    return xml;
  }
  const root = findRootFormContainerRange(xml, containerTag);
  if (!root) {
    // Корневой контейнер не материализован — общий путь сам создаст блок перед </Form>.
    return appendIntoContainer(xml, containerTag, content);
  }
  const blockStart = root.start;
  const blockEnd = root.end;
  const block = xml.slice(blockStart, blockEnd);
  // Само-закрытый корневой контейнер: `<ChildItems/>` → раскрыть.
  if (/\/>\s*$/.test(block)) {
    const expanded = `<${containerTag}>\n${content}\n\t</${containerTag}>`;
    return `${xml.slice(0, blockStart)}${expanded}${xml.slice(blockEnd)}`;
  }
  const closeTag = `</${containerTag}>`;
  const closeAt = blockEnd - closeTag.length;
  const innerContent = xml.slice(blockStart + `<${containerTag}>`.length, closeAt);
  return `${xml.slice(0, blockStart)}<${containerTag}>${innerContent.trimEnd()}\n${content}\n\t${closeTag}${xml.slice(blockEnd)}`;
}

export function appendIntoNamedElementChildItems(xml: string, elementName: string, content: string): string {
  const re = new RegExp(`(<[A-Za-z]+\\b[^>]*name="${escapeRegExp(elementName)}"[^>]*>[\\s\\S]*?)(<ChildItems>)([\\s\\S]*?)(<\\/ChildItems>)`);
  if (re.test(xml)) {
    return xml.replace(re, (_, prefix: string, open: string, inner: string, close: string) => `${prefix}${open}${inner.trimEnd()}\n${content}\n\t\t${close}`);
  }
  return appendIntoContainer(xml, 'ChildItems', content);
}

/** Вставить content сразу после элемента `afterName`, найденного в корневом `<ChildItems>`. */
function appendAfterInRootChildItems(xml: string, afterName: string, content: string, warnings: string[]): string {
  // Корневой <ChildItems> — прямой потомок <Form>; первый текстовый матч нередко
  // принадлежит вложенному <AutoCommandBar>, поэтому ищем nesting-aware.
  const root = findRootFormContainerRange(xml, 'ChildItems');
  if (!root) {
    warnings.push(`[WARN] <ChildItems> отсутствует, добавление в конец формы.`);
    return appendIntoRootContainer(xml, 'ChildItems', content);
  }
  // closeStart известен из nesting-aware диапазона — корректно при вложенных <ChildItems>.
  return insertAfterNamedInsideContainer(xml, root.start, 'ChildItems', afterName, content, warnings, root.end - '</ChildItems>'.length);
}

function appendAfterInNamedElementChildItems(xml: string, intoName: string, afterName: string, content: string, warnings: string[]): string {
  // Найти открывающий тег into-элемента
  const intoStart = xml.search(new RegExp(`<[A-Za-z]+\\b[^>]*\\bname="${escapeRegExp(intoName)}"[^>]*>`));
  if (intoStart < 0) {
    warnings.push(`[WARN] into='${intoName}' не найден — вставка в корневой ChildItems.`);
    return appendAfterInRootChildItems(xml, afterName, content, warnings);
  }
  const ciOpen = xml.indexOf('<ChildItems>', intoStart);
  if (ciOpen < 0) {
    warnings.push(`[WARN] У '${intoName}' нет <ChildItems> — вставка в корневой ChildItems.`);
    return appendAfterInRootChildItems(xml, afterName, content, warnings);
  }
  return insertAfterNamedInsideContainer(xml, ciOpen, 'ChildItems', afterName, content, warnings);
}

function insertAfterNamedInsideContainer(xml: string, containerOpenAt: number, containerTag: string, afterName: string, content: string, warnings: string[], containerCloseAt?: number): string {
  const closeTag = `</${containerTag}>`;
  // Если позиция закрывающего тега передана из nesting-aware диапазона — используем её,
  // иначе fallback на первый текстовый матч (для именованных вложенных контейнеров).
  const containerClose = containerCloseAt ?? xml.indexOf(closeTag, containerOpenAt);
  if (containerClose < 0) {
    warnings.push(`[WARN] </${containerTag}> не найден, вставка в конец.`);
    return appendIntoContainer(xml, containerTag, content);
  }
  const containerInnerStart = containerOpenAt + `<${containerTag}>`.length;
  // Найти named element строго внутри container
  const closeAt = findNamedElementCloseEnd(xml.slice(0, containerClose), afterName, containerInnerStart);
  if (closeAt === null) {
    warnings.push(`[WARN] after='${afterName}' не найден в ${containerTag}, добавление в конец.`);
    return `${xml.slice(0, containerClose).trimEnd()}\n${content}\n\t${xml.slice(containerClose)}`;
  }
  // Вставить content прямо после закрывающего тега + перевод строки
  return `${xml.slice(0, closeAt)}\n${content}${xml.slice(closeAt)}`;
}

export function appendFormEvents(xml: string, events: readonly FormEventPatch[]): string {
  const content = events.map((event) => `\t\t<Event name="${escapeXml(event.name)}"${event.callType ? ` callType="${escapeXml(event.callType)}"` : ''}>${escapeXml(event.handler)}</Event>`).join('\n');
  // Корневые события формы — прямой потомок <Form>, а не первый <Events> по тексту
  // (вложенные элементы тоже могут содержать собственные <Events>).
  return appendIntoRootContainer(xml, 'Events', content);
}

export function appendElementEvent(xml: string, event: ElementEventPatch): string {
  const block = `\t\t<Event name="${escapeXml(event.name)}"${event.callType ? ` callType="${escapeXml(event.callType)}"` : ''}>${escapeXml(event.handler)}</Event>`;
  const re = new RegExp(`(<[A-Za-z]+\\b[^>]*name="${escapeRegExp(event.element)}"[^>]*>[\\s\\S]*?)(<Events>)([\\s\\S]*?)(<\\/Events>)`);
  if (re.test(xml)) {
    return xml.replace(re, (_, prefix: string, open: string, inner: string, close: string) => `${prefix}${open}${inner.trimEnd()}\n${block}\n\t\t${close}`);
  }
  const elementOpen = new RegExp(`(<[A-Za-z]+\\b[^>]*name="${escapeRegExp(event.element)}"[^>]*>)`);
  return xml.replace(elementOpen, (_m, g1: string) => `${g1}\n\t\t<Events>\n${block}\n\t\t</Events>`);
}
