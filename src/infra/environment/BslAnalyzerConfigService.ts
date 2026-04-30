import * as fs from 'fs';
import * as path from 'path';

const CONFIG_FILE_NAME = 'bsl-analyzer.toml';
const SOURCE_SECTION_HEADER = '[source]';

/**
 * Поддерживает `bsl-analyzer.toml` в актуальном состоянии для текущей структуры проекта.
 */
export class BslAnalyzerConfigService {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Создаёт конфиг, если его нет. Существующий файл не трогает, чтобы не затирать ручные настройки.
   */
  ensureExists(extensionRootPaths: readonly string[]): void {
    const configPath = this.getConfigPath();
    if (fs.existsSync(configPath)) {
      return;
    }

    this.writeSourceConfig(extensionRootPaths);
  }

  /**
   * Перезаписывает только секцию `[source]`, сохраняя остальные секции файла.
   */
  updateSource(extensionRootPaths: readonly string[]): void {
    this.writeSourceConfig(extensionRootPaths);
  }

  getConfigPath(): string {
    return path.join(this.workspaceRoot, CONFIG_FILE_NAME);
  }

  private writeSourceConfig(extensionRootPaths: readonly string[]): void {
    const configPath = this.getConfigPath();
    const existing = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, 'utf-8')
      : '';
    const content = upsertSourceSection(existing, buildSourceSection(
      normalizeExtensionPaths(this.workspaceRoot, extensionRootPaths)
    ));
    fs.writeFileSync(configPath, content, 'utf-8');
  }
}

export function buildBslAnalyzerSourceConfig(extensionPaths: readonly string[]): string {
  return buildSourceSection([...extensionPaths]);
}

export function upsertSourceSection(content: string, sourceSection: string): string {
  const normalizedSource = `${sourceSection.trimEnd()}\n`;
  const sourceRange = findSourceSectionRange(content);
  if (!sourceRange) {
    const prefix = content.trim().length > 0 ? `${content.trimEnd()}\n\n` : '';
    return `${prefix}${normalizedSource}`;
  }

  const before = content.slice(0, sourceRange.start).trimEnd();
  const after = content.slice(sourceRange.end).trimStart();
  return [
    before,
    normalizedSource.trimEnd(),
    after,
  ].filter((part) => part.length > 0).join('\n\n') + '\n';
}

function buildSourceSection(extensionPaths: readonly string[]): string {
  const lines = [
    SOURCE_SECTION_HEADER,
    'root = "src/cf"',
  ];

  if (extensionPaths.length > 0) {
    lines.push('', 'extensions = [');
    for (const extensionPath of extensionPaths) {
      lines.push(`  "${escapeTomlString(extensionPath)}",`);
    }
    lines.push(']');
  }

  return `${lines.join('\n')}\n`;
}

function normalizeExtensionPaths(workspaceRoot: string, extensionRootPaths: readonly string[]): string[] {
  const result = new Set<string>();
  for (const extensionRootPath of extensionRootPaths) {
    const relative = path
      .relative(workspaceRoot, extensionRootPath)
      .split(path.sep)
      .join('/');
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      result.add(relative);
    }
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function findSourceSectionRange(content: string): { start: number; end: number } | null {
  const sourceMatch = /^\s*\[source]\s*$/m.exec(content);
  if (!sourceMatch || sourceMatch.index === undefined) {
    return null;
  }

  const restStart = sourceMatch.index + sourceMatch[0].length;
  const rest = content.slice(restStart);
  const nextSectionMatch = /^\s*\[[^\]]+]\s*$/m.exec(rest);
  return {
    start: sourceMatch.index,
    end: nextSectionMatch && nextSectionMatch.index !== undefined
      ? restStart + nextSectionMatch.index
      : content.length,
  };
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
