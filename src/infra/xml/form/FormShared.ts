import * as fs from 'fs';
import * as path from 'path';
import type { FormPurpose } from './types';
import { resolveFormXmlByDescriptor } from '../../fs/MetaPathResolver';
import { escapeXmlAttribute, escapeRegExp, buildLocalizedTag, extractMetaDataObjectVersion } from '../XmlUtils';
import { maxIdByKind } from './FormIdSpaces';

export const MD_XMLNS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
export const FORM_XMLNS = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
export const FORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
export const GUID_PATTERN = /^[0-9a-fA-F-]{36}$/;
export const IDENT_PATTERN = /^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/;
export const VALID_CALL_TYPES = new Set(['Before', 'After', 'Override']);

export interface IdAllocator {
  nextElement(): number;
  nextAttribute(): number;
  nextCommand(): number;
}

/**
 * Счётчики новых id опираются на {@link maxIdByKind}: максимум берётся
 * структурно (любой тег с `id`, кроме Attribute/Column/Command) и по ВСЕМУ
 * документу, включая `<BaseForm>`. Собственного списка тегов у аллокатора нет —
 * иначе новый вид поля 1С снова оказался бы невидимым и генератор выдал бы
 * коллизию id.
 */
export function createIdAllocator(xml: string): IdAllocator {
  const max = maxIdByKind(xml);
  let elementId = max.element;
  let attrId = max.attribute;
  let commandId = max.command;
  const extension = /<BaseForm\b/.test(xml);
  if (extension) {
    elementId = Math.max(elementId, 999999);
    attrId = Math.max(attrId, 999999);
    commandId = Math.max(commandId, 999999);
  }
  return {
    nextElement: () => ++elementId,
    nextAttribute: () => ++attrId,
    nextCommand: () => ++commandId,
  };
}

