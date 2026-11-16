import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Logger } from './Logger';
import { SupportMode } from './SupportMode';
import { parseParentConfigurations, type ParentConfigurationsData } from './ParentConfigurationsParser';
import { resolveOwnerXmlForExtContent } from '../fs/MetaPathResolver';

export { SupportMode } from './SupportMode';

/**
 * Состояние корня конфигурации в кэше. Корень без bin хранится маркером
 * `hasData: false`, а не удаляется: иначе файл вложенного корня (CFE внутри CF)
 * попал бы под более короткий префикс внешней конфигурации и получил чужой режим.
 */
type ConfigSupportData =
  | { hasData: false; normalizedRoot: string; originalRoot: string }
  | {
    hasData: true;
    normalizedRoot: string;
    originalRoot: string;
    fileHash: string;
    statKey: string;
    uuidToMode: Map<string, SupportMode>;
  };

const UUID_ATTR_RE = /uuid="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

// Максимальное смещение `uuid="` от начала файла по 43 225 XML реальных выгрузок —
// 942 байта; двукратный запас покрывает длинные пространства имён без чтения всего файла.
const XML_HEAD_BYTES = 2048;

/**
 * Разбирает `ParentConfigurations.bin` и по пути к файлу выдаёт режим поддержки.
 *
 * UUID объекта извлекается напрямую из его XML (атрибут `uuid="…"`); это
 * исключает зависимость от `ConfigDumpInfo.xml` и коллизии имён с расширениями.
 * Повторная загрузка отсекается сначала по stat файла (без чтения 9 МБ), затем по SHA-1.
 */
