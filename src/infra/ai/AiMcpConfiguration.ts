export type AiMcpProfile = 'reference' | 'workspace';
export type AiMcpProcessState = 'disabled' | 'running' | 'stopped' | 'error';

export interface AiMcpSettings {
  readonly extensionAutoStart: boolean;
  readonly extensionHost: string;
  readonly extensionPort: number;
  readonly bslAnalyzerAutoStart: boolean;
  readonly bslAnalyzerReferenceEnabled: boolean;
  readonly bslAnalyzerWorkspaceEnabled: boolean;
  readonly bslAnalyzerWorkspaceSourceDir: string;
  readonly bslAnalyzerEmbeddingUrl: string;
  readonly bslAnalyzerEmbeddingApiKey: string;
  readonly bslAnalyzerEmbeddingModel: string;
  readonly bslAnalyzerNaparnikToken: string;
  readonly bslAnalyzerOnecUrl: string;
  readonly bslAnalyzerOnecUser: string;
  readonly bslAnalyzerOnecPassword: string;
}

export interface AiMcpToolInfo {
  readonly profile: AiMcpProfile | 'extension';
  readonly name: string;
  readonly description: string;
  readonly requirement: string;
}

export const EXTENSION_MCP_TOOLS: readonly AiMcpToolInfo[] = [
  {
    profile: 'extension',
    name: 'v8vscedit_list_configurations',
    description: 'Список найденных корней CF/CFE после загрузки дерева метаданных.',
    requirement: 'Загруженный проект с XML-выгрузкой 1С',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_list_metadata_types',
    description: 'Декларативный реестр META_TYPES: типы, папки, дочерние элементы и слоты модулей.',
    requirement: 'Не требует дополнительных настроек',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_list_metadata_nodes',
    description: 'Поиск узлов основной панели метаданных и выдача nodeId для последующих инструментов.',
    requirement: 'Загруженное дерево метаданных',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_get_property_contract',
    description: 'Контракт свойства узла: тип значения, текущее значение и допустимые enum-значения.',
    requirement: 'nodeId и ключ свойства',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_set_property',
    description: 'Изменение простого свойства после проверки контракта.',
    requirement: 'Сначала получить контракт свойства',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_add_metadata',
    description: 'Добавление объекта или дочернего элемента через общий сервис UI-команды.',
    requirement: 'Узел, поддерживающий добавление метаданных',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_execute_command',
    description: 'Безопасный мост к разрешённым командам refresh, importConfigurations, updateChangedConfigurations.',
    requirement: 'Команда должна быть в allowlist расширения',
  },
];

export const BSL_ANALYZER_MCP_TOOLS: readonly AiMcpToolInfo[] = [
  {
    profile: 'reference',
    name: 'search',
    description: 'Поиск по справке платформы: find_docs, search_docs, status.',
    requirement: 'EMBEDDING_URL нужен только для search_docs',
  },
  {
    profile: 'reference',
    name: 'syntax_help',
    description: 'Точечная справка по типу, методу или глобальной функции.',
    requirement: 'Не требует дополнительных настроек',
  },
  {
    profile: 'reference',
    name: 'its_help',
    description: 'Вопросы к ИТС / 1С:Напарник по стандартам, БСП и методическим рекомендациям.',
    requirement: 'NAPARNIK_TOKEN',
  },
  {
    profile: 'workspace',
    name: 'metadata',
    description: 'Обзор объектов конфигурации, реквизитов, форм и дерева метаданных.',
    requirement: '--source-dir',
  },
  {
    profile: 'workspace',
    name: 'search',
    description: 'Поиск по коду проекта: find_code, search_code, status.',
    requirement: 'EMBEDDING_URL нужен только для search_code',
  },
  {
    profile: 'workspace',
    name: 'query',
    description: 'validate для SDBL и execute для SELECT.',
    requirement: '--onec-url нужен для live-валидации через платформу и execute',
  },
  {
    profile: 'workspace',
    name: 'execute',
    description: 'check, run и eval для BSL-кода.',
    requirement: '--onec-url нужен для run и eval',
  },
  {
    profile: 'workspace',
    name: 'debug',
    description: 'Attach, breakpoints, step, stack trace, locals и eval.',
    requirement: '--onec-url и доступ к отладочному контуру',
  },
];

export function createDefaultAiMcpSettings(workspaceRoot: string): AiMcpSettings {
  return {
    extensionAutoStart: true,
    extensionHost: '127.0.0.1',
    extensionPort: 38481,
    bslAnalyzerAutoStart: false,
    bslAnalyzerReferenceEnabled: true,
    bslAnalyzerWorkspaceEnabled: true,
    bslAnalyzerWorkspaceSourceDir: workspaceRoot,
    bslAnalyzerEmbeddingUrl: '',
    bslAnalyzerEmbeddingApiKey: '',
    bslAnalyzerEmbeddingModel: 'qwen/qwen3-embedding-0.6b',
    bslAnalyzerNaparnikToken: '',
    bslAnalyzerOnecUrl: '',
    bslAnalyzerOnecUser: '',
    bslAnalyzerOnecPassword: '',
  };
}

