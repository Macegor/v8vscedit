import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { writeTextFilePreservingBomAndEol } from './XmlUtils';

export interface AddHelpOptions {
  readonly objectPath: string;
  readonly lang?: string;
  readonly title?: string;
}

export interface CreateExternalObjectOptions {
  readonly name: string;
  readonly synonym?: string;
  readonly outputDir: string;
}

export interface CreateExternalReportOptions extends CreateExternalObjectOptions {
  readonly withSkd?: boolean;
}

export interface ExternalObjectMutationResult {
  readonly rootPath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

export type BspProcessingKind =
  | 'ДополнительнаяОбработка'
  | 'ДополнительныйОтчет'
  | 'ЗаполнениеОбъекта'
  | 'Отчет'
  | 'ПечатнаяФорма'
  | 'СозданиеСвязанныхОбъектов';

export type BspCommandType =
  | 'ОткрытиеФормы'
  | 'ВызовКлиентскогоМетода'
  | 'ВызовСерверногоМетода'
  | 'ЗаполнениеФормы'
  | 'СценарийВБезопасномРежиме';

export interface BspRegistrationOptions {
  readonly objectPath: string;
  readonly kind: BspProcessingKind | string;
  readonly targets?: readonly string[];
}

export interface AddBspCommandOptions {
  readonly objectPath: string;
  readonly identifier: string;
  readonly commandType?: BspCommandType | string;
  readonly presentation?: string;
  readonly formModulePath?: string;
}

export interface ExternalObjectValidationOptions {
  readonly objectPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface ExternalObjectValidationResult {
  readonly objectPath: string;
  readonly type: 'ExternalDataProcessor' | 'ExternalReport' | 'unknown';
  readonly name: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly lines: readonly string[];
}

const XMLNS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const MD_NS = 'http://v8.1c.ru/8.3/MDClasses';
const EPF_CLASS_ID = 'c3831ec8-d8d5-4f93-8a22-f9bfae07327f';
const ERF_CLASS_ID = 'e41aff26-25cf-4bb6-b6c1-3f478a75f374';
const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const IDENT_PATTERN = /^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/;
const CHILD_ORDER: Record<string, number> = { Attribute: 0, TabularSection: 1, Form: 2, Template: 3, Command: 4 };
const ALLOWED_CHILD_TYPES = new Set(Object.keys(CHILD_ORDER));

export class ExternalObjectService {
  addHelp(options: AddHelpOptions): ExternalObjectMutationResult {
    const lang = (options.lang ?? 'ru').trim() || 'ru';
    validateLang(lang);
    const location = resolveExternalObjectLocation(options.objectPath);
    const extDir = path.join(location.objectDir, 'Ext');
    if (!fs.existsSync(extDir)) {
      throw new Error(`Каталог Ext не найден: ${extDir}`);
    }

    const helpXmlPath = path.join(extDir, 'Help.xml');
    if (fs.existsSync(helpXmlPath)) {
      throw new Error(`Справка уже существует: ${helpXmlPath}`);
    }

    const formatVersion = detectFormatVersion(location.xmlPath ?? location.objectDir);
    const helpDir = path.join(extDir, 'Help');
    const htmlPath = path.join(helpDir, `${lang}.html`);
    fs.mkdirSync(helpDir, { recursive: true });
    writeNewTextFile(helpXmlPath, buildHelpDescriptorXml(formatVersion, lang));
    writeNewTextFile(htmlPath, buildHelpHtml(options.title ?? location.name));

    const changedFiles = [helpXmlPath, htmlPath];
    for (const formXmlPath of findFormDescriptorFiles(location.objectDir)) {
      const original = fs.readFileSync(formXmlPath, 'utf-8');
      if (/<IncludeHelpInContents\b/.test(original)) {
        continue;
      }
      const next = insertIncludeHelpInContents(original);
      if (next === original) {
        continue;
      }
      writeTextFilePreservingBomAndEol(formXmlPath, original, next);
      changedFiles.push(formXmlPath);
    }

    return { rootPath: location.objectDir, changedFiles, warnings: [] };
  }

  createExternalDataProcessor(options: CreateExternalObjectOptions): ExternalObjectMutationResult {
    validateName(options.name);
    const outputDir = path.resolve(options.outputDir);
    const rootFile = path.join(outputDir, `${options.name}.xml`);
    const objectDir = path.join(outputDir, options.name);
    ensureNewExternalObject(rootFile, objectDir);

    const changedFiles = writeExternalObjectFiles({
      rootFile,
      objectDir,
      xml: buildExternalObjectXml({
        type: 'ExternalDataProcessor',
        name: options.name,
        synonym: options.synonym ?? options.name,
      }),
    });
    return { rootPath: rootFile, changedFiles, warnings: [] };
  }

  createExternalReport(options: CreateExternalReportOptions): ExternalObjectMutationResult {
    validateName(options.name);
    const outputDir = path.resolve(options.outputDir);
    const rootFile = path.join(outputDir, `${options.name}.xml`);
    const objectDir = path.join(outputDir, options.name);
    ensureNewExternalObject(rootFile, objectDir);

    const changedFiles = writeExternalObjectFiles({
      rootFile,
      objectDir,
      xml: buildExternalObjectXml({
        type: 'ExternalReport',
        name: options.name,
        synonym: options.synonym ?? options.name,
        withSkd: options.withSkd === true,
      }),
    });

    if (options.withSkd === true) {
      changedFiles.push(...writeMainSkdTemplate(objectDir));
    }

    return { rootPath: rootFile, changedFiles, warnings: [] };
  }