export class SupportInfoService {
  private readonly cache = new Map<string, ConfigSupportData>();
  private readonly pathUuidCache = new Map<string, string>();
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  loadConfig(configRoot: string): void {
    const name = path.basename(configRoot);
    const normalizedRoot = normPath(configRoot);
    const binPath = path.join(configRoot, 'Ext', 'ParentConfigurations.bin');

    let stat: fs.Stats;
    try {
      stat = fs.statSync(binPath);
    } catch {
      this.clearPathUuidCacheForRoot(normalizedRoot);
      this.cache.set(configRoot, { hasData: false, normalizedRoot, originalRoot: configRoot });
      this.log.appendLine(`[support] ${name}: ParentConfigurations.bin не найден — поддержка отсутствует`);
      return;
    }

    const statKey = `${String(stat.mtimeMs)}:${String(stat.size)}`;
    const cached = this.cache.get(configRoot);
    if (cached?.hasData && cached.statKey === statKey) {
      this.log.appendLine(`[support] ${name}: кэш актуален (файл не изменялся)`);
      return;
    }

    const buf = fs.readFileSync(binPath);
    const fileHash = crypto.createHash('sha1').update(buf).digest('hex');
    if (cached?.hasData && cached.fileHash === fileHash) {
      // Платформа и git переписывают файл с тем же содержимым: разбор не нужен,
      // но stat обновляется, чтобы следующий вызов вышел без чтения.
      cached.statKey = statKey;
      this.log.appendLine(`[support] ${name}: кэш актуален (hash=${fileHash.slice(0, 8)}…)`);
      return;
    }

    // utf8, а не latin1: имена поставщиков в заголовках — кириллица.
    const data = parseParentConfigurations(buf.toString('utf8'));
    this.logSummary(name, data, fileHash);

    this.clearPathUuidCacheForRoot(normalizedRoot);
    this.cache.set(configRoot, {
      hasData: true, normalizedRoot, originalRoot: configRoot, fileHash, statKey, uuidToMode: data.modes,
    });
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
   * Возвращает режим поддержки по пути к файлу.
   * XML объекта читается как есть; содержимое `Ext` (модули, тело формы, макет,
   * справка) относится к XML своего владельца — дескриптора формы/команды/макета
   * или объекта. Конфигурация без данных поддержки — {@link SupportMode.None}.
   */
  getSupportMode(filePath: string): SupportMode {
    const data = this.findConfig(filePath);
    if (!data?.hasData) {
      return SupportMode.None;
    }

    const xmlPath = isOwnXml(filePath, data.normalizedRoot)
      ? filePath
      : resolveOwnerXmlForExtContent(data.originalRoot, filePath);
    if (!xmlPath) {
      return SupportMode.None;
    }

    const uuid = this.getUuidForFile(xmlPath);
    if (!uuid) {
      return SupportMode.None;
    }
    return data.uuidToMode.get(uuid) ?? SupportMode.None;
  }

  hasConfigData(filePath: string): boolean {
    return this.findConfig(filePath)?.hasData === true;
  }

  isLocked(filePath: string): boolean {
    return this.getSupportMode(filePath) === SupportMode.Locked;
  }

  /**
   * Возвращает режим поддержки конкретного UUID в рамках конфигурации,
   * к которой принадлежит filePath.
   */
  getSupportModeByUuid(filePath: string, uuid: string): SupportMode {
    const data = this.findConfig(filePath);
    if (!data?.hasData) {
      return SupportMode.None;
    }
    return data.uuidToMode.get(uuid.toLowerCase()) ?? SupportMode.None;
  }

  // ── private ─────────────────────────────────────────────────────────────

  /** Корень с самым длинным совпадающим префиксом: вложенный корень важнее внешнего. */
  private findConfig(filePath: string): ConfigSupportData | undefined {
    const normFilePath = normPath(filePath);
    let best: ConfigSupportData | undefined;
    for (const data of this.cache.values()) {
      if (!normFilePath.startsWith(data.normalizedRoot + '/')) { continue; }
      if (!best || data.normalizedRoot.length > best.normalizedRoot.length) {
        best = data;
      }
    }
    return best;
  }

  private logSummary(name: string, data: ParentConfigurationsData, fileHash: string): void {
    let locked = 0, editable = 0, removed = 0;
    for (const mode of data.modes.values()) {
      if (mode === SupportMode.Locked) { locked++; }
      else if (mode === SupportMode.Editable) { editable++; }
      else { removed++; }
    }
    const vendors = data.vendors
      .map((v) => `${v.name} ${v.version} (${String(v.declaredCount)})`)
      .join(', ');
    this.log.appendLine(
      `[support] ${name}: загружено ${String(data.modes.size)} объектов` +
      ` (запрещено: ${String(locked)}, разрешено: ${String(editable)}, снято: ${String(removed)});` +
      ` поставщики: ${vendors}; неизвестных кодов (считаются запрещёнными): ${String(data.unknownCodeCount)};` +
      ` hash=${fileHash.slice(0, 8)}…`
    );
    if (data.recordCount !== data.declaredCount) {
      this.log.appendLine(
        `[support] ${name}: расхождение числа записей — найдено ${String(data.recordCount)},` +
        ` объявлено ${String(data.declaredCount)}; формат файла мог измениться`
      );
    }
  }

  private clearPathUuidCacheForRoot(normalizedRoot: string): void {
    const prefix = normalizedRoot + '/';
    for (const key of this.pathUuidCache.keys()) {
      if (key.startsWith(prefix)) {
        this.pathUuidCache.delete(key);
      }
    }
  }

  private getUuidForFile(filePath: string): string | undefined {
    const key = normPath(filePath);
    const cached = this.pathUuidCache.get(key);
    if (cached !== undefined) {
      return cached || undefined;
    }

    const uuid = readXmlHeadUuid(filePath);
    this.pathUuidCache.set(key, uuid);
    return uuid || undefined;
  }
}

/** uuid из заголовка XML; '' — нет файла или атрибута (кэшируется, чтобы не читать повторно). */
function readXmlHeadUuid(filePath: string): string {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return '';
  }
  try {
    const buf = Buffer.alloc(XML_HEAD_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, XML_HEAD_BYTES, 0);
    const m = UUID_ATTR_RE.exec(buf.subarray(0, bytesRead).toString('utf-8'));
    return m ? m[1].toLowerCase() : '';
  } finally {
    fs.closeSync(fd);
  }
}

/** XML самого объекта — `.xml` вне каталога `Ext`; всё остальное принадлежит владельцу. */
function isOwnXml(filePath: string, normalizedRoot: string): boolean {
  const norm = normPath(filePath);
  if (!norm.endsWith('.xml')) {
    return false;
  }
  return !norm.slice(normalizedRoot.length + 1).split('/').includes('ext');
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
}
