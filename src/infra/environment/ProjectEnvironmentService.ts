import * as fs from 'fs';
import * as path from 'path';
import {
  InstalledOnecPlatform,
  scanInstalledOnecPlatforms,
} from '../process';
import {
  InfoBaseRegistryScanResult,
  InfoBaseRegistryService,
  RegisteredInfoBase,
} from './InfoBaseRegistryService';

export interface ProjectLaunchSettings {
  readonly ibConnection: string;
  readonly dbUser: string;
  readonly dbPassword: string;
  readonly platformPath: string;
  readonly v8Version: string;
}

export interface ProjectEnvironmentSnapshot {
  readonly envPath: string;
  readonly settings: ProjectLaunchSettings;
  readonly platforms: InstalledOnecPlatform[];
  readonly bases: RegisteredInfoBase[];
  readonly sources: string[];
  readonly warnings: string[];
}

export interface SaveProjectEnvironmentInput {
  readonly platformPath: string;
  readonly baseId: string;
  readonly dbUser: string;
  readonly dbPassword: string;
}

const DEFAULT_ENV = {
  $schema: 'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/develop/vanessa-runner-schema.json',
  default: {
    '--ibconnection': '',
    '--db-user': '',
    '--db-pwd': '',
    '--path': '',
    '--root': '.',
    '--workspace': '.',
    '--v8version': '',
    '--locale': 'ru',
    '--language': 'ru',
    '--additional': '/DisplayAllFunctions /Lru  /iTaxi /TESTMANAGER',
    '--ordinaryapp': '-1',
  },
} as const;

/**
 * Готовит снимок окружения запуска и сохраняет выбранную базу/платформу в `env.json`.
 */
export class ProjectEnvironmentService {
  private readonly infoBaseRegistry = new InfoBaseRegistryService();
  private registryCache: InfoBaseRegistryScanResult | undefined;
  private platformsCache: InstalledOnecPlatform[] | undefined;

  constructor(private readonly workspaceRoot: string) {}

  getInitialSnapshot(): ProjectEnvironmentSnapshot {
    const settings = this.readSettings();
    return {
      envPath: this.getEnvPath(),
      settings,
      platforms: ensureCurrentPlatformInList(this.platformsCache ?? [], settings.platformPath),
      bases: this.registryCache?.bases ?? [],
      sources: this.registryCache?.sources ?? [],
      warnings: this.registryCache?.warnings ?? [],
    };
  }

  getSnapshot(forceRefresh = false): ProjectEnvironmentSnapshot {
    const registry = this.getRegistry(forceRefresh);
    const settings = this.readSettings();
    const platforms = ensureCurrentPlatformInList(this.getPlatforms(forceRefresh), settings.platformPath);
    return {
      envPath: this.getEnvPath(),
      settings,
      platforms,
      bases: registry.bases,
      sources: registry.sources,
      warnings: registry.warnings,
    };
  }

  save(input: SaveProjectEnvironmentInput): ProjectEnvironmentSnapshot {
    let registry = this.getRegistry(false);
    let selectedBase = registry.bases.find((base) => base.id === input.baseId);
    if (!selectedBase) {
      registry = this.getRegistry(true);
      selectedBase = registry.bases.find((base) => base.id === input.baseId);
    }
    if (!selectedBase) {
      throw new Error('Выбранная информационная база не найдена в системном списке 1С.');
    }

    const env = this.readEnv();
    const defaults = getDefaultSection(env);
    const platforms = this.getPlatforms(false);
    const selectedPlatform = platforms.find(
      (platform) => platform.executablePath === input.platformPath
    );

    defaults['--path'] = input.platformPath;
    defaults['--v8version'] = selectedPlatform?.version ?? '';
    defaults['--ibconnection'] = selectedBase.connection;
    defaults['--db-user'] = input.dbUser;
    defaults['--db-pwd'] = input.dbPassword;
    env.default = defaults;
    this.writeEnv(env);

    return {
      envPath: this.getEnvPath(),
      settings: this.readSettings(),
      platforms: ensureCurrentPlatformInList(platforms, input.platformPath),
      bases: registry.bases,
      sources: registry.sources,
      warnings: registry.warnings,
    };
  }

  private getRegistry(forceRefresh: boolean): InfoBaseRegistryScanResult {
    if (!forceRefresh && this.registryCache) {
      return this.registryCache;
    }

    this.registryCache = this.infoBaseRegistry.scan();
    return this.registryCache;
  }

  private getPlatforms(forceRefresh: boolean): InstalledOnecPlatform[] {
    if (!forceRefresh && this.platformsCache) {
      return this.platformsCache;
    }

    this.platformsCache = scanInstalledOnecPlatforms();
    return this.platformsCache;
  }

  private getEnvPath(): string {
    return path.join(this.workspaceRoot, 'env.json');
  }

  private readSettings(): ProjectLaunchSettings {
    const defaults = getDefaultSection(this.readEnv());
    return {
      ibConnection: asString(defaults['--ibconnection']),
      dbUser: asString(defaults['--db-user']),
      dbPassword: asString(defaults['--db-pwd']),
      platformPath: asString(defaults['--path']),
      v8Version: asString(defaults['--v8version']),
    };
  }

  private readEnv(): Record<string, unknown> {
    const envPath = this.getEnvPath();
    if (!fs.existsSync(envPath)) {
      return structuredClone(DEFAULT_ENV) as Record<string, unknown>;
    }

    const raw = fs.readFileSync(envPath, 'utf-8').trim();
    if (!raw) {
      return structuredClone(DEFAULT_ENV) as Record<string, unknown>;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return structuredClone(DEFAULT_ENV) as Record<string, unknown>;
  }

  private writeEnv(env: Record<string, unknown>): void {
    const envPath = this.getEnvPath();
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, `${JSON.stringify(env, null, 2)}\n`, 'utf-8');
  }
}

function ensureCurrentPlatformInList(
  platforms: InstalledOnecPlatform[],
  platformPath: string
): InstalledOnecPlatform[] {
  if (!platformPath || platforms.some((platform) => platform.executablePath === platformPath)) {
    return platforms;
  }

  return [
    {
      executablePath: platformPath,
      version: '',
      label: `Из env.json: ${platformPath}`,
    },
    ...platforms,
  ];
}

function getDefaultSection(env: Record<string, unknown>): Record<string, unknown> {
  const defaults = env.default;
  if (isRecord(defaults)) {
    return defaults;
  }
  const created: Record<string, unknown> = {};
  env.default = created;
  return created;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type { InfoBaseRegistryScanResult, RegisteredInfoBase } from './InfoBaseRegistryService';
