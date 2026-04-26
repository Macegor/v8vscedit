import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MetaKind } from '../../domain/MetaTypes';
import { parseConfigXml, parseObjectXml } from '../xml';

export interface RepositoryBinding {
  repoPath: string;
  repoUser: string;
  repoPassword: string;
}

export interface RepositoryTarget {
  configRoot: string;
  configKind: 'cf' | 'cfe';
  extensionName?: string;
  displayName: string;
}

export interface RepositoryNodeRef {
  nodeKind?: string;
  label?: string;
  xmlPath?: string;
  metaContext?: {
    rootMetaKind: string;
    tabularSectionName?: string;
    ownerObjectXmlPath?: string;
  };
}

interface RepositoryScopeState {
  connected?: boolean;
  lockedFullNames: string[];
}

interface RepositoryStateFile {
  version: 2;
  scopes: Record<string, RepositoryScopeState>;
}

const REPOSITORY_STATE_VERSION = 2;
const REPOSITORY_NAMESPACE = 'http://v8.1c.ru/8.3/config/objects';

const ROOT_KIND_NAMES: Partial<Record<MetaKind, string>> = {
  Subsystem: 'Подсистема',
  CommonModule: 'ОбщийМодуль',
  SessionParameter: 'ПараметрСеанса',
  CommonAttribute: 'ОбщийРеквизит',
  Role: 'Роль',
  CommonForm: 'ОбщаяФорма',
  CommonCommand: 'ОбщаяКоманда',
  CommandGroup: 'ГруппаКоманд',
  CommonPicture: 'ОбщаяКартинка',
  CommonTemplate: 'ОбщийМакет',
  XDTOPackage: 'XDTOPackage',
  StyleItem: 'ЭлементСтиля',
  DefinedType: 'ОпределяемыйТип',
  FunctionalOption: 'ФункциональнаяОпция',
  FunctionalOptionsParameter: 'ПараметрФункциональнойОпции',
  SettingsStorage: 'ХранилищеНастроек',
  Style: 'Стиль',
  WSReference: 'WSСсылка',
  WebSocketClient: 'WebSocketКлиент',
  IntegrationService: 'СервисИнтеграции',
  Bot: 'Бот',
  Interface: 'Интерфейс',
  PaletteColor: 'ЦветПалитры',
  Language: 'Язык',
  HTTPService: 'HTTPСервис',
  WebService: 'WebСервис',
  Constant: 'Константа',
  Catalog: 'Справочник',
  Document: 'Документ',
  DocumentNumerator: 'НумераторДокументов',
  Enum: 'Перечисление',
  InformationRegister: 'РегистрСведений',
  AccumulationRegister: 'РегистрНакопления',
  AccountingRegister: 'РегистрБухгалтерии',
  CalculationRegister: 'РегистрРасчета',
  Report: 'Отчет',
  DataProcessor: 'Обработка',
  BusinessProcess: 'БизнесПроцесс',
  Task: 'Задача',
  ExchangePlan: 'ПланОбмена',
  ChartOfCharacteristicTypes: 'ПланВидовХарактеристик',
  ChartOfAccounts: 'ПланСчетов',
  ChartOfCalculationTypes: 'ПланВидовРасчета',
  DocumentJournal: 'ЖурналДокументов',
  ScheduledJob: 'РегламентноеЗадание',
  EventSubscription: 'ПодпискаНаСобытие',
  FilterCriterion: 'КритерийОтбора',
  Sequence: 'Последовательность',
  ExternalDataSource: 'ВнешнийИсточникДанных',
};

const CHILD_KIND_NAMES: Partial<Record<MetaKind, string>> = {
  Attribute: 'Реквизит',
  AddressingAttribute: 'РеквизитАдресации',
  TabularSection: 'ТабличнаяЧасть',
  Column: 'Реквизит',
  Form: 'Форма',
  Command: 'Команда',
  Template: 'Макет',
  Dimension: 'Измерение',
  Resource: 'Ресурс',
  EnumValue: 'ЗначениеПеречисления',
};

/**
 * Инфраструктурный сервис хранилища: хранит настройки в `env.json`,
 * локальный кэш захваченных объектов и генерирует `Objects.xml`.
 */
export class RepositoryService {
  constructor(private readonly workspaceRoot: string) {}

  getEnvJsonPath(): string {
    return path.join(this.workspaceRoot, 'env.json');
  }

  resolveTargetByXmlPath(xmlPath: string): RepositoryTarget | null {
    const configRoot = this.findConfigRoot(xmlPath);
    if (!configRoot) {
      return null;
    }

    const info = parseConfigXml(path.join(configRoot, 'Configuration.xml'));
    return {
      configRoot,
      configKind: info.kind,
      extensionName: info.kind === 'cfe' ? info.name : undefined,
      displayName: info.name || path.basename(configRoot),
    };
  }

