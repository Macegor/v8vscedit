import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../support/Logger';

export type AiRolePlatformFormat =
  | 'skill'
  | 'cursor-rule'
  | 'copilot-instruction'
  | 'opencode-instruction'
  | 'claude-code';

export interface AiSkillsPlatform {
  readonly id: string;
  readonly label: string;
  readonly targetPrefix: string;
  readonly format: AiRolePlatformFormat;
}

export const AI_SKILLS_PLATFORMS: readonly AiSkillsPlatform[] = [
  { id: 'claude-code', label: 'Claude Code', targetPrefix: '.claude/skills', format: 'claude-code' },
  { id: 'augment', label: 'Augment', targetPrefix: '.augment/skills', format: 'skill' },
  { id: 'cline', label: 'Cline', targetPrefix: '.cline/skills', format: 'skill' },
  { id: 'cursor', label: 'Cursor', targetPrefix: '.cursor/rules', format: 'cursor-rule' },
  { id: 'copilot', label: 'GitHub Copilot', targetPrefix: '.github/instructions', format: 'copilot-instruction' },
  { id: 'kilo', label: 'Kilo Code', targetPrefix: '.kilocode/skills', format: 'skill' },
  { id: 'kiro', label: 'Kiro', targetPrefix: '.kiro/skills', format: 'skill' },
  { id: 'codex', label: 'Codex', targetPrefix: '.codex/skills', format: 'skill' },
  { id: 'gemini', label: 'Gemini CLI', targetPrefix: '.gemini/skills', format: 'skill' },
  { id: 'opencode', label: 'OpenCode', targetPrefix: '.opencode/instructions', format: 'opencode-instruction' },
  { id: 'roo', label: 'Roo Code', targetPrefix: '.roo/skills', format: 'skill' },
  { id: 'windsurf', label: 'Windsurf', targetPrefix: '.windsurf/rules', format: 'skill' },
  { id: 'agents', label: 'Agent Skills', targetPrefix: '.agents/skills', format: 'skill' },
] as const;

export interface AiSkillsInstallOptions {
  readonly projectRoot: string;
  readonly platform: AiSkillsPlatform;
}

export interface AiSkillsInstallResult {
  readonly installedCount: number;
  readonly targetDir: string;
  readonly targetPrefix: string;
  readonly info: readonly string[];
  readonly warnings: readonly string[];
}

interface AiRoleDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly alwaysApply: boolean;
  readonly globs?: readonly string[];
  readonly body: string;
}

interface AiRoleFile {
  readonly relativePath: string;
  readonly content: string;
}

const GENERATED_MARKER = '<!-- v8vscedit:generated-role -->';
const CLAUDE_MD_START = '<!-- v8vscedit:claude-roles:start -->';
const CLAUDE_MD_END = '<!-- v8vscedit:claude-roles:end -->';
const DEFAULT_OPENCODE_MCP_URL = 'http://127.0.0.1:38481/mcp';

