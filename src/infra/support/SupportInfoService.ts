import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from './Logger';

/**
 * Режим поддержки объекта метаданных 1С.
 * Значения соответствуют числовым кодам в `ParentConfigurations.bin`:
 *   0 — снято с поддержки, 1 — запрещено, 2 — разрешено.
 */
export const enum SupportMode {
  None = 0,
  Locked = 1,
  Editable = 2,
}

interface ConfigSupportData {
  fileHash: string;
  /** Нормализованный путь к корню конфигурации (нижний регистр, прямые слэши) */
  normalizedRoot: string;
  /** Оригинальный путь (для восстановления регистра) */
  originalRoot: string;
  /** UUID объекта → режим поддержки */
  uuidToMode: Map<string, SupportMode>;
}

const UUID_ATTR_RE = /uuid="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

const SUPPORT_MODE_LABEL: Record<number, string> = {
  [SupportMode.None]: 'снято с поддержки',
  [SupportMode.Locked]: 'запрещено',
  [SupportMode.Editable]: 'разрешено',
};

/**
 * Разбирает `ParentConfigurations.bin` и по пути к файлу выдаёт режим поддержки.
 *
 * UUID объекта извлекается напрямую из его XML (атрибут `uuid="…"`); это
 * исключает зависимость от `ConfigDumpInfo.xml` и коллизии имён с расширениями.
 * Результаты кэшируются по SHA-1 хешу `ParentConfigurations.bin`.
 */
export class SupportInfoService {
  private readonly cache = new Map<string, ConfigSupportData>();
  private readonly pathUuidCache = new Map<string, string>();
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  loadConfig(configRoot: string): void {
    const binPath = path.join(configRoot, 'Ext', 'ParentConfigurations.bin');
    if (!fs.existsSync(binPath)) {
      this.cache.delete(configRoot);
      this.log.appendLine(`[support] ${path.basename(configRoot)}: ParentConfigurations.bin не найден — поддержка отсутствует`);
      return;
    }

    const fileHash = this.computeHash(binPath);
    const cached = this.cache.get(configRoot);
    if (cached?.fileHash === fileHash) {
      this.log.appendLine(`[support] ${path.basename(configRoot)}: кэш актуален (hash=${fileHash.slice(0, 8)}…)`);
      return;
    }

    const uuidToMode = this.parseBinFile(binPath);
    const normalizedRoot = normPath(configRoot);

    let locked = 0, editable = 0, none = 0;
    for (const mode of uuidToMode.values()) {
      if (mode === SupportMode.Locked) { locked++; }
      else if (mode === SupportMode.Editable) { editable++; }
      else { none++; }
    }

    this.log.appendLine(
      `[support] ${path.basename(configRoot)}: загружено ${uuidToMode.size} объектов` +
      ` (запрещено: ${locked}, разрешено: ${editable}, снято: ${none})` +
      ` hash=${fileHash.slice(0, 8)}…`
    );

    this.clearPathUuidCacheForRoot(normalizedRoot);
    this.cache.set(configRoot, { fileHash, normalizedRoot, originalRoot: configRoot, uuidToMode });
  }

  invalidate(configRoot: string): void {
    const cached = this.cache.get(configRoot);
    if (cached) {
      this.clearPathUuidCacheForRoot(cached.normalizedRoot);
    }
    this.cache.delete(configRoot);
    this.log.appendLine(`[support] ${path.basename(configRoot)}: кэш сброшен`);
  }

  /**
   * Возвращает режим поддержки по пути к файлу объекта.
   * Для BSL-модулей резолвит `<Тип>/<Имя>/<Имя>.xml`; если конфигурация не
   * имеет данных поддержки — возвращает {@link SupportMode.None}.
   */
  getSupportMode(filePath: string): SupportMode {
    const normFilePath = normPath(filePath);

    for (const data of this.cache.values()) {
      if (!normFilePath.startsWith(data.normalizedRoot + '/')) { continue; }

      const isBsl = filePath.toLowerCase().endsWith('.bsl');
      const xmlPath = isBsl
        ? this.resolveObjectXmlForBsl(filePath, data.normalizedRoot, data.originalRoot)
        : filePath;

      if (!xmlPath) {
        this.log.appendLine(`[support] не удалось определить XML для: ${path.basename(filePath)}`);
        return SupportMode.None;
      }

      const uuid = this.getUuidForFile(xmlPath);
      if (!uuid) {
        this.log.appendLine(`[support] UUID не найден в: ${xmlPath}`);
        return SupportMode.None;
      }

      const mode = data.uuidToMode.get(uuid) ?? SupportMode.None;
      this.log.appendLine(
        `[support] ${path.basename(filePath)}: uuid=${uuid.slice(0, 8)}… → ${SUPPORT_MODE_LABEL[mode] ?? 'нет данных'}`
      );
      return mode;
    }
    return SupportMode.None;
  }

