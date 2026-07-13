import * as fs from 'fs';
import { decode } from 'iconv-lite';

/**
 * Разбор списка имён расширений из вывода Конфигуратора
 * (`/DumpDBCfgList -AllExtensions /Out <file>`): по одному имени в строке.
 */
export function parseExtensionList(text: string): string[] {
  // Снимаем ведущий символьный BOM (U+FEFF), оставшийся после декодирования.
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  return withoutBom
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Читает файл выгрузки списка расширений, снимая байтовый BOM и декодируя
 * содержимое. Отсутствие/недоступность файла — не ошибка, а пустой список.
 */
export function readExtensionListFromDumpFile(dumpFilePath: string): string[] {
  let buffer: Buffer;
  try {
    if (!fs.existsSync(dumpFilePath)) {
      return [];
    }
    buffer = fs.readFileSync(dumpFilePath);
  } catch {
    return [];
  }
  return parseExtensionList(decodeDumpBuffer(buffer));
}

function decodeDumpBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf-8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decode(buffer.subarray(2), 'utf16-be');
  }
  return buffer.toString('utf-8');
}

export interface ExtensionChoicePlan {
  selectable: string[];
  allConnected: boolean;
}

/**
 * Решает, какие имена расширений базы предложить пользователю (ещё не
 * подключённые как каталог выгрузки) и является ли база непустой при том, что
 * все её расширения уже подключены. Сравнение регистронезависимое, исходный
 * регистр и порядок имён базы сохраняются.
 */
export function planExtensionChoices(dbNames: string[], connectedNames: string[]): ExtensionChoicePlan {
  const connectedSet = new Set(connectedNames.map((name) => name.toLowerCase()));
  const selectable = dbNames.filter((name) => !connectedSet.has(name.toLowerCase()));
  return {
    selectable,
    allConnected: dbNames.length > 0 && selectable.length === 0,
  };
}