const ROLE_DEFINITIONS: readonly AiRoleDefinition[] = [
  {
    id: 'v8vscedit-mcp-required',
    title: 'v8vscedit: обязательная работа через MCP',
    description: 'Обязательное правило: любые операции с XML-выгрузкой 1С выполнять через MCP-инструменты v8vscedit.',
    alwaysApply: true,
    body: [
      '# v8vscedit: обязательная работа через MCP',
      '',
      'Эта роль применяется всегда, когда агент работает с конфигурацией или расширением 1С в XML-выгрузке.',
      '',
      '## Жесткие правила',
      '',
      '- Не редактируй XML-файлы 1С напрямую. Все изменения структуры конфигурации, расширения, форм, макетов, СКД, ролей, подсистем и командного интерфейса выполняй только через MCP-инструменты `v8vscedit_*`.',
      '- Не создавай вручную каталоги и файлы `Forms`, `Commands`, `Templates`, `Ext/Template.*`, `Ext/Form.xml`, `Ext/Rights.xml`, `CommandInterface.xml` и записи `ChildObjects`, если для операции есть MCP-инструмент.',
      '- Не запускай Python/PowerShell-скрипты из `.codex/skills`, `.cursor/skills`, `.claude/skills` и похожих каталогов для изменения конфигурации.',
      '- Для навигации сначала используй предметные path-инструменты: `v8vscedit_workspace_overview`, `v8vscedit_search_metadata`, `v8vscedit_list_metadata`. В поиске всегда передавай `configuration` из overview, если корней больше одного.',
      '- Для добавления используй отдельный инструмент на каждый тип: корневые объекты — `v8vscedit_add_catalog`, `v8vscedit_add_document`, `v8vscedit_add_common_module`, `v8vscedit_add_information_register` и т.п.; дочерние — `v8vscedit_add_attribute`, `v8vscedit_add_tabular_section`, `v8vscedit_add_column`, `v8vscedit_add_form`, `v8vscedit_add_command`, `v8vscedit_add_template`, `v8vscedit_add_dimension`, `v8vscedit_add_resource`, `v8vscedit_add_enum_value`, `v8vscedit_add_addressing_attribute`.',
      '- Канон путей: корни во множественном числе (`Справочники.Пользователи`), реквизиты и табличные части прямые сегменты без префикса (`Справочники.Пользователи.Фамилия`, `Справочники.Пользователи.Состав`), внутри ТЧ сегменты возвращаются (`Справочники.Пользователи.ТабличнаяЧасть.Состав.Реквизит.Номенклатура`), подсистемы без удвоения (`Подсистема.Продажи.Розница`). Английские и единственное число для коллекций (`Catalog.X`, `Справочник.X`) отбиваются. Полный справочник — `docs/mcp-paths.md`.',
      '- Для свойств: `v8vscedit_get_properties` возвращает все свойства узла с allowedValues для enum/multiEnum. Записывай одно — через `v8vscedit_set_property_by_path`, несколько — через `v8vscedit_set_properties` (объект ключ→значение). Для типов сначала вызывай `v8vscedit_list_available_types` или `v8vscedit_list_supported_types` с тем же `path`, потом меняй тип через `v8vscedit_set_type`. Не придумывай типы вручную. Для CFE список содержит только собственные и заимствованные объекты. Длину и точность задавай в `v8vscedit_set_type` через `length`/`digits` и `precision`/`fractionDigits`.',
      '- После изменений используй validate-инструмент той же области: metadata, form, skd, mxl, subsystem, role, external object или configuration.',
      '- Если MCP-сервер недоступен, остановись и попроси включить панель `ИИ и MCP`; не обходи это прямой правкой XML.',
      '',
      '## Быстрое соответствие старых навыков MCP-инструментам',
      '',
      '- `cf-info`, `cf-validate`, `cf-init`, `cfe-init` -> `v8vscedit_configuration_info`, `v8vscedit_validate_configuration`, `v8vscedit_create_configuration`, `v8vscedit_create_extension`.',
      '- `meta-info`, `meta-validate`, `meta-compile`, `meta-edit`, `meta-remove` -> `v8vscedit_metadata_info`, `v8vscedit_validate_metadata`, `v8vscedit_search_metadata`, `v8vscedit_list_metadata`, `v8vscedit_tree`, отдельные `v8vscedit_add_<тип>` (catalog/document/common_module/…), `v8vscedit_add_attribute`/`add_tabular_section`/`add_column`/`add_form`/`add_command`/`add_template`/`add_dimension`/`add_resource`/`add_enum_value`, `v8vscedit_remove_metadata`, `v8vscedit_get_properties`, `v8vscedit_set_property_by_path`, `v8vscedit_set_properties`, `v8vscedit_set_type`, `v8vscedit_rename_metadata`.',
      '- `form-*` -> `v8vscedit_form_info`, `v8vscedit_validate_form`, `v8vscedit_add_form`, `v8vscedit_remove_form`, `v8vscedit_compile_form`, `v8vscedit_edit_form`.',
      '- `skd-*` -> `v8vscedit_skd_info`, `v8vscedit_validate_skd`, `v8vscedit_compile_skd`, `v8vscedit_edit_skd`.',
      '- `mxl-*`, `template-*` -> `v8vscedit_mxl_info`, `v8vscedit_validate_mxl`, `v8vscedit_compile_mxl`, `v8vscedit_decompile_mxl`.',
      '- `subsystem-*`, `interface-*` -> `v8vscedit_subsystem_info`, `v8vscedit_validate_subsystem`, `v8vscedit_compile_subsystem`, `v8vscedit_get_properties`, `v8vscedit_set_property_by_path`, `v8vscedit_edit_subsystem_content`, `v8vscedit_edit_command_interface`, `v8vscedit_validate_command_interface`.',
      '- `role-*` -> `v8vscedit_role_info`, `v8vscedit_validate_role`, `v8vscedit_compile_role`.',
      '- `epf-*`, `erf-*`, `help-add` -> `v8vscedit_create_epf`, `v8vscedit_create_erf`, `v8vscedit_validate_external_object`, `v8vscedit_add_help`.',
      '- `cfe-*` -> `v8vscedit_cfe_borrow`, `v8vscedit_cfe_patch_method`, `v8vscedit_cfe_diff`, `v8vscedit_validate_configuration`.',
    ].join('\n'),
  },
  {
    id: 'v8vscedit-1c-developer',
    title: 'v8vscedit: senior 1C developer',
    description: 'Роль senior-разработчика 1С: код BSL, запросы, производительность, проверка через bsl-analyzer.',
    alwaysApply: true,
    globs: ['**/*.bsl', '**/*.os'],
    body: [
      '# v8vscedit: senior 1C developer',
      '',
      'Отвечай на русском языке. Код, идентификаторы, комментарии и пользовательские строки в BSL пиши по-русски.',
      '',
      '## Процесс',
      '',
      '- Перед написанием кода проверь существующие модули и повторно используй локальные паттерны.',
      '- Проверяй имена метаданных через MCP-инструменты `v8vscedit_*`, а не по памяти.',
      '- Для документации платформы и примеров используй доступные инструменты bsl-analyzer MCP: `docsearch`, `templatesearch`, `syntaxcheck`, `check_1c_code`, `codesearch`.',
      '- После изменения BSL запускай `syntaxcheck`, если инструмент доступен; исправляй ошибки до предупреждений стиля.',
      '',
      '## Код',
      '',
      '- Не используй `Сообщить`; применяй `ОбщегоНазначения.СообщитьПользователю` или `ОбщегоНазначенияКлиент.СообщитьПользователю`.',
      '- Не оборачивай чтение и запись БД широкими `Попытка...Исключение`; исключения должны быть узкими и объяснимыми.',
      '- Не сравнивай булевы значения с `Истина`/`Ложь`, не используй тернарный оператор `?(...)`.',
      '- Не называй переменные именами глобального контекста: `Документы`, `Справочники`, `Метаданные`, `Регистры`, `Константы`.',
      '- Для запросов всегда используй параметры, алиасы `КАК`, промежуточную переменную результата и пакетные выборки вместо запросов в цикле.',
      '- Для чтения реквизитов ссылок предпочитай БСП-методы `ОбщегоНазначения.ЗначениеРеквизитаОбъекта` и родственные функции.',
    ].join('\n'),
  },
  {
    id: 'v8vscedit-bsp-developer',
    title: 'v8vscedit: БСП и подключаемые команды',
    description: 'Роль для разработки с БСП: стандартные подсистемы, дополнительные обработки, команды, сообщения пользователю.',
    alwaysApply: false,
    globs: ['**/*.bsl'],
    body: [
      '# v8vscedit: БСП и подключаемые команды',
      '',
      'Используй эту роль, когда задача связана с БСП, дополнительными отчетами/обработками, подключаемыми командами или стандартными подсистемами.',
      '',
      '## Приоритеты БСП',
      '',
      '- Перед собственной реализацией ищи готовый программный интерфейс БСП через `ssl_search` или справку проекта.',
      '- Для сообщений пользователю используй БСП-обертки, а не `Сообщить`.',
      '- Для доступа к реквизитам ссылок используй функции `ОбщегоНазначения`, чтобы не загружать объект целиком.',
      '- Для дополнительных обработок сначала добавляй регистрацию через `v8vscedit_epf_bsp_init`, затем команды через `v8vscedit_epf_bsp_add_command`.',
      '- Идентификаторы команд делай стабильными, без пробелов и локализованных вариантов; представление команды выноси в пользовательский текст.',
      '- Серверные, клиентские и печатные обработчики команд держи раздельно, не смешивай клиентский UI-код с серверной бизнес-логикой.',
      '- После изменения EPF/ERF обязательно выполняй `v8vscedit_validate_external_object`.',
    ].join('\n'),
  },
  {
    id: 'v8vscedit-metadata-manager',
    title: 'v8vscedit: менеджер метаданных 1С',
    description: 'Роль для создания, изменения и проверки метаданных CF/CFE только через сервисы v8vscedit.',
    alwaysApply: false,
    body: [
      '# v8vscedit: менеджер метаданных 1С',
      '',
      'Используй эту роль для операций с объектами конфигурации, расширениями, формами, СКД, MXL, ролями и подсистемами.',
      '',
      '## Алгоритм',
      '',
      '1. Найди корни через `v8vscedit_workspace_overview`.',
      '2. Найди объект или дочерний элемент через `v8vscedit_search_metadata`, `v8vscedit_list_metadata` или `v8vscedit_tree`; всегда передавай `configuration`, если в overview есть несколько корней.',
      '   Для добавления используй отдельный инструмент на каждый тип. Корневые: `v8vscedit_add_catalog`, `v8vscedit_add_document`, `v8vscedit_add_common_module`, `v8vscedit_add_information_register`, `v8vscedit_add_role`, … (всего 45 root-tools). Дочерние: `v8vscedit_add_attribute` (`path = Справочники.Пользователи`), `v8vscedit_add_tabular_section`, `v8vscedit_add_column` (`path = Справочники.Пользователи.ТабличнаяЧасть.Состав`), `v8vscedit_add_form` (с purpose), `v8vscedit_add_command`, `v8vscedit_add_template` (с templateType), `v8vscedit_add_dimension`/`add_resource` (только для регистров), `v8vscedit_add_enum_value`, `v8vscedit_add_addressing_attribute` (только для задач).',
      '3. Прочитай структуру профильным `*_info` инструментом.',
      '4. Выполни изменение профильным `add`, `compile`, `edit`, `remove`, `borrow` или `patch` инструментом.',
      '5. Запусти профильный `*_validate` инструмент и устрани ошибки.',
      '',
      '## Ограничения',
      '',
      '- Для CFE сначала проверяй принадлежность и заимствование; для перехватчиков используй только `v8vscedit_cfe_patch_method`.',
      '- Для удаления корневых объектов полагайся на `v8vscedit_remove_metadata`, потому что он проверяет ссылки.',
      '- Для командного интерфейса используй `v8vscedit_edit_command_interface`; не меняй `CommandInterface.xml` вручную.',
    ].join('\n'),
  },
  {
    id: 'v8vscedit-bsl-module-standards',
    title: 'v8vscedit: стандарты модулей BSL',
    description: 'Правила структуры модулей BSL: области, директивы, обработчики, комментарии и форматирование.',
    alwaysApply: false,
    globs: ['**/*.bsl'],
    body: [
      '# v8vscedit: стандарты модулей BSL',
      '',
      '- Соблюдай порядок областей: публичный интерфейс, обработчики событий, служебный интерфейс, служебные процедуры и функции, инициализация.',
      '- В модулях форм группируй обработчики по назначению формы, а не по директивам клиента/сервера.',
      '- Используй `&НаСервереБезКонтекста`, когда контекст формы не нужен.',
      '- Не добавляй пустые области, закомментированный код, отладочные остатки и личные пометки.',
      '- Комментарии к процедурам и функциям нужны для публичного интерфейса и сложных контрактов; не дублируй очевидный код.',
      '- Строки запросов форматируй многострочно, с алиасами и параметрами.',
    ].join('\n'),
  },
];

