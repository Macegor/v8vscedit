/**
 * Регистрация MCP-инструментов добавления метаданных.
 *
 * Декомпозиция бывшего `v8vscedit_add_metadata_by_path` на отдельные tools:
 *  - один tool на каждый корневой `MetaKind` (`v8vscedit_add_catalog`,
 *    `v8vscedit_add_document`, …);
 *  - один tool на каждый дочерний `ChildTag` (`v8vscedit_add_attribute`,
 *    `v8vscedit_add_dimension`, `v8vscedit_add_column`, …).
 *
 * Цель: агент видит в каталоге tools «v8vscedit_add_catalog» и сразу понимает,
 * что и куда он добавляет, не размышляя про `childTag`/`templateType`/`path`.
 *
 * Регистрация устроена фабриками `registerAddRootTool`/`registerAddChildTool` —
 * каждая регистрация — тонкая обёртка над `MetadataMutationService.addMetadata`,
 * без дублирующего кода и без новой бизнес-логики.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as z from 'zod/v4';
import type { ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import type { TemplateType } from '../../infra/xml';
import type { MetadataMutationService } from '../commands/metadata/MetadataMutationService';
import type { McpMetadataPathService } from './McpMetadataPathService';

/**
 * Поддерживаемые типы макетов для `v8vscedit_add_template`/`v8vscedit_add_common_template`.
 * Совпадает с `TemplateType` в `infra/xml/MetadataXmlCreator.ts`.
 */
const TEMPLATE_TYPES = [
  'SpreadsheetDocument',
  'TextDocument',
  'HTMLDocument',
  'BinaryData',
  'DataCompositionSchema',
  'DataCompositionAppearanceTemplate',
  'GraphicalSchema',
  'AddIn',
] as const;

/** Алиасы русских/английских имён типов макета для удобного ввода. */
const TEMPLATE_TYPE_ALIASES: Readonly<Record<string, TemplateType>> = {
  'spreadsheetdocument': 'SpreadsheetDocument',
  'табличныйдокумент': 'SpreadsheetDocument',
  'mxl': 'SpreadsheetDocument',
  'datacompositionschema': 'DataCompositionSchema',
  'схемакомпоновкиданных': 'DataCompositionSchema',
  'скд': 'DataCompositionSchema',
  'textdocument': 'TextDocument',
  'текстовыйдокумент': 'TextDocument',
  'текст': 'TextDocument',
  'htmldocument': 'HTMLDocument',
  'htmlдокумент': 'HTMLDocument',
  'binarydata': 'BinaryData',
  'двоичныеданные': 'BinaryData',
  'datacompositionappearancetemplate': 'DataCompositionAppearanceTemplate',
  'макетоформлениякомпоновкиданных': 'DataCompositionAppearanceTemplate',
  'graphicalschema': 'GraphicalSchema',
  'графическаясхема': 'GraphicalSchema',
  'addin': 'AddIn',
  'внешняякомпонента': 'AddIn',
};

/**
 * Список корневых типов метаданных, для которых регистрируется отдельный tool.
 * Включает только типы из таблицы §1.1 канона: `group ∈ {common, top, documents-branch}`
 * и наличие `folder`. Из общего списка исключены `Bot`/`WebSocketClient`/`Interface`/
 * `PaletteColor` — у платформы их XML-структура отличается от того, что умеет
 * `MetadataXmlCreator.addRootObject`, и они не входят в каноническую таблицу путей.
 */
export const ROOT_ADD_KINDS: readonly MetaKind[] = [
  // group: common
  'Subsystem',
  'CommonModule',
  'SessionParameter',
  'Role',
  'CommonAttribute',
  'ExchangePlan',
  'FilterCriterion',
  'EventSubscription',
  'ScheduledJob',
  'FunctionalOption',
  'FunctionalOptionsParameter',
  'DefinedType',
  'SettingsStorage',
  'CommonCommand',
  'CommandGroup',
  'CommonForm',
  'CommonTemplate',
  'CommonPicture',
  'XDTOPackage',
  'WebService',
  'HTTPService',
  'WSReference',
  'IntegrationService',
  'StyleItem',
  'Style',
  'Language',
  // group: top
  'Constant',
  'Catalog',
  'Document',
  'DocumentJournal',
  'Enum',
  'Report',
  'DataProcessor',
  'ChartOfCharacteristicTypes',
  'ChartOfAccounts',
  'ChartOfCalculationTypes',
  'InformationRegister',
  'AccumulationRegister',
  'AccountingRegister',
  'CalculationRegister',
  'BusinessProcess',
  'Task',
  'ExternalDataSource',
  // group: documents-branch
  'DocumentNumerator',
  'Sequence',
];