export function resolveObjectLocation(inputPath: string): { xmlPath: string; objectDir: string; kind: string; name: string } {
  const xmlPath = resolveObjectXmlPath(inputPath);
  if (!xmlPath) {
    throw new Error(`XML объекта не найден: ${inputPath}`);
  }
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const rootMatch = /<MetaDataObject\b[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(xml);
  const kind = rootMatch?.[1];
  const name = extractTag(extractBlock(xml, 'Properties') ?? xml, 'Name') ?? path.basename(xmlPath, '.xml');
  if (!kind) {
    throw new Error(`Не удалось определить тип объекта: ${xmlPath}`);
  }
  return {
    xmlPath,
    objectDir: path.join(path.dirname(xmlPath), path.basename(xmlPath, '.xml')),
    kind,
    name,
  };
}

export function resolveObjectXmlPath(inputPath: string): string | null {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const dirName = path.basename(resolved);
    const inside = path.join(resolved, `${dirName}.xml`);
    const sibling = path.join(path.dirname(resolved), `${dirName}.xml`);
    if (fs.existsSync(inside)) {
      return inside;
    }
    if (fs.existsSync(sibling)) {
      return sibling;
    }
    return null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

/**
 * Нормализует вход инструмента формы в путь СУЩЕСТВУЮЩЕГО тела формы.
 *
 * Отказ вместо «вернуть вход как есть» принципиален: прежняя ветка молча отдавала
 * любой существующий файл, и по пути XML объекта метаданных правка формы ложилась
 * поверх самого объекта.
 */
export function resolveFormXmlPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved)) {
    if (fs.statSync(resolved).isDirectory()) {
      // Каталог формы: тело достраивается без проверки существования — вызывающий
      // получает штатный путь и падает уже на чтении, если выгрузка неполна.
      return path.join(resolved, 'Ext', 'Form.xml');
    }
    if (path.basename(resolved) === 'Form.xml') {
      return resolved;
    }
    // Дескриптор формы: тело лежит рядом. Для любого другого файла (XML объекта,
    // .bsl, …) такого соседа не окажется, и мы честно отказываем ниже.
    const body = resolveFormXmlByDescriptor(resolved);
    if (fs.existsSync(body)) {
      return body;
    }
  } else if (path.basename(resolved) === 'Form.xml') {
    const candidate = path.join(path.dirname(resolved), 'Ext', 'Form.xml');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Form.xml не найден: ${inputPath}`);
}

/**
 * Нормализует вход в путь тела формы для записи/создания (файла может ещё не быть).
 *
 * Порядок веток важен: тело формы тоже оканчивается на `.xml`, и проверь мы сначала
 * расширение — `Form.xml` был бы принят за дескриптор и превращён в `Form/Ext/Form.xml`.
 */
export function resolveFormXmlPathForWrite(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (path.basename(resolved) === 'Form.xml') {
    return resolved;
  }
  if (resolved.endsWith('.xml')) {
    return resolveFormXmlByDescriptor(resolved);
  }
  return path.join(resolved, 'Ext', 'Form.xml');
}

/**
 * Первый элемент документа: снимает BOM, пролог `<?xml …?>`, пробелы и XML-комментарии.
 * `null` — корня нет (пустой/оборванный документ), решение по корню принять нельзя.
 */
function sliceToRootElement(xml: string): string | null {
  let rest = xml.startsWith('﻿') ? xml.slice(1) : xml;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (rest.startsWith('<?')) {
      const end = rest.indexOf('?>');
      if (end < 0) {
        return null;
      }
      rest = rest.slice(end + 2);
      continue;
    }
    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      if (end < 0) {
        return null;
      }
      rest = rest.slice(end + 3);
      continue;
    }
    return rest;
  }
}

/** Локальное имя первого тега: префикс пространства (`lf:Form`) допустим. */
function rootLocalNamePattern(localName: string): RegExp {
  return new RegExp(`^<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?${localName}(?=[\\s/>])`);
}

const FORM_ROOT = rootLocalNamePattern('Form');
const META_DATA_OBJECT_ROOT = rootLocalNamePattern('MetaDataObject');

/**
 * Документ является телом управляемой формы: ПЕРВЫЙ элемент — `Form`.
 *
 * Критерий снят с эталона `example/`: 6329 файлов `Form.xml` обеих генераций (cf и cfe) —
 * у 100% корень `Form`, у 100% пространство `http://v8.1c.ru/8.3/xcf/logform`, у 100% BOM,
 * контрпримеров нет. Пространство имён намеренно НЕ требуется: сужать guard сверх
 * необходимого не на чем, а ложный отказ на форме дороже пропуска экзотического корня.
 *
 * Проверять подстрокой `<Form` нельзя: в XML справочника есть `<Form>ФормаСписка</Form>`
 * внутри `<ChildObjects>`, и XML объекта проходил как форма.
 */
export function isFormRootXml(xml: string): boolean {
  const root = sliceToRootElement(xml);
  return root !== null && FORM_ROOT.test(root);
}

/**
 * Документ является XML объекта метаданных: первый элемент — `MetaDataObject`.
 * Нужен, чтобы отличить самую частую ошибку адресации (передали объект вместо формы)
 * от произвольного чужого корня и дать по ней конкретную подсказку.
 */
export function isMetaDataObjectRootXml(xml: string): boolean {
  const root = sliceToRootElement(xml);
  return root !== null && META_DATA_OBJECT_ROOT.test(root);
}

/** Бросает, если по пути лежит не тело формы. Для XML объекта метаданных — отдельный текст. */
export function assertFormRootXml(xml: string, filePath: string): void {
  if (isFormRootXml(xml)) {
    return;
  }
  if (isMetaDataObjectRootXml(xml)) {
    throw new Error(
      `По пути ${filePath} лежит XML объекта метаданных, а не Form.xml. ` +
      'Тело формы хранится в <Объект>/Forms/<Имя>/Ext/Form.xml (общая форма — CommonForms/<Имя>/Ext/Form.xml).'
    );
  }
  throw new Error(`Файл ${filePath} не является управляемой формой: первый элемент документа не <Form>.`);
}

/** Единственная точка чтения тела формы: содержимое как есть + guard корневого элемента. */
export function readFormXml(formPath: string): string {
  const xml = fs.readFileSync(formPath, 'utf-8');
  assertFormRootXml(xml, formPath);
  return xml;
}

/**
 * Принимает большой набор синонимов назначения формы (английских + русских).
 *
 * Каноничные значения: Object, List, Choice, Record.
 * Также принимает: Item/ItemForm/Object/ObjectForm/Element/Folder/FolderForm/Group/GroupForm
 *                  → Object; List/ListForm → List; Choice/ChoiceForm → Choice;
 *                  Record/RecordForm → Record.
 * Русские: ФормаЭлемента/ФормаОбъекта/ФормаДокумента/ФормаГруппы/ФормаСчёта → Object;
 *          ФормаСписка → List; ФормаВыбора → Choice; ФормаЗаписи → Record.
 */
export function normalizePurpose(value: string): FormPurpose {
  const raw = value.trim();
  const lower = raw.toLowerCase();
  const synonyms: Record<string, FormPurpose> = {
    // English canonical + variants
    object: 'Object', objectform: 'Object', item: 'Object', itemform: 'Object',
    element: 'Object', elementform: 'Object', folder: 'Object', folderform: 'Object',
    group: 'Object', groupform: 'Object', document: 'Object', documentform: 'Object',
    account: 'Object', accountform: 'Object', node: 'Object', nodeform: 'Object',
    list: 'List', listform: 'List',
    choice: 'Choice', choiceform: 'Choice', selection: 'Choice', selectionform: 'Choice',
    record: 'Record', recordform: 'Record',
    // Russian (с буквой ё и без)
    формаэлемента: 'Object', формаобъекта: 'Object', формадокумента: 'Object',
    формагруппы: 'Object', формасчета: 'Object', формасчёта: 'Object',
    формаузла: 'Object', формазадачи: 'Object',
    формасписка: 'List', формавыбора: 'Choice', формазаписи: 'Record',
  };
  const collapsed = lower.replace(/\s+/g, '');
  if (collapsed in synonyms) {
    return synonyms[collapsed];
  }
  throw new Error(
    `Недопустимое назначение формы: "${value}". Используйте Object|List|Choice|Record ` +
    `или их синонимы (Item, ItemForm, Element, ObjectForm, Folder, ListForm, ChoiceForm, RecordForm, ` +
    `ФормаЭлемента, ФормаСписка, ФормаВыбора, ФормаЗаписи).`
  );
}

export function validatePurpose(objectKind: string, purpose: FormPurpose): void {
  const processorLike = ['DataProcessor', 'Report', 'ExternalDataProcessor', 'ExternalReport'];
  if (purpose === 'Choice' && (processorLike.includes(objectKind) || objectKind === 'InformationRegister')) {
    throw new Error(`Purpose=Choice недопустим для ${objectKind}`);
  }
  if (purpose === 'Record' && objectKind !== 'InformationRegister') {
    throw new Error('Purpose=Record допустим только для InformationRegister');
  }
}

export function isProcessorLike(kind: string): boolean {
  return ['DataProcessor', 'Report', 'ExternalDataProcessor', 'ExternalReport'].includes(kind);
}

export function isExternalKind(kind: string): boolean {
  return kind === 'ExternalDataProcessor' || kind === 'ExternalReport';
}

export function detectFormatVersion(startPath: string): string {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
  while (current && current !== path.dirname(current)) {
    const configXml = path.join(current, 'Configuration.xml');
    if (fs.existsSync(configXml)) {
      const head = fs.readFileSync(configXml, 'utf-8').slice(0, 2000);
      return extractMetaDataObjectVersion(head) ?? '2.17';
    }
    current = path.dirname(current);
  }
  return '2.17';
}

export function isEmptyTagValue(xml: string, tag: string): boolean {
  const value = extractTag(xml, tag);
  return value === undefined || value === '';
}

export function setTagValue(xml: string, tag: string, value: string, createIfMissing = false): string {
  const escaped = escapeXml(value);
  const nextTag = value ? `<${tag}>${escaped}</${tag}>` : `<${tag}/>`;
  const selfClosing = new RegExp(`<${tag}\\s*\\/>`);
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, () => nextTag);
  }
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`);
  if (re.test(xml)) {
    return xml.replace(re, () => nextTag);
  }
  if (createIfMissing) {
    return xml.replace(/<\/Properties>/, () => `\t\t\t<${tag}>${escaped}</${tag}>\n\t\t</Properties>`);
  }
  return xml;
}

export function extractBlock(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1] ?? null;
}

export function extractTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1]?.trim();
}

export function extractLocalizedContent(xml: string): string | undefined {
  return /<v8:content>([\s\S]*?)<\/v8:content>/.exec(xml)?.[1]?.trim();
}

export function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${escapeRegExp(name)}="([^"]*)"`).exec(attrs)?.[1];
}

