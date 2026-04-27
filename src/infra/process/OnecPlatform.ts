import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { globSync } from 'glob';

const WINDOWS_EXECUTABLE = '1cv8.exe';
const UNIX_EXECUTABLES = ['1cv8', '1cv8c'] as const;

/**
 * Находит исполняемый файл платформы 1С без привязки к Windows-каталогу.
 * Путь из настроек может быть файлом, каталогом bin, каталогом .app или именем из PATH.
 */
export function resolveV8ExecutablePath(v8Path: string, platform: NodeJS.Platform = process.platform): string {
  const explicitPath = trimOuterQuotes(v8Path).trim();
  if (explicitPath) {
    return resolveExplicitV8Path(explicitPath, platform);
  }

  const candidates = collectDefaultV8Candidates(platform);
  const found = pickLatestExistingPath(candidates, platform);
  if (found) {
    return found;
  }

  const hint = platform === 'win32'
    ? 'C:\\Program Files\\1cv8\\<версия>\\bin\\1cv8.exe'
    : '/Applications/1cv8.app или /opt/1cv8/.../1cv8';
  throw new Error(`Не найден исполняемый файл 1С. Укажите "--path" в env.json, например: ${hint}`);
}

/**
 * Нормализует путь файловой базы только по правилам текущей ОС.
 * На macOS/Linux абсолютные пути вида `/F/Users/...` должны остаться Unix-путями.
 */
