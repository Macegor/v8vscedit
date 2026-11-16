/**
 * Синтетический `ParentConfigurations.bin` и вспомогательные фикстуры выгрузки
 * для тестов режима поддержки. Всё строится во временных каталогах; реальные
 * выгрузки пользователя и корпус `example/` не используются.
 *
 * Формат (снят с реального файла, см. docs/metadata-navigator.md#поддержка-поставщика-parentconfigurationsbin): код режима — ПЕРВОЕ поле записи
 * `code,0,localUuid,vendorUuid`; заголовок поставщика
 * `<uuid>,0,<uuid>,"версия","поставщик","имя",<count>`.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BinRecord {
  /** Код режима: 0 — запрещено, 1 — разрешено, 2 — снят с поддержки. */
  readonly code: number;
  /** Локальный uuid объекта (ключ индекса). */
  readonly uuid: string;
  /** uuid объекта поставщика; по умолчанию совпадает с локальным. */
  readonly vendorUuid?: string;
}

export interface BinVendor {
  readonly name: string;
  readonly vendor?: string;
  readonly version?: string;
  readonly records: readonly BinRecord[];
  /** Объявленное число записей в заголовке; по умолчанию = records.length (для проверки расхождения). */
  readonly declaredCount?: number;
}

const BIN_TAIL = ',0,1,0,0,0,0,0,0,0,1,1,1,1,0,0,1,0,1,0,1,1,1,1}';

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Детерминированный uuid по номеру — для читаемых фикстур. */
export function testUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export function buildParentConfigurationsBin(vendors: readonly BinVendor[]): Buffer {
  const blocks = vendors.map((v, i) => {
    const header = [
      testUuid(9000 + i * 2), '0', testUuid(9001 + i * 2),
      quote(v.version ?? '1.0'), quote(v.vendor ?? 'Поставщик'), quote(v.name),
      String(v.declaredCount ?? v.records.length),
    ].join(',');
    const rows = v.records.map((r) => `${String(r.code)},0,${r.uuid},${r.vendorUuid ?? r.uuid}`);
    return [header, ...rows].join(',');
  });
  const text = `{6,0,${String(vendors.length)},${blocks.join(',0,0,')}${BIN_TAIL}`;
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
}

export function makeTempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Создаёт файл (с каталогами) и возвращает его абсолютный путь. */
export function writeFileIn(root: string, relPath: string, content: string): string {
  const full = path.join(root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

/** Минимальный XML объекта метаданных с uuid в заголовке. */
export function objectXml(tag: string, uuid: string, name: string): string {
  return `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">\n\t<${tag} uuid="${uuid}">\n\t\t<Properties>\n\t\t\t<Name>${name}</Name>\n\t\t</Properties>\n\t</${tag}>\n</MetaDataObject>`;
}

/** Записывает `Ext/ParentConfigurations.bin` в корень конфигурации. */
export function writeBin(configRoot: string, vendors: readonly BinVendor[]): string {
  const binPath = path.join(configRoot, 'Ext', 'ParentConfigurations.bin');
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, buildParentConfigurationsBin(vendors));
  return binPath;
}

/** Сборщик строк лога: достаточно для `Logger`. */
export class LineLogger {
  readonly lines: string[] = [];
  appendLine(message: string): void {
    this.lines.push(message);
  }
  includes(fragment: string): boolean {
    return this.lines.some((l) => l.includes(fragment));
  }
}
