# CLAUDE.md

Гайд для Claude Code (и любого агента) при работе с этим репозиторием. Правила ниже — контракт, а не рекомендации.

## О проекте

`v8vscedit` — расширение для VS Code / Cursor (TypeScript) для работы с выгрузкой конфигураций и расширений 1С:Предприятие: навигация по метаданным из XML, редактирование свойств и состава, создание/удаление объектов метаданных, синхронизация с базой, хранилище конфигурации, LSP для BSL и локальный MCP-сервер для ИИ-агентов.

Две независимые подсистемы:
1. **Навигатор метаданных** — дерево объектов из XML-выгрузки (CF и CFE), свойства, чтение/создание/редактирование метаданных, открытие BSL-модулей.
2. **Языковая поддержка BSL** — LSP-клиент для внешнего `bsl-analyzer`.

Подробная документация — в `./docs` (`architecture.md`, `metadata-navigator.md`, `metadata-parser.md`, `bsl-language-support.md`, `mcp-paths.md`, `mcp-server-lifecycle.md`, `xml-format-rulesets.md`, `agentic-pipeline.md`, `vscode-extension-best-practices.md`, `git-metadata-changes.md`, `git-history-graph.md`).

## Язык общения

- Отвечать на русском. Комментарии и документация в коде — только на русском. Сообщения коммитов — на русском.
- Комментарии объясняют *почему*, а не *что*. Без «комментариев-капитанов» (`// импортируем X`, `// возвращаем результат`) и декоративных эмодзи.
- Избегать высокоуровневых ответов — давать конкретные решения применительно к проекту.

## Git-процесс

- **Коммиты — на русском.** Категорически запрещено упоминать Claude/ИИ в любой форме: никаких трейлеров `Co-Authored-By: Claude ...`, `Generated with Claude Code` и подобных подписей. То же для тел PR.
- **Ветки создаёт только пользователь** — сам или по явному указанию. Не создавать ветки автоматически, даже находясь на ветке по умолчанию; работать в текущей ветке, если не сказано иначе.

## Конвейер агентной разработки (оркестратор + субагенты)

Разработка ведётся TDD-конвейером специализированных субагентов (`.claude/agents/*.md`), которыми
дирижирует **оркестратор — основной чат**. Полное описание — `docs/agentic-pipeline.md`. Обязательный
стандарт качества для `architect` и `reviewer` — `docs/vscode-extension-best-practices.md`.

**Роли:** `architect` (opus, план, кода не пишет) → `test-writer` (sonnet, падающие тесты) →
`developer` (opus, реализация до «зелёного») → `qa-e2e` (sonnet, полный прогон + E2E + покрытие) →
`reviewer` (opus, соответствие ТЗ/конвенциям/SOLID/best-practices) → `documenter` (sonnet, доки в конце).

**Триаж оркестратора — какой трек выбрать:**

- **FULL-трек** (architect → test-writer → developer → qa-e2e → reviewer → documenter) — если задача
  правит центральные контракты (`META_TYPES`, `MetaPathResolver`, `PropertySchema`, ruleset формата),
  добавляет тип метаданных/слот/тег/схему/MCP-инструмент/команду, меняет контракт webview↔расширение,
  затрагивает > 2–3 файлов или пересекает границы слоёв.
- **FAST-трек** — мелкая нерисковая задача (локальная правка одного файла, узкий фикс, правка доки):
  оркестратор реализует сам, затем `qa-e2e` → `reviewer` → (при изменении контракта/архитектуры)
  `documenter`.

**Инвариант: `reviewer` и `qa-e2e` выполняются ВСЕГДА, на любом треке.** Меняется только объём
предшествующих стадий. Ревьюер при расхождении с ТЗ возвращает задачу на `developer` или `architect`
с конкретными замечаниями; после доработки — повторный `qa-e2e` и `reviewer`. При сомнении в размере
задачи оркестратор выбирает FULL-трек.

**Эффективность конвейера (обязанности оркестратора):**

- **Не дроби `test-writer`.** Один брифинг = все тесты задачи сразу: покрытие новых файлов до 100% (все
  ветки), параметризация по конечным множествам значений (enum/настройки, напр. `host`), helper'ы
  диалогов и т.п. Отдельные вызовы «дописать тест на X», «добрать покрытие Y» — это лишние ре-циклы;
  включай их в первый бриф. Исключение — реальный возврат от reviewer/qa по новому дефекту.
- **Гейт покрытия — `coverage:changed`, не глобальный `coverage`.** qa-e2e проверяет 100% на изменённых
  файлах; глобальный порог красный из-за легаси и НЕ основание для RED. Не давай агентам гонять
  stash/baseline-сравнения и десятки повторов «на стабильность».
- **Флейк = дефект теста, а не окружения.** Возврат автору тестов, а не бесконечные повторы.
- **Быстрый цикл на промежуточных стадиях:** `test:compile` → `MOCHA_GREP=… test:fast`; полный `npm test`
  — один раз на стадии qa-e2e.

## Команды

```bash
npm run build         # полная сборка: clean + build:node + build:webview (Vite → dist/)
npm run watch         # параллельный watch node + webview (scripts/vite-watch.mjs)
npm run typecheck     # tsc (расширение) + vue-tsc (webview); = npm run compile
npm run lint          # eslint . --max-warnings=0
npm test              # запуск всех тестов через @vscode/test-electron (out/test/runTests.js)
npm run test:fast     # прогон без pretest-пересборки; фильтр: MOCHA_GREP='<regex>' npm run test:fast
npm run coverage:changed # 100% ТОЛЬКО по изменённым production-файлам (гейт задачи; scripts/patch-coverage.mjs)
npm run coverage      # c8 с глобальным порогом 100% (аспирационный; сейчас RED из-за легаси-долга — не гейт задачи)
npm run coverage:report  # покрытие без падения по порогу (диагностика)
```

