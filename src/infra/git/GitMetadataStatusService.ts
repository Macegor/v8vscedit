import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ChildTag } from '../../domain/ChildTag';
import type { MetaKind } from '../../domain/MetaTypes';
import {
  extractChildMetaElementXml,
  extractChildMetaElementsXml,
  extractColumnXmlFromTabularSection,
  extractColumnsXmlFromTabularSection,
  extractMethodXmlFromUrlTemplate,
} from '../xml/XmlUtils';

export type MetadataGitDecorationStatus = 'added' | 'modified' | 'deleted';

export interface MetadataGitDecorationTarget {
  kind: 'child' | 'group' | 'paths';
  ownerXmlPath: string;
  childKind: MetaKind | ChildTag | 'Column';
  name?: string;
  tabularSectionName?: string;
  /** Имя URL-шаблона-контейнера для метода HTTP-сервиса (аналог tabularSectionName у Column). */
  urlTemplateName?: string;
  paths?: string[];
}

interface ObjectGitSnapshot {
  currentXml: string | null;
  headXml: string | null;
  fileChanged: boolean;
  fileAdded: boolean;
}

/**
 * Состояние batch-карты git-статусов для одного gitRoot.
 * `statusByPath` хранит изменённые файлы — отсутствие ключа означает «чисто/committed».
 * `loaded` различает «карта прогрета одним git-status» и «карта пуста, потому что
 * git не доступен или это не репозиторий».
 */
interface GitRootState {
  readonly statusByPath: Map<string, MetadataGitDecorationStatus>;
  readonly headContentByPath: Map<string, string | null>;
  loaded: boolean;
}

/**
 * Вычисляет git-состояние вложенных элементов, которые физически живут в XML объекта.
 * Штатный Git-декоратор VS Code видит только файл целиком, поэтому для реквизитов
 * нужен отдельный diff конкретного XML-блока.
 *
 * Производительность: на 1000+ объектов недопустимо запускать `git status` на каждый
 * файл — на Windows один spawn git стоит 50–200 мс. Поэтому первое обращение
 * прогревает `statusByPath` одним вызовом `git status --porcelain --untracked-files=all`,
 * а все последующие per-file запросы читают карту в памяти.
 *
 * Ключ карты — нормализованный абсолютный путь lower-case. Без `realpathSync`:
 * нормализация одинаково применяется и к выводу git, и к запросу — этого достаточно
 * для совпадения, а `realpathSync` капризен к forward-slash формату на Windows.
 */
export class GitMetadataStatusService {
  private gitRoot: string | null | undefined;
  private readonly objectCache = new Map<string, ObjectGitSnapshot>();
  private readonly statusMapByRoot = new Map<string, GitRootState>();

  constructor(private readonly workspaceRoot: string) {}

  /**
   * Полный сброс кэша. Использовать для смены HEAD (checkout, pull) — для точечной
   * инвалидации после mutate использовать `invalidate(filePaths)`.
   */
  clear(): void {
    this.objectCache.clear();
    this.statusMapByRoot.clear();
  }

  /**
   * Точечная инвалидация после mutate. Сбрасывает кэш HEAD-содержимого и
   * `objectCache` для указанных путей, помечает batch-карту как не загруженную,
   * чтобы следующий запрос статуса любого файла из этой группы инициировал
   * один git-status для всего root.
   */
  invalidate(filePaths: readonly string[]): void {
    if (filePaths.length === 0) {
      return;
    }
    const keys = filePaths.map(normalizePath);
    for (const key of keys) {
      this.objectCache.delete(key);
    }
    for (const state of this.statusMapByRoot.values()) {
      for (const key of keys) {
        state.statusByPath.delete(key);
        state.headContentByPath.delete(key);
      }
      // Заставляем следующий getFileDecorationStatus перепрогреть карту,
      // чтобы добавленные/удалённые/изменённые файлы получили актуальный статус.
      state.loaded = false;
    }
  }