  initBspRegistration(options: BspRegistrationOptions): ExternalObjectMutationResult {
    const objectModulePath = resolveObjectModulePath(options.objectPath);
    if (!fs.existsSync(objectModulePath)) {
      throw new Error(`Модуль объекта не найден: ${objectModulePath}`);
    }
    const kind = normalizeBspKind(options.kind);
    const targets = options.targets ?? [];
    if (requiresTargets(kind) && targets.length === 0) {
      throw new Error(`Для вида "${kind}" нужно указать назначение.`);
    }
    const original = fs.readFileSync(objectModulePath, 'utf-8');
    if (/Функция\s+СведенияОВнешнейОбработке\s*\(/i.test(original)) {
      throw new Error('Функция СведенияОВнешнейОбработке уже существует.');
    }

    const snippet = buildBspRegistrationFunction(kind, targets);
    const next = insertIntoPublicRegion(original, snippet);
    writeTextFilePreservingBomAndEol(objectModulePath, original, next);
    return { rootPath: objectModulePath, changedFiles: [objectModulePath], warnings: [] };
  }

  addBspCommand(options: AddBspCommandOptions): ExternalObjectMutationResult {
    validateBspIdentifier(options.identifier);
    const objectModulePath = resolveObjectModulePath(options.objectPath);
    if (!fs.existsSync(objectModulePath)) {
      throw new Error(`Модуль объекта не найден: ${objectModulePath}`);
    }

    const original = fs.readFileSync(objectModulePath, 'utf-8');
    if (!/Функция\s+СведенияОВнешнейОбработке\s*\(/i.test(original)) {
      throw new Error('Сначала добавьте СведенияОВнешнейОбработке.');
    }
    if (original.includes(`"${options.identifier}"`) || original.includes(`Идентификатор        = ${options.identifier}`)) {
      throw new Error(`Команда "${options.identifier}" уже есть в модуле.`);
    }

    const kind = detectBspKind(original);
    const commandType = normalizeBspCommandType(options.commandType ?? defaultCommandType(kind));
    const presentation = options.presentation ?? options.identifier;
    let nextObjectModule = insertBspCommandBlock(original, buildBspCommandBlock({
      identifier: options.identifier,
      presentation,
      commandType,
      printKind: kind === 'ПечатнаяФорма',
    }));
    const changedFiles = new Set<string>([objectModulePath]);

    if (kind === 'ПечатнаяФорма') {
      nextObjectModule = ensurePrintHandler(nextObjectModule, options.identifier, presentation);
    } else if (commandType === 'ВызовСерверногоМетода') {
      nextObjectModule = ensureServerCommandHandler(nextObjectModule, options.identifier, isTargetedKind(kind));
    } else if (commandType === 'ВызовКлиентскогоМетода') {
      const formModulePath = options.formModulePath ?? findFirstFormModule(resolveExternalObjectLocation(options.objectPath).objectDir);
      if (!formModulePath) {
        throw new Error('Для клиентского обработчика нужен модуль формы. Передайте formModulePath или добавьте форму.');
      }
      const formOriginal = fs.existsSync(formModulePath) ? fs.readFileSync(formModulePath, 'utf-8') : '';
      const formNext = ensureClientCommandHandler(formOriginal, options.identifier, isTargetedKind(kind));
      writeTextFilePreservingBomAndEol(formModulePath, formOriginal, formNext);
      changedFiles.add(formModulePath);
    }

    writeTextFilePreservingBomAndEol(objectModulePath, original, nextObjectModule);
    return { rootPath: objectModulePath, changedFiles: [...changedFiles], warnings: [] };
  }

  validate(options: ExternalObjectValidationOptions): ExternalObjectValidationResult {
    const objectPath = resolveExternalObjectXmlPath(options.objectPath);
    const maxErrors = options.maxErrors ?? 30;
    const detailed = options.detailed === true;
    const lines: string[] = [];
    let errors = 0;
    let warnings = 0;
    let ok = 0;
    let type: ExternalObjectValidationResult['type'] = 'unknown';
    let name = '(unknown)';

    const reportOk = (message: string) => {
      ok++;
      if (detailed) {
        lines.push(`[OK]    ${message}`);
      }
    };
    const reportWarn = (message: string) => {
      warnings++;
      lines.push(`[WARN]  ${message}`);
    };
    const reportError = (message: string) => {
      errors++;
      lines.push(`[ERROR] ${message}`);
    };
    const canContinue = () => errors < maxErrors;

    if (!objectPath || !fs.existsSync(objectPath)) {
      return {
        objectPath: options.objectPath,
        type,
        name,
        errors: 1,
        warnings: 0,
        checks: 1,
        lines: [`[ERROR] Файл не найден: ${options.objectPath}`],
      };
    }

    let xml = '';
    try {
      xml = fs.readFileSync(objectPath, 'utf-8');
    } catch (error) {
      return {
        objectPath,
        type,
        name,
        errors: 1,
        warnings: 0,
        checks: 1,
        lines: [`[ERROR] XML не прочитан: ${String(error)}`],
      };
    }

    const rootMatch = /<MetaDataObject\b([^>]*)>\s*<(ExternalDataProcessor|ExternalReport)\b([^>]*)>/m.exec(xml);
    if (!rootMatch) {
      reportError('1. Корень должен иметь вид MetaDataObject/ExternalDataProcessor или MetaDataObject/ExternalReport.');
      return finalizeValidation(objectPath, type, name, errors, warnings, ok, lines);
    }

    type = rootMatch[2] as 'ExternalDataProcessor' | 'ExternalReport';
    const objectOpenAttrs = rootMatch[3] ?? '';
    const version = /version="([^"]+)"/.exec(rootMatch[1] ?? '')?.[1] ?? '';
    const uuid = /uuid="([^"]+)"/.exec(objectOpenAttrs)?.[1] ?? '';
    name = extractTag(xml, 'Name') ?? '(unknown)';
    lines.unshift(`=== Validation: ${type === 'ExternalDataProcessor' ? 'EPF' : 'ERF'}.${name} ===`);

