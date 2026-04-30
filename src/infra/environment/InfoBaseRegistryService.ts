import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type RegisteredInfoBaseKind = 'file' | 'server' | 'unknown';

export interface RegisteredInfoBase {
  readonly id: string;
  readonly name: string;
  readonly kind: RegisteredInfoBaseKind;
  readonly connection: string;
  readonly sourcePath: string;
  readonly filePath?: string;
  readonly server?: string;
  readonly ref?: string;
  readonly order?: number;
}

export interface InfoBaseRegistryScanResult {
  readonly bases: RegisteredInfoBase[];
  readonly sources: string[];
  readonly warnings: string[];
}

interface SectionData {
  readonly name: string;
  readonly values: Map<string, string>;
}

/**
 * Читает системный реестр информационных баз 1С из локального `ibases.v8i`
 * и общих списков, подключённых через `CommonInfoBases`.
 */
export class InfoBaseRegistryService {
  scan(): InfoBaseRegistryScanResult {
    const warnings: string[] = [];
    const sources = new Set<string>();
    const v8iPaths = new Set(resolveLocalInfoBaseListPaths());

    for (const cfgPath of resolveStartCfgPaths()) {
      if (!fs.existsSync(cfgPath)) {
        continue;
      }
      sources.add(cfgPath);
      try {
        const cfgContent = readTextFileWithEncoding(cfgPath);
        for (const commonPath of parseCommonInfoBasePaths(cfgContent, cfgPath)) {
          v8iPaths.add(commonPath);
        }
      } catch (error) {
        warnings.push(formatReadWarning(cfgPath, error));
      }
    }

    const bases: RegisteredInfoBase[] = [];
    for (const v8iPath of v8iPaths) {
      if (!fs.existsSync(v8iPath)) {
        continue;
      }
      sources.add(v8iPath);
      try {
        bases.push(...parseV8iContent(readTextFileWithEncoding(v8iPath), v8iPath));
      } catch (error) {
        warnings.push(formatReadWarning(v8iPath, error));
      }
    }

    return {
      bases: deduplicateBases(bases).sort(compareInfoBases),
      sources: [...sources].sort((left, right) => left.localeCompare(right)),
      warnings,
    };
  }
}

export function parseV8iContent(content: string, sourcePath: string): RegisteredInfoBase[] {
  return parseSections(content).map((section, index) => {
    const connection = section.values.get('connect') ?? '';
    const parsedConnection = parseConnectionString(connection);
    const order = Number.parseInt(section.values.get('orderinlist') ?? '', 10);
    return {
      id: `${sourcePath}#${index}`,
      name: section.name,
      kind: parsedConnection.kind,
      connection: buildEnvConnection(parsedConnection),
      sourcePath,
      filePath: parsedConnection.filePath,
      server: parsedConnection.server,
      ref: parsedConnection.ref,
      order: Number.isFinite(order) ? order : undefined,
    };
  }).filter((base) => Boolean(base.connection));
}

export function parseCommonInfoBasePaths(content: string, cfgPath: string): string[] {
  const result: string[] = [];
  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }
    const delimiterIndex = line.indexOf('=');
    if (delimiterIndex < 0) {
      continue;
    }
    const key = line.slice(0, delimiterIndex).trim().toLowerCase();
    if (key !== 'commoninfobases') {
      continue;
    }
    const value = line.slice(delimiterIndex + 1).trim();
    result.push(...splitConfigList(value).map((item) => resolveConfiguredPath(item, cfgPath)));
  }
  return result.filter((item) => item.length > 0);
}

function resolveLocalInfoBaseListPaths(): string[] {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? [path.join(appData, '1C', '1CEStart', 'ibases.v8i')] : [];
  }

  const home = os.homedir();
  return [
    path.join(home, '.1C', '1cestart', 'ibases.v8i'),
    path.join(home, '.1cv8', '1C', '1CEStart', 'ibases.v8i'),
    path.join(home, 'Library', 'Application Support', '1C', '1CEStart', 'ibases.v8i'),
  ];
}