/**
 * Дескриптор tool-а добавления дочернего элемента.
 *
 * `allowedOwnerKinds` — белый список типов корневого объекта-владельца,
 * который проверяется до вызова `addMetadata`. Это позволяет давать понятную
 * ошибку «измерение можно добавлять только в регистры» вместо разнотипных
 * сообщений из недр XML-конвертера.
 */
export interface ChildAddToolDescriptor {
  /** Имя MCP-инструмента, например `v8vscedit_add_attribute`. */
  readonly toolName: string;
  /**
   * `ChildTag` для XML-конвертера. Для колонок табличной части — литерал
   * `'Column'`, который `MetadataXmlCreator` обрабатывает специально.
   */
  readonly childTag: ChildTag | 'Column';
  /** Русская подпись типа дочернего элемента — для описания tool. */
  readonly russianLabel: string;
  /**
   * Список допустимых типов владельца. Для `Column` владельцем считается
   * табличная часть (узел `nodeKind === 'TabularSection'`); все остальные
   * tool-ы работают с корневым объектом метаданных.
   */
  readonly allowedOwnerKinds: readonly MetaKind[];
  /**
   * Указатель на то, что tool работает внутри табличной части. Поле задаётся
   * только для `v8vscedit_add_column` — отличает её от прочих дочерних tools.
   */
  readonly inTabularSection?: true;
}

const TYPED_OWNERS: readonly MetaKind[] = [
  'Catalog', 'Document', 'ChartOfCharacteristicTypes', 'ChartOfAccounts',
  'ChartOfCalculationTypes', 'BusinessProcess', 'Task', 'Report', 'DataProcessor',
  'ExchangePlan',
];

const REGISTER_OWNERS: readonly MetaKind[] = [
  'InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister',
];

// Форма добавляется через отдельный v8vscedit_add_form (см. V8McpServer) —
// в этом списке tools для добавления формы как тонкой обёртки нет.

const COMMAND_OWNERS: readonly MetaKind[] = [
  ...TYPED_OWNERS, ...REGISTER_OWNERS, 'DocumentJournal', 'Enum',
];

/**
 * Дескрипторы tools для добавления дочерних элементов.
 *
 * `v8vscedit_add_form` НЕ входит в этот список — для добавления формы есть
 * отдельный, более богатый, инструмент с аргументами `purpose`/`autoFill`/…
 * (см. `V8McpServer.registerTools()`).
 */
export const CHILD_ADD_TOOLS: readonly ChildAddToolDescriptor[] = [
  {
    toolName: 'v8vscedit_add_attribute',
    childTag: 'Attribute',
    russianLabel: 'реквизит',
    allowedOwnerKinds: [...TYPED_OWNERS, ...REGISTER_OWNERS, 'CommonAttribute'],
  },
  {
    toolName: 'v8vscedit_add_addressing_attribute',
    childTag: 'AddressingAttribute',
    russianLabel: 'реквизит адресации',
    allowedOwnerKinds: ['Task'],
  },
  {
    toolName: 'v8vscedit_add_tabular_section',
    childTag: 'TabularSection',
    russianLabel: 'табличную часть',
    allowedOwnerKinds: TYPED_OWNERS,
  },
  {
    toolName: 'v8vscedit_add_command',
    childTag: 'Command',
    russianLabel: 'команду',
    allowedOwnerKinds: COMMAND_OWNERS,
  },
  {
    toolName: 'v8vscedit_add_template',
    childTag: 'Template',
    russianLabel: 'макет',
    allowedOwnerKinds: [
      ...TYPED_OWNERS, 'Enum',
      // Регистры собственных макетов не имеют — Template не входит в childTags.
    ],
  },
  {
    toolName: 'v8vscedit_add_dimension',
    childTag: 'Dimension',
    russianLabel: 'измерение',
    allowedOwnerKinds: REGISTER_OWNERS,
  },
  {
    toolName: 'v8vscedit_add_resource',
    childTag: 'Resource',
    russianLabel: 'ресурс',
    allowedOwnerKinds: REGISTER_OWNERS,
  },
  {
    toolName: 'v8vscedit_add_enum_value',
    childTag: 'EnumValue',
    russianLabel: 'значение перечисления',
    allowedOwnerKinds: ['Enum'],
  },
  {
    toolName: 'v8vscedit_add_column',
    childTag: 'Column',
    russianLabel: 'колонку табличной части',
    allowedOwnerKinds: ['TabularSection'],
    inTabularSection: true,
  },
];