  getStatus(target: MetadataGitDecorationTarget): MetadataGitDecorationStatus | undefined {
    if (target.kind === 'paths') {
      return this.getPathsStatus(target.paths ?? []);
    }

    const snapshot = this.getObjectSnapshot(target.ownerXmlPath);
    if (!snapshot.fileChanged) {
      return undefined;
    }

    if (target.kind === 'group') {
      return this.getGroupStatus(snapshot, target);
    }

    if (!target.name) {
      return undefined;
    }

    if (snapshot.fileAdded || !snapshot.headXml) {
      return 'added';
    }

    const currentBlock = this.extractTargetXml(snapshot.currentXml, target);
    const headBlock = this.extractTargetXml(snapshot.headXml, target);
    if (currentBlock && !headBlock) {
      return 'added';
    }
    if (!currentBlock && headBlock) {
      return 'deleted';
    }
    if (currentBlock && headBlock && normalizeComparableXml(currentBlock) !== normalizeComparableXml(headBlock)) {
      return 'modified';
    }

    return undefined;
  }

  private getPathsStatus(filePaths: string[]): MetadataGitDecorationStatus | undefined {
    let hasAdded = false;
    let hasModified = false;
    let hasDeleted = false;

    for (const filePath of filePaths) {
      const status = this.getPathStatus(filePath);
      hasAdded = hasAdded || status === 'added';
      hasModified = hasModified || status === 'modified';
      hasDeleted = hasDeleted || status === 'deleted';
    }

    if (hasModified || (hasAdded && hasDeleted)) {
      return 'modified';
    }
    if (hasAdded) {
      return 'added';
    }
    if (hasDeleted) {
      return 'deleted';
    }
    return undefined;
  }

  /**
   * Универсальный резолв статуса для пути: для файла возвращает прямой статус,
   * для каталога — агрегированный статус всех изменённых файлов внутри.
   * Это нужно для корневых групп дерева («Справочники», «Документы»), у которых
   * `decorationPath` указывает на каталог группы, а не на конкретный файл.
   */
  private getPathStatus(filePath: string): MetadataGitDecorationStatus | undefined {
    const direct = this.getFileDecorationStatus(filePath);
    if (direct) {
      return direct;
    }
    return this.getDirectoryStatus(filePath);
  }