    if (!uuid || !GUID_PATTERN.test(uuid)) {
      reportError(`1. Некорректный uuid у <${type}>.`);
    } else {
      reportOk(`1. Root structure: MetaDataObject/${type}, version ${version || '(empty)'}`);
    }
    if (version && !['2.17', '2.18', '2.20', '2.21'].includes(version)) {
      reportWarn(`1. Необычная версия MetaDataObject: ${version}.`);
    }

    const internalInfo = extractBlock(xml, 'InternalInfo');
    if (canContinue()) {
      validateInternalInfo(type, name, internalInfo, reportError, reportWarn, reportOk);
    }

    const properties = extractBlock(xml, 'Properties');
    const defaultForm = extractTag(properties ?? '', 'DefaultForm') ?? '';
    const auxiliaryForm = extractTag(properties ?? '', 'AuxiliaryForm') ?? '';
    const mainDcs = type === 'ExternalReport' ? extractTag(properties ?? '', 'MainDataCompositionSchema') ?? '' : '';
    if (canContinue()) {
      if (!properties) {
        reportError('3. Блок Properties отсутствует.');
      } else if (!name || name === '(unknown)' || !IDENT_PATTERN.test(name)) {
        reportError(`3. Properties: некорректное имя "${name}".`);
      } else {
        const extras = [defaultForm ? 'DefaultForm set' : '', mainDcs ? 'MainDCS set' : ''].filter(Boolean).join(', ');
        reportOk(`3. Properties: Name="${name}"${extras ? `, ${extras}` : ''}`);
      }
    }

    const childObjects = extractBlock(xml, 'ChildObjects') ?? '';
    const children = parseChildObjects(childObjects);
    if (canContinue()) {
      validateChildObjects(children, reportError, reportWarn, reportOk);
    }
    if (canContinue()) {
      validateCrossRefs(type, name, children, { defaultForm, auxiliaryForm, mainDcs }, reportError, reportWarn, reportOk);
    }
    if (canContinue()) {
      validateAttributes(children, reportError, reportOk);
    }
    if (canContinue()) {
      validateNameUniqueness(children, reportError, reportOk);
    }
    if (canContinue()) {
      validateExternalObjectFiles(objectPath, name, children, reportError, reportOk);
    }

    return finalizeValidation(objectPath, type, name, errors, warnings, ok, lines);
  }
}

function writeExternalObjectFiles(options: { rootFile: string; objectDir: string; xml: string }): string[] {
  fs.mkdirSync(path.join(options.objectDir, 'Ext'), { recursive: true });
  writeNewTextFile(options.rootFile, options.xml);
  const modulePath = path.join(options.objectDir, 'Ext', 'ObjectModule.bsl');
  writeNewTextFile(modulePath, buildEmptyObjectModule());
  return [options.rootFile, modulePath];
}

function ensureNewExternalObject(rootFile: string, objectDir: string): void {
  if (fs.existsSync(rootFile)) {
    throw new Error(`Файл уже существует: ${rootFile}`);
  }
  if (fs.existsSync(objectDir)) {
    throw new Error(`Каталог уже существует: ${objectDir}`);
  }
}

function writeMainSkdTemplate(objectDir: string): string[] {
  const name = 'ОсновнаяСхемаКомпоновкиДанных';
  const templateXmlPath = path.join(objectDir, 'Templates', `${name}.xml`);
  const templateContentPath = path.join(objectDir, 'Templates', name, 'Ext', 'Template.xml');
  fs.mkdirSync(path.dirname(templateContentPath), { recursive: true });
  writeNewTextFile(templateXmlPath, buildTemplateDescriptorXml(name));
  writeNewTextFile(templateContentPath, buildEmptySkdXml());
  return [templateXmlPath, templateContentPath];
}

function resolveObjectModulePath(objectPath: string): string {
  const location = resolveExternalObjectLocation(objectPath);
  return path.join(location.objectDir, 'Ext', 'ObjectModule.bsl');
}

function normalizeBspKind(value: string): BspProcessingKind {
  const lower = value.trim().toLowerCase();
  if (['дополнительнаяобработка', 'доп обработка', 'обработка', 'глобальная'].includes(lower)) {
    return 'ДополнительнаяОбработка';
  }
  if (['дополнительныйотчет', 'дополнительныйотчёт', 'доп отчёт', 'доп отчет', 'глобальный отчёт', 'глобальный отчет'].includes(lower)) {
    return 'ДополнительныйОтчет';
  }
  if (['заполнениеобъекта', 'заполнение', 'заполнить'].includes(lower)) {
    return 'ЗаполнениеОбъекта';
  }
  if (['отчет', 'отчёт'].includes(lower)) {
    return 'Отчет';
  }
  if (['печатнаяформа', 'печатная форма', 'печать'].includes(lower)) {
    return 'ПечатнаяФорма';
  }
  if (['созданиесвязанныхобъектов', 'создание связанных объектов'].includes(lower)) {
    return 'СозданиеСвязанныхОбъектов';
  }
  const allowed: readonly BspProcessingKind[] = ['ДополнительнаяОбработка', 'ДополнительныйОтчет', 'ЗаполнениеОбъекта', 'Отчет', 'ПечатнаяФорма', 'СозданиеСвязанныхОбъектов'];
  if (allowed.includes(value as BspProcessingKind)) {
    return value as BspProcessingKind;
  }
  throw new Error(`Неизвестный вид обработки БСП: ${value}`);
}