  loadBinding(target: RepositoryTarget): RepositoryBinding | null {
    const env = this.readEnvFile();
    const defaults = this.getDefaultSection(env);
    if (target.configKind === 'cfe') {
      const extensionSection = this.getExtensionSection(defaults);
      const extensionName = target.extensionName ?? '';
      const item = extensionSection[extensionName];
      const repoPath = this.readString(item?.['repo-path']);
      if (!repoPath) {
        return null;
      }

      return {
        repoPath,
        repoUser: this.readString(item?.['repo-user']) ?? '',
        repoPassword: this.readString(item?.['repo-pwd']) ?? '',
      };
    }

    const repoPath = this.readString(defaults['--repo-path']);
    if (!repoPath) {
      return null;
    }

    return {
      repoPath,
      repoUser: this.readString(defaults['--repo-user']) ?? '',
      repoPassword: this.readString(defaults['--repo-pwd']) ?? '',
    };
  }

  saveBinding(target: RepositoryTarget, binding: RepositoryBinding): void {
    const env = this.readEnvFile();
    const defaults = this.getDefaultSection(env);
    if (target.configKind === 'cfe') {
      const extensionName = target.extensionName ?? '';
      const extensionSection = this.getExtensionSection(defaults);
      extensionSection[extensionName] = {
        'repo-path': binding.repoPath,
        'repo-user': binding.repoUser,
        'repo-pwd': binding.repoPassword,
      };
      defaults.extension = extensionSection;
    } else {
      defaults['--repo-path'] = binding.repoPath;
      defaults['--repo-user'] = binding.repoUser;
      defaults['--repo-pwd'] = binding.repoPassword;
    }

    env.default = defaults;
    this.writeEnvFile(env);
    this.saveScopeState(target, {
      connected: true,
      lockedFullNames: [],
    });
  }

  clearBinding(target: RepositoryTarget): void {
    const env = this.readEnvFile();
    const defaults = this.getDefaultSection(env);
    if (target.configKind === 'cfe') {
      const extensionName = target.extensionName ?? '';
      const extensionSection = this.getExtensionSection(defaults);
      delete extensionSection[extensionName];
      defaults.extension = extensionSection;
    } else {
      delete defaults['--repo-path'];
      delete defaults['--repo-user'];
      delete defaults['--repo-pwd'];
    }
    env.default = defaults;
    this.writeEnvFile(env);
    this.clearScopeState(target);
  }

  hasBinding(target: RepositoryTarget): boolean {
    return this.loadBinding(target) !== null;
  }

  isConnected(target: RepositoryTarget): boolean {
    if (!this.hasBinding(target)) {
      return false;
    }

    const state = this.loadStateFile();
    const scope = state.scopes[this.buildScopeKey(target)];
    return scope?.connected ?? true;
  }

  setConnected(target: RepositoryTarget, connected: boolean): void {
    const state = this.loadStateFile();
    const scopeKey = this.buildScopeKey(target);
    const scope = state.scopes[scopeKey] ?? { lockedFullNames: [] };
    state.scopes[scopeKey] = {
      ...scope,
      connected,
    };
    this.saveStateFile(state);
  }

  isLocked(target: RepositoryTarget, fullName: string): boolean {
    const state = this.loadStateFile();
    const scope = state.scopes[this.buildScopeKey(target)];
    return scope?.lockedFullNames.includes(fullName) ?? false;
  }

  setLocked(target: RepositoryTarget, fullNames: string[], locked: boolean): void {
    if (fullNames.length === 0) {
      return;
    }

    const state = this.loadStateFile();
    const scopeKey = this.buildScopeKey(target);
    const scope = state.scopes[scopeKey] ?? { lockedFullNames: [] };
    const items = new Set(scope.lockedFullNames);
    for (const fullName of fullNames) {
      if (locked) {
        items.add(fullName);
      } else {
        items.delete(fullName);
      }
    }
    state.scopes[scopeKey] = {
      lockedFullNames: [...items].sort((left, right) => left.localeCompare(right, 'ru')),
    };
    this.saveStateFile(state);
  }

