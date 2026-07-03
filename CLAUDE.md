# CLAUDE.md

Гайд для Claude Code (и любого агента) при работе с этим репозиторием. Правила ниже — контракт, а не рекомендации.

## О проекте

`v8vscedit` — расширение для VS Code / Cursor (TypeScript) для работы с выгрузкой конфигураций и расширений 1С:Предприятие: навигация по метаданным из XML, редактирование свойств и состава, создание/удаление объектов метаданных, синхронизация с базой, хранилище конфигурации, LSP для BSL и локальный MCP-сервер для ИИ-агентов.

Две независимые подсистемы:
1. **Навигатор метаданных** — дерево объектов из XML-выгрузки (CF и CFE), свойства, чтение/создание/редактирование метаданных, открытие BSL-модулей.
2. **Языковая поддержка BSL** — LSP-клиент для внешнего `bsl-analyzer`.

Подробная документация — в `./docs` (`architecture.md`, `metadata-navigator.md`, `metadata-parser.md`, `bsl-language-support.md`, `mcp-paths.md`, `xml-format-rulesets.md`, `agentic-pipeline.md`, `vscode-extension-best-practices.md`).

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

## Команды

```bash
npm run build         # полная сборка: clean + build:node + build:webview (Vite → dist/)
npm run watch         # параллельный watch node + webview (scripts/vite-watch.mjs)
npm run typecheck     # tsc (расширение) + vue-tsc (webview); = npm run compile
npm run lint          # eslint . --max-warnings=0
npm test              # запуск всех тестов через @vscode/test-electron (out/test/runTests.js)
npm run coverage      # c8 с порогом 100%
npm run coverage:report  # покрытие без падения по порогу (диагностика)
```

- **`npm test` требует предварительной сборки.** Скрипт `pretest` уже делает `typecheck → build → test:compile` (компиляция тестов в `out/` через `tsconfig.test.json`). Тестовый runner берётся из `out/`, т.к. Mocha грузит `out/test/suite/*.js`.
- Запуск под конкретной версией VS Code: `VSCODE_TEST_VERSION=1.85.0 npm test`.
- **Отдельный тест:** runner (`src/test/suite/index.ts`) грузит все `**/*.test.js` без grep-фильтра. Чтобы прогнать один — временно `test.only(...)` / `suite.only(...)` (Mocha UI — `tdd`), затем пересобрать тесты (`npm run test:compile`).
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
│   │   └── MetaPathResolver.ts       # единый resolver: XML + все модули по ModuleSlot
│   ├── cfe/                          # расширения: CfeBorrowService, CfeDiffService, CfePatchMethodService
│   ├── support/                      # SupportInfoReader/Service (ParentConfigurations.bin), Logger
│   ├── cache/                        # MetadataCache, hashCache (CLI)
│   ├── repository/                   # хранилище 1С, локальные захваты
│   ├── git/                          # статус Git для узлов метаданных
│   ├── environment/                  # bsl-analyzer.toml, окружение проекта, реестр баз
│   ├── process/                      # поиск платформы, spawn, декодер OEM/Win1251
│   └── skills/                       # AiSkillsInstaller — установка ИИ-навыков
│
├── ui/                               # Всё, что знает про vscode API
│   ├── tree/                         # MetadataTreeProvider (тонкий), TreeNode, nodeBuilders/, decorations/
│   ├── views/                        # webview-провайдеры
│   │   ├── universal/                # UniversalPanelViewProvider — ОСНОВНОЙ UI навигатора
│   │   ├── properties/               # PropertyBuilder по PropertySchema
│   │   └── subsystem|search|repository|environment|standalone|…
│   ├── commands/                     # CommandRegistry.registerAll + подпапки по доменам
│   ├── mcp/                          # V8McpServer, McpNodeRegistry, McpPropertyService
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

Vue-приложения (сборка `vite.webview.config.ts`, проверка типов `vue-tsc`/`tsconfig.ui.json`). `src-ui/apps/*` — отдельные панели (`universal`, `dynamic-panel`, `environment`, `subsystem`, `repository-*`, `standalone`, `ai`, `tree-search`). `src-ui/shared/` — общий код: `protocol/` (контракт сообщений webview ↔ расширение), `state/`, `components/`, `api/`. При изменении взаимодействия панели и расширения правьте обе стороны протокола.

## MCP-сервер для ИИ-агентов

`src/ui/mcp/V8McpServer.ts` — локальный MCP-сервер, официальный канал автоматизации. Запускается только после `reloadEntries()`, слушает loopback, не даёт агенту прямой доступ к shell/произвольным путям/произвольным VS Code командам.

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
- **Открытие BSL-модулей:** только реальные `file://` документы (виртуальная схема `onec://` удалена). Readonly — через `ui/readonly/BslReadonlyGuard.ts`.

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

## Ключевые принципы

- Один декларативный реестр `META_TYPES` → один конвейер. Поведение — функции/сервисы поверх таблицы, без дублирующих словарей.
- Все пути (XML и BSL-модули) резолвятся только через `MetaPathResolver`.
- `bsl-analyzer` — единственный LSP; BSL-файлы открываются напрямую через `file://`.
- Ленивая загрузка дерева: дочерние узлы строятся при раскрытии.
- **Генерация XML привязана к версии формата через ruleset** (`infra/xml/format/`, текущий — 2.21). См. `docs/xml-format-rulesets.md`.

## TDD и покрытие

1. **Любое изменение поведения начинается с теста** (красный → код → зелёный).
2. **Покрытие production-кода — 100%** по строкам, веткам, функциям, операторам.
3. **Заглушки/фиктивные ассёрты/тесты ради покрытия запрещены.** Тест проверяет реальное поведение на настоящих XML-фикстурах (`example/src/cf`, `example/src/cfe/EVOLC`), реальных временных файлах или реальном процессе; mock/stub допустимы только для внешней недоступной системы с обоснованием.
4. Непокрываемую из-за VS Code API логику выносить в `domain/`/`infra/` и покрывать unit-тестом; тонкий UI-адаптер — интеграционным тестом.
5. Перед завершением задачи — `npm test` и `npm run coverage`. Если нельзя выполнить локально — зафиксировать причину, задачу не считать завершённой.

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

## `.cursor/`, `.codex/`, `.claude/skills/` — это доменные 1С-скилы, а не разработка расширения

`.cursor/rules/` и `.cursor/skills/`, а также скилы в `.claude/skills/` (перенесены из `.codex/skills/`: `cf-*`, `cfe-*`, `epf-*`, `erf-*`, `meta-*`, `form-*`, `role-*`, `skd-*`, `mxl-*`, `subsystem-*`, `web-*`, `db-*`, `interface-*`, `template-*`, `help-add`, `img-grid` и т.п.) — это **стандарты написания кода 1С/BSL и навыки работы с метаданными редактируемых конфигураций 1С**. Расширение устанавливает их пользователям как проектные ИИ-роли.

**Важно: эти 1С-скилы нужны только для справки** — как ориентир, что и как должно делать само расширение с выгрузкой 1С (канон операций, форматы, DSL). Они относятся к редактируемым конфигурациям 1С, **не** к TypeScript-коду этого репозитория. При разработке самого расширения руководствуйтесь этим файлом, а не BSL-правилами из `.cursor/rules/` и не 1С-скилами.