/** Тип callback-а пост-мутации, переиспользует существующий путь в `V8McpServer`. */
export type AfterMutationCallback = (changedFiles: readonly string[]) => void;
/** Обёртка `wrapAsync` `V8McpServer` — возвращает `CallToolResult` с JSON-выдачей. */
export type WrapAsyncFn = (fn: () => Promise<unknown>) => Promise<CallToolResult>;

/** Параметры регистрации tool-а — то, что приходит из `V8McpServer.registerTools()`. */
export interface RegistrationContext {
  readonly paths: McpMetadataPathService;
  readonly mutations: MetadataMutationService;
  readonly afterMutation: AfterMutationCallback;
  readonly wrapAsync: WrapAsyncFn;
}

/**
 * Регистрирует все tool-ы добавления (корневые + дочерние).
 * Вызывается из `V8McpServer.registerTools()` один раз для каждой сессии.
 */
export function registerAllAddTools(server: McpServer, ctx: RegistrationContext): void {
  for (const kind of ROOT_ADD_KINDS) {
    registerAddRootTool(server, kind, ctx);
  }
  for (const descriptor of CHILD_ADD_TOOLS) {
    registerAddChildTool(server, descriptor, ctx);
  }
}

/**
 * Регистрирует tool добавления корневого объекта `kind`.
 *
 * Имя tool строится через `englishKind` в snake_case
 * (`Catalog` → `v8vscedit_add_catalog`, `CommonModule` → `v8vscedit_add_common_module`).
 */
export function registerAddRootTool(server: McpServer, kind: MetaKind, ctx: RegistrationContext): void {
  const def = META_TYPES[kind];
  const toolName = `v8vscedit_add_${toSnakeCase(def.englishKind ?? def.kind)}`;
  const inputShape: Record<string, z.ZodType> = {
    name: z.string(),
    configuration: z.string().optional(),
  };
  if (kind === 'CommonTemplate') {
    // У CommonTemplate можно выбрать тип макета (по умолчанию SpreadsheetDocument).
    // У дочерних `Template`-tool-ов аналогичный аргумент задаётся в общей фабрике.
    inputShape.templateType = z.string().optional();
  }

  server.registerTool(
    toolName,
    {
      title: `Добавить ${def.label.toLocaleLowerCase('ru-RU')}`,
      description: buildRootDescription(kind),
      inputSchema: z.object(inputShape),
      annotations: { destructiveHint: true },
    },
    async (args: Record<string, unknown>) => ctx.wrapAsync(async () => {
      const name = z.string().parse(args.name);
      const configuration = optionalString(args.configuration);
      const templateType = kind === 'CommonTemplate'
        ? normalizeTemplateTypeInput(args.templateType)
        : undefined;
      const { configRoot, configKind, namePrefix } = resolveConfigContext(ctx.paths, configuration);
      const result = await ctx.mutations.addMetadata({
        target: {
          kind: 'root',
          configRoot,
          configKind,
          targetKind: kind,
          namePrefix,
        },
        name,
        templateType,
      });
      if (result.success) {
        ctx.afterMutation(result.changedFiles);
      }
      return result;
    }),
  );
}

/**
 * Регистрирует tool добавления дочернего элемента по дескриптору.
 *
 * Сценарии:
 *  - `inTabularSection: true` — `path` должен указывать на табличную часть
 *    (узел `TabularSection`); из него берётся `ownerObjectXmlPath` и
 *    `tabularSectionName = node.textLabel`.
 *  - Обычный дочерний — `path` указывает на корневой объект; используется
 *    его `xmlPath` как `ownerObjectXmlPath`.
 */