/**
 * Устанавливает проектные роли v8vscedit для AI-платформ.
 * Роли не содержат скриптов: они направляют агента к MCP-инструментам расширения.
 */
export class AiSkillsInstaller {
  constructor(private readonly logger: Logger) {}

  installProjectRoles(options: AiSkillsInstallOptions): AiSkillsInstallResult {
    const targetDir = path.join(options.projectRoot, ...options.platform.targetPrefix.split('/'));
    const files = buildRoleFiles(options.platform);
    const info: string[] = [];
    const warnings: string[] = [];
    let installedCount = 0;

    if (files.length > 0) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    this.logger.appendLine(`[ai-roles] Установка ролей v8vscedit в ${options.platform.targetPrefix}/`);
    for (const file of files) {
      const targetPath = path.join(targetDir, ...file.relativePath.split('/'));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });

      if (fs.existsSync(targetPath) && !isGeneratedRoleFile(targetPath)) {
        warnings.push(`${path.join(options.platform.targetPrefix, file.relativePath)} уже существует и будет перезаписан`);
      }

      fs.writeFileSync(targetPath, file.content, 'utf-8');
      this.logger.appendLine(`[ai-roles] [OK] ${path.join(options.platform.targetPrefix, file.relativePath)}`);
      installedCount += 1;
    }

    if (options.platform.format === 'opencode-instruction') {
      const configPath = ensureOpenCodeConfig(options.projectRoot, options.platform);
      this.logger.appendLine(`[ai-roles] [OK] ${path.relative(options.projectRoot, configPath)}`);
      info.push('OpenCode подключает роли через opencode.json -> instructions.');
      info.push('OpenCode MCP v8vscedit включён в opencode.json.');
    }

    if (options.platform.format === 'claude-code') {
      const alwaysApplyRoles = ROLE_DEFINITIONS.filter((role) => role.alwaysApply);
      const claudeMdPath = path.join(options.projectRoot, 'CLAUDE.md');
      const updateResult = upsertClaudeMd(claudeMdPath, alwaysApplyRoles);
      this.logger.appendLine(`[ai-roles] [OK] ${path.relative(options.projectRoot, claudeMdPath)} (${updateResult.action})`);
      installedCount += alwaysApplyRoles.length;

      const removed = removeStaleClaudeAlwaysApplySkills(targetDir, alwaysApplyRoles);
      for (const relative of removed) {
        this.logger.appendLine(`[ai-roles] [cleanup] удалён устаревший skill ${path.join(options.platform.targetPrefix, relative)}`);
      }

      info.push('Claude Code: always-apply роли встроены в CLAUDE.md между маркерами v8vscedit:claude-roles.');
      info.push('Claude Code: остальные роли установлены в .claude/skills и подключаются по описанию.');
    }

    info.push('Установлены проектные роли без внешнего репозитория, Python и PowerShell-скриптов.');
    info.push('Роль v8vscedit-mcp-required запрещает прямую правку XML при наличии MCP-инструмента.');

    return {
      installedCount,
      targetDir,
      targetPrefix: options.platform.targetPrefix,
      info,
      warnings,
    };
  }
}

