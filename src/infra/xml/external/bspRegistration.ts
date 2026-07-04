import * as fs from 'fs';
import * as path from 'path';
import { escapeBslString } from './externalObjectShared';

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

export function normalizeBspKind(value: string): BspProcessingKind {
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

export function normalizeBspCommandType(value: string): BspCommandType {
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

export function requiresTargets(kind: BspProcessingKind): boolean {
  return ['ЗаполнениеОбъекта', 'Отчет', 'ПечатнаяФорма', 'СозданиеСвязанныхОбъектов'].includes(kind);
}

export function isTargetedKind(kind: BspProcessingKind): boolean {
  return requiresTargets(kind);
}

export function defaultCommandType(kind: BspProcessingKind): BspCommandType {
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

export function detectBspKind(moduleText: string): BspProcessingKind {
  const match = /ВидОбработки(ДополнительнаяОбработка|ДополнительныйОтчет|ЗаполнениеОбъекта|Отчет|ПечатнаяФорма|СозданиеСвязанныхОбъектов)\s*\(/.exec(moduleText);
  return match ? normalizeBspKind(match[1]) : 'ДополнительнаяОбработка';
}

export function buildBspRegistrationFunction(kind: BspProcessingKind, targets: readonly string[]): string {
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

export function buildBspCommandBlock(options: {
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

export function insertIntoPublicRegion(moduleText: string, snippet: string): string {
  const region = /(#Область\s+ПрограммныйИнтерфейс[\s\S]*?)(#КонецОбласти)/i.exec(moduleText);
  if (region?.index !== undefined) {
    return `${moduleText.slice(0, region.index)}${region[1].trimEnd()}\n\n${snippet.trim()}\n\n${region[2]}${moduleText.slice(region.index + region[0].length)}`;
  }
  return `${moduleText.trimEnd()}\n\n#Область ПрограммныйИнтерфейс\n\n${snippet.trim()}\n\n#КонецОбласти\n`;
}

export function insertBspCommandBlock(moduleText: string, commandBlock: string): string {
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

export function ensureServerCommandHandler(moduleText: string, identifier: string, targeted: boolean): string {
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

export function ensureClientCommandHandler(moduleText: string, identifier: string, targeted: boolean): string {
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

export function ensurePrintHandler(moduleText: string, identifier: string, presentation: string): string {
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

export function findFirstFormModule(objectDir: string): string | null {
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
