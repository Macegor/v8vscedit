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

/**
 * Снимок настроек для webview без сырых секретов. Реальные значения
 * ключей/токена/пароля остаются только на стороне расширения, наружу
 * уходит лишь признак «задано/не задано», чтобы UI мог показать маску.
 * Любая XSS/инъекция в webview не должна получить доступ к секретам.
 */
export interface AiMcpRedactedSettings {
  readonly extensionAutoStart: boolean;
  readonly extensionHost: string;
  readonly extensionPort: number;
  readonly bslAnalyzerAutoStart: boolean;
  readonly bslAnalyzerReferenceEnabled: boolean;
  readonly bslAnalyzerWorkspaceEnabled: boolean;
  readonly bslAnalyzerWorkspaceSourceDir: string;
  readonly bslAnalyzerEmbeddingUrl: string;
  readonly bslAnalyzerEmbeddingApiKeySet: boolean;
  readonly bslAnalyzerEmbeddingModel: string;
  readonly bslAnalyzerNaparnikTokenSet: boolean;
  readonly bslAnalyzerOnecUrl: string;
  readonly bslAnalyzerOnecUser: string;
  readonly bslAnalyzerOnecPasswordSet: boolean;
}

/**
 * Полезная нагрузка сохранения из webview: несекретные поля приходят всегда,
 * секреты — только если пользователь реально ввёл новое значение. Пустой/
 * отсутствующий секрет означает «не менять» и не затирает сохранённое.
 */
export type AiMcpSaveSettings = Omit<
  AiMcpSettings,
  'bslAnalyzerEmbeddingApiKey' | 'bslAnalyzerNaparnikToken' | 'bslAnalyzerOnecPassword'
> & {
  readonly bslAnalyzerEmbeddingApiKey?: string;
  readonly bslAnalyzerNaparnikToken?: string;
  readonly bslAnalyzerOnecPassword?: string;
};

export interface AiMcpToolInfo {
  readonly profile: AiMcpProfile | 'extension';
  readonly name: string;
  readonly description: string;
  readonly requirement: string;
}