export function buildRoleFiles(platform: AiSkillsPlatform): readonly AiRoleFile[] {
  const roles = platform.format === 'claude-code'
    ? ROLE_DEFINITIONS.filter((role) => !role.alwaysApply)
    : ROLE_DEFINITIONS;

  return roles.map((role) => {
    if (platform.format === 'cursor-rule') {
      return {
        relativePath: `${role.id}.mdc`,
        content: renderCursorRule(role),
      };
    }

    if (platform.format === 'copilot-instruction') {
      return {
        relativePath: `${role.id}.instructions.md`,
        content: renderCopilotInstruction(role),
      };
    }

    if (platform.format === 'opencode-instruction') {
      return {
        relativePath: `${role.id}.md`,
        content: renderInstruction(role),
      };
    }

    return {
      relativePath: `${role.id}/SKILL.md`,
      content: renderSkill(role),
    };
  });
}

function renderCursorRule(role: AiRoleDefinition): string {
  const globs = role.globs && role.globs.length > 0
    ? `globs:\n${role.globs.map((glob) => `  - "${glob}"`).join('\n')}\n`
    : '';

  return [
    '---',
    `description: ${role.description}`,
    globs.trimEnd(),
    `alwaysApply: ${String(role.alwaysApply)}`,
    '---',
    GENERATED_MARKER,
    '',
    role.body,
    '',
  ].filter((line) => line !== '').join('\n');
}