function normalizeBspCommandType(value: string): BspCommandType {
  const lower = value.trim().toLowerCase();
  if (['открытиеформы', 'открыть форму', 'форма'].includes(lower)) {
    return 'ОткрытиеФормы';
  }
  if (['вызовклиентскогометода', 'клиентский метод', 'на клиенте'].includes(lower)) {
    return 'ВызовКлиентскогоМетода';
  }
  if (['вызовсерверногометода', 'серверный метод', 'на сервере', 'серверный'].includes(lower)) {
    return 'ВызовСерверногоМетода';
  }
  if (['заполнениеформы', 'заполнение формы', 'заполнить форму'].includes(lower)) {
    return 'ЗаполнениеФормы';
  }
  if (['сценарийвбезопасномрежиме', 'сценарий', 'безопасный режим'].includes(lower)) {
    return 'СценарийВБезопасномРежиме';
  }
  const allowed: readonly BspCommandType[] = ['ОткрытиеФормы', 'ВызовКлиентскогоМетода', 'ВызовСерверногоМетода', 'ЗаполнениеФормы', 'СценарийВБезопасномРежиме'];
  if (allowed.includes(value as BspCommandType)) {
    return value as BspCommandType;
  }
  throw new Error(`Неизвестный тип команды БСП: ${value}`);
}

function requiresTargets(kind: BspProcessingKind): boolean {
  return ['ЗаполнениеОбъекта', 'Отчет', 'ПечатнаяФорма', 'СозданиеСвязанныхОбъектов'].includes(kind);
}

function isTargetedKind(kind: BspProcessingKind): boolean {
  return requiresTargets(kind);
}

function defaultCommandType(kind: BspProcessingKind): BspCommandType {
  return ['ЗаполнениеОбъекта', 'ПечатнаяФорма', 'СозданиеСвязанныхОбъектов'].includes(kind)
    ? 'ВызовСерверногоМетода'
    : 'ОткрытиеФормы';
}

function bspKindMethod(kind: BspProcessingKind): string {
  return `ВидОбработки${kind}()`;
}

function bspCommandMethod(commandType: BspCommandType): string {
  return `ТипКоманды${commandType}()`;
}

