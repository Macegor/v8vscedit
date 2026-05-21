import * as fs from 'fs';
import * as path from 'path';
import { getMetaFolder, type MetaKind } from '../../domain/MetaTypes';
import { extractSimpleTag, writeTextFilePreservingBomAndEol } from '../xml/XmlUtils';

export type CfeInterceptorType = 'Before' | 'After' | 'ModificationAndControl';

export interface AddMethodInterceptorOptions {
  readonly extensionPath: string;
  readonly modulePath: string;
  readonly methodName: string;
  readonly interceptorType: CfeInterceptorType;
  readonly context?: string;
  readonly isFunction?: boolean;
}

export interface AddMethodInterceptorResult {
  readonly moduleFilePath: string;
  readonly procedureName: string;
  readonly decorator: string;
  readonly contextAnnotation: string;
  readonly created: boolean;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Генерирует BSL-перехватчики методов для расширений CFE.
 * Это TS-порт cfe-patch-method.py без запуска внешнего скрипта.
 */
export class CfePatchMethodService {
  addMethodInterceptor(options: AddMethodInterceptorOptions): AddMethodInterceptorResult {
    const extensionRoot = resolveExtensionRoot(options.extensionPath);
    const configXmlPath = path.join(extensionRoot, 'Configuration.xml');
    if (!fs.existsSync(configXmlPath)) {
      throw new Error(`Configuration.xml не найден в расширении: ${extensionRoot}`);
    }

    const methodName = options.methodName.trim();
    if (!isValidBslMethodName(methodName)) {
      throw new Error('Имя метода должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.');
    }

    const moduleFilePath = resolveModuleFilePath(extensionRoot, options.modulePath);
    const namePrefix = readNamePrefix(configXmlPath);
    const decorator = interceptorDecorator(options.interceptorType);
    const contextAnnotation = normalizeContextAnnotation(options.context ?? 'НаСервере');
    const procedureName = `${namePrefix}${methodName}`;
    const interceptorText = buildInterceptorText({
      methodName,
      procedureName,
      decorator,
      contextAnnotation,
      interceptorType: options.interceptorType,
      isFunction: options.isFunction === true,
    });

    fs.mkdirSync(path.dirname(moduleFilePath), { recursive: true });
    const created = !fs.existsSync(moduleFilePath);
    if (created) {
      fs.writeFileSync(moduleFilePath, interceptorText, 'utf-8');
    } else {
      const current = fs.readFileSync(moduleFilePath, 'utf-8');
      const separator = current.trim().length === 0
        ? ''
        : current.endsWith('\n')
          ? '\r\n'
          : '\r\n\r\n';
      writeTextFilePreservingBomAndEol(moduleFilePath, current, `${current}${separator}${interceptorText}`);
    }

    return {
      moduleFilePath,
      procedureName,
      decorator,
      contextAnnotation,
      created,
      changedFiles: [moduleFilePath],
      warnings: collectWarnings(extensionRoot, options.modulePath),
    };
  }
}

function resolveExtensionRoot(extensionPath: string): string {
  const absolute = path.resolve(extensionPath);
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile()
    ? path.dirname(absolute)
    : absolute;
}

function readNamePrefix(configXmlPath: string): string {
  const xml = fs.readFileSync(configXmlPath, 'utf-8');
  return extractSimpleTag(xml, 'NamePrefix') ?? 'Расш_';
}

function resolveModuleFilePath(extensionRoot: string, modulePath: string): string {
  const parts = modulePath.split('.').map((item) => item.trim()).filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Неверный ModulePath "${modulePath}". Ожидается Type.Name.Module или CommonModule.Name.`);
  }

  const [rawKind, objectName] = parts;
  const kind = normalizeMetaKind(rawKind);
  const folder = getMetaFolder(kind);
  if (!folder) {
    throw new Error(`Неизвестный тип метаданных: ${rawKind}`);
  }

  if (kind === 'CommonModule') {
    return path.join(extensionRoot, folder, objectName, 'Ext', 'Module.bsl');
  }

  if (parts.length >= 4 && parts[2] === 'Form') {
    return path.join(extensionRoot, folder, objectName, 'Forms', parts[3], 'Ext', 'Form', 'Module.bsl');
  }

  if (parts.length >= 3) {
    return path.join(extensionRoot, folder, objectName, 'Ext', moduleFileName(parts[2]));
  }

  throw new Error(`Неверный ModulePath "${modulePath}". Ожидается Type.Name.Module, Type.Name.Form.FormName или CommonModule.Name.`);
}

function normalizeMetaKind(value: string): MetaKind {
  const aliases: Record<string, MetaKind> = {
    Catalogs: 'Catalog',
    Documents: 'Document',
    Enums: 'Enum',
    CommonModules: 'CommonModule',
    Reports: 'Report',
    DataProcessors: 'DataProcessor',
    ExchangePlans: 'ExchangePlan',
    InformationRegisters: 'InformationRegister',
    AccumulationRegisters: 'AccumulationRegister',
    AccountingRegisters: 'AccountingRegister',
    CalculationRegisters: 'CalculationRegister',
    ChartsOfAccounts: 'ChartOfAccounts',
    ChartsOfCharacteristicTypes: 'ChartOfCharacteristicTypes',
    ChartsOfCalculationTypes: 'ChartOfCalculationTypes',
    BusinessProcesses: 'BusinessProcess',
    Tasks: 'Task',
  };
  return aliases[value] ?? value as MetaKind;
}

function moduleFileName(moduleName: string): string {
  const map: Record<string, string> = {
    ObjectModule: 'ObjectModule.bsl',
    ManagerModule: 'ManagerModule.bsl',
    RecordSetModule: 'RecordSetModule.bsl',
    CommandModule: 'CommandModule.bsl',
    ValueManagerModule: 'ValueManagerModule.bsl',
  };
  return map[moduleName] ?? `${moduleName}.bsl`;
}

function interceptorDecorator(type: CfeInterceptorType): string {
  switch (type) {
    case 'Before':
      return '&Перед';
    case 'After':
      return '&После';
    case 'ModificationAndControl':
      return '&ИзменениеИКонтроль';
    default:
      throw new Error(`Неподдерживаемый тип перехватчика: ${String(type)}`);
  }
}

function normalizeContextAnnotation(context: string): string {
  const trimmed = context.trim();
  return trimmed.startsWith('&') ? trimmed : `&${trimmed}`;
}

function buildInterceptorText(options: {
  readonly methodName: string;
  readonly procedureName: string;
  readonly decorator: string;
  readonly contextAnnotation: string;
  readonly interceptorType: CfeInterceptorType;
  readonly isFunction: boolean;
}): string {
  const keyword = options.isFunction ? 'Функция' : 'Процедура';
  const endKeyword = options.isFunction ? 'КонецФункции' : 'КонецПроцедуры';
  const body = buildBody(options.interceptorType, options.isFunction);
  return [
    options.contextAnnotation,
    `${options.decorator}("${options.methodName}")`,
    `${keyword} ${options.procedureName}()`,
    ...body,
    endKeyword,
    '',
  ].join('\r\n');
}

function buildBody(type: CfeInterceptorType, isFunction: boolean): string[] {
  const lines: string[] = [];
  if (type === 'Before') {
    lines.push('\t// TODO: код перед вызовом оригинального метода');
  } else if (type === 'After') {
    lines.push('\t// TODO: код после вызова оригинального метода');
  } else {
    lines.push('\t// Скопируйте тело оригинального метода и внесите изменения,');
    lines.push('\t// используя маркеры #Удаление / #КонецУдаления и #Вставка / #КонецВставки');
  }
  if (isFunction) {
    lines.push('\t');
    lines.push('\tВозврат Неопределено; // TODO: заменить на реальное возвращаемое значение');
  }
  return lines;
}

function collectWarnings(extensionRoot: string, modulePath: string): string[] {
  const parts = modulePath.split('.');
  if (parts.length < 4 || parts[2] !== 'Form') {
    return [];
  }
  const kind = normalizeMetaKind(parts[0]);
  const folder = getMetaFolder(kind);
  if (!folder) {
    return [];
  }
  const formMetaPath = path.join(extensionRoot, folder, parts[1], 'Forms', `${parts[3]}.xml`);
  const formXmlPath = path.join(extensionRoot, folder, parts[1], 'Forms', parts[3], 'Ext', 'Form.xml');
  return fs.existsSync(formMetaPath) && fs.existsSync(formXmlPath)
    ? []
    : [`Форма "${parts[3]}" не полностью заимствована. Сначала выполните заимствование формы.`];
}

function isValidBslMethodName(value: string): boolean {
  return /^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value);
}