function renderCopilotInstruction(role: AiRoleDefinition): string {
  const applyTo = role.globs && role.globs.length > 0 ? role.globs.join(',') : '**';

  return [
    '---',
    `applyTo: "${applyTo}"`,
    '---',
    GENERATED_MARKER,
    '',
    role.body,
    '',
  ].join('\n');
}

function renderInstruction(role: AiRoleDefinition): string {
  return [
    GENERATED_MARKER,
    '',
    role.body,
    '',
  ].join('\n');
}

function renderSkill(role: AiRoleDefinition): string {
  return [
    '---',
    `name: ${role.id}`,
    `description: ${role.description}`,
    '---',
    GENERATED_MARKER,
    '',
    role.body,
    '',
  ].join('\n');
}

interface ClaudeMdUpsertResult {
  readonly action: 'created' | 'updated' | 'replaced' | 'appended';
}

function upsertClaudeMd(
  filePath: string,
  alwaysApplyRoles: readonly AiRoleDefinition[]
): ClaudeMdUpsertResult {
  const block = renderClaudeMdBlock(alwaysApplyRoles);

  if (!fs.existsSync(filePath)) {
    const header = '# Инструкции для Claude Code\n\n';
    fs.writeFileSync(filePath, `${header}${block}\n`, 'utf-8');
    return { action: 'created' };
  }

  const original = fs.readFileSync(filePath, 'utf-8');
  const startIdx = original.indexOf(CLAUDE_MD_START);
  const endIdx = original.indexOf(CLAUDE_MD_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = original.slice(0, startIdx);
    const after = original.slice(endIdx + CLAUDE_MD_END.length);
    fs.writeFileSync(filePath, `${before}${block}${after}`, 'utf-8');
    return { action: 'replaced' };
  }

  const separator = original.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(filePath, `${original}${separator}${block}\n`, 'utf-8');
  return original.length === 0 ? { action: 'updated' } : { action: 'appended' };
}