function detectBspKind(moduleText: string): BspProcessingKind {
  const match = /ВидОбработки(ДополнительнаяОбработка|ДополнительныйОтчет|ЗаполнениеОбъекта|Отчет|ПечатнаяФорма|СозданиеСвязанныхОбъектов)\s*\(/.exec(moduleText);
  return match ? normalizeBspKind(match[1]) : 'ДополнительнаяОбработка';
}

function buildBspRegistrationFunction(kind: BspProcessingKind, targets: readonly string[]): string {
  const commandType = defaultCommandType(kind);
  const targetLines = targets.map((target) => `\tПараметрыРегистрации.Назначение.Добавить("${escapeBslString(target)}");`);
  const modifierLines = kind === 'ПечатнаяФорма' ? ['\tНоваяКоманда.Модификатор = "ПечатьMXL";'] : [];
  const handler = commandType === 'ВызовСерверногоМетода'
    ? (kind === 'ПечатнаяФорма' ? buildPrintProcedureStub() : buildServerProcedureStub(isTargetedKind(kind)))
    : '';

  return [
    'Функция СведенияОВнешнейОбработке() Экспорт',
    '',
    '\tМетаданныеОбработки = Метаданные();',
    '',
    '\tПараметрыРегистрации = ДополнительныеОтчетыИОбработки.СведенияОВнешнейОбработке("2.2.2.1");',
    `\tПараметрыРегистрации.Вид    = ДополнительныеОтчетыИОбработкиКлиентСервер.${bspKindMethod(kind)};`,
    '\tПараметрыРегистрации.Версия = "1.0";',
    '',
    ...targetLines,
    ...(targetLines.length > 0 ? [''] : []),
    '\tНоваяКоманда = ПараметрыРегистрации.Команды.Добавить();',
    '\tНоваяКоманда.Представление        = МетаданныеОбработки.Представление();',
    '\tНоваяКоманда.Идентификатор        = МетаданныеОбработки.Имя;',
    `\tНоваяКоманда.Использование        = ДополнительныеОтчетыИОбработкиКлиентСервер.${bspCommandMethod(commandType)};`,
    '\tНоваяКоманда.ПоказыватьОповещение = Ложь;',
    ...modifierLines,
    ...(modifierLines.length > 0 ? [''] : []),
    '\tВозврат ПараметрыРегистрации;',
    '',
    'КонецФункции',
    '',
    handler,
  ].filter((line, index, lines) => !(line === '' && lines[index - 1] === '')).join('\n');
}

function buildBspCommandBlock(options: {
  readonly identifier: string;
  readonly presentation: string;
  readonly commandType: BspCommandType;
  readonly printKind: boolean;
}): string {
  return [
    '\tНоваяКоманда = ПараметрыРегистрации.Команды.Добавить();',
    `\tНоваяКоманда.Представление        = НСтр("ru = '${escapeBslString(options.presentation)}'");`,
    `\tНоваяКоманда.Идентификатор        = "${escapeBslString(options.identifier)}";`,
    `\tНоваяКоманда.Использование        = ДополнительныеОтчетыИОбработкиКлиентСервер.${bspCommandMethod(options.commandType)};`,
    '\tНоваяКоманда.ПоказыватьОповещение = Ложь;',
    ...(options.printKind ? ['\tНоваяКоманда.Модификатор = "ПечатьMXL";'] : []),
    '',
  ].join('\n');
}

function insertIntoPublicRegion(moduleText: string, snippet: string): string {
  const region = /(#Область\s+ПрограммныйИнтерфейс[\s\S]*?)(#КонецОбласти)/i.exec(moduleText);
  if (region?.index !== undefined) {
    return `${moduleText.slice(0, region.index)}${region[1].trimEnd()}\n\n${snippet.trim()}\n\n${region[2]}${moduleText.slice(region.index + region[0].length)}`;
  }
  return `${moduleText.trimEnd()}\n\n#Область ПрограммныйИнтерфейс\n\n${snippet.trim()}\n\n#КонецОбласти\n`;
}

function insertBspCommandBlock(moduleText: string, commandBlock: string): string {
  const fn = /Функция\s+СведенияОВнешнейОбработке\s*\([\s\S]*?КонецФункции/i.exec(moduleText);
  if (!fn) {
    throw new Error('Функция СведенияОВнешнейОбработке не найдена.');
  }
  const returnMatch = /\n\s*Возврат\s+ПараметрыРегистрации\s*;/i.exec(fn[0]);
  if (!returnMatch) {
    throw new Error('В функции СведенияОВнешнейОбработке не найден возврат ПараметрыРегистрации.');
  }
  const insertAt = fn.index + returnMatch.index;
  return `${moduleText.slice(0, insertAt)}\n${commandBlock}${moduleText.slice(insertAt)}`;
}

function ensureServerCommandHandler(moduleText: string, identifier: string, targeted: boolean): string {
  const proc = /Процедура\s+ВыполнитьКоманду\s*\([\s\S]*?КонецПроцедуры/i.exec(moduleText);
  const branch = buildCommandBranch(identifier);
  if (proc) {
    const endIf = /\n\s*КонецЕсли\s*;/i.exec(proc[0]);
    if (endIf) {
      const insertAt = proc.index + endIf.index;
      return `${moduleText.slice(0, insertAt)}\n${branch.replace('Если ', 'ИначеЕсли ')}${moduleText.slice(insertAt)}`;
    }
    const insertAt = proc.index + proc[0].lastIndexOf('КонецПроцедуры');
    return `${moduleText.slice(0, insertAt)}${branch}\n${moduleText.slice(insertAt)}`;
  }
  return insertIntoPublicRegion(moduleText, buildServerProcedureWithBranch(identifier, targeted));
}

function ensureClientCommandHandler(moduleText: string, identifier: string, targeted: boolean): string {
  const proc = /Процедура\s+ВыполнитьКоманду\s*\([\s\S]*?КонецПроцедуры/i.exec(moduleText);
  const branch = buildCommandBranch(identifier);
  if (proc) {
    const endIf = /\n\s*КонецЕсли\s*;/i.exec(proc[0]);
    if (endIf) {
      const insertAt = proc.index + endIf.index;
      return `${moduleText.slice(0, insertAt)}\n${branch.replace('Если ', 'ИначеЕсли ')}${moduleText.slice(insertAt)}`;
    }
  }
  const args = targeted ? 'ИдентификаторКоманды, ОбъектыНазначенияМассив' : 'ИдентификаторКоманды';
  const snippet = [
    '&НаКлиенте',
    `Процедура ВыполнитьКоманду(${args}) Экспорт`,
    '',
    buildCommandBranch(identifier),
    '\tКонецЕсли;',
    '',
    'КонецПроцедуры',
  ].join('\n');
  return `${moduleText.trimEnd()}\n\n${snippet}\n`;
}

function ensurePrintHandler(moduleText: string, identifier: string, presentation: string): string {
  const proc = /Процедура\s+Печать\s*\([\s\S]*?КонецПроцедуры/i.exec(moduleText);
  const block = buildPrintBranch(identifier, presentation);
  if (proc) {
    const insertAt = proc.index + proc[0].lastIndexOf('КонецПроцедуры');
    return `${moduleText.slice(0, insertAt)}${block}\n${moduleText.slice(insertAt)}`;
  }
  return insertIntoPublicRegion(moduleText, [
    'Процедура Печать(МассивОбъектов, КоллекцияПечатныхФорм, ОбъектыПечати, ПараметрыВывода) Экспорт',
    '',
    block,
    'КонецПроцедуры',
  ].join('\n'));
}

function buildServerProcedureStub(targeted: boolean): string {
  const args = targeted
    ? 'ИдентификаторКоманды, ОбъектыНазначения, ПараметрыВыполненияКоманды'
    : 'ИдентификаторКоманды, ПараметрыВыполненияКоманды';
  return [
    `Процедура ВыполнитьКоманду(${args}) Экспорт`,
    '',
    '\t// TODO: Реализация',
    '',
    'КонецПроцедуры',
  ].join('\n');
}

function buildPrintProcedureStub(): string {
  return [
    'Процедура Печать(МассивОбъектов, КоллекцияПечатныхФорм, ОбъектыПечати, ПараметрыВывода) Экспорт',
    '',
    '\t// TODO: Реализация',
    '',
    'КонецПроцедуры',
  ].join('\n');
}

function buildServerProcedureWithBranch(identifier: string, targeted: boolean): string {
  const args = targeted
    ? 'ИдентификаторКоманды, ОбъектыНазначения, ПараметрыВыполненияКоманды'
    : 'ИдентификаторКоманды, ПараметрыВыполненияКоманды';
  return [
    `Процедура ВыполнитьКоманду(${args}) Экспорт`,
    '',
    buildCommandBranch(identifier),
    '\tКонецЕсли;',
    '',
    'КонецПроцедуры',
  ].join('\n');
}

function buildCommandBranch(identifier: string): string {
  return [
    `\tЕсли ИдентификаторКоманды = "${escapeBslString(identifier)}" Тогда`,
    `\t\t// TODO: Реализация ${identifier}`,
  ].join('\n');
}

function buildPrintBranch(identifier: string, presentation: string): string {
  return [
    `\tПечатнаяФорма = УправлениеПечатью.СведенияОПечатнойФорме(КоллекцияПечатныхФорм, "${escapeBslString(identifier)}");`,
    '\tЕсли ПечатнаяФорма <> Неопределено Тогда',
    `\t\tПечатнаяФорма.ТабличныйДокумент = Сформировать${identifier}(МассивОбъектов, ОбъектыПечати);`,
    `\t\tПечатнаяФорма.СинонимМакета = НСтр("ru = '${escapeBslString(presentation)}'");`,
    '\tКонецЕсли;',
    '',
  ].join('\n');
}

function findFirstFormModule(objectDir: string): string | null {
  const formsDir = path.join(objectDir, 'Forms');
  if (!fs.existsSync(formsDir)) {
    return null;
  }
  for (const formName of fs.readdirSync(formsDir)) {
    const modulePath = path.join(formsDir, formName, 'Ext', 'Form', 'Module.bsl');
    if (fs.existsSync(modulePath)) {
      return modulePath;
    }
  }
  return null;
}

function buildExternalObjectXml(options: {
  readonly type: 'ExternalDataProcessor' | 'ExternalReport';
  readonly name: string;
  readonly synonym: string;
  readonly withSkd?: boolean;
}): string {
  const classId = options.type === 'ExternalDataProcessor' ? EPF_CLASS_ID : ERF_CLASS_ID;
  const objectPrefix = options.type === 'ExternalDataProcessor' ? 'ExternalDataProcessorObject' : 'ExternalReportObject';
  const mainDcs = options.type === 'ExternalReport' && options.withSkd === true
    ? `ExternalReport.${options.name}.Template.ОсновнаяСхемаКомпоновкиДанных`
    : '';
  const reportProps = options.type === 'ExternalReport'
    ? [
        `\t\t\t${mainDcs ? `<MainDataCompositionSchema>${escapeXml(mainDcs)}</MainDataCompositionSchema>` : '<MainDataCompositionSchema/>'}`,
        '\t\t\t<DefaultSettingsForm/>',
        '\t\t\t<AuxiliarySettingsForm/>',
        '\t\t\t<DefaultVariantForm/>',
        '\t\t\t<VariantsStorage/>',
        '\t\t\t<SettingsStorage/>',
      ]
    : [];
  const childObjects = options.withSkd === true
    ? [
        '\t\t<ChildObjects>',
        '\t\t\t<Template>ОсновнаяСхемаКомпоновкиДанных</Template>',
        '\t\t</ChildObjects>',
      ].join('\n')
    : '\t\t<ChildObjects/>';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${XMLNS} version="2.17">`,
    `\t<${options.type} uuid="${newUuid()}">`,
    '\t\t<InternalInfo>',
    '\t\t\t<xr:ContainedObject>',
    `\t\t\t\t<xr:ClassId>${classId}</xr:ClassId>`,
    `\t\t\t\t<xr:ObjectId>${newUuid()}</xr:ObjectId>`,
    '\t\t\t</xr:ContainedObject>',
    `\t\t\t<xr:GeneratedType name="${objectPrefix}.${escapeXml(options.name)}" category="Object">`,
    `\t\t\t\t<xr:TypeId>${newUuid()}</xr:TypeId>`,
    `\t\t\t\t<xr:ValueId>${newUuid()}</xr:ValueId>`,
    '\t\t\t</xr:GeneratedType>',
    '\t\t</InternalInfo>',
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(options.name)}</Name>`,
    '\t\t\t<Synonym>',
    '\t\t\t\t<v8:item>',
    '\t\t\t\t\t<v8:lang>ru</v8:lang>',
    `\t\t\t\t\t<v8:content>${escapeXml(options.synonym)}</v8:content>`,
    '\t\t\t\t</v8:item>',
    '\t\t\t</Synonym>',
    '\t\t\t<Comment/>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    ...reportProps,
    '\t\t</Properties>',
    childObjects,
    `\t</${options.type}>`,
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildTemplateDescriptorXml(name: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${XMLNS} version="2.17">`,
    `\t<Template uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    '\t\t\t<Synonym>',
    '\t\t\t\t<v8:item>',
    '\t\t\t\t\t<v8:lang>ru</v8:lang>',
    '\t\t\t\t\t<v8:content>Основная схема компоновки данных</v8:content>',
    '\t\t\t\t</v8:item>',
    '\t\t\t</Synonym>',
    '\t\t\t<Comment/>',
    '\t\t\t<TemplateType>DataCompositionSchema</TemplateType>',
    '\t\t</Properties>',
    '\t</Template>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildEmptySkdXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"',
    '\t\txmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common"',
    '\t\txmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core"',
    '\t\txmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"',
    '\t\txmlns:v8="http://v8.1c.ru/8.1/data/core"',
    '\t\txmlns:v8ui="http://v8.1c.ru/8.1/data/ui"',
    '\t\txmlns:xs="http://www.w3.org/2001/XMLSchema"',
    '\t\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<dataSource>',
    '\t\t<name>ИсточникДанных1</name>',
    '\t\t<dataSourceType>Local</dataSourceType>',
    '\t</dataSource>',
    '</DataCompositionSchema>',
    '',
  ].join('\n');
}

function buildHelpDescriptorXml(formatVersion: string, lang: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Help xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${escapeXml(formatVersion)}">`,
    `\t<Page>${escapeXml(lang)}</Page>`,
    '</Help>',
    '',
  ].join('\n');
}

function buildHelpHtml(title: string): string {
  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">',
    '<html>',
    '<head>',
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
    '    <link rel="stylesheet" type="text/css" href="v8help://service_book/service_style"/>',
    '</head>',
    '<body>',
    `    <h1>${escapeHtml(title)}</h1>`,
    '    <p>Описание.</p>',
    '</body>',
    '</html>',
  ].join('\n');
}

function buildEmptyObjectModule(): string {
  return [
    '#Область ОписаниеПеременных',
    '',
    '#КонецОбласти',
    '',
    '#Область ПрограммныйИнтерфейс',
    '',
    '#КонецОбласти',
    '',
    '#Область СлужебныеПроцедурыИФункции',
    '',
    '#КонецОбласти',
    '',
  ].join('\n');
}

function resolveExternalObjectLocation(inputPath: string): { objectDir: string; xmlPath?: string; name: string } {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return { objectDir: resolved, xmlPath: resolveExternalObjectXmlPath(resolved) ?? undefined, name: path.basename(resolved) };
  }
  const xmlPath = resolveExternalObjectXmlPath(resolved);
  if (!xmlPath) {
    return { objectDir: resolved, name: path.basename(resolved) };
  }
  return { objectDir: path.join(path.dirname(xmlPath), path.basename(xmlPath, '.xml')), xmlPath, name: path.basename(xmlPath, '.xml') };
}

function resolveExternalObjectXmlPath(inputPath: string): string | null {
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
    const xmlFile = fs.readdirSync(resolved).find((file) => file.toLowerCase().endsWith('.xml'));
    return xmlFile ? path.join(resolved, xmlFile) : null;
  }
  if (fs.existsSync(resolved)) {
    return resolved;
  }
  const parent = path.dirname(resolved);
  const base = path.basename(resolved, '.xml');
  const sibling = path.join(path.dirname(parent), `${base}.xml`);
  return fs.existsSync(sibling) ? sibling : null;
}

function findFormDescriptorFiles(objectDir: string): string[] {
  const formsDir = path.join(objectDir, 'Forms');
  if (!fs.existsSync(formsDir)) {
    return [];
  }
  return fs.readdirSync(formsDir)
    .filter((file) => file.toLowerCase().endsWith('.xml'))
    .map((file) => path.join(formsDir, file))
    .filter((filePath) => fs.statSync(filePath).isFile());
}

function insertIncludeHelpInContents(xml: string): string {
  return xml.replace(/(<FormType>[\s\S]*?<\/FormType>)(?![\s\S]*?<IncludeHelpInContents\b)/, '$1\n\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>');
}

function detectFormatVersion(startPath: string): string {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
  while (current && current !== path.dirname(current)) {
    const configXml = path.join(current, 'Configuration.xml');
    if (fs.existsSync(configXml)) {
      const head = fs.readFileSync(configXml, 'utf-8').slice(0, 2000);
      return /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(head)?.[1] ?? '2.17';
    }
    current = path.dirname(current);
  }
  return '2.17';
}

function validateInternalInfo(
  type: 'ExternalDataProcessor' | 'ExternalReport',
  name: string,
  inner: string | null,
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  if (!inner) {
    reportError('2. InternalInfo block missing.');
    return;
  }
  const expectedClassId = type === 'ExternalDataProcessor' ? EPF_CLASS_ID : ERF_CLASS_ID;
  const classId = extractTag(inner, 'xr:ClassId') ?? extractTag(inner, 'ClassId') ?? '';
  const objectId = extractTag(inner, 'xr:ObjectId') ?? extractTag(inner, 'ObjectId') ?? '';
  const generatedTypeMatches = [...inner.matchAll(/<xr:GeneratedType\b([^>]*)>/g)];
  if (classId !== expectedClassId) {
    reportError(`2. ClassId is "${classId}", expected "${expectedClassId}".`);
    return;
  }
  if (objectId && !GUID_PATTERN.test(objectId)) {
    reportError('2. Invalid ObjectId UUID.');
    return;
  }
  if (generatedTypeMatches.length === 0) {
    reportError('2. No GeneratedType entries found.');
    return;
  }
  const expectedPrefix = `${type}Object.`;
  for (const match of generatedTypeMatches) {
    const generatedName = /name="([^"]+)"/.exec(match[1] ?? '')?.[1] ?? '';
    if (name !== '(unknown)' && generatedName && !generatedName.startsWith(expectedPrefix)) {
      reportWarn(`2. GeneratedType name "${generatedName}" does not start with "${expectedPrefix}".`);
    }
  }
  reportOk(`2. InternalInfo: ClassId correct, ${generatedTypeMatches.length} GeneratedType`);
}