export function registerAddChildTool(
  server: McpServer,
  descriptor: ChildAddToolDescriptor,
  ctx: RegistrationContext,
): void {
  const inputShape: Record<string, z.ZodType> = {
    path: z.string(),
    name: z.string(),
    configuration: z.string().optional(),
  };
  if (descriptor.childTag === 'Template') {
    inputShape.templateType = z.string().optional();
  }

  server.registerTool(
    descriptor.toolName,
    {
      title: `Добавить ${descriptor.russianLabel}`,
      description: buildChildDescription(descriptor),
      inputSchema: z.object(inputShape),
      annotations: { destructiveHint: true },
    },
    async (args: Record<string, unknown>) => ctx.wrapAsync(async () => {
      const ownerPath = z.string().parse(args.path);
      const name = z.string().parse(args.name);
      const configuration = optionalString(args.configuration);
      const templateType = descriptor.childTag === 'Template'
        ? normalizeTemplateTypeInput(args.templateType)
        : undefined;
      const node = ctx.paths.resolveNode(ownerPath, configuration);

      // Колонка ТЧ: узел-владелец должен быть TabularSection; имя ТЧ — textLabel.
      if (descriptor.inTabularSection) {
        if (node.nodeKind !== 'TabularSection' || !node.metaContext?.ownerObjectXmlPath) {
          throw new Error(
            `Путь "${ownerPath}" должен указывать на табличную часть ` +
            `(Справочники.X.КонтактныеЛица), получено ${node.nodeKind}.`,
          );
        }
        const result = await ctx.mutations.addMetadata({
          target: {
            kind: 'child',
            ownerObjectXmlPath: node.metaContext.ownerObjectXmlPath,
            childTag: 'Column',
            tabularSectionName: node.textLabel,
          },
          name,
          templateType,
        });
        if (result.success) {
          ctx.afterMutation(result.changedFiles);
        }
        return result;
      }

      // Обычный дочерний: владелец — сам корневой объект (метаконтекста нет).
      if (node.metaContext || !node.xmlPath) {
        throw new Error(
          `Путь "${ownerPath}" должен указывать на корневой объект метаданных ` +
          `(Справочники.X, Документы.X, РегистрыСведений.X), получено ${node.nodeKind}.`,
        );
      }
      if (!descriptor.allowedOwnerKinds.includes(node.nodeKind)) {
        throw new Error(
          `Дочерний элемент «${descriptor.russianLabel}» нельзя добавить к ` +
          `${describeOwnerKind(node.nodeKind)} — допустимы только: ` +
          `${descriptor.allowedOwnerKinds.map(describeOwnerKind).join(', ')}.`,
        );
      }
      const result = await ctx.mutations.addMetadata({
        target: {
          kind: 'child',
          ownerObjectXmlPath: node.xmlPath,
          childTag: descriptor.childTag,
        },
        name,
        templateType,
      });
      if (result.success) {
        ctx.afterMutation(result.changedFiles);
      }
      return result;
    }),
  );
}

/**
 * Возвращает `configRoot`/`configKind`/`namePrefix` для добавления корня.
 * Использует `paths.getWorkspaceOverview()`: уже отдаёт нормализованные
 * данные, выбираемые тем же способом, что и UI-навигатор.
 */
function resolveConfigContext(
  paths: McpMetadataPathService,
  configuration: string | undefined,
): { readonly configRoot: string; readonly configKind: 'cf' | 'cfe'; readonly namePrefix: string } {
  const overview = paths.getWorkspaceOverview();
  const all = [...overview.mainConfigurations, ...overview.extensions];
  if (all.length === 0) {
    throw new Error('Не найдено ни одной конфигурации или расширения для добавления объекта.');
  }
  if (configuration === undefined) {
    if (all.length > 1) {
      throw new Error(
        `Укажите configuration. Найдено несколько конфигураций: ${all.map((item) => item.configuration).join(', ')}.`,
      );
    }
    return contextFromEntry(all[0]);
  }
  const normalized = configuration.trim().toLocaleLowerCase('ru-RU');
  const match = all.find((item) => (
    item.configuration.toLocaleLowerCase('ru-RU') === normalized
    || path.basename(item.rootPath).toLocaleLowerCase('ru-RU') === normalized
    || item.rootPath.toLocaleLowerCase('ru-RU') === normalized
  ));
  if (!match) {
    throw new Error(
      `Конфигурация "${configuration}" не найдена. Доступные: ${all.map((item) => item.configuration).join(', ')}.`,
    );
  }
  return contextFromEntry(match);
}

