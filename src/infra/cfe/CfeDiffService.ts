import * as fs from 'fs';
import * as path from 'path';
import { getMetaFolder, type MetaKind } from '../../domain/MetaTypes';
import { ConfigXmlReader } from '../xml/ConfigXmlReader';
import { extractMainChildObjectsInnerXml } from '../xml/XmlUtils';

export type CfeDiffMode = 'overview' | 'transfer';
export type TransferStatus = 'transferred' | 'not_transferred' | 'needs_review';

export interface CfeDiffOptions {
  readonly extensionPath: string;
  readonly configPath?: string;
  readonly mode?: CfeDiffMode;
}

export interface CfeInterceptorInfo {
  readonly type: string;
  readonly method: string;
  readonly line: number;
  readonly filePath: string;
}

export interface CfeObjectDiffInfo {
  readonly ref: string;
  readonly kind: MetaKind;
  readonly name: string;
  readonly filePath: string;
  readonly exists: boolean;
  readonly borrowed: boolean;
  readonly childCounts: Record<string, number>;
  readonly interceptors: CfeInterceptorInfo[];
}

export interface CfeTransferCheck {
  readonly ref: string;
  readonly sourceFilePath: string;
  readonly targetFilePath: string | null;
  readonly startLine: number;
  readonly endLine: number;
  readonly status: TransferStatus;
}

export interface CfeDiffResult {
  readonly extensionPath: string;
  readonly configPath?: string;
  readonly objects: CfeObjectDiffInfo[];
  readonly transferChecks: CfeTransferCheck[];
  readonly warnings: string[];
}

interface InsertionBlock {
  readonly startLine: number;
  readonly endLine: number;
  readonly code: string;
  readonly filePath: string;
}

/**
 * Анализирует состав расширения CFE и проверяет перенос блоков #Вставка.
 * Возвращает структурированные данные для UI, MCP и отчётов без привязки к stdout.
 */
export class CfeDiffService {
  private readonly configReader = new ConfigXmlReader();

  analyze(options: CfeDiffOptions): CfeDiffResult {
    const extensionPath = path.resolve(options.extensionPath);
    const configXmlPath = path.join(extensionPath, 'Configuration.xml');
    if (!fs.existsSync(configXmlPath)) {
      throw new Error(`Configuration.xml не найден в расширении: ${extensionPath}`);
    }

    const info = this.configReader.read(configXmlPath);
    const objects = [...info.childObjects.entries()]
      .flatMap(([kind, names]) => {
        if (!isMetaKind(kind)) {
          return [];
        }
        return names.map((name) => this.readObject(extensionPath, kind, name));
      })
      .sort((a, b) => a.ref.localeCompare(b.ref, 'ru'));

    const warnings: string[] = [];
    const transferChecks = options.mode === 'transfer'
      ? this.checkTransfers(objects, extensionPath, options.configPath, warnings)
      : [];

    return {
      extensionPath,
      configPath: options.configPath ? path.resolve(options.configPath) : undefined,
      objects,
      transferChecks,
      warnings,
    };
  }

  private readObject(extensionPath: string, kind: MetaKind, name: string): CfeObjectDiffInfo {
    const folder = getMetaFolder(kind);
    const filePath = folder ? path.join(extensionPath, folder, `${name}.xml`) : path.join(extensionPath, `${name}.xml`);
    const xml = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const objectDir = folder ? path.join(extensionPath, folder, name) : path.dirname(filePath);

    return {
      ref: `${kind}.${name}`,
      kind,
      name,
      filePath,
      exists: fs.existsSync(filePath),
      borrowed: /<ObjectBelonging>\s*Adopted\s*<\/ObjectBelonging>/.test(xml),
      childCounts: countChildObjects(xml),
      interceptors: listBslFiles(objectDir).flatMap((bslPath) => readInterceptors(bslPath)),
    };
  }

  private checkTransfers(
    objects: CfeObjectDiffInfo[],
    extensionPath: string,
    configPath: string | undefined,
    warnings: string[]
  ): CfeTransferCheck[] {
    if (!configPath) {
      warnings.push('Для проверки переноса нужен путь к основной конфигурации.');
      return [];
    }

    const configRoot = path.resolve(configPath);
    const checks: CfeTransferCheck[] = [];
    for (const object of objects) {
      const folder = getMetaFolder(object.kind);
      if (!folder) {
        continue;
      }
      const objectDir = path.join(extensionPath, folder, object.name);
      for (const bslPath of listBslFiles(objectDir)) {
        for (const block of readInsertionBlocks(bslPath)) {
          const relative = path.relative(extensionPath, bslPath);
          const targetPath = path.join(configRoot, relative);
          const targetCode = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : null;
          checks.push({
            ref: object.ref,
            sourceFilePath: bslPath,
            targetFilePath: targetCode === null ? null : targetPath,
            startLine: block.startLine,
            endLine: block.endLine,
            status: resolveTransferStatus(block.code, targetCode),
          });
        }
      }
    }
    return checks;
  }
}

function isMetaKind(value: string): value is MetaKind {
  return getMetaFolder(value as MetaKind) !== null;
}

function countChildObjects(xml: string): Record<string, number> {
  const inner = extractMainChildObjectsInnerXml(xml);
  if (!inner) {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const match of inner.matchAll(/<([A-Za-z][A-Za-z0-9]*)\b[\s\S]*?(?:<\/\1>|\/>)/g)) {
    counts[match[1]] = (counts[match[1]] ?? 0) + 1;
  }
  return counts;
}

function listBslFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }
  const result: string[] = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...listBslFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bsl')) {
      result.push(fullPath);
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'ru'));
}

function readInterceptors(bslPath: string): CfeInterceptorInfo[] {
  const lines = fs.readFileSync(bslPath, 'utf-8').split(/\r?\n/);
  const result: CfeInterceptorInfo[] = [];
  const pattern = /^&(Перед|После|ИзменениеИКонтроль|Вместо)\("([^"]+)"\)/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = pattern.exec(line.trim());
    if (!match) {
      continue;
    }
    result.push({
      type: match[1],
      method: match[2],
      line: index + 1,
      filePath: bslPath,
    });
  }
  return result;
}

function readInsertionBlocks(bslPath: string): InsertionBlock[] {
  const lines = fs.readFileSync(bslPath, 'utf-8').split(/\r?\n/);
  const result: InsertionBlock[] = [];
  let startLine = 0;
  let buffer: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '#Вставка') {
      startLine = index + 1;
      buffer = [];
      continue;
    }
    if (trimmed === '#КонецВставки' && startLine > 0) {
      result.push({
        startLine,
        endLine: index + 1,
        code: buffer.join('\n').trim(),
        filePath: bslPath,
      });
      startLine = 0;
      buffer = [];
      continue;
    }
    if (startLine > 0) {
      buffer.push(line);
    }
  }
  return result;
}

function resolveTransferStatus(code: string, targetCode: string | null): TransferStatus {
  if (!code.trim() || targetCode === null) {
    return 'needs_review';
  }
  return normalizeCode(targetCode).includes(normalizeCode(code))
    ? 'transferred'
    : 'not_transferred';
}

function normalizeCode(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}