function validateChildObjects(
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  let lastOrder = -1;
  let orderWarned = false;
  const counts = new Map<string, number>();
  for (const child of children) {
    if (!ALLOWED_CHILD_TYPES.has(child.tag)) {
      reportError(`4. ChildObjects: disallowed element "${child.tag}".`);
      continue;
    }
    counts.set(child.tag, (counts.get(child.tag) ?? 0) + 1);
    const currentOrder = CHILD_ORDER[child.tag] ?? -1;
    if (currentOrder < lastOrder && !orderWarned) {
      reportWarn('4. ChildObjects: нарушен порядок Attribute, TabularSection, Form, Template, Command.');
      orderWarned = true;
    }
    lastOrder = currentOrder;
  }
  const summary = [...counts.entries()]
    .sort((a, b) => (CHILD_ORDER[a[0]] ?? 99) - (CHILD_ORDER[b[0]] ?? 99))
    .map(([tag, count]) => `${tag}(${count})`)
    .join(', ');
  reportOk(summary ? `4. ChildObjects: ${summary}` : '4. ChildObjects: empty');
}

function validateCrossRefs(
  type: 'ExternalDataProcessor' | 'ExternalReport',
  name: string,
  children: readonly ExternalChild[],
  refs: { readonly defaultForm: string; readonly auxiliaryForm: string; readonly mainDcs: string },
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const forms = new Set(children.filter((child) => child.tag === 'Form').map((child) => child.name));
  const templates = new Set(children.filter((child) => child.tag === 'Template').map((child) => child.name));
  let checked = 0;
  for (const [label, value] of [['DefaultForm', refs.defaultForm], ['AuxiliaryForm', refs.auxiliaryForm]] as const) {
    if (!value) {
      continue;
    }
    checked++;
    const prefix = `${type}.${name}.Form.`;
    if (!value.startsWith(prefix)) {
      reportWarn(`5. ${label} value "${value}" has unexpected prefix.`);
      continue;
    }
    const formName = value.slice(prefix.length);
    if (!forms.has(formName)) {
      reportError(`5. ${label} references "${formName}", but no such Form in ChildObjects.`);
    }
  }
  if (refs.mainDcs) {
    checked++;
    const prefix = `ExternalReport.${name}.Template.`;
    if (!refs.mainDcs.startsWith(prefix)) {
      reportWarn(`5. MainDataCompositionSchema value "${refs.mainDcs}" has unexpected prefix.`);
    } else {
      const templateName = refs.mainDcs.slice(prefix.length);
      if (!templates.has(templateName)) {
        reportError(`5. MainDataCompositionSchema references "${templateName}", but no such Template in ChildObjects.`);
      }
    }
  }
  if (checked > 0) {
    reportOk('5. Cross-references valid.');
  }
}