function renderClaudeMdBlock(alwaysApplyRoles: readonly AiRoleDefinition[]): string {
  const sections = alwaysApplyRoles.map((role) => role.body.trim()).join('\n\n---\n\n');
  return [
    CLAUDE_MD_START,
    '<!-- Автоматически сгенерировано v8vscedit. Изменения внутри блока перезаписываются. -->',
    '',
    sections,
    '',
    CLAUDE_MD_END,
  ].join('\n');
}

function removeStaleClaudeAlwaysApplySkills(
  skillsDir: string,
  alwaysApplyRoles: readonly AiRoleDefinition[]
): readonly string[] {
  const removed: string[] = [];
  for (const role of alwaysApplyRoles) {
    const skillDir = path.join(skillsDir, role.id);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillFile) && isGeneratedRoleFile(skillFile)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      removed.push(`${role.id}/SKILL.md`);
    }
  }
  return removed;
}

function ensureOpenCodeConfig(
  projectRoot: string,
  platform: AiSkillsPlatform
): string {
  const configPath = path.join(projectRoot, 'opencode.json');
  const instructionGlob = path.posix.join(platform.targetPrefix, '*.md');

  let config: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      const parsed = parseJsonObjectConfig(fs.readFileSync(configPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      const backupPath = `${configPath}.bak`;
      fs.copyFileSync(configPath, backupPath);
      config = {};
    }
  }

  const existing = Array.isArray(config.instructions)
    ? config.instructions.filter((item): item is string => typeof item === 'string')
    : [];
  config.$schema = typeof config.$schema === 'string'
    ? config.$schema
    : 'https://opencode.ai/config.json';
  config.instructions = [...new Set([...existing, instructionGlob])];
  config.mcp = ensureOpenCodeMcp(config.mcp);

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return configPath;
}

function ensureOpenCodeMcp(value: unknown): Record<string, unknown> {
  const mcp = value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
  const current = mcp.v8vscedit;
  const v8vscedit = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};

  v8vscedit.type = typeof v8vscedit.type === 'string' ? v8vscedit.type : 'remote';
  v8vscedit.url = typeof v8vscedit.url === 'string' ? v8vscedit.url : DEFAULT_OPENCODE_MCP_URL;
  v8vscedit.enabled = true;
  mcp.v8vscedit = v8vscedit;
  return mcp;
}

function parseJsonObjectConfig(content: string): unknown {
  return JSON.parse(stripJsonCommentsAndTrailingCommas(content)) as unknown;
}

function stripJsonCommentsAndTrailingCommas(content: string): string {
  return removeTrailingCommas(stripJsonComments(content));
}

function stripJsonComments(content: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
        result += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      } else if (char === '\n' || char === '\r') {
        result += char;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    result += char;
  }

  return result;
}

function removeTrailingCommas(content: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === ',') {
      let nextIndex = i + 1;
      while (nextIndex < content.length && /\s/.test(content[nextIndex])) {
        nextIndex += 1;
      }
      if (content[nextIndex] === '}' || content[nextIndex] === ']') {
        continue;
      }
    }
    result += char;
  }

  return result;
}

function isGeneratedRoleFile(filePath: string): boolean {
  try {
    return fs.readFileSync(filePath, 'utf-8').includes(GENERATED_MARKER);
  } catch {
    return false;
  }
}
