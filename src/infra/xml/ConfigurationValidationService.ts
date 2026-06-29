import * as fs from 'fs';
import * as path from 'path';
import { getMetaFolder, META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { ConfigXmlReader } from './ConfigXmlReader';
import { extractSimpleTag } from './XmlUtils';

export interface ConfigurationValidationOptions {
  readonly configPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface ValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface ConfigurationValidationResult {
  readonly configXmlPath: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly ValidationIssue[];
  readonly lines: readonly string[];
}

const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const IDENT_PATTERN = /^[\p{L}_][\p{L}\p{Nd}_]*$/u;

const VALID_ENUM_VALUES: Record<string, readonly string[]> = {
  ConfigurationExtensionPurpose: ['Patch', 'Customization', 'AddOn'],
  DefaultRunMode: ['ManagedApplication', 'OrdinaryApplication', 'Auto'],
  ScriptVariant: ['Russian', 'English'],
  DataLockControlMode: ['Automatic', 'Managed', 'AutomaticAndManaged'],
  ObjectAutonumerationMode: ['NotAutoFree', 'AutoFree'],
  ModalityUseMode: ['DontUse', 'Use', 'UseWithWarnings'],
  SynchronousPlatformExtensionAndAddInCallUseMode: ['DontUse', 'Use', 'UseWithWarnings'],
  InterfaceCompatibilityMode: [
    'Version8_2', 'Version8_2EnableTaxi', 'Taxi', 'TaxiEnableVersion8_2',
    'TaxiEnableVersion8_5', 'Version8_5EnableTaxi', 'Version8_5',
  ],
  DatabaseTablespacesUseMode: ['DontUse', 'Use'],
  MainClientApplicationWindowMode: ['Normal', 'Fullscreen', 'Kiosk'],
};

/**
 * Проверяет базовую структуру Configuration.xml и файловую связанность ChildObjects.
 * Закрывает runtime-сценарии cf-validate/cfe-validate без внешнего Python.
 */
export class ConfigurationValidationService {
  private readonly reader = new ConfigXmlReader();

  validate(options: ConfigurationValidationOptions): ConfigurationValidationResult {
    const configXmlPath = resolveConfigXmlPath(options.configPath);
    const issues: ValidationIssue[] = [];
    const maxErrors = options.maxErrors ?? 30;
    const ok = (message: string) => {
      if (options.detailed) {
        issues.push({ severity: 'ok', message });
      }
    };
    const warn = (message: string) => issues.push({ severity: 'warning', message });
    const error = (message: string) => {
      if (issues.filter((item) => item.severity === 'error').length < maxErrors) {
        issues.push({ severity: 'error', message });
      }
    };

    const xml = safeRead(configXmlPath, error);
    if (!xml) {
      return buildResult(configXmlPath, issues);
    }

    if (!/<MetaDataObject\b/.test(xml)) {
      error('Корневой элемент MetaDataObject не найден.');
      return buildResult(configXmlPath, issues);
    }
    ok('Корневой элемент MetaDataObject найден.');

    let info;
    try {
      info = this.reader.read(configXmlPath);
      ok('Configuration.xml прочитан.');
    } catch (readError) {
      error(readError instanceof Error ? readError.message : String(readError));
      return buildResult(configXmlPath, issues);
    }

    const uuid = /<Configuration\b[^>]*uuid=(["'])([^"']+)\1/.exec(xml)?.[2] ?? '';
    if (!uuid || !GUID_PATTERN.test(uuid)) {
      error('UUID конфигурации отсутствует или имеет неверный формат.');
    } else {
      ok('UUID конфигурации корректен.');
    }

    if (!IDENT_PATTERN.test(info.name)) {
      error(`Недопустимое имя конфигурации: ${info.name}`);
    } else {
      ok('Имя конфигурации корректно.');
    }

    validateEnumProperties(xml, ok, warn);
    validateDefaultLanguage(configXmlPath, xml, ok, warn, error);
    validateChildObjects(configXmlPath, info.childObjects, ok, warn, error);
    return buildResult(configXmlPath, issues);
  }
}

function validateEnumProperties(
  xml: string,
  ok: (message: string) => void,
  warn: (message: string) => void
): void {
  for (const [key, allowed] of Object.entries(VALID_ENUM_VALUES)) {
    const value = extractSimpleTag(xml, key);
    if (!value) {
      continue;
    }
    if (allowed.includes(value)) {
      ok(`${key}: ${value}`);
    } else {
      warn(`${key}: неизвестное значение "${value}".`);
    }
  }
  for (const key of ['CompatibilityMode', 'ConfigurationExtensionCompatibilityMode']) {
    const value = extractSimpleTag(xml, key);
    if (value && !/^Version8_\d+(_\d+)*$|^Version8_5_1$|^DontUse$/.test(value)) {
      warn(`${key}: неизвестный режим совместимости "${value}".`);
    }
  }
}

function validateDefaultLanguage(
  configXmlPath: string,
  xml: string,
  ok: (message: string) => void,
  warn: (message: string) => void,
  error: (message: string) => void
): void {
  const defaultLanguage = extractSimpleTag(xml, 'DefaultLanguage') ?? '';
  if (!defaultLanguage) {
    warn('DefaultLanguage не задан.');
    return;
  }
  const languageName = defaultLanguage.replace(/^Language\./, '');
  const languageXmlPath = path.join(path.dirname(configXmlPath), 'Languages', `${languageName}.xml`);
  if (fs.existsSync(languageXmlPath)) {
    ok(`Файл языка найден: ${path.relative(path.dirname(configXmlPath), languageXmlPath)}`);
  } else {
    error(`Файл языка DefaultLanguage не найден: ${languageXmlPath}`);
  }
}

function validateChildObjects(
  configXmlPath: string,
  childObjects: Map<string, string[]>,
  ok: (message: string) => void,
  warn: (message: string) => void,
  error: (message: string) => void
): void {
  const configRoot = path.dirname(configXmlPath);
  for (const [kind, names] of childObjects.entries()) {
    if (!Object.prototype.hasOwnProperty.call(META_TYPES, kind)) {
      warn(`Неизвестный тип ChildObjects: ${kind}`);
      continue;
    }
    const folder = getMetaFolder(kind as MetaKind);
    if (!folder) {
      continue;
    }
    for (const name of names) {
      const flatXmlPath = path.join(configRoot, folder, `${name}.xml`);
      const deepXmlPath = path.join(configRoot, folder, name, `${name}.xml`);
      if (fs.existsSync(flatXmlPath) || fs.existsSync(deepXmlPath)) {
        ok(`${kind}.${name}: XML найден.`);
      } else {
        error(`${kind}.${name}: XML-файл не найден в ${folder}.`);
      }
    }
  }
}

function safeRead(filePath: string, error: (message: string) => void): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (readError) {
    error(readError instanceof Error ? readError.message : String(readError));
    return null;
  }
}

function buildResult(configXmlPath: string, issues: ValidationIssue[]): ConfigurationValidationResult {
  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.filter((item) => item.severity === 'warning').length;
  const lines = issues.map((issue) => `[${issue.severity.toUpperCase()}] ${issue.message}`);
  lines.push('', `=== Result: ${String(errors)} errors, ${String(warnings)} warnings (${String(issues.length)} checks) ===`);
  return {
    configXmlPath,
    errors,
    warnings,
    checks: issues.length,
    issues,
    lines,
  };
}

function resolveConfigXmlPath(configPath: string): string {
  const resolved = path.resolve(configPath);
  const candidate = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'Configuration.xml')
    : resolved;
  if (!fs.existsSync(candidate)) {
    throw new Error(`Configuration.xml не найден: ${configPath}`);
  }
  return candidate;
}