function resolveStartCfgPaths(): string[] {
  if (process.platform === 'win32') {
    const result: string[] = [];
    if (process.env.APPDATA) {
      result.push(path.join(process.env.APPDATA, '1C', '1CEStart', '1cestart.cfg'));
    }
    if (process.env.ALLUSERSPROFILE) {
      result.push(path.join(process.env.ALLUSERSPROFILE, '1C', '1CEStart', '1cestart.cfg'));
    }
    return result;
  }

  const home = os.homedir();
  return [
    path.join(home, '.1C', '1cestart', '1cestart.cfg'),
    path.join(home, '.1cv8', '1C', '1CEStart', '1cestart.cfg'),
    path.join(home, 'Library', 'Application Support', '1C', '1CEStart', '1cestart.cfg'),
  ];
}

function readTextFileWithEncoding(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  const nullBytes = buffer.subarray(0, Math.min(buffer.length, 120)).filter((byte) => byte === 0).length;
  if (nullBytes > 10) {
    return buffer.toString('utf16le');
  }

  return buffer.toString('utf8');
}

function parseSections(content: string): SectionData[] {
  const sections: SectionData[] = [];
  let current: SectionData | undefined;

  for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = /^\[(.*)]$/.exec(line);
    if (sectionMatch) {
      current = {
        name: sectionMatch[1].trim(),
        values: new Map<string, string>(),
      };
      sections.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    const delimiterIndex = line.indexOf('=');
    if (delimiterIndex >= 0) {
      current.values.set(
        line.slice(0, delimiterIndex).trim().toLowerCase(),
        trimOuterQuotes(line.slice(delimiterIndex + 1).trim())
      );
    }
  }

  return sections;
}

function parseConnectionString(connection: string): Pick<RegisteredInfoBase, 'kind' | 'filePath' | 'server' | 'ref'> {
  const props = parseSemicolonProperties(connection);
  const filePath = findProperty(props, 'file');
  if (filePath) {
    return { kind: 'file', filePath };
  }

  const server = findProperty(props, 'srvr');
  const ref = findProperty(props, 'ref');
  if (server && ref) {
    return { kind: 'server', server, ref };
  }

  return { kind: 'unknown' };
}

function parseSemicolonProperties(value: string): Map<string, string> {
  const result = new Map<string, string>();
  let key = '';
  let current = '';
  let readingKey = true;
  let quoted = false;

  const flush = () => {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey) {
      result.set(normalizedKey, trimOuterQuotes(current.trim()));
    }
    key = '';
    current = '';
    readingKey = true;
  };

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (readingKey && char === '=') {
      key = current;
      current = '';
      readingKey = false;
      continue;
    }
    if (!quoted && char === ';') {
      flush();
      continue;
    }
    current += char;
  }

  flush();
  return result;
}

function findProperty(props: Map<string, string>, key: string): string | undefined {
  return props.get(key.toLowerCase());
}

function buildEnvConnection(connection: Pick<RegisteredInfoBase, 'kind' | 'filePath' | 'server' | 'ref'>): string {
  if (connection.kind === 'file' && connection.filePath) {
    return `/F${connection.filePath}`;
  }
  if (connection.kind === 'server' && connection.server && connection.ref) {
    return `/S${connection.server}/${connection.ref}`;
  }
  return '';
}

function splitConfigList(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ',') {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  result.push(current.trim());
  return result.map(trimOuterQuotes).filter(Boolean);
}

function resolveConfiguredPath(rawValue: string, cfgPath: string): string {
  const expanded = expandVariables(trimOuterQuotes(rawValue));
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return path.resolve(path.dirname(cfgPath), expanded);
}

function expandVariables(value: string): string {
  const home = os.homedir();
  return value
    .replace(/^~(?=$|[\\/])/, home)
    .replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? '')
    .replace(/\$\{([^}]+)}/g, (_, name: string) => process.env[name] ?? '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => process.env[name] ?? '');
}

function deduplicateBases(bases: RegisteredInfoBase[]): RegisteredInfoBase[] {
  const seen = new Set<string>();
  const result: RegisteredInfoBase[] = [];
  for (const base of bases) {
    const key = `${base.name}\n${base.connection}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(base);
  }
  return result;
}

function compareInfoBases(left: RegisteredInfoBase, right: RegisteredInfoBase): number {
  const orderDiff = (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
  if (orderDiff !== 0) {
    return orderDiff;
  }
  return left.name.localeCompare(right.name);
}

function trimOuterQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, '');
}

function formatReadWarning(filePath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${filePath}: ${message}`;
}