  /**
   * Возвращает `true`, если редактирование файла должно быть запрещено из-за
   * активного подключения к хранилищу без локального захвата объекта.
   */
  isEditRestricted(filePath: string): boolean {
    const ownerObjectXmlPath = this.resolveOwnerObjectXmlPath(filePath);
    if (!ownerObjectXmlPath) {
      return false;
    }

    const target = this.resolveTargetByXmlPath(ownerObjectXmlPath);
    if (!target || !this.hasBinding(target) || !this.isConnected(target)) {
      return false;
    }

    const fullName = this.resolveRootObjectFullName(ownerObjectXmlPath);
    if (!fullName) {
      return false;
    }

    return !this.isLocked(target, fullName);
  }

  clearLocks(target: RepositoryTarget): void {
    const state = this.loadStateFile();
    const scopeKey = this.buildScopeKey(target);
    const scope = state.scopes[scopeKey];
    if (!scope) {
      return;
    }
    scope.lockedFullNames = [];
    state.scopes[scopeKey] = scope;
    this.saveStateFile(state);
  }

  resolveFullName(node: RepositoryNodeRef): string | null {
    const kind = node.nodeKind as MetaKind | undefined;
    if (!kind) {
      return null;
    }

    if (kind === 'configuration' || kind === 'extension' || kind === 'extensions-root' ||
      kind === 'group-common' || kind === 'group-type' || kind === 'NumeratorsBranch' || kind === 'SequencesBranch') {
      return null;
    }

    const childKindName = CHILD_KIND_NAMES[kind];
    if (!childKindName) {
      return this.buildRootObjectFullName(kind, node.xmlPath, node.label);
    }

    const ownerXmlPath = node.metaContext?.ownerObjectXmlPath;
    if (!ownerXmlPath) {
      return null;
    }

    const ownerObject = parseObjectXml(ownerXmlPath);
    if (!ownerObject) {
      return null;
    }

    const ownerKind = ownerObject.tag as MetaKind;
    const ownerName = ownerObject.name || path.basename(ownerXmlPath, '.xml');
    const ownerKindName = ROOT_KIND_NAMES[ownerKind];
    if (!ownerKindName) {
      return null;
    }

    const ownerFullName = `${ownerKindName}.${ownerName}`;
    return ownerFullName;
  }

  createObjectsFileForNode(node: RepositoryNodeRef, recursive: boolean): { filePath: string; fullNames: string[] } {
    const target = node.xmlPath ? this.resolveTargetByXmlPath(node.xmlPath) : null;
    if (!target) {
      throw new Error('Не удалось определить корень конфигурации для выбранного узла.');
    }

    const kind = node.nodeKind as MetaKind | undefined;
    if (!kind) {
      throw new Error('У выбранного узла не определён тип.');
    }

    if (kind === 'configuration' || kind === 'extension') {
      const xml = [
        `<Objects xmlns="${REPOSITORY_NAMESPACE}" version="1.0">`,
        `  <Configuration includeChildObjects="${recursive ? 'true' : 'false'}"/>`,
        `</Objects>`,
      ].join('\n');
      return {
        filePath: this.writeObjectsFile(target, xml),
        fullNames: [],
      };
    }

    const fullName = this.resolveFullName(node);
    if (!fullName) {
      throw new Error('Для выбранного узла не удалось сформировать полное имя объекта.');
    }

    const lines = [
      `<Objects xmlns="${REPOSITORY_NAMESPACE}" version="1.0">`,
      `  <Object fullName="${escapeXml(fullName)}" includeChildObjects="${recursive ? 'true' : 'false'}">`,
    ];
    if (kind === 'Subsystem') {
      lines.push(
        `    <Subsystem includeObjectsFromSubordinateSubsystems="${recursive ? 'true' : 'false'}"/>`
      );
    }
    lines.push('  </Object>', '</Objects>');

    return {
      filePath: this.writeObjectsFile(target, lines.join('\n')),
      fullNames: [fullName],
    };
  }

  private buildRootObjectFullName(kind: MetaKind, xmlPath: string | undefined, fallbackLabel: string | undefined): string | null {
    const rootKindName = ROOT_KIND_NAMES[kind];
    if (!rootKindName) {
      return null;
    }

    const objectInfo = xmlPath ? parseObjectXml(xmlPath) : null;
    const objectName = objectInfo?.name || fallbackLabel;
    if (!objectName) {
      return null;
    }

    return `${rootKindName}.${objectName}`;
  }

  private resolveRootObjectFullName(xmlPath: string): string | null {
    const objectInfo = parseObjectXml(xmlPath);
    if (!objectInfo) {
      return null;
    }

    return this.buildRootObjectFullName(objectInfo.tag as MetaKind, xmlPath, objectInfo.name);
  }