function validateAttributes(
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const attributes = children.filter((child) => child.tag === 'Attribute');
  for (const attr of attributes) {
    if (!attr.uuid || !GUID_PATTERN.test(attr.uuid)) {
      reportError(`6. Attribute "${attr.name}" has invalid uuid.`);
      return;
    }
    if (!attr.name || !IDENT_PATTERN.test(attr.name)) {
      reportError(`6. Attribute "${attr.name}" has invalid identifier.`);
      return;
    }
    if (!/<Type\b[\s\S]*?(<v8:Type>|<v8:TypeSet>)/.test(attr.xml)) {
      reportError(`6. Attribute "${attr.name}" Type block has no v8:Type or v8:TypeSet.`);
      return;
    }
  }
  if (attributes.length > 0) {
    reportOk(`6. Attributes: ${attributes.length} checked.`);
  }
}

function validateNameUniqueness(
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const seen = new Map<string, string>();
  for (const child of children) {
    if (!child.name) {
      continue;
    }
    const previous = seen.get(child.name);
    if (previous) {
      reportError(`8. Duplicate name "${child.name}" (${child.tag} conflicts with ${previous}).`);
      return;
    }
    seen.set(child.name, child.tag);
  }
  reportOk(`8. Name uniqueness: ${seen.size} names, all unique.`);
}