function contextFromEntry(
  entry: { readonly rootPath: string; readonly kind: 'cf' | 'cfe'; readonly namePrefix: string },
): { readonly configRoot: string; readonly configKind: 'cf' | 'cfe'; readonly namePrefix: string } {
  return {
    configRoot: entry.rootPath,
    configKind: entry.kind,
    namePrefix: entry.namePrefix,
  };
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function normalizeTemplateTypeInput(value: unknown): TemplateType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[\s_-]+/g, '');
  if (normalized.length === 0) {
    return undefined;
  }
  // Сначала прямое совпадение (как раз для канонического `SpreadsheetDocument`).
  const direct = (TEMPLATE_TYPES as readonly string[]).find((candidate) => candidate.toLocaleLowerCase('ru-RU') === normalized);
  if (direct) {
    return direct as TemplateType;
  }
  if (Object.prototype.hasOwnProperty.call(TEMPLATE_TYPE_ALIASES, normalized)) {
    return TEMPLATE_TYPE_ALIASES[normalized];
  }
  throw new Error(
    `Неподдерживаемый тип макета "${value}". Допустимы: ` +
    'Табличный документ, Текстовый документ, HTML, Двоичные данные, СКД, Графическая схема, Внешняя компонента.',
  );
}

function buildRootDescription(kind: MetaKind): string {
  const def = META_TYPES[kind];
  const segment = def.pathSegment ?? def.pluralLabel;
  if (kind === 'Subsystem') {
    // Подсистемы первого уровня — здесь, вложенные — через v8vscedit_compile_subsystem.
    return [
      'Добавляет подсистему первого уровня в конфигурацию или расширение.',
      'Для вложенных подсистем (Подсистема.А.Б) используй v8vscedit_compile_subsystem с parentPath.',
      `Пример: name="${exampleName(kind)}".`,
    ].join(' ');
  }
  if (kind === 'CommonTemplate') {
    return [
      'Добавляет общий макет в конфигурацию или расширение. templateType задаёт',
      'тип содержимого (Табличный документ, Текстовый документ, HTML, Двоичные данные, СКД).',
      `Пример: name="${exampleName(kind)}", templateType="Табличный документ".`,
    ].join(' ');
  }
  return [
    `Добавляет ${def.label.toLocaleLowerCase('ru-RU')} в конфигурацию или расширение.`,
    'Имя должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.',
    `Канонический путь созданного объекта — ${segment}.<Имя>.`,
    `Пример: name="${exampleName(kind)}".`,
  ].join(' ');
}

function buildChildDescription(descriptor: ChildAddToolDescriptor): string {
  if (descriptor.inTabularSection) {
    return [
      'Добавляет колонку (реквизит табличной части). path — канонический путь',
      'самой табличной части (Справочники.Контрагенты.КонтактныеЛица).',
      'Пример: path="Справочники.Контрагенты.КонтактныеЛица", name="Должность".',
    ].join(' ');
  }
  if (descriptor.childTag === 'Template') {
    return [
      'Добавляет макет к объекту метаданных. path — канонический путь объекта',
      '(Справочники.Контрагенты или Документы.РасходТовара).',
      'templateType — тип содержимого (Табличный документ, Текстовый документ, HTML, СКД, …).',
      'Пример: path="Справочники.Контрагенты", name="СчетФактура", templateType="Табличный документ".',
    ].join(' ');
  }
  if (descriptor.childTag === 'AddressingAttribute') {
    return [
      'Добавляет реквизит адресации к задаче. path — канонический путь задачи',
      '(Задачи.ВыполнитьПоручение).',
      'Пример: path="Задачи.ВыполнитьПоручение", name="Исполнитель".',
    ].join(' ');
  }
  if (descriptor.childTag === 'Dimension' || descriptor.childTag === 'Resource') {
    return [
      `Добавляет ${descriptor.russianLabel} в регистр сведений, накопления, бухгалтерии или расчёта.`,
      'path — канонический путь регистра (РегистрыСведений.КурсыВалют).',
      `Пример: path="РегистрыСведений.КурсыВалют", name="Курс".`,
    ].join(' ');
  }
  if (descriptor.childTag === 'EnumValue') {
    return [
      'Добавляет значение перечисления. path — канонический путь перечисления',
      '(Перечисления.СтатусыЗаказа).',
      'Пример: path="Перечисления.СтатусыЗаказа", name="Активен".',
    ].join(' ');
  }
  if (descriptor.childTag === 'TabularSection') {
    return [
      'Добавляет табличную часть к объекту метаданных. path — канонический путь',
      'объекта-владельца (Справочники.Контрагенты).',
      'Пример: path="Справочники.Контрагенты", name="КонтактныеЛица".',
    ].join(' ');
  }
  if (descriptor.childTag === 'Command') {
    return [
      'Добавляет команду к объекту метаданных. path — канонический путь объекта',
      '(Справочники.Контрагенты).',
      'Пример: path="Справочники.Контрагенты", name="ВыгрузитьВExcel".',
    ].join(' ');
  }
  // Реквизит и прочее — общий шаблон.
  return [
    `Добавляет ${descriptor.russianLabel} объекту метаданных.`,
    'path — канонический путь объекта (Справочники.Контрагенты или Документы.РасходТовара).',
    `Пример: path="Справочники.Контрагенты", name="ИНН".`,
  ].join(' ');
}