export const EXTENSION_MCP_TOOLS: readonly AiMcpToolInfo[] = [
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
    name: 'v8vscedit_tree',
    description: 'Плоский список канонических путей метаданных без свойств, с фильтрами scope/depth/include.',
    requirement: 'При нескольких корнях обязательно configuration; limit до 50000',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_resolve_path',
    description: 'Нормализует канонический путь и проверяет наличие узла в дереве; невалидный синтаксис — ошибка, валидный без узла — exists=false.',
    requirement: 'Принимает только канонические русские пути; английские/legacy формы отвергаются',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_list_supported_types',
    description: 'Реестр платформенных типов с фильтром по контексту (metadataAttribute/formAttribute/commandParameter/eventSource).',
    requirement: 'configuration нужен только для ссылочных групп; базовые типы доступны и без неё',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_configuration_info',
    description: 'Структурированный отчёт по CF/CFE: свойства, ChildObjects, роли по умолчанию.',
    requirement: 'path = "Конфигурация" или "Расширение"',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_configuration',
    description: 'Валидация Configuration.xml, ChildObjects и базовых enum-значений.',
    requirement: 'path = "Конфигурация" или "Расширение"',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_metadata_info',
    description: 'Структура объекта метаданных: реквизиты, табличные части, формы, команды и макеты.',
    requirement: 'Канонический путь объекта (Справочники.Контрагенты)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_metadata',
    description: 'Валидация XML объекта метаданных, дочерних элементов и связанных файлов.',
    requirement: 'Канонический путь объекта (path) или массив путей (paths)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_subsystem_info',
    description: 'Сводка подсистемы: свойства, состав, дерево и CommandInterface.xml.',
    requirement: 'Канонический путь подсистемы (Подсистема.Продажи.Розница)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_subsystem',
    description: 'Валидация XML подсистемы, Content, ChildObjects и CommandInterface.xml.',
    requirement: 'Канонический путь подсистемы (Подсистема.Продажи.Розница)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_subsystem',
    description: 'Создание подсистемы из JSON DSL с регистрацией в Configuration.xml или родительской подсистеме.',
    requirement: 'parentPath = "Конфигурация" (по умолчанию) или Подсистема.X; definition с name',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_subsystem_content',
    description: 'Точечное добавление и удаление объектов из состава подсистемы (Content).',
    requirement: 'path подсистемы и add/remove с каноническими путями объектов',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_mxl_info',
    description: 'Анализ MXL-макета: области, параметры, текст, объединения и статистика.',
    requirement: 'Канонический путь макета (Справочники.X.Макет.Y или ОбщиеМакеты.X)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_mxl',
    description: 'Валидация Template.xml табличного документа.',
    requirement: 'Канонический путь макета (Справочники.X.Макет.Y или ОбщиеМакеты.X)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_mxl',
    description: 'Перезапись содержимого существующего MXL Template.xml из JSON DSL.',
    requirement: 'Канонический путь существующего макета; для нового — сначала v8vscedit_add_template с templateType="Табличный документ"',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_decompile_mxl',
    description: 'Декомпиляция MXL Template.xml в редактируемый JSON DSL.',
    requirement: 'Канонический путь макета',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_skd_info',
    description: 'Анализ СКД: наборы, запросы, поля, параметры, итоги и варианты.',
    requirement: 'Канонический путь макета СКД (Отчеты.X.Макет.ОсновнаяСхема)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_skd',
    description: 'Валидация Template.xml схемы компоновки данных.',
    requirement: 'Канонический путь макета СКД',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_skd',
    description: 'Перезапись содержимого существующей СКД Template.xml из JSON DSL.',
    requirement: 'Канонический путь существующей СКД; для новой — сначала v8vscedit_add_template с templateType="Схема компоновки данных"',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_skd',
    description: 'Точечное редактирование СКД: поля, итоги, параметры, запросы, выборка, фильтры.',
    requirement: 'Канонический путь макета СКД, operation и value',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_add_help',
    description: 'Создание встроенной справки Ext/Help.xml и HTML-страницы для объекта метаданных.',
    requirement: 'Канонический путь объекта (Справочники.Контрагенты)',
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
    requirement: 'Канонический путь формы (Справочники.X.Форма.Y или ОбщиеФормы.X)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_form',
    description: 'Валидация управляемой формы: ID, DataPath, команды, события, callType и типы.',
    requirement: 'Канонический путь формы (Справочники.X.Форма.Y или ОбщиеФормы.X)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_add_form',
    description: 'Создание формы объекта: метаданные, Form.xml, Module.bsl и регистрация в ChildObjects.',
    requirement: 'parentPath канонический путь объекта-владельца, name имени формы и purpose назначение',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_remove_form',
    description: 'Удаление формы и очистка регистрации/default-ссылки в XML объекта.',
    requirement: 'Канонический путь формы (Справочники.X.Форма.Y)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_form',
    description: 'Перезапись Form.xml из JSON DSL или по метаданным объекта.',
    requirement: 'Канонический путь существующей формы; definition или флаг fromObject',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_form',
    description: 'Точечное добавление элементов, реквизитов, команд и событий в Form.xml.',
    requirement: 'Канонический путь формы и JSON definition',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_edit_command_interface',
    description: 'Редактирование CommandInterface.xml: hide/show/place/order/subsystem-order/group-order.',
    requirement: 'Канонический путь подсистемы (Подсистема.Продажи.Розница)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_command_interface',
    description: 'Валидация CommandInterface.xml: разделы, порядок, дубли и форматы ссылок команд.',
    requirement: 'Канонический путь подсистемы (Подсистема.Продажи.Розница)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_role_info',
    description: 'Сводка прав роли из Rights.xml: разрешённые права, RLS и шаблоны ограничений.',
    requirement: 'Канонический путь роли (Роли.БазовыеПрава)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_validate_role',
    description: 'Валидация Rights.xml роли, метаданных роли и регистрации в Configuration.xml.',
    requirement: 'Канонический путь роли (Роли.БазовыеПрава)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_compile_role',
    description: 'Создание роли из JSON DSL с регистрацией в Configuration.xml.',
    requirement: 'parentPath = "Конфигурация" (по умолчанию) или "Расширение"; definition с name/objects/templates',
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
    description: 'ВСЕ свойства объекта по каноническому пути, включая readonly, со всеми допустимыми enum/multiEnum-значениями; для metadataType-свойств в notes указано, каким tool менять значение.',
    requirement: 'Канонический путь (path)',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_set_property_by_path',
    description: 'Изменение простого свойства объекта по каноническому пути с проверками панели свойств.',
    requirement: 'path, propertyKey, value',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_set_properties',
    description: 'Пакетная смена нескольких простых свойств одного узла за один вызов; возвращает applied/failed и единый changedFiles. Типы (Type/Source/CommandParameterType) — через v8vscedit_set_type.',
    requirement: 'path и объект properties = { propertyKey: value, ... }',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_list_available_types',
    description: 'Список доступных типов 1С с русским value для передачи в set_type; для CFE включает только собственные и заимствованные объекты.',
    requirement: 'Перед ссылочным типом вызывать с тем же path и propertyKey',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_set_type',
    description: 'Изменение свойства Тип/Источник/Тип параметра команды по каноническому пути, включая длину и точность.',
    requirement: 'Ссылочные типы брать из v8vscedit_list_available_types',
  },
  {
    profile: 'extension',
    name: 'v8vscedit_rename_metadata',
    description: 'Переименование объекта или дочернего элемента по каноническому пути через общий XML-сервис.',
    requirement: 'path и newName',
  },
  // ── Декомпозированные tools добавления (E8) — корневые типы ─────────────
  // Каждый tool — тонкая обёртка над MetadataMutationService.addMetadata
  // с фиксированным targetKind, чтобы агент не угадывал childTag/templateType.
  { profile: 'extension', name: 'v8vscedit_add_subsystem',
    description: 'Создаёт подсистему первого уровня; вложенные — через v8vscedit_compile_subsystem.',
    requirement: 'name; configuration при нескольких корнях' },
  { profile: 'extension', name: 'v8vscedit_add_common_module',
    description: 'Создаёт общий модуль.',
    requirement: 'name; configuration при нескольких корнях' },
  { profile: 'extension', name: 'v8vscedit_add_session_parameter',
    description: 'Создаёт параметр сеанса.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_role',
    description: 'Создаёт роль с пустым Rights.xml; права назначай через v8vscedit_edit_role.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_common_attribute',
    description: 'Создаёт общий реквизит.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_exchange_plan',
    description: 'Создаёт план обмена.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_filter_criterion',
    description: 'Создаёт критерий отбора.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_event_subscription',
    description: 'Создаёт подписку на событие.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_scheduled_job',
    description: 'Создаёт регламентное задание.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_functional_option',
    description: 'Создаёт функциональную опцию.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_functional_options_parameter',
    description: 'Создаёт параметр функциональных опций.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_defined_type',
    description: 'Создаёт определяемый тип.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_settings_storage',
    description: 'Создаёт хранилище настроек.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_common_form',
    description: 'Создаёт общую форму (Form.xml + Module.bsl).',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_common_command',
    description: 'Создаёт общую команду.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_command_group',
    description: 'Создаёт группу команд.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_common_template',
    description: 'Создаёт общий макет; templateType — тип содержимого.',
    requirement: 'name; templateType по умолчанию SpreadsheetDocument' },
  { profile: 'extension', name: 'v8vscedit_add_common_picture',
    description: 'Создаёт общую картинку.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_xdto_package',
    description: 'Создаёт XDTO-пакет.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_web_service',
    description: 'Создаёт Web-сервис (SOAP).',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_http_service',
    description: 'Создаёт HTTP-сервис.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_ws_reference',
    description: 'Создаёт WS-ссылку.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_integration_service',
    description: 'Создаёт сервис интеграции.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_style_item',
    description: 'Создаёт элемент стиля.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_style',
    description: 'Создаёт стиль.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_language',
    description: 'Создаёт язык.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_constant',
    description: 'Создаёт константу.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_catalog',
    description: 'Создаёт справочник с базовыми обязательными свойствами.',
    requirement: 'name; configuration при нескольких корнях' },
  { profile: 'extension', name: 'v8vscedit_add_document',
    description: 'Создаёт документ.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_document_journal',
    description: 'Создаёт журнал документов.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_document_numerator',
    description: 'Создаёт нумератор документов.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_sequence',
    description: 'Создаёт последовательность документов.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_enum',
    description: 'Создаёт перечисление; значения — через v8vscedit_add_enum_value.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_report',
    description: 'Создаёт отчёт.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_data_processor',
    description: 'Создаёт обработку.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_chart_of_characteristic_types',
    description: 'Создаёт план видов характеристик.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_chart_of_accounts',
    description: 'Создаёт план счетов.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_chart_of_calculation_types',
    description: 'Создаёт план видов расчёта.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_information_register',
    description: 'Создаёт регистр сведений; измерения/ресурсы — отдельными tools.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_accumulation_register',
    description: 'Создаёт регистр накопления.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_accounting_register',
    description: 'Создаёт регистр бухгалтерии.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_calculation_register',
    description: 'Создаёт регистр расчёта.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_business_process',
    description: 'Создаёт бизнес-процесс с пустым Flowchart.xml.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_task',
    description: 'Создаёт задачу; реквизиты адресации — через v8vscedit_add_addressing_attribute.',
    requirement: 'name' },
  { profile: 'extension', name: 'v8vscedit_add_external_data_source',
    description: 'Создаёт внешний источник данных.',
    requirement: 'name' },
  // ── Декомпозированные tools добавления (E8) — дочерние элементы ────────
  { profile: 'extension', name: 'v8vscedit_add_attribute',
    description: 'Добавляет реквизит объекту метаданных (Справочник/Документ/Регистр/…).',
    requirement: 'path к объекту-владельцу, name' },
  { profile: 'extension', name: 'v8vscedit_add_addressing_attribute',
    description: 'Добавляет реквизит адресации к задаче.',
    requirement: 'path к задаче, name' },
  { profile: 'extension', name: 'v8vscedit_add_tabular_section',
    description: 'Добавляет табличную часть к объекту метаданных.',
    requirement: 'path к объекту-владельцу, name' },
  { profile: 'extension', name: 'v8vscedit_add_command',
    description: 'Добавляет команду к объекту метаданных.',
    requirement: 'path к объекту-владельцу, name' },
  { profile: 'extension', name: 'v8vscedit_add_template',
    description: 'Добавляет макет к объекту; templateType — тип содержимого.',
    requirement: 'path к объекту-владельцу, name; templateType по умолчанию SpreadsheetDocument' },
  { profile: 'extension', name: 'v8vscedit_add_dimension',
    description: 'Добавляет измерение в регистр сведений/накопления/бухгалтерии/расчёта.',
    requirement: 'path к регистру, name' },
  { profile: 'extension', name: 'v8vscedit_add_resource',
    description: 'Добавляет ресурс в регистр сведений/накопления/бухгалтерии/расчёта.',
    requirement: 'path к регистру, name' },
  { profile: 'extension', name: 'v8vscedit_add_enum_value',
    description: 'Добавляет значение перечисления.',
    requirement: 'path к перечислению, name' },
  { profile: 'extension', name: 'v8vscedit_add_column',
    description: 'Добавляет колонку (реквизит) к табличной части.',
    requirement: 'path к табличной части (Справочники.X.КонтактныеЛица), name' },
  { profile: 'extension', name: 'v8vscedit_add_url_template',
    description: 'Добавляет URL-шаблон к HTTP-сервису.',
    requirement: 'path к HTTP-сервису (HTTPСервисы.X), name' },
  { profile: 'extension', name: 'v8vscedit_add_method',
    description: 'Добавляет метод к URL-шаблону HTTP-сервиса.',
    requirement: 'path к URL-шаблону (HTTPСервисы.X.URLШаблон.Y), name' },
  {
    profile: 'extension',
    name: 'v8vscedit_remove_metadata',
    description: 'Удаление объекта или дочернего элемента через общий сервис удаления метаданных.',
    requirement: 'Канонический путь (path); XML/каталоги вручную не удалять',
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
    requirement: 'extensionPath, path канонического модуля (Справочники.X.МодульОбъекта) и имя метода',
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

/** Готовит снимок настроек для webview, заменяя секреты признаком «задано». */
export function redactAiMcpSettings(settings: AiMcpSettings): AiMcpRedactedSettings {
  return {
    extensionAutoStart: settings.extensionAutoStart,
    extensionHost: settings.extensionHost,
    extensionPort: settings.extensionPort,
    bslAnalyzerAutoStart: settings.bslAnalyzerAutoStart,
    bslAnalyzerReferenceEnabled: settings.bslAnalyzerReferenceEnabled,
    bslAnalyzerWorkspaceEnabled: settings.bslAnalyzerWorkspaceEnabled,
    bslAnalyzerWorkspaceSourceDir: settings.bslAnalyzerWorkspaceSourceDir,
    bslAnalyzerEmbeddingUrl: settings.bslAnalyzerEmbeddingUrl,
    bslAnalyzerEmbeddingApiKeySet: settings.bslAnalyzerEmbeddingApiKey.trim().length > 0,
    bslAnalyzerEmbeddingModel: settings.bslAnalyzerEmbeddingModel,
    bslAnalyzerNaparnikTokenSet: settings.bslAnalyzerNaparnikToken.trim().length > 0,
    bslAnalyzerOnecUrl: settings.bslAnalyzerOnecUrl,
    bslAnalyzerOnecUser: settings.bslAnalyzerOnecUser,
    bslAnalyzerOnecPasswordSet: settings.bslAnalyzerOnecPassword.trim().length > 0,
  };
}

/**
 * Заменяет в настройках сырые секреты на маску для путей, ведущих в webview
 * (например commandLine со статусом). Несекретные значения не меняются.
 */
export function maskAiMcpSecrets(settings: AiMcpSettings, mask: string): AiMcpSettings {
  return {
    ...settings,
    bslAnalyzerEmbeddingApiKey: settings.bslAnalyzerEmbeddingApiKey.trim() ? mask : '',
    bslAnalyzerNaparnikToken: settings.bslAnalyzerNaparnikToken.trim() ? mask : '',
    bslAnalyzerOnecPassword: settings.bslAnalyzerOnecPassword.trim() ? mask : '',
  };
}

/**
 * Сливает полезную нагрузку сохранения с уже сохранёнными настройками:
 * секрет берётся из payload только при непустом значении, иначе остаётся
 * прежний. Так пустой ввод не затирает сохранённый секрет.
 */
export function mergeAiMcpSaveSettings(
  current: AiMcpSettings,
  incoming: AiMcpSaveSettings
): AiMcpSettings {
  return {
    extensionAutoStart: incoming.extensionAutoStart,
    extensionHost: incoming.extensionHost,
    extensionPort: incoming.extensionPort,
    bslAnalyzerAutoStart: incoming.bslAnalyzerAutoStart,
    bslAnalyzerReferenceEnabled: incoming.bslAnalyzerReferenceEnabled,
    bslAnalyzerWorkspaceEnabled: incoming.bslAnalyzerWorkspaceEnabled,
    bslAnalyzerWorkspaceSourceDir: incoming.bslAnalyzerWorkspaceSourceDir,
    bslAnalyzerEmbeddingUrl: incoming.bslAnalyzerEmbeddingUrl,
    bslAnalyzerEmbeddingApiKey: pickSecret(incoming.bslAnalyzerEmbeddingApiKey, current.bslAnalyzerEmbeddingApiKey),
    bslAnalyzerEmbeddingModel: incoming.bslAnalyzerEmbeddingModel,
    bslAnalyzerNaparnikToken: pickSecret(incoming.bslAnalyzerNaparnikToken, current.bslAnalyzerNaparnikToken),
    bslAnalyzerOnecUrl: incoming.bslAnalyzerOnecUrl,
    bslAnalyzerOnecUser: incoming.bslAnalyzerOnecUser,
    bslAnalyzerOnecPassword: pickSecret(incoming.bslAnalyzerOnecPassword, current.bslAnalyzerOnecPassword),
  };
}

function pickSecret(incoming: string | undefined, current: string): string {
  const trimmed = incoming?.trim();
  if (trimmed) {
    return trimmed;
  }
  return current;
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
