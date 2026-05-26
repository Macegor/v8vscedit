import * as fs from 'fs';
import type { MetaObject } from '../../domain/MetaObject';

/**
 * LRU-кэш результата `parseObjectXml` по ключу `(xmlPath, mtimeMs)`.
 *
 * Зачем: в одной MCP-транзакции один и тот же XML может парситься 2–3 раза
 * (path-resolver → metadataInfoService → updateProperty), а парсер
 * `fast-xml-parser` на больших объектах метаданных стоит десятки миллисекунд.
 * Кэш по mtime безопасен — при правке файла mtimeMs гарантированно меняется,
 * и старая запись отбрасывается автоматически (fallthrough на повторный parse).
 *
 * Размер: 500 объектов — компромисс между типичной средней конфигурацией
 * (~1000 объектов в дереве, из них горячих под MCP-сессию — десятки) и
 * расходом памяти. Поведение LRU реализовано через `Map`: при попадании
 * запись «приподнимается» переустановкой ключа, при превышении лимита
 * выкидывается самая старая.
 */

interface CachedEntry {
  readonly mtimeMs: number;
  readonly value: MetaObject | null;
}

const CACHE_LIMIT = 500;

export class ParseObjectXmlCache {
  private readonly entries = new Map<string, CachedEntry>();

  /**
   * Возвращает кэшированный результат, если файл не изменился.
   * Иначе вызывает `parser` и кладёт результат в кэш.
   * Если файл не существует — кэширует `null` через mtime=−1, чтобы
   * не делать повторных `statSync` в горячем пути.
   */
  getOrParse(xmlPath: string, parser: (xmlPath: string) => MetaObject | null): MetaObject | null {
    const mtimeMs = this.safeMtimeMs(xmlPath);
    const existing = this.entries.get(xmlPath);
    if (existing?.mtimeMs === mtimeMs) {
      // LRU touch: переустанавливаем ключ, чтобы в Map он стал самым свежим.
      this.entries.delete(xmlPath);
      this.entries.set(xmlPath, existing);
      return existing.value;
    }

    const value = parser(xmlPath);
    const entry: CachedEntry = { mtimeMs, value };
    if (this.entries.has(xmlPath)) {
      this.entries.delete(xmlPath);
    }
    this.entries.set(xmlPath, entry);
    if (this.entries.size > CACHE_LIMIT) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) {
        this.entries.delete(firstKey);
      }
    }
    return value;
  }

  /** Принудительно очистить кэш — нужно в тестах, когда подменяется fs. */
  clear(): void {
    this.entries.clear();
  }

  /** Информационная статистика для отладки и тестов. */
  size(): number {
    return this.entries.size;
  }

  private safeMtimeMs(xmlPath: string): number {
    try {
      return fs.statSync(xmlPath).mtimeMs;
    } catch {
      return -1;
    }
  }
}

/** Глобальный singleton-кэш для `parseObjectXml`. */
export const parseObjectXmlCache = new ParseObjectXmlCache();