export function normalizeInfoBasePath(rawPath: string, platform: NodeJS.Platform = process.platform): string {
  let value = trimOuterQuotes(rawPath).trim();
  if (platform === 'win32') {
    value = value.replace(/\//g, '\\');
    value = value.replace(/^([A-Za-z]):\\+/, '$1:\\');
    if (!value.startsWith('\\\\')) {
      value = value.replace(/\\{2,}/g, '\\');
    }
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * Строит подсказку пути к платформе по версии из env.json.
 * Нужна, чтобы `--v8version` продолжал работать без Windows-only автоопределения.
 */
export function resolveV8PathHintFromVersion(version: string, platform: NodeJS.Platform = process.platform): string {
  const normalizedVersion = version.trim();
  if (!normalizedVersion) {
    return '';
  }

  const candidates = platform === 'win32'
    ? [
      `C:/Program Files/1cv8/${normalizedVersion}/bin`,
      `C:/Program Files (x86)/1cv8/${normalizedVersion}/bin`,
    ]
    : [
      `/opt/1cv8/${normalizedVersion}`,
      `/opt/1C/v8.3/${normalizedVersion}`,
    ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] ?? '';
}

function resolveExplicitV8Path(v8Path: string, platform: NodeJS.Platform): string {
  if (!hasPathSeparator(v8Path)) {
    const fromPath = findExecutableInPath(v8Path, platform);
    if (fromPath) {
      return fromPath;
    }
  }

  if (!fs.existsSync(v8Path)) {
    throw new Error(`Не найден исполняемый файл 1С: ${v8Path}`);
  }

  const stat = fs.statSync(v8Path);
  if (stat.isFile() && isAllowedExecutable(v8Path, platform)) {
    return v8Path;
  }
  if (stat.isDirectory()) {
    const found = pickLatestExistingPath(collectDirectoryCandidates(v8Path, platform), platform);
    if (found) {
      return found;
    }
  }

  throw new Error(`Не удалось определить исполняемый файл 1С по пути: ${v8Path}`);
}

function collectDefaultV8Candidates(platform: NodeJS.Platform): string[] {
  const candidates: string[] = [];

  if (platform === 'win32') {
    candidates.push(
      ...globSync('C:/Program Files/1cv8/*/bin/1cv8.exe', { windowsPathsNoEscape: true, nodir: true }),
      ...globSync('C:/Program Files (x86)/1cv8/*/bin/1cv8.exe', { windowsPathsNoEscape: true, nodir: true }),
      ...collectPathCandidates([WINDOWS_EXECUTABLE], platform)
    );
    return candidates;
  }

  if (platform === 'darwin') {
    candidates.push(
      ...collectMacAppCandidates('/Applications/**'),
      ...collectMacAppCandidates('/opt/1cv8/*'),
      ...collectUnixVersionCandidates('/opt/1C/v8.3/*'),
      ...collectUnixVersionCandidates('/opt/1cv8/*')
    );
  } else {
    candidates.push(
      ...collectUnixVersionCandidates('/opt/1C/v8.3/*'),
      ...collectUnixVersionCandidates('/opt/1cv8/*'),
      '/usr/local/bin/1cv8',
      '/usr/bin/1cv8',
      '/usr/local/bin/1cv8c',
      '/usr/bin/1cv8c'
    );
  }

  candidates.push(...collectPathCandidates([...UNIX_EXECUTABLES], platform));
  return candidates;
}

function collectDirectoryCandidates(dirPath: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [
      path.join(dirPath, WINDOWS_EXECUTABLE),
      path.join(dirPath, 'bin', WINDOWS_EXECUTABLE),
    ];
  }

  const candidates = UNIX_EXECUTABLES.flatMap((name) => [
    path.join(dirPath, name),
    path.join(dirPath, 'bin', name),
    path.join(dirPath, 'Contents', 'MacOS', name),
  ]);

  if (platform === 'darwin') {
    candidates.push(
      ...UNIX_EXECUTABLES.map((name) => path.join(dirPath, `${name}.app`, 'Contents', 'MacOS', name))
    );
  }

  return candidates;
}

function collectPathCandidates(names: string[], platform: NodeJS.Platform): string[] {
  return names
    .map((name) => findExecutableInPath(name, platform))
    .filter((candidate): candidate is string => Boolean(candidate));
}

function findExecutableInPath(commandName: string, platform: NodeJS.Platform): string | null {
  const pathValue = process.env.PATH ?? '';
  const pathParts = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  const names = path.extname(commandName)
    ? [commandName]
    : extensions.map((ext) => `${commandName}${ext.toLowerCase()}`);

  for (const dir of pathParts) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExistingFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function pickLatestExistingPath(candidates: string[], platform: NodeJS.Platform): string | null {
  const existing = Array.from(new Set(candidates)).filter((candidate) =>
    isExistingFile(candidate) && isAllowedExecutable(candidate, platform)
  );
  if (existing.length === 0) {
    return null;
  }
  return existing.sort(compareCandidatePaths).at(-1) ?? null;
}

function compareCandidatePaths(left: string, right: string): number {
  const leftVersion = extractVersion(left);
  const rightVersion = extractVersion(right);
  const length = Math.max(leftVersion.length, rightVersion.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (leftVersion[i] ?? 0) - (rightVersion[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  const executableDiff = executablePriority(left) - executablePriority(right);
  if (executableDiff !== 0) {
    return executableDiff;
  }
  const containerDiff = containerPriority(left) - containerPriority(right);
  if (containerDiff !== 0) {
    return containerDiff;
  }
  return left.localeCompare(right);
}

function extractVersion(filePath: string): number[] {
  const matches = filePath.match(/\d+(?:\.\d+)+/g);
  const version = matches?.at(-1) ?? '';
  return version.split('.').map((item) => Number.parseInt(item, 10)).filter(Number.isFinite);
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function collectUnixVersionCandidates(versionGlob: string): string[] {
  return UNIX_EXECUTABLES.flatMap((name) => globSync(path.join(versionGlob, name), { nodir: true }));
}

function collectMacAppCandidates(rootGlob: string): string[] {
  return UNIX_EXECUTABLES.flatMap((name) =>
    globSync(path.join(rootGlob, `${name}.app`, 'Contents', 'MacOS', name), { nodir: true })
  );
}

function isAllowedExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  const executableNames = platform === 'win32'
    ? [WINDOWS_EXECUTABLE]
    : [...UNIX_EXECUTABLES];
  return executableNames.includes(path.basename(filePath));
}

function executablePriority(filePath: string): number {
  switch (path.basename(filePath)) {
    case '1cv8':
    case WINDOWS_EXECUTABLE:
      return 2;
    case '1cv8c':
      return 1;
    default:
      return 0;
  }
}

function containerPriority(filePath: string): number {
  return filePath.includes('.app/Contents/MacOS') ? 0 : 1;
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function trimOuterQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, '');
}