  /**
   * Агрегированный статус каталога: ищет в batch-карте любые изменённые файлы
   * с префиксом нормализованного каталога. Возвращает 'modified' если есть
   * хотя бы один изменённый файл; иначе undefined (каталог чист).
   */
  private getDirectoryStatus(directoryPath: string): MetadataGitDecorationStatus | undefined {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return undefined;
    }
    const state = this.ensureStatusMap(gitRoot);
    if (state.statusByPath.size === 0) {
      return undefined;
    }
    const prefix = `${normalizePath(directoryPath)}/`;
    let hasAdded = false;
    let hasModified = false;
    let hasDeleted = false;
    for (const [key, status] of state.statusByPath) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      hasAdded = hasAdded || status === 'added';
      hasModified = hasModified || status === 'modified';
      hasDeleted = hasDeleted || status === 'deleted';
    }
    if (hasModified || (hasAdded && hasDeleted)) {
      return 'modified';
    }
    if (hasAdded) {
      return 'added';
    }
    if (hasDeleted) {
      return 'deleted';
    }
    return undefined;
  }

  private getGroupStatus(
    snapshot: ObjectGitSnapshot,
    target: MetadataGitDecorationTarget
  ): MetadataGitDecorationStatus | undefined {
    if (snapshot.fileAdded || !snapshot.headXml) {
      return 'modified';
    }

    const current = this.extractGroupXml(snapshot.currentXml, target);
    const head = this.extractGroupXml(snapshot.headXml, target);
    const names = new Set([...current.keys(), ...head.keys()]);

    for (const name of names) {
      const currentXml = current.get(name);
      const headXml = head.get(name);
      if (!currentXml || !headXml || normalizeComparableXml(currentXml) !== normalizeComparableXml(headXml)) {
        return 'modified';
      }
    }

    return undefined;
  }

  private getObjectSnapshot(ownerXmlPath: string): ObjectGitSnapshot {
    const key = normalizePath(ownerXmlPath);
    const cached = this.objectCache.get(key);
    if (cached) {
      return cached;
    }

    const currentXml = readTextFile(ownerXmlPath);
    const fileStatus = this.getFileStatus(ownerXmlPath);
    const snapshot: ObjectGitSnapshot = {
      currentXml,
      headXml: fileStatus.changed ? this.readHeadFile(ownerXmlPath) : currentXml,
      fileChanged: fileStatus.changed,
      fileAdded: fileStatus.added,
    };
    this.objectCache.set(key, snapshot);
    return snapshot;
  }

  private getFileStatus(filePath: string): { changed: boolean; added: boolean } {
    const status = this.getFileDecorationStatus(filePath);
    return {
      changed: Boolean(status),
      added: status === 'added',
    };
  }

  private getFileDecorationStatus(filePath: string): MetadataGitDecorationStatus | undefined {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return undefined;
    }
    const state = this.ensureStatusMap(gitRoot);
    return state.statusByPath.get(normalizePath(filePath));
  }

  /**
   * Лениво прогревает batch-карту статусов для gitRoot одним git-процессом.
   * Если git недоступен или прогрев упал — state остаётся помеченным как loaded
   * с пустой картой, повторных spawn не будет до `clear()` или `invalidate()`.
   */
  private ensureStatusMap(gitRoot: string): GitRootState {
    let state = this.statusMapByRoot.get(gitRoot);
    if (!state) {
      state = { statusByPath: new Map(), headContentByPath: new Map(), loaded: false };
      this.statusMapByRoot.set(gitRoot, state);
    }
    if (state.loaded) {
      return state;
    }
    try {
      const output = execFileSync(
        'git',
        ['-C', gitRoot, 'status', '--porcelain', '--untracked-files=all'],
        {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      parsePorcelainOutput(output, gitRoot, state.statusByPath);
    } catch {
      // git недоступен / не репозиторий — карта пуста, повторных попыток не будет.
    }
    state.loaded = true;
    return state;
  }

  private readHeadFile(filePath: string): string | null {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return null;
    }
    const state = this.ensureStatusMap(gitRoot);
    const key = normalizePath(filePath);
    const cached = state.headContentByPath.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const relativePath = path.relative(gitRoot, filePath).split(path.sep).join('/');
    let content: string | null;
    try {
      content = execFileSync('git', ['-C', gitRoot, 'show', `HEAD:${relativePath}`], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      content = null;
    }
    state.headContentByPath.set(key, content);
    return content;
  }

  private getGitRoot(): string | null {
    if (this.gitRoot !== undefined) {
      return this.gitRoot;
    }

    try {
      this.gitRoot = execFileSync('git', ['-C', this.workspaceRoot, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      this.gitRoot = null;
    }

    return this.gitRoot;
  }

  private extractTargetXml(xml: string | null, target: MetadataGitDecorationTarget): string | null {
    if (!xml || !target.name) {
      return null;
    }

    if (target.childKind === 'Column') {
      return target.tabularSectionName
        ? extractColumnXmlFromTabularSection(xml, target.tabularSectionName, target.name)
        : null;
    }

    if (target.childKind === 'Method') {
      return target.urlTemplateName
        ? extractMethodXmlFromUrlTemplate(xml, target.urlTemplateName, target.name)
        : null;
    }

    return extractChildMetaElementXml(xml, target.childKind, target.name);
  }

  private extractGroupXml(xml: string | null, target: MetadataGitDecorationTarget): Map<string, string> {
    if (!xml) {
      return new Map();
    }

    if (target.childKind === 'Column') {
      const columns = target.tabularSectionName
        ? extractColumnsXmlFromTabularSection(xml, target.tabularSectionName)
        : [];
      return new Map(columns.map((item) => [item.name, item.xml]));
    }

    return new Map(extractChildMetaElementsXml(xml, target.childKind).map((item) => [item.name, item.xml]));
  }
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Нормализованная форма абсолютного пути для использования в качестве ключа кэша.
 * Унифицирует разделители на forward slash и приводит к нижнему регистру.
 * `realpathSync` не используется — он капризен к forward-slash формату на Windows.
 * Forward slash в ключах нужен для prefix-сравнений в `getDirectoryStatus`
 * (агрегация статуса каталога через `key.startsWith(dirPrefix + '/')`).
 */
function normalizePath(filePath: string): string {
  return path.resolve(filePath).split(/[\\/]/).join('/').toLowerCase();
}

function normalizeComparableXml(xml: string): string {
  return xml
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .trim();
}

/**
 * Парсит вывод `git status --porcelain` (v1) и заполняет переданную карту:
 *   XY <path>
 *   XY <path> -> <newpath>    (для переименований)
 * где XY — двухсимвольный код статуса (index + worktree).
 */
function parsePorcelainOutput(
  output: string,
  gitRoot: string,
  result: Map<string, MetadataGitDecorationStatus>
): void {
  if (!output) {
    return;
  }
  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.length < 4) {
      continue;
    }
    const code = rawLine.slice(0, 2);
    let relPath = rawLine.slice(3);
    const renameArrow = relPath.indexOf(' -> ');
    if (renameArrow !== -1) {
      relPath = relPath.slice(renameArrow + 4);
    }
    if (relPath.startsWith('"') && relPath.endsWith('"')) {
      relPath = unquotePorcelainPath(relPath);
    }
    const absolute = path.resolve(gitRoot, relPath);
    result.set(normalizePath(absolute), decodePorcelainStatus(code));
  }
}

function decodePorcelainStatus(code: string): MetadataGitDecorationStatus {
  if (code.includes('D')) {
    return 'deleted';
  }
  if (code.includes('A') || code === '??') {
    return 'added';
  }
  return 'modified';
}

/**
 * Декодирует C-style escape-последовательности из кавычек, которые git добавляет
 * при `core.quotepath=true` (по умолчанию). Полную семантику не реализуем —
 * расшифровываем только обычные escapes; этого хватает для путей в выгрузке 1С.
 */
function unquotePorcelainPath(quoted: string): string {
  const body = quoted.slice(1, -1);
  let result = '';
  let index = 0;
  const bytes: number[] = [];
  while (index < body.length) {
    const ch = body[index];
    if (ch !== '\\') {
      if (bytes.length > 0) {
        result += Buffer.from(bytes).toString('utf-8');
        bytes.length = 0;
      }
      result += ch;
      index += 1;
      continue;
    }
    if (index + 1 >= body.length) {
      break;
    }
    const next = body[index + 1];
    if (next >= '0' && next <= '7') {
      // Восьмеричный escape \NNN — байт UTF-8 последовательности.
      const octal = body.slice(index + 1, index + 4);
      bytes.push(parseInt(octal, 8));
      index += 4;
      continue;
    }
    if (bytes.length > 0) {
      result += Buffer.from(bytes).toString('utf-8');
      bytes.length = 0;
    }
    switch (next) {
      case 'n': result += '\n'; break;
      case 't': result += '\t'; break;
      case 'r': result += '\r'; break;
      case '\\': result += '\\'; break;
      case '"': result += '"'; break;
      default: result += next; break;
    }
    index += 2;
  }
  if (bytes.length > 0) {
    result += Buffer.from(bytes).toString('utf-8');
  }
  return result;
}