/** Имя-пример для описания tool-а добавления корня. */
function exampleName(kind: MetaKind): string {
  switch (kind) {
    case 'Catalog': return 'Контрагенты';
    case 'Document': return 'РасходТовара';
    case 'CommonModule': return 'ОбщегоНазначения';
    case 'InformationRegister': return 'КурсыВалют';
    case 'AccumulationRegister': return 'ТоварыНаСкладах';
    case 'AccountingRegister': return 'Хозрасчётный';
    case 'CalculationRegister': return 'Зарплата';
    case 'Report': return 'ПродажиЗаПериод';
    case 'DataProcessor': return 'ЗагрузкаПрайса';
    case 'Role': return 'БазовыеПрава';
    case 'Enum': return 'СтатусыЗаказа';
    case 'BusinessProcess': return 'Согласование';
    case 'Task': return 'ВыполнитьПоручение';
    case 'Subsystem': return 'Продажи';
    case 'Constant': return 'КурсДоллара';
    case 'CommonForm': return 'ФормаНастроек';
    case 'CommonCommand': return 'ГлобальныйПоиск';
    case 'CommonTemplate': return 'ОбщийМакет';
    case 'Language': return 'Английский';
    case 'Style': return 'ОсновнойСтиль';
    case 'StyleItem': return 'ЦветФона';
    case 'DocumentJournal': return 'Складские';
    case 'DocumentNumerator': return 'НомераДокументов';
    case 'Sequence': return 'ПартииТоваров';
    case 'ChartOfCharacteristicTypes': return 'ВидыСубконто';
    case 'ChartOfAccounts': return 'Основной';
    case 'ChartOfCalculationTypes': return 'ОсновныеНачисления';
    case 'ScheduledJob': return 'ОбновлениеКурсов';
    case 'SessionParameter': return 'ТекущийПользователь';
    case 'CommonAttribute': return 'Организация';
    case 'FunctionalOption': return 'УчётНДС';
    case 'FunctionalOptionsParameter': return 'ОсновнаяОрганизация';
    case 'DefinedType': return 'СсылкаНаОбъект';
    case 'SettingsStorage': return 'ХранилищеПользователя';
    case 'CommandGroup': return 'СервисныеКоманды';
    case 'CommonPicture': return 'Логотип';
    case 'XDTOPackage': return 'ИнтеграционныйПакет';
    case 'WebService': return 'СервисОбмена';
    case 'HTTPService': return 'REST_API';
    case 'WSReference': return 'ВнешнийПоставщик';
    case 'IntegrationService': return 'EDI';
    case 'ExchangePlan': return 'СинхронизацияДанных';
    case 'ExternalDataSource': return 'СтороннийПрайс';
    case 'EventSubscription': return 'ПриЗаписиКонтрагента';
    case 'FilterCriterion': return 'ДокументыКонтрагента';
    default:
      return 'НовыйОбъект';
  }
}

function describeOwnerKind(kind: MetaKind): string {
  return META_TYPES[kind].label;
}

/**
 * Конвертация PascalCase / camelCase в snake_case.
 * Используется для построения имени tool-а из `englishKind`:
 *  - `Catalog` → `catalog`
 *  - `CommonModule` → `common_module`
 *  - `ChartOfCharacteristicTypes` → `chart_of_characteristic_types`
 *  - `HTTPService` → `http_service`
 *  - `XDTOPackage` → `xdto_package`
 */
export function toSnakeCase(value: string): string {
  // Сначала разрываем границы вида ABBRWord (ABBR | Word).
  const step1 = value.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
  // Затем границы wordWord.
  const step2 = step1.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return step2.toLowerCase();
}