export function validateName(value: string, label: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new Error(`${label} должно быть идентификатором 1С.`);
  }
}

export function writeNewTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\uFEFF${content}`, 'utf-8');
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

// Реэкспорт канонического хелпера: формы экранируют и текст, и значения
// атрибутов одной функцией, поэтому семантика совпадает с escapeXmlAttribute.
export const escapeXml = escapeXmlAttribute;

// Реэкспорт канонического хелпера из XmlUtils: внешние импортёры формы
// (FormEditService/FormValidateService/FormInfoService/FormAddService) продолжают
// брать escapeRegExp отсюда, но единственная реализация живёт в XmlUtils.
export { escapeRegExp };

// Реэкспорт канонического хелпера из XmlUtils: формы всегда генерируют полный
// локализованный блок (без самозакрывающегося варианта для пустого текста), что
// совпадает с дефолтом buildLocalizedTag (emptyAsSelfClosing не задан).
export { buildLocalizedTag };

export function appendBoolean(lines: string[], indent: string, tag: string, value: boolean | undefined): void {
  if (value !== undefined) {
    lines.push(`${indent}<${tag}>${String(value)}</${tag}>`);
  }
}

export function appendScalar(lines: string[], indent: string, tag: string, value: unknown): void {
  if (value !== undefined) {
    lines.push(`${indent}<${tag}>${escapeXml(stringifyScalar(value))}</${tag}>`);
  }
}

function stringifyScalar(value: unknown): string {
  if (value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // Объект/массив — сериализуем явно, чтобы не получить "[object Object]".
  return JSON.stringify(value);
}