- **`npm test` требует предварительной сборки.** Скрипт `pretest` делает `typecheck → build:node → build:webview → test:compile` (без `clean` — сборка инкрементальная; компиляция тестов в `out/` через `tsconfig.test.json`). Тестовый runner берётся из `out/`, т.к. Mocha грузит `out/test/suite/*.js`.
- Запуск под конкретной версией VS Code: `VSCODE_TEST_VERSION=1.85.0 npm test`.
- **Отдельный тест — быстро и без `.only`.** Runner (`src/test/suite/index.ts`) читает `MOCHA_GREP` и применяет `mocha.grep()`. Итерация: правка теста → `npm run test:compile` → `MOCHA_GREP='<regex по имени suite/теста>' npm run test:fast` (`test:fast` НЕ запускает `pretest`, т.е. не пересобирает Vite — на порядок быстрее полного `npm test`). `.only` больше не нужен.
- Перед любым коммитом: `npm run compile` и **`npm run lint`** должны проходить без ошибок и предупреждений.
- Точки входа: `main` = `./dist/extension.js`; CLI — `dist/cli/onec-tools.js`. Целевая среда — VS Code API ≥ 1.85, TypeScript ≥ 5.3, strict, ES2020.

## Технологический стек

- TypeScript ≥ 5.3, target ES2020, strict. VS Code API ≥ 1.85, `vscode-languageclient`.
- **Vite** (сборка в `dist/`). Два конфига: `vite.node.config.ts` (Node-таргет: `extension`, CLI) и `vite.webview.config.ts` (Vue-webview из `src-ui/`). Встроенного `server`-entry нет — LSP внешний (`bsl-analyzer`).
- `iconv-lite` — декодирование OEM-866/Win1251 вывода vrunner.
- Тесты — Mocha через `@vscode/test-electron`, покрытие — `c8`.

## Архитектура

Слоистая, с однонаправленными зависимостями. Единый принцип: **одна декларативная таблица типов метаданных (`META_TYPES`) → один конвейер, использующий её везде**. Всё поведение — функции и сервисы поверх таблицы.

```
domain          ←   никто (самый низ)
infra           ←   domain
ui              ←   domain, infra
lsp             ←   infra (на чтение файлов), domain (опционально)
cli             ←   domain, infra (отдельный потребитель, нижние слои от него не зависят)
container/ext   ←   всё
```

Запреты зависимостей:
- `domain/**` не импортирует `vscode`, `fs`, `path`.
- `infra/**` не импортирует `vscode`.
- `domain/**` и `infra/**` не импортируют `cli/**`; CLI всегда потребитель.
- `ui/**` не содержит regex-парсинга XML и вычислений путей — только вызовы `infra/*`.
- LSP-подсистема не содержит встроенного сервера; все языковые возможности — через внешний `bsl-analyzer`.

### Раскладка каталогов

