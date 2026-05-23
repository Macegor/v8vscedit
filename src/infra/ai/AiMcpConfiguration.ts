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
    name: 'v8vscedit_workspace_overview',
    description: 'Быстрый обзор основной конфигурации и расширений: корни, имена, версии и счётчики объектов.',
    requirement: 'Загруженное дерево метаданных',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_search_metadata',
    description: 'Поиск по части строки в предметных путях метаданных выбранной конфигурации.',
    requirement: 'query и configuration из v8vscedit_workspace_overview; kind можно задавать по-русски',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_list_metadata',
    description: 'Список объектов группы или дочерних элементов по пути без nodeId.',
    requirement: 'При нескольких корнях обязательно configuration; kind/group можно задавать по-русски',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_configuration_info',
    description: 'Структурированный отчёт по CF/CFE: свойства, ChildObjects, роли по умолчанию.',
    requirement: 'Путь к Configuration.xml или каталогу выгрузки',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_configuration',
    description: 'Валидация Configuration.xml, ChildObjects и базовых enum-значений.',
    requirement: 'Путь к Configuration.xml или каталогу выгрузки',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_metadata_info',
    description: 'Структура объекта метаданных: реквизиты, табличные части, формы, команды и макеты.',
    requirement: 'Путь к XML-файлу объекта или каталогу объекта',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_metadata',
    description: 'Валидация XML объекта метаданных, дочерних элементов и связанных файлов.',
    requirement: 'Путь к XML-файлу объекта или каталогу объекта',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_subsystem_info',
    description: 'Сводка подсистемы: свойства, состав, дерево и CommandInterface.xml.',
    requirement: 'Путь к XML-файлу подсистемы или каталогу Subsystems',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_subsystem',
    description: 'Валидация XML подсистемы, Content, ChildObjects и CommandInterface.xml.',
    requirement: 'Путь к XML-файлу подсистемы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_subsystem',
    description: 'Создание подсистемы из JSON DSL с регистрацией в Configuration.xml или родительской подсистеме.',
    requirement: 'Корень выгрузки, definition с name; опционально parentPath',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_subsystem_content',
    description: 'Точечное добавление и удаление объектов из состава подсистемы (Content).',
    requirement: 'metadataPath подсистемы и add/remove со ссылками или предметными путями объектов',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_mxl_info',
    description: 'Анализ MXL-макета: области, параметры, текст, объединения и статистика.',
    requirement: 'Путь к Template.xml, каталогу макета или XML-описателю макета',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_mxl',
    description: 'Валидация Template.xml табличного документа.',
    requirement: 'Путь к Template.xml, каталогу макета или XML-описателю макета',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_mxl',
    description: 'Создание или перезапись содержимого существующего MXL Template.xml из JSON DSL.',
    requirement: 'Для нового макета сначала v8vscedit_add_metadata_by_path',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_decompile_mxl',
    description: 'Декомпиляция MXL Template.xml в редактируемый JSON DSL.',
    requirement: 'Путь к Template.xml, каталогу макета или XML-описателю макета',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_skd_info',
    description: 'Анализ СКД: наборы, запросы, поля, параметры, итоги и варианты.',
    requirement: 'Путь к Template.xml, каталогу макета или XML-описателю макета',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_skd',
    description: 'Валидация Template.xml схемы компоновки данных.',
    requirement: 'Путь к Template.xml, каталогу макета или XML-описателю макета',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_skd',
    description: 'Создание или перезапись содержимого существующей СКД Template.xml из JSON DSL.',
    requirement: 'Для новой СКД сначала v8vscedit_add_metadata_by_path',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_skd',
    description: 'Точечное редактирование СКД: поля, итоги, параметры, запросы, выборка, фильтры.',
    requirement: 'Путь к Template.xml, operation и value',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_add_help',
    description: 'Создание встроенной справки Ext/Help.xml и HTML-страницы для объекта метаданных.',
    requirement: 'Путь к XML объекта или каталогу объекта',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_create_epf',
    description: 'Создание XML-исходников внешней обработки EPF.',
    requirement: 'Имя и выходной каталог',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_create_erf',
    description: 'Создание XML-исходников внешнего отчёта ERF, опционально с основной СКД.',
    requirement: 'Имя, выходной каталог и флаг withSkd при необходимости',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_external_object',
    description: 'Валидация XML-исходников внешней обработки или отчёта.',
    requirement: 'Путь к корневому XML или каталогу внешнего объекта',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_epf_bsp_init',
    description: 'Добавление функции СведенияОВнешнейОбработке для регистрации в БСП.',
    requirement: 'Путь к внешней обработке/отчёту, вид обработки и назначение для назначаемых видов',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_epf_bsp_add_command',
    description: 'Добавление команды БСП и соответствующего обработчика.',
    requirement: 'Путь к внешней обработке/отчёту, идентификатор команды; для клиентского метода нужен модуль формы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_form_info',
    description: 'Анализ управляемой формы: элементы, реквизиты, команды и события.',
    requirement: 'Путь к Form.xml, XML-описателю формы или каталогу формы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_form',
    description: 'Валидация управляемой формы: ID, DataPath, команды, события, callType и типы.',
    requirement: 'Путь к Form.xml, XML-описателю формы или каталогу формы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_add_form',
    description: 'Создание формы объекта: метаданные, Form.xml, Module.bsl и регистрация в ChildObjects.',
    requirement: 'Путь к XML объекта, имя формы и назначение',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_remove_form',
    description: 'Удаление формы и очистка регистрации/default-ссылки в XML объекта.',
    requirement: 'Путь к XML объекта и имя формы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_form',
    description: 'Компиляция Form.xml из JSON DSL или по метаданным объекта.',
    requirement: 'OutputPath и definition или флаг fromObject',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_form',
    description: 'Точечное добавление элементов, реквизитов, команд и событий в Form.xml.',
    requirement: 'Путь к Form.xml и JSON definition',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_command_interface',
    description: 'Редактирование CommandInterface.xml: hide/show/place/order/subsystem-order/group-order.',
    requirement: 'Путь к CommandInterface.xml или каталогу подсистемы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_command_interface',
    description: 'Валидация CommandInterface.xml: разделы, порядок, дубли и форматы ссылок команд.',
    requirement: 'Путь к CommandInterface.xml или каталогу подсистемы',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_role_info',
    description: 'Сводка прав роли из Rights.xml: разрешённые права, RLS и шаблоны ограничений.',
    requirement: 'Путь к роли, Role.xml или Rights.xml',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_role',
    description: 'Валидация Rights.xml роли, метаданных роли и регистрации в Configuration.xml.',
    requirement: 'Путь к роли, Role.xml или Rights.xml',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_role',
    description: 'Создание роли из JSON DSL с регистрацией в Configuration.xml.',
    requirement: 'Корень выгрузки и definition с name/objects/templates',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_create_configuration',
    description: 'Создание пустого scaffold CF без Python-скрипта.',
    requirement: 'Имя и выходной каталог',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_create_extension',
    description: 'Создание scaffold CFE с языком и опциональной основной ролью.',
    requirement: 'Имя, выходной каталог; желательно путь к базовой CF',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_get_properties',
    description: 'Все свойства объекта по предметному пути с текущими значениями и допустимыми enum/multiEnum-значениями.',
    requirement: 'metadataPath',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_set_property_by_path',
    description: 'Изменение простого свойства объекта по предметному пути с проверками панели свойств.',
    requirement: 'metadataPath, propertyKey, value',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_list_available_types',
    description: 'Список доступных типов 1С с русским value для передачи в set_type; для CFE включает только собственные и заимствованные объекты.',
    requirement: 'Перед ссылочным типом вызывать с тем же metadataPath и propertyKey; propertyKey можно "Тип"',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_set_type',
    description: 'Изменение свойства "Тип"/"Источник"/"Тип параметра команды" по предметному пути, включая длину и точность.',
    requirement: 'Ссылочные типы брать из v8vscedit_list_available_types; для числа можно указать length/digits и precision/fractionDigits',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_rename_metadata',
    description: 'Переименование объекта или дочернего элемента по предметному пути через общий XML-сервис.',
    requirement: 'metadataPath и newName',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_add_metadata_by_path',
    description: 'Добавление объекта, реквизита, табличной части, колонки, формы, команды или макета по предметному пути.',
    requirement: 'path; для табличной части используй сегмент "ТабличныеЧасти"; childTag и templateType можно задавать по-русски',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_remove_metadata',
    description: 'Удаление объекта или дочернего элемента через общий сервис удаления метаданных.',
    requirement: 'metadataPath и configuration; XML/каталоги вручную не удалять',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_cfe_borrow',
    description: 'Заимствование объекта, формы или дочернего элемента из CF в CFE.',
    requirement: 'Пути к CF/CFE и ссылка на объект метаданных',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_cfe_patch_method',
    description: 'Создание BSL-перехватчика метода в модуле расширения CFE.',
    requirement: 'Путь расширения, ModulePath и имя оригинального метода',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_cfe_diff',
    description: 'Анализ состава CFE, перехватчиков и проверки переноса блоков #Вставка.',
    requirement: 'Путь расширения; для режима transfer также путь CF',
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