  private resolveOwnerObjectXmlPath(filePath: string): string | null {
    const configRoot = this.findConfigRoot(filePath);
    if (!configRoot) {
      return null;
    }

    const relativeParts = path.relative(configRoot, filePath).split(path.sep).filter(Boolean);
    if (relativeParts.length < 2) {
      return null;
    }

    const folderName = relativeParts[0];
    const objectSegment = relativeParts[1];
    if (!folderName || !objectSegment) {
      return null;
    }

    if (objectSegment.toLowerCase().endsWith('.xml')) {
      const flatXmlPath = path.join(configRoot, folderName, objectSegment);
      return fs.existsSync(flatXmlPath) ? flatXmlPath : null;
    }

    const deepXmlPath = path.join(configRoot, folderName, objectSegment, `${objectSegment}.xml`);
    if (fs.existsSync(deepXmlPath)) {
      return deepXmlPath;
    }

    const flatXmlPath = path.join(configRoot, folderName, `${objectSegment}.xml`);
    return fs.existsSync(flatXmlPath) ? flatXmlPath : null;
  }

  private readEnvFile(): Record<string, unknown> {
    const envPath = this.getEnvJsonPath();
    if (!fs.existsSync(envPath)) {
      return { default: {} };
    }

    const raw = fs.readFileSync(envPath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  private writeEnvFile(env: Record<string, unknown>): void {
    const envPath = this.getEnvJsonPath();
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, `${JSON.stringify(env, null, 2)}\n`, 'utf-8');
  }

  private getDefaultSection(env: Record<string, unknown>): Record<string, unknown> {
    const defaults = env.default;
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
      return {};
    }
    return { ...(defaults as Record<string, unknown>) };
  }

  private getExtensionSection(defaults: Record<string, unknown>): Record<string, Record<string, string>> {
    const raw = defaults.extension;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const result: Record<string, Record<string, string>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const item = value as Record<string, unknown>;
      result[key] = {
        'repo-path': this.readString(item['repo-path']) ?? '',
        'repo-user': this.readString(item['repo-user']) ?? '',
        'repo-pwd': this.readString(item['repo-pwd']) ?? '',
      };
    }
    return result;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private findConfigRoot(startPath: string): string | null {
    let current: string;
    try {
      current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    } catch {
      return null;
    }
    const workspaceRoot = path.resolve(this.workspaceRoot).toLowerCase();
    while (current.toLowerCase().startsWith(workspaceRoot)) {
      if (fs.existsSync(path.join(current, 'Configuration.xml'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
  }

  private loadStateFile(): RepositoryStateFile {
    const filePath = this.getStateFilePath();
    if (!fs.existsSync(filePath)) {
      return {
        version: REPOSITORY_STATE_VERSION,
        scopes: {},
      };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<RepositoryStateFile>;
      if (parsed.version !== REPOSITORY_STATE_VERSION || !parsed.scopes) {
        return {
          version: REPOSITORY_STATE_VERSION,
          scopes: {},
        };
      }
      return {
        version: REPOSITORY_STATE_VERSION,
        scopes: parsed.scopes,
      };
    } catch {
      return {
        version: REPOSITORY_STATE_VERSION,
        scopes: {},
      };
    }
  }

  private saveStateFile(state: RepositoryStateFile): void {
    const filePath = this.getStateFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  }

  private ensureScopeState(target: RepositoryTarget): void {
    const state = this.loadStateFile();
    const scopeKey = this.buildScopeKey(target);
    if (!state.scopes[scopeKey]) {
      state.scopes[scopeKey] = { connected: true, lockedFullNames: [] };
      this.saveStateFile(state);
    }
  }

  private saveScopeState(target: RepositoryTarget, scope: RepositoryScopeState): void {
    const state = this.loadStateFile();
    state.scopes[this.buildScopeKey(target)] = scope;
    this.saveStateFile(state);
  }

  private clearScopeState(target: RepositoryTarget): void {
    const state = this.loadStateFile();
    delete state.scopes[this.buildScopeKey(target)];
    this.saveStateFile(state);
  }

  private getStateFilePath(): string {
    return path.join(this.workspaceRoot, '.v8vscedit', 'repository', 'state.json');
  }

  private buildScopeKey(target: RepositoryTarget): string {
    const raw = `${target.configKind}|${path.resolve(target.configRoot)}|${target.extensionName ?? ''}`;
    return crypto.createHash('sha1').update(raw).digest('hex');
  }

  private writeObjectsFile(target: RepositoryTarget, xml: string): string {
    const scopeKey = this.buildScopeKey(target);
    const filePath = path.join(
      this.workspaceRoot,
      '.v8vscedit',
      'repository',
      'objects',
      `${scopeKey}-${Date.now()}.xml`
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${xml}\n`, 'utf-8');
    return filePath;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