```
src/
├── extension.ts                      # тонкий activate/deactivate → делегирует Container
├── Container.ts                      # composition root: собирает сервисы, регистрирует команды/watcher/view
│
├── domain/                           # Чистый домен — НЕ импортирует vscode, fs, path
│   ├── MetaTypes.ts                  # Единый реестр META_TYPES: Record<MetaKind, MetaTypeDef>
│   ├── ChildTag.ts                   # Теги дочерних элементов + CHILD_TAG_CONFIG
│   ├── ModuleSlot.ts                 # Слоты модулей: 'Object'|'Manager'|'Form'|'Command'|…
│   ├── Configuration.ts              # ConfigInfo, ConfigEntry, ChildObjectsMap
│   ├── MetaObject.ts                 # MetaObject, MetaChild (результат парсинга XML объекта)
│   ├── StandardAttribute.ts          # стандартные реквизиты по видам
│   └── Ownership.ts                  # «свой/заимствованный» по namePrefix для CFE
│
├── infra/                            # ФС, XML, окружение, git, хранилище, CFE, роли; vscode не импортировать
│   ├── xml/                          # ридеры/эдиторы XML
│   │   ├── ConfigXmlReader.ts        # парсер Configuration.xml
│   │   ├── ObjectXmlReader.ts        # парсер XML объекта + updateType/updateProperty
│   │   ├── PropertySchema.ts         # декларативные схемы свойств по MetaKind
│   │   ├── TypedFieldPropertyRules.ts# свойства типизированных полей по типу
│   │   ├── XmlUtils.ts               # extract*, экранирование, writeTextFilePreservingBomAndEol
│   │   ├── ConfigurationXmlEditor.ts # редактирование Configuration.xml
│   │   ├── MetadataXmlCreator.ts     # создание новых XML-объектов метаданных
│   │   ├── MetadataXmlRemover.ts     # удаление XML-объектов метаданных
│   │   └── format/                   # ruleset формата сериализации (см. docs/xml-format-rulesets.md)
│   │       ├── FormatRuleset.ts      # интерфейс правил генерации одного поколения формата
│   │       ├── baselineRuleset.ts    # правила текущего формата (2.21)
│   │       └── formatRegistry.ts     # реестр «версия → ruleset» + version-guard
│   ├── fs/
│   │   ├── ConfigLocator.ts          # рекурсивный поиск Configuration.xml
│   │   ├── MetaPathResolver.ts       # единый resolver: XML + все модули по ModuleSlot
│   │   └── ConfigurationCleanWindow.ts # окно тишины по корню конфигурации после
│   │                                  # импорта/обновления БД (Container.markConfigurationsClean,
│   │                                  # см. docs/architecture.md)
│   ├── cfe/                          # расширения: CfeBorrowService, CfeDiffService, CfePatchMethodService
│   ├── support/                      # SupportInfoReader/Service (ParentConfigurations.bin), Logger
│   ├── cache/                        # MetadataCache, hashCache (CLI)
│   ├── repository/                   # хранилище 1С, локальные захваты
│   ├── git/                          # статус Git для узлов метаданных (GitMetadataStatusService,
│   │                                  # декорации) + представление «Изменения метаданных»
│   │                                  # (GitPorcelainReader, MetadataChangeResolver,
│   │                                  # MetadataChangeAggregator, GitBlobReader, GitStatusReader,
│   │                                  # GitWriteService — см. docs/git-metadata-changes.md) +
│   │                                  # чистое ядро графа истории (GitLogReader, GitLogParser,
│   │                                  # GitGraphLayout, GitCommitChangesReader — см.
│   │                                  # docs/git-history-graph.md; граф — сворачиваемый блок панели
│   │                                  # «Изменения метаданных», отдельного webview/вкладки нет)
│   ├── environment/                  # bsl-analyzer.toml, окружение проекта, реестр баз
│   ├── process/                      # поиск платформы, spawn, декодер OEM/Win1251
│   ├── mcp/                          # McpServerIdentity/McpStartDecision/McpPortProbe/
│   │                                  # McpConflictPrompt/McpHost — чистая логика жизненного цикла
│   │                                  # встроенного MCP-сервера (bind/reuse/conflict, закрытие порта),
│   │                                  # без vscode; см. docs/mcp-server-lifecycle.md
│   └── skills/                       # AiSkillsInstaller — установка ИИ-навыков
│
├── ui/                               # Всё, что знает про vscode API
│   ├── tree/                         # MetadataTreeProvider (тонкий), TreeNode, nodeBuilders/, decorations/
│   ├── views/                        # webview-провайдеры
│   │   ├── universal/                # UniversalPanelViewProvider — ОСНОВНОЙ UI навигатора
│   │   ├── properties/               # PropertyBuilder по PropertySchema
│   │   ├── changes/                  # changesDtoBuilder (листья, чистый) + changesTreeAssembler
│   │   │                              # (сборка навигаторной иерархии секции, чистый) +
│   │   │                              # changesHistorySection (чистый helper состояния блока
│   │   │                              # «История» поверх views/history/*, см. ниже) +
│   │   │                              # MetadataChangesViewProvider (ЕДИНСТВЕННЫЙ webview-провайдер
│   │   │                              # v8vsceditChanges — панель с ДВУМЯ сворачиваемыми блоками
│   │   │                              # «Изменения»/«История»; дерево «Изменения» повторяет иерархию
│   │   │                              # навигатора через treeProvider; см. docs/git-metadata-changes.md
│   │   │                              # и docs/git-history-graph.md)
│   │   ├── history/                  # ТОЛЬКО чистые модули (без vscode): historyGraphDtoBuilder/
│   │   │                              # historyGraphController — read-only переиспользование движка
│   │   │                              # changes/; см. docs/git-history-graph.md
│   │   └── subsystem|search|repository|environment|standalone|…
│   ├── commands/                     # CommandRegistry.registerAll + подпапки по доменам
│   ├── git/                          # OnecGitContentProvider — схема onec-git для diff HEAD/индекс
│   ├── mcp/                          # V8McpServer (тонкий HTTP-фасад: транспорт MCP, служебные
│   │                                  # эндпоинты /identity+/shutdown — не MCP-инструменты,
│   │                                  # см. docs/mcp-server-lifecycle.md), McpNodeRegistry,
│   │                                  # McpPropertyService
│   └── readonly/                     # BslReadonlyGuard
│
├── lsp/                              # LspManager + analyzer/ (внешний bsl-analyzer; встроенного сервера нет)
├── cli/                             # Node entry onec-tools.ts + commands/ + core/ (адаптеры)
└── test/                            # runTests.ts + suite/
```

`cli/` — отдельный потребитель `domain/` и `infra/`. Если код нужен и расширению, и CLI — он живёт в `infra/<подпапка>/`, а `cli/core/*` даёт тонкий re-export.

### Центральный контракт — `META_TYPES`

Единственный источник правды по типам метаданных: иконки, папки выгрузки, дочерние элементы, слоты модулей, группировка в дереве, схема свойств.

```typescript
// domain/MetaTypes.ts
export interface MetaTypeDef {
  kind: MetaKind;                  // 'Catalog'
  label: string;                   // 'Справочник'
  pluralLabel: string;             // 'Справочники'
  folder?: string;                 // 'Catalogs'
  icon: string;                    // имя SVG без расширения
  group: MetaGroup;                // 'common' | 'top' | 'documents-branch' | 'child' | 'service' | 'root'
  groupOrder: number;
  childTags?: readonly ChildTag[]; // ['Attribute','TabularSection','Form','Command','Template']
  modules?: readonly ModuleSlot[]; // ['Object','Manager']
  propertySchema?: string;         // ключ в PROPERTY_SCHEMAS
  singleClickCommand?: OpenModuleCommandId;
  pathSegment?: string;            // канонический сегмент пути для MCP
  englishKind?: string;            // англ. имя типа (по умолчанию = kind)
}
```

Правила:
- **Добавление нового типа метаданных — ТОЛЬКО одна запись в `META_TYPES`.** Если пришлось править что-то ещё — это утечка знаний из реестра.
- Никаких параллельных словарей `typeToFolder`, `NODE_DESCRIPTORS`, `HANDLER_REGISTRY`, `FOLDER_MAP`.
- `ConfigXmlReader`, `MetaPathResolver`, `MetaObjectBuilder`, `GroupBuilder`, `PropertyBuilder` — все читают данные из `META_TYPES`.

### Центральный контракт — `MetaPathResolver`