  hasConfigData(filePath: string): boolean {
    const normFilePath = normPath(filePath);
    for (const data of this.cache.values()) {
      if (normFilePath.startsWith(data.normalizedRoot + '/')) { return true; }
    }
    return false;
  }

  isLocked(filePath: string): boolean {
    return this.getSupportMode(filePath) === SupportMode.Locked;
  }

  /**
   * Возвращает режим поддержки конкретного UUID в рамках конфигурации,
   * к которой принадлежит filePath.
   */
  getSupportModeByUuid(filePath: string, uuid: string): SupportMode {
    const normFilePath = normPath(filePath);
    const normalizedUuid = uuid.toLowerCase();
    for (const data of this.cache.values()) {
      if (!normFilePath.startsWith(data.normalizedRoot + '/')) {
        continue;
      }
      return data.uuidToMode.get(normalizedUuid) ?? SupportMode.None;
    }
    return SupportMode.None;
  }

  // ── private ─────────────────────────────────────────────────────────────

  private clearPathUuidCacheForRoot(normalizedRoot: string): void {
    const prefix = normalizedRoot + '/';
    let cleared = 0;
    for (const key of this.pathUuidCache.keys()) {
      if (key.startsWith(prefix)) {
        this.pathUuidCache.delete(key);
        cleared++;
      }
    }
    if (cleared > 0) {
      this.log.appendLine(`[support] очищено ${cleared} записей кэша UUID`);
    }
  }

  private computeHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha1').update(content).digest('hex');
  }

  /**
   * По пути к BSL-модулю находит XML-файл объекта метаданных:
   * `TypeFolder/ObjectName/[…]/Ext/Module.bsl` → `TypeFolder/ObjectName/ObjectName.xml`.
   */
  private resolveObjectXmlForBsl(
    bslPath: string,
    normalizedRoot: string,
    originalRoot: string
  ): string | undefined {
    const normBsl = normPath(bslPath);
    const rel = normBsl.slice(normalizedRoot.length + 1);
    const parts = rel.split('/');

    const extIdx = parts.indexOf('ext');
    if (extIdx < 2) { return undefined; }

    const bslParts = bslPath.replace(/\\/g, '/').split('/');
    const rootDepth = originalRoot.replace(/\\/g, '/').split('/').length;
    const typeFolder = bslParts[rootDepth];
    const objectName = bslParts[rootDepth + 1];
    if (!typeFolder || !objectName) { return undefined; }

    const xmlPath = path.join(originalRoot, typeFolder, objectName, objectName + '.xml');
    if (!fs.existsSync(xmlPath)) {
      this.log.appendLine(`[support] XML-файл не существует: ${xmlPath}`);
      return undefined;
    }
    return xmlPath;
  }

  private getUuidForFile(filePath: string): string | undefined {
    const key = normPath(filePath);
    if (this.pathUuidCache.has(key)) {
      const v = this.pathUuidCache.get(key)!;
      return v || undefined;
    }

    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(2048);
      const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      const head = buf.slice(0, bytesRead).toString('utf-8');
      const m = UUID_ATTR_RE.exec(head);
      const uuid = m ? m[1].toLowerCase() : '';
      this.pathUuidCache.set(key, uuid);
      return uuid || undefined;
    } catch {
      this.pathUuidCache.set(key, '');
      return undefined;
    }
  }

  /**
   * Разбирает `ParentConfigurations.bin`: запись объекта поддержки — это
   * строка с двумя одинаковыми UUID и кодом режима: `<uuid>,<uuid>,<mode>`.
   */
  private parseBinFile(binPath: string): Map<string, SupportMode> {
    const uuidToMode = new Map<string, SupportMode>();

    let content = fs.readFileSync(binPath, 'utf-8');
    if (content.charCodeAt(0) === 0xfeff) { content = content.slice(1); }

    const UUID_PAT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const RE = new RegExp(`(${UUID_PAT}),(${UUID_PAT}),(\\d)`, 'gi');

    let m: RegExpExecArray | null;
    while ((m = RE.exec(content)) !== null) {
      if (m[1].toLowerCase() !== m[2].toLowerCase()) { continue; }
      const uuid = m[1].toLowerCase();
      const mode = parseInt(m[3], 10) as SupportMode;
      uuidToMode.set(uuid, mode);
    }
    return uuidToMode;
  }
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
}