function validateExternalObjectFiles(
  objectXmlPath: string,
  name: string,
  children: readonly ExternalChild[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const objectDir = path.join(path.dirname(objectXmlPath), name);
  let checked = 0;
  for (const child of children) {
    if (child.tag === 'Form') {
      const descriptor = path.join(objectDir, 'Forms', `${child.name}.xml`);
      const formXml = path.join(objectDir, 'Forms', child.name, 'Ext', 'Form.xml');
      if (!fs.existsSync(descriptor)) {
        reportError(`9. Missing form descriptor: Forms/${child.name}.xml`);
        return;
      }
      if (!fs.existsSync(formXml)) {
        reportError(`9. Missing form layout: Forms/${child.name}/Ext/Form.xml`);
        return;
      }
      checked += 2;
    }
    if (child.tag === 'Template') {
      const descriptor = path.join(objectDir, 'Templates', `${child.name}.xml`);
      const extDir = path.join(objectDir, 'Templates', child.name, 'Ext');
      if (!fs.existsSync(descriptor)) {
        reportError(`9. Missing template descriptor: Templates/${child.name}.xml`);
        return;
      }
      if (!fs.existsSync(extDir) || !fs.readdirSync(extDir).some((file) => file.startsWith('Template.'))) {
        reportError(`9. Missing template content: Templates/${child.name}/Ext/Template.*`);
        return;
      }
      checked += 2;
    }
  }
  const objectModule = path.join(objectDir, 'Ext', 'ObjectModule.bsl');
  if (fs.existsSync(objectModule)) {
    checked++;
  }
  if (checked > 0) {
    reportOk(`9. File existence: ${checked} files verified.`);
  }
}

interface ExternalChild {
  readonly tag: string;
  readonly name: string;
  readonly uuid: string;
  readonly xml: string;
}

function parseChildObjects(inner: string): ExternalChild[] {
  const children: ExternalChild[] = [];
  const tagRegex = /<([A-Za-z][A-Za-z0-9]*)\b([^>]*)>([\s\S]*?)<\/\1>|<([A-Za-z][A-Za-z0-9]*)\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(inner)) !== null) {
    const tag = match[1] ?? match[4] ?? '';
    const attrs = match[2] ?? match[5] ?? '';
    const body = match[3] ?? '';
    if (!tag) {
      continue;
    }
    children.push({
      tag,
      name: extractTag(body, 'Name') ?? body.trim(),
      uuid: /uuid="([^"]+)"/.exec(attrs)?.[1] ?? '',
      xml: match[0],
    });
  }
  return children;
}

function finalizeValidation(
  objectPath: string,
  type: ExternalObjectValidationResult['type'],
  name: string,
  errors: number,
  warnings: number,
  ok: number,
  lines: string[]
): ExternalObjectValidationResult {
  const checks = errors + warnings + ok;
  if (errors === 0 && warnings === 0 && lines.length === 1) {
    lines.push(`=== Validation OK: ${type}.${name} (${checks} checks) ===`);
  } else {
    lines.push('');
    lines.push(`=== Result: ${errors} errors, ${warnings} warnings (${checks} checks) ===`);
  }
  return { objectPath, type, name, errors, warnings, checks, lines };
}

function extractBlock(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1] ?? null;
}

function extractTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  const value = re.exec(xml)?.[1]?.trim();
  return value || undefined;
}

function validateName(value: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new Error('Имя должно начинаться с буквы или подчёркивания и содержать только буквы, цифры и подчёркивание.');
  }
}

function validateLang(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Код языка справки должен содержать только латиницу, цифры, дефис и подчёркивание.');
  }
}

function validateBspIdentifier(value: string): void {
  if (!/^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/.test(value)) {
    throw new Error('Идентификатор команды БСП должен быть идентификатором 1С.');
  }
}

function writeNewTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\ufeff${content}`, 'utf-8');
}

function newUuid(): string {
  return crypto.randomUUID();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}

function escapeBslString(value: string): string {
  return value.replace(/"/g, '""').replace(/'/g, "''");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