Один класс вместо россыпи функций; карта слотов модулей (`Object→Ext/ObjectModule.bsl` и т.п.) — внутри как данные. Все пути (XML и BSL-модули) резолвятся только через него.

### Composition root

`Container.bootstrap()`: создаёт `OutputChannel` и все сервисы → регистрирует `TreeView`/декорации/`FileSystemWatcher` → `CommandRegistry.registerAll(ctx, services)` → `reloadEntries()` → запускает `V8McpServer` (если `v8vscedit.mcp.enabled`) → стартует `LspManager`. Сервисы не создаются через `new` в командах/builder'ах — только через Container.

### Основной UI — webview, а не TreeView

**`UniversalPanelViewProvider` (`src/ui/views/universal/`) — основной UI навигатора** (HTML/Vue-webview: дерево, поиск, контекстное меню, операции). Нативный `MetadataTreeProvider` (`ui/tree/`) существует только как источник данных (`treeProvider.getChildren()`); сам TreeView-виджет — атавизм и **не основной UI**.

Следствия:
- Контекстное меню узлов формируется в `UniversalPanelViewProvider.getNodeActions()` / `addModuleActions()`, **а не** через `package.json → contributes.menus`.
- Источник правды для команд узла — `META_TYPES.modules`, читаемый через `MODULE_SLOT_ACTIONS`.
- Новая команда узла: добавить в `MODULE_SLOT_ACTIONS` (в `UniversalPanelViewProvider.ts`) + зарегистрировать в `CommandRegistry`. Правка `package.json → menus` — опциональна (для нативного TreeView).

### Webview (`src-ui/`)

Vue-приложения (сборка `vite.webview.config.ts`, проверка типов `vue-tsc`/`tsconfig.ui.json`). `src-ui/apps/*` — отдельные панели (`universal`, `dynamic-panel`, `environment`, `subsystem`, `repository-*`, `standalone`, `ai`, `tree-search`, `changes` — панель «Изменения метаданных»: ДВА сворачиваемых блока — «Изменения» (SCM-шапка + дерево, повторяющее навигаторную иерархию, обрезанную по изменениям) и «История» (граф git-коммитов `CommitGraph.vue` с inline-раскрытием коммита: детали + дерево изменений через общий `UniversalTree`, read-only, ленивая загрузка при первом раскрытии, см. `docs/git-history-graph.md`); отдельного приложения `apps/history` больше нет — граф целиком часть `apps/changes`). `src-ui/shared/` — общий код: `protocol/` (контракт сообщений webview ↔ расширение), `state/`, `components/` (в т.ч. `components/tree/UniversalTree*.vue` — дерево, общее для навигатора и панели изменений, включая её блок истории), `api/`. При изменении взаимодействия панели и расширения правьте обе стороны протокола.

## MCP-сервер для ИИ-агентов

`src/ui/mcp/V8McpServer.ts` — локальный MCP-сервер, официальный канал автоматизации. Запускается только после `reloadEntries()`, слушает loopback, не даёт агенту прямой доступ к shell/произвольным путям/произвольным VS Code командам. Старт/остановка, гарантированное освобождение порта и разрешение конфликта порта с другим инстансом/проектом — отдельный слой `infra/mcp/`, см. [mcp-server-lifecycle.md](./docs/mcp-server-lifecycle.md) (не путать с каноном путей инструментов ниже).

Правила:
- SDK: production-ветка `@modelcontextprotocol/sdk` v1.x. Транспорт: Streamable HTTP на `127.0.0.1`/`localhost`/`::1`; удалённый bind запрещён.
- Инструменты регистрируются в `V8McpServer.ts`, но бизнес-логика живёт в общих сервисах (`infra/*`, `ui/commands/*/*Service.ts`). UI-команда и MCP-инструмент для одного действия вызывают **один и тот же код**.
- Для команд, меняющих конфигурацию/базу (импорт, обновление, создание/удаление/редактирование метаданных), добавлять MCP-инструмент или явно документировать, почему нельзя.
- Нельзя делать инструмент, исполняющий произвольную строку команды, произвольный `vscode.commands.executeCommand` или пишущий XML в обход существующего сервиса.
- Любой инструмент записи сначала валидирует вход и права, возвращает список изменённых файлов и маркирует конфигурацию изменённой тем же механизмом, что UI. Единый post-mutation путь: `suppressConfigurationReloadForFiles(changedFiles)` → `markChangedConfigurationByFiles(changedFiles)` → `treeProvider.refresh()` → `refreshActionsView()`.
- Значения enum, boolean/localized-классификация и схемы свойств живут в `infra/xml/PropertySchema.ts` (или спец-реестре infra), MCP только публикует контракт.

### Канон именования путей MCP

Полный справочник — `./docs/mcp-paths.md`. Ключевое:
- Корни-коллекции — **только множественное число** (`Справочники.Контрагенты`, `РегистрыСведений.КурсыВалют`). Единственное — только для `Подсистема`, `Конфигурация`, `Расширение`.
- Реквизиты/ТЧ — прямые сегменты без роли-префикса (`Справочники.Контрагенты.ИНН`; внутри ТЧ — `…ТабличнаяЧасть.Имя.Реквизит.Имя`).
- Английских алиасов (`Catalog.X`) и legacy-форм нет; любая такая форма отбивается с подсказкой канона.
- У инструментов, работающих с одним узлом, аргумент называется `path`; парные `compile_*` принимают `parentPath`. Никаких `objectPath`/`formPath`/`modulePath` и т.п.

### Перенос новой функции из скилов в расширение

1. Бизнес-логику — в `infra/<область>/<Service>.ts` без `vscode` и shell.
2. Тест на реальных XML-фикстурах или временной структуре выгрузки.
3. Если нужно человеку в UI — команда в `ui/commands/**` + действие в `UniversalPanelViewProvider.getNodeActions()`.
4. Если меняет конфигурацию/расширение — MCP-инструмент в `V8McpServer.registerTools()` + запись в `EXTENSION_MCP_TOOLS`.
5. Обновить кэш/дерево/статус через общий post-mutation путь.