export function normalizeAiMcpSettings(
  value: Partial<AiMcpSettings>,
  workspaceRoot: string
): AiMcpSettings {
  const defaults = createDefaultAiMcpSettings(workspaceRoot);
  const extensionHost = normalizeLoopbackHost(value.extensionHost, defaults.extensionHost);
  const extensionPort = normalizePort(value.extensionPort, defaults.extensionPort);
  return {
    extensionAutoStart: value.extensionAutoStart ?? defaults.extensionAutoStart,
    extensionHost,
    extensionPort,
    bslAnalyzerAutoStart: value.bslAnalyzerAutoStart ?? defaults.bslAnalyzerAutoStart,
    bslAnalyzerReferenceEnabled: value.bslAnalyzerReferenceEnabled ?? defaults.bslAnalyzerReferenceEnabled,
    bslAnalyzerWorkspaceEnabled: value.bslAnalyzerWorkspaceEnabled ?? defaults.bslAnalyzerWorkspaceEnabled,
    bslAnalyzerWorkspaceSourceDir: nonEmpty(value.bslAnalyzerWorkspaceSourceDir, defaults.bslAnalyzerWorkspaceSourceDir),
    bslAnalyzerEmbeddingUrl: value.bslAnalyzerEmbeddingUrl?.trim() ?? defaults.bslAnalyzerEmbeddingUrl,
    bslAnalyzerEmbeddingApiKey: value.bslAnalyzerEmbeddingApiKey?.trim() ?? defaults.bslAnalyzerEmbeddingApiKey,
    bslAnalyzerEmbeddingModel: nonEmpty(value.bslAnalyzerEmbeddingModel, defaults.bslAnalyzerEmbeddingModel),
    bslAnalyzerNaparnikToken: value.bslAnalyzerNaparnikToken?.trim() ?? defaults.bslAnalyzerNaparnikToken,
    bslAnalyzerOnecUrl: value.bslAnalyzerOnecUrl?.trim() ?? defaults.bslAnalyzerOnecUrl,
    bslAnalyzerOnecUser: value.bslAnalyzerOnecUser?.trim() ?? defaults.bslAnalyzerOnecUser,
    bslAnalyzerOnecPassword: value.bslAnalyzerOnecPassword ?? defaults.bslAnalyzerOnecPassword,
  };
}

export function getEnabledBslAnalyzerProfiles(settings: AiMcpSettings): AiMcpProfile[] {
  const profiles: AiMcpProfile[] = [];
  if (settings.bslAnalyzerReferenceEnabled) {
    profiles.push('reference');
  }
  if (settings.bslAnalyzerWorkspaceEnabled) {
    profiles.push('workspace');
  }
  return profiles;
}

export function buildBslAnalyzerMcpArgs(profile: AiMcpProfile, settings: AiMcpSettings): string[] {
  const args = ['mcp', 'serve', '--profile', profile];
  if (profile === 'workspace') {
    args.push('--source-dir', settings.bslAnalyzerWorkspaceSourceDir);
    appendOption(args, '--onec-url', settings.bslAnalyzerOnecUrl);
    appendOption(args, '--onec-user', settings.bslAnalyzerOnecUser);
    appendOption(args, '--onec-password', settings.bslAnalyzerOnecPassword);
  }
  return args;
}

export function buildBslAnalyzerMcpEnv(
  settings: AiMcpSettings,
  baseEnv: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: baseEnv.PATH,
    HOME: baseEnv.HOME,
    LANG: baseEnv.LANG,
    LC_ALL: baseEnv.LC_ALL,
  };
  appendEnv(env, 'EMBEDDING_URL', settings.bslAnalyzerEmbeddingUrl);
  appendEnv(env, 'EMBEDDING_API_KEY', settings.bslAnalyzerEmbeddingApiKey);
  appendEnv(env, 'EMBEDDING_MODEL', settings.bslAnalyzerEmbeddingModel);
  appendEnv(env, 'NAPARNIK_TOKEN', settings.bslAnalyzerNaparnikToken);
  return removeUndefinedEnv(env);
}

function normalizeLoopbackHost(value: string | undefined, fallback: string): string {
  const host = value?.trim();
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return host;
  }
  return fallback;
}

function normalizePort(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  return fallback;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  return fallback;
}

function appendOption(args: string[], name: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    args.push(name, trimmed);
  }
}

function appendEnv(env: NodeJS.ProcessEnv, name: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    env[name] = trimmed;
  }
}

function removeUndefinedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'));
}