## Инвариант изменений — как добавлять функциональность

Для каждого сценария указано, какие файлы трогать. Если требуется править сверх списка — задача решается в другом слое.

- **Новый тип метаданных:** запись в `META_TYPES` → при спец-модуле `ModuleSlot` + карта в `MetaPathResolver` → при наборе свойств схема в `PROPERTY_SCHEMAS` → иконка `src/icons/{light,dark}/<icon>.svg` → при нестандартной сборке узла builder в `ui/tree/nodeBuilders/` → тест `ObjectXmlReader` на пример из `example/`.
- **Новый слот модуля (`ModuleSlot`):** литерал в `domain/ModuleSlot.ts` → путь в карте `MetaPathResolver` → при необходимости `OpenModuleCommandId` + команда → поле `modules` в записях `META_TYPES`.
- **Новый дочерний тег (`ChildTag`):** значение в `domain/ChildTag.ts` + `CHILD_TAG_CONFIG` → при своём контейнере расширить `ObjectXmlReader.parseChildren` → тег в `childTags` нужных `META_TYPES`.
- **Новый контейнерный дочерний тип со своими вложенными листьями** (паттерн ТЧ→Колонка; второй прецедент — HTTPСервис→URLШаблон→Метод, см. [mcp-paths.md](./docs/mcp-paths.md#26-расширенные-примеры-путей) и [metadata-navigator.md](./docs/metadata-navigator.md#контейнерные-дочерние-узлы-тчколонка-и-httpсервисurlшаблонметод)): контейнер и лист — обе отдельные записи `MetaKind`/`META_TYPES`/`ChildTag`; лист парсится в `MetaChild.columns` контейнера через `ObjectXmlReader.toXxxChild` (образец `toTabularSectionChild`) → имя родителя-контейнера пробрасывается ПАРАЛЛЕЛЬНЫМ полем контекста (`tabularSectionName`/`urlTemplateName`), а не переименованием существующего слота и не новым реестром → `domain/CanonicalNames.ts` (`canonicalChildPath`) обобщает контейнерную ветку по этому полю → узел дерева строится симметрично в ДВУХ источниках — `infra/cache/MetadataCache.ts` (webview) и `ui/tree/nodeBuilders/metaObjectTreeBuilder.ts` (нативный TreeView/свойства) → `infra/xml/XmlUtils.ts` получает nesting-aware `findXxxRangeInYyy`/`extractXxxXmlFromYyy` (образец `findColumnRangeInTabularSection`) → MCP add-инструмент для листа получает флаг-аналог `inTabularSection` (например `inUrlTemplate`) в `McpAddToolsRegistration.ts`, владелец — сам контейнер (`allowedOwnerKinds: ['<Контейнер>']`).
- **Новая схема свойств:** объект-схема в `PROPERTY_SCHEMAS` → при новом `PropertyValueKind` расширить `_types.ts` + `PropertyBuilder.ts`. Регулярки — только в `infra/xml/`.
- **Новая команда:** класс в `ui/commands/...` с `readonly id` → регистрация в `CommandRegistry.registerAll` → `package.json → contributes.commands` → при меню узла `contributes.menus` c `when: viewItem =~ /…/` → при хоткее `contributes.keybindings`.
- **Новый builder узла:** `ui/tree/nodeBuilders/<имя>.ts` → регистрация в диспетчере `metaObjectTreeBuilder.ts`. XML — только через `parseObjectXml`/`ObjectXmlReader`.
- **Новая декорация узла:** класс в `ui/tree/decorations/` (реализует `vscode.FileDecorationProvider`) → регистрация в `Container.wireTreeView` → суффикс `contextValue` — только в `TreeNode`.
- **Новый view/webview:** класс в `ui/views/<Имя>ViewProvider.ts` (без XML/FS) → данные готовит отдельный сервис → создание и команда открытия через `Container`.
- **Новый сервис инфры:** класс в `infra/<подпапка>/<Имя>Service.ts` без `vscode`, `Logger` через конструктор → создать в `Container.bootstrap` → тест на пример из `example/`.
- **Новая возможность LSP:** встроенных провайдеров нет; completion/hover/diagnostics добавляются в `bsl-analyzer`, здесь проверяется только интеграция `LspManager`.
- **Новая настройка:** `package.json → contributes.configuration.properties` с префиксом `v8vscedit.<область>.<ключ>`, `description` на русском → читать только через `vscode.workspace.getConfiguration('v8vscedit')` в UI/Container → при рантайм-влиянии подписка на `onDidChangeConfiguration`.
- **Новый watcher:** `FileSystemWatcher` — только в `Container` или `ui/support/`; обработчик делегирует в сервис.
- **Внешняя интеграция (vrunner):** запуск процесса в `ui/commands/ext/`; декодирование OEM/Win1251 через `iconv-lite`; прогресс/отмена через `vscode.window.withProgress`.
- **Новая операция чтения данных из базы через пакетный Конфигуратор** (данных, которых нет в
  XML-выгрузке — список/состояние; образец — список подключённых расширений для
  `v8vscedit.connectExtension`): CLI-команда `cli/commands/<name>.ts` с гейтом по `exitCode` процесса
  (не по тексту лога) и передачей результата через `-ResultFile` (не marker-блок в stdout — избегает
  порчи данных построчным `LineBufferedDecoder`) → чистый парсер в `infra/<область>/<Name>Parser.ts` без
  `vscode`/spawn (снятие BOM, разбор строк, при необходимости — чистая функция выбора для UI) → тонкая
  UI-обёртка `ui/commands/.../*CommandRunner.ts` (спавн CLI + чтение `-ResultFile`, `undefined` при
  недоступности) → диалог без ручного fallback-ввода: при `undefined`/пустом/полностью исчерпанном
  списке — явные `showErrorMessage`/`showInformationMessage` по причине и отмена операции, без
  переключения на ручной ввод значения пользователем. Подробности и обоснование —
  [architecture.md](./docs/architecture.md#паттерн-чтение-данных-из-базы-через-пакетный-конфигуратор-file-handoff).
- **Открытие BSL-модулей:** только реальные `file://` документы (виртуальная схема `onec://` удалена). Readonly — через `ui/readonly/BslReadonlyGuard.ts`.
- **Изменение жизненного цикла/безопасности встроенного MCP-сервера** (порт, идентичность процесса,
  graceful shutdown, Host/Origin, отличается от «новый MCP-инструмент» из раздела выше): чистая логика —
  в `infra/mcp/` (`McpServerIdentity`, `McpStartDecision`, `McpPortProbe`, `McpConflictPrompt`, `McpHost`,
  без `vscode`) → тонкий адаптер конкретного эндпоинта/диалога — `ui/mcp/V8McpServer.ts` (HTTP-роутинг,
  служебные `/identity`+`/shutdown` — не MCP-инструменты) и `Container` (чтение настроек `v8vscedit.mcp.*`,
  показ диалога конфликта порта). См. [mcp-server-lifecycle.md](./docs/mcp-server-lifecycle.md).
- **Новая часть объекта в панели «Изменения метаданных»** (`MetadataPartKind`, см.
  [git-metadata-changes.md](./docs/git-metadata-changes.md)): случай в
  `infra/git/MetadataChangeResolver.ts` (`resolveSubPath`/дизамбигуация слота через
  `META_TYPES[kind].modules`) → при новом варианте схлопывания статуса — `combineStatus` в
  `infra/git/MetadataChangeAggregator.ts` → метка/статус ЛИСТА в
  `ui/views/changes/changesDtoBuilder.ts` (`partLabelOf`/`toGitStatus`, функции `buildObjectNode`/
  `buildPartNode`; навигаторную иерархию НАД листом строит `changesTreeAssembler.ts` +
  `MetadataChangesViewProvider.resolveAncestors`, этот слой не трогается для новой части) → тест на
  реальном временном git-репозитории (образец — `support/changesFixtures.ts`). Каноничный путь владельца
  — только через `domain/CanonicalNames.ts` (`canonicalRootPath`), не новый форматтер.
- **Новая git-мутация над панелью изменений** (аналог stage/unstage/discard/commit): движок — функция
  в `infra/git/GitWriteService.ts` (без `vscode`) → действие подключается веткой в
  `MetadataChangesViewProvider.handleMessage` (значение `command` протокола) → то же значение `command`
  добавляется на стороне ui в `src-ui/apps/changes/ChangesApp.vue` (пункт контекстного меню узла и/или
  кнопка в `ChangesCommitBox.vue`) → узлы для действия строит `changesDtoBuilder` из `ChangesModel`
  (`resolveChangeAddress` — единственное место, расшифровывающее `nodeId` обратно в файлы). Никаких
  команд `package.json → contributes.commands`/меню `view/item/context` для этой панели не заводится —
  весь UI-контракт живёт во внутреннем протоколе webview (см.
  [git-metadata-changes.md](./docs/git-metadata-changes.md#формат-сообщений-протокола)).
- **Новый триггер обновления панели изменений/декораций по git-событию** (аналог Git Extension API):
  чистый селектор репозитория — `infra/git/GitRepositorySelector.ts` (без `vscode`) → тонкий наблюдатель
  поверх события — `ui/git/` (образец `GitStateObserver.ts` + типовой фасад `gitExtensionApi.ts`) →
  подключение в `Container` (образец `wireGitStateWatcher()`), с обязательным fallback fs-вотчером на
  случай недоступности источника → единственный выход обоих триггеров —
  `Container.scheduleDecorationRefresh()` (не заводить параллельный debounce/refresh-путь). См.
  [git-metadata-changes.md](./docs/git-metadata-changes.md#триггеры-обновления-панели-и-декораций-git-extension-api--fallback-fs-вотчер).
- **Новая возможность блока «История»** (граф git-коммитов внутри панели «Изменения метаданных», НЕ
  отдельная вкладка/провайдер, см. [git-history-graph.md](./docs/git-history-graph.md)), в зависимости от
  слоя:
  - новая колонка/поле графа (например автор-аватар, статус CI) — `RawCommit`/`GitLogParser` (если
    берётся из `git log`) → `GraphRowDto` в `ui/views/history/historyGraphDtoBuilder.ts` →
    `src-ui/shared/types/history.ts` (зеркало) → отрисовка в `src-ui/apps/changes/CommitGraph.vue`;
  - новая команда протокола (аналог `selectCommit`/`openCommitDiff`/`historyLoadMore`/`historyRefresh`) —
    `MetadataChangesViewProvider.handleMessage` (ветка `switch (message.command)`) → та же строка
    `command` добавляется в `src-ui/apps/changes/ChangesApp.vue` (`sendCommand`); чистая бизнес-логика
    команды — в `historyGraphController.ts`/`ChangesHistorySection` (`ui/views/changes/
    changesHistorySection.ts`), а не в самом провайдере;
  - изменение алгоритма раскладки дорожек — только `infra/git/GitGraphLayout.ts` (чистая функция без
    `vscode`), тест на реальном временном git-репозитории с ветвлением/merge (образец —
    `support/changesFixtures.ts:buildHistoryRepo`);
  - новое поле/метод состояния графа (пагинация, выбор коммита) — `ChangesHistorySection`
    (`ui/views/changes/changesHistorySection.ts`), а не поля самого `MetadataChangesViewProvider` —
    провайдер остаётся тонким диспетчером команд поверх этого helper'а;
  - новая часть/статус объекта в дереве изменений коммита переиспользует ТОТ ЖЕ путь, что и панель
    изменений (см. пункт выше «Новая часть объекта в панели «Изменения метаданных»»), т.к.
    `buildCommitChangesSection` вызывает те же `buildObjectNode`/`buildPartNode`/`synthesizeAncestors` —
    отдельного реестра для блока истории не заводится.
- **Декомпозиция God-класса (косметика, без изменения поведения):** characterization/байт-golden-тест ДО дробления (фиксирует текущий выход) → вынос по доменам/ответственности в подпапку того же слоя (`ui/mcp/registration/`, `infra/xml/<область>/`) через `git mv`/перенос функций без изменения публичного API фасада → диспетчер-`switch` → таблица (данные в `META_TYPES`/спец-реестр infra, поведение — функции поверх) → эталоны golden при этом НЕ редактируются: их правка означает регресс поведения, а не косметику. Для XML-генераторов (`MetadataXmlCreator`, `FormBuilders`) байт-golden обязателен как входное условие (см. запрет №17).

## Запреты и анти-паттерны

1. **Никаких regex-парсеров XML вне `infra/xml/`.**
2. **Нет дублирующих реестров типов.** `Record<string,string>` с `Catalog:'Catalogs'` вне `META_TYPES` — баг архитектуры.
3. **Нет команд в `package.json`, не покрытых `CommandRegistry`.**
4. **`MetadataTreeProvider` не знает про типы метаданных** — делегирует в builder'ы.
5. **`TreeNode` не хранит XML-логику** — только отображение + ссылка на `TreeNodeModel`.
6. **Не импортировать `vscode` в `domain/` и `infra/`.**
7. **Сервисы не создаются через `new` в командах/builder'ах** — только через `Container`.
8. **Не использовать `any`.** Если неизбежно — комментарий `// any: <причина>`.
9. **Не сохранять пароли/токены в файлы проекта.** Секреты — через VS Code SecretStorage.
10. **Не создавать файлы при команде «Открыть».** Создание — только явным командам добавления/генерации.
11. **Не вешать синхронный I/O на getters, tooltip, decoration и hot path дерева.**
12. **Не терять формат XML.** Любой редактор существующего XML сохраняет BOM и стиль переводов строк исходного файла (`writeTextFilePreservingBomAndEol`).
13. **Справочники свойств не живут в UI** — только в `infra/xml/PropertySchema.ts` (или спец-реестре infra); UI рендерит готовое.
14. **Команды контекстного меню не хардкодятся в `UniversalPanelViewProvider`** — `addModuleActions` читает `META_TYPES[kind].modules` через `MODULE_SLOT_ACTIONS`.
15. **Нативный TreeView — не основной UI**; не дублировать логику меню в `package.json`, если она есть в `addModuleActions`.
16. **MCP-инструменты принимают только канон** (см. `./docs/mcp-paths.md`).
17. **God-объектов быть не должно.** Порог-ориентир — **~800 строк** на файл производственного кода; превышение требует либо явного обоснования, либо декомпозиции. Дробить **по ответственности/домену, а не механически по строкам**. Каноничные приёмы: регистрация MCP-инструментов дробится по доменам (`src/ui/mcp/registration/*`, образец — `McpAddToolsRegistration`); диспетчер `switch (kind)` заменяется **таблицей** `Record<MetaKind, …>` — данные типа в `META_TYPES`, XML-литералы формата в спец-реестре `infra/` (параллельные словари вне `META_TYPES` запрещены, см. п.2); класс-фасад остаётся тонким, логика — в module-level функциях/подмодулях того же слоя. **Любое дробление XML-генератора обязано сохранять байт-в-байт выход** (BOM/EOL/порядок атрибутов/самозакрытие, см. п.12) и предваряться байт-golden-тестом; декомпозиция `MetadataXmlCreator`/`FormBuilders` без такого эталона — запрещена (идёт вслепую).

## Ключевые принципы

- Один декларативный реестр `META_TYPES` → один конвейер. Поведение — функции/сервисы поверх таблицы, без дублирующих словарей.
- Все пути (XML и BSL-модули) резолвятся только через `MetaPathResolver`.
- `bsl-analyzer` — единственный LSP; BSL-файлы открываются напрямую через `file://`.
- Ленивая загрузка дерева: дочерние узлы строятся при раскрытии.
- **Генерация XML привязана к версии формата через ruleset** (`infra/xml/format/`, текущий — 2.21). См. `docs/xml-format-rulesets.md`.

## TDD и покрытие

1. **Любое изменение поведения начинается с теста** (красный → код → зелёный).
2. **Покрытие кода, ЗАТРОНУТОГО изменением, — 100%** по строкам, веткам, функциям, операторам. Гейт задачи — `npm run coverage:changed` (проверяет ровно изменённые/новые production-файлы). Глобальный `npm run coverage --100` сейчас красный из-за унаследованного легаси-долга в несвязанных областях (`ui/tree/nodeBuilders/*`, `ExtensionCommandRunner`, `RepositoryCommandRunner`, `InitializeProjectCommand`, `infra/xml/form/*` и др.) — это **известное состояние, не предмет каждой задачи**; не трать время, доказывая это заново через stash/baseline. `Container.ts`/`extension.ts` исполняются в Extension Host и c8 не инструментируются — покрываются интеграционно, из гейта изменённых файлов исключены.
3. **Заглушки/фиктивные ассёрты/тесты ради покрытия запрещены.** Тест проверяет реальное поведение на настоящих XML-фикстурах (`example/src/cf`, `example/src/cfe/EVOLC`), реальных временных файлах или реальном процессе; mock/stub допустимы только для внешней недоступной системы с обоснованием. Тесты **детерминированы** — без гонок/угадывания таймингов; учитывай фоновое поведение SDK/клиентов.
4. Непокрываемую из-за VS Code API логику выносить в `domain/`/`infra/` и покрывать unit-тестом; тонкий UI-адаптер — интеграционным тестом. Осознанно недостижимую защитную ветку — `/* c8 ignore */` с обоснованием, а не оставлять пробел для qa.
5. **Покрытие новых файлов доводится до 100% за один проход автора тестов** (перечислить ветки заранее: ошибки, таймауты, guard'ы, граничные входы; параметризовать по конечным множествам значений — enum/настройки, напр. `host ∈ {127.0.0.1, localhost, ::1}`), чтобы не гонять лишний ре-цикл через qa.
6. Перед завершением задачи — `npm test` (регресс) и `npm run coverage:changed` (100% на изменённом). Если нельзя выполнить локально — зафиксировать причину, задачу не считать завершённой.

## Рабочий процесс и отладка

- Запуск: `npm install` → `npm run watch` → `F5` (Extension Development Host), `Ctrl+Shift+F5` — перезапуск.
- Каналы вывода: «BSL LSP Trace» (JSON-RPC), «1С Редактор» (лог расширения), «BSL Analyzer» (stdout/stderr сервера).
- Инкрементальность: менять не более одного слоя за коммит; после каждого коммита проходят `npm run compile` и `npm run lint`.
- Новый код — только в целевых папках. Создание новых файлов в корне `src/` запрещено (кроме `Container.ts`, `extension.ts`). Папки `src/handlers|nodes|services|views|language|language-server|formEditor` не существуют — не создавать.
- Не создавать параллельные версии сервисов («v2»). При переносе файла — `git mv` + обновить импорты + `compile`/`lint`.

### Sanity-чек после изменений

1. `npm run compile` — 0 ошибок.
2. `npm run lint` — 0 ошибок и предупреждений.
3. `npm run build` — Vite собирается.
4. `rg "typeToFolder\s*:" src` — 0.
5. `rg "import .* from 'vscode'" src/domain src/infra` — 0.
6. `rg "from ['\"].*cli|from ['\"].*/cli" src/domain src/infra` — 0.
7. `rg "require\(|readFileSync" src/domain` — 0.
8. `rg "FOLDER_MAP|FOLDER_RU" src` — 0.

## Известные технические долги

1. `CommandRegistry.ts` — один файл, пока не разбит на `open/`, `properties/`, `support/`, `ext/`.
2. `TreeNode.ts` не разделён на `TreeNodeModel` (POJO) + vscode-обёртку.
3. Миграция XML-парсинга на `fast-xml-parser` (внутри `infra/xml/*` — регулярки), без изменения публичного API ридеров.
4. Сильная типизация дерева: `TreeNodeModel` → discriminated union по `kind`.
5. `ui/views/properties/_types.ts` — окончательно отделить типы панели свойств.
6. `infra/git/GitStatusReader.ts` дублирует запуск `git status`/поиск корня с `GitMetadataStatusService`
   (панель «Изменения метаданных» vs декорации навигатора) — кандидат на объединение, см.
   [git-metadata-changes.md](./docs/git-metadata-changes.md#известные-ограничения).
7. Панель «Изменения метаданных» показывает дерево навигаторной иерархии, но лист (объект) раскрывается
   только до глубины «объект → изменённая часть» (модуль/Свойства/форма), без разворота части до
   атрибута/колонки — см. [git-metadata-changes.md](./docs/git-metadata-changes.md#известные-ограничения).
8. Панель «Изменения метаданных»: `findNavigatorNode` ищет узел объекта в `MetadataTreeProvider`
   отдельным DFS-обходом на КАЖДУЮ изменённую группу (O(изменения × размер дерева) на `refresh()`) —
   кандидат на индексацию дерева одним проходом; `synthesizeAncestors` для удалённых объектов группы
   `documents-branch` не восстанавливает промежуточную ветвь «Документы» — см.
   [git-metadata-changes.md](./docs/git-metadata-changes.md#известные-ограничения).
9. Блок «История» панели «Изменения метаданных»: пагинация графа — полная перераскладка растущего окна
   `git log --max-count` на каждый `historyLoadMore` (без курсора/`--skip`, осознанно ради детерминизма
   дорожек); резолвинг принадлежности файлов коммита объектам идёт по ТЕКУЩЕМУ списку `configRoots`, а не
   по структуре выгрузки на момент коммита — см. [git-history-graph.md](./docs/git-history-graph.md#известные-ограничения).

## `.cursor/`, `.codex/`, `.claude/skills/` — это доменные 1С-скилы, а не разработка расширения

`.cursor/rules/` и `.cursor/skills/`, а также скилы в `.claude/skills/` (перенесены из `.codex/skills/`: `cf-*`, `cfe-*`, `epf-*`, `erf-*`, `meta-*`, `form-*`, `role-*`, `skd-*`, `mxl-*`, `subsystem-*`, `web-*`, `db-*`, `interface-*`, `template-*`, `help-add`, `img-grid` и т.п.) — это **стандарты написания кода 1С/BSL и навыки работы с метаданными редактируемых конфигураций 1С**. Расширение устанавливает их пользователям как проектные ИИ-роли.

**Важно: эти 1С-скилы нужны только для справки** — как ориентир, что и как должно делать само расширение с выгрузкой 1С (канон операций, форматы, DSL). Они относятся к редактируемым конфигурациям 1С, **не** к TypeScript-коду этого репозитория. При разработке самого расширения руководствуйтесь этим файлом, а не BSL-правилами из `.cursor/rules/` и не 1С-скилами.
