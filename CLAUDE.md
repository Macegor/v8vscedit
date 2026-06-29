# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## О проекте

`v8vscedit` — расширение для VS Code / Cursor (TypeScript) для работы с выгрузкой конфигураций и расширений 1С:Предприятие: навигация по метаданным из XML, редактирование свойств и состава, синхронизация с базой, хранилище конфигурации, LSP для BSL и локальный MCP-сервер для ИИ-агентов.

Подробная документация — в `./docs` (`architecture.md`, `metadata-navigator.md`, `metadata-parser.md`, `bsl-language-support.md`, `mcp-paths.md`). `AGENTS.md` — расширенный контракт для агентов; **внимание: его раздел «Технологический стек» устарел** (упоминает Webpack — фактически сборка на Vite).

## Язык общения

- Отвечать на русском. Комментарии и документация в коде — только на русском. Сообщения коммитов — на русском.
- Комментарии объясняют *почему*, а не *что*. Без «комментариев-капитанов» и декоративных эмодзи.

## Команды

```bash
npm run build         # полная сборка: clean + build:node + build:webview (Vite → dist/)
npm run watch         # параллельный watch node + webview (scripts/vite-watch.mjs)
npm run typecheck     # tsc (расширение) + vue-tsc (webview); = npm run compile
npm run lint          # eslint . --max-warnings=0
npm test              # запуск всех тестов через @vscode/test-electron (out/test/runTests.js)
npm run coverage      # c8 с порогом 100%
```

- **`npm test` требует предварительной сборки.** Скрипт `pretest` уже делает `typecheck → build → test:compile` (компиляция тестов в `out/` через `tsconfig.test.json`). При прямом запуске убедитесь, что `out/` собран.
- Запуск под конкретной версией VS Code: `VSCODE_TEST_VERSION=1.85.0 npm test`.
- **Отдельный тест:** runner (`src/test/suite/index.ts`) грузит все `**/*.test.js` без grep-фильтра. Чтобы прогнать один тест — временно используйте `test.only(...)` / `suite.only(...)` (Mocha UI — `tdd`), затем пересоберите тесты (`npm run test:compile`).
- Точки входа расширения: `main` = `./dist/extension.js`; целевая среда — VS Code API ≥ 1.85, TypeScript ≥ 5.3, strict, ES2020.

## Архитектура

Слоистая, с однонаправленными зависимостями (`extension.ts → Container → infra/ui/lsp → domain`):

- **`src/extension.ts`** — тонкий `activate/deactivate`, делегирует `Container`.
- **`src/Container.ts`** — composition root. `bootstrap()` создаёт все сервисы, регистрирует дерево, webview-панели, декорации, watcher-ы и команды, грузит XML-выгрузки, запускает `LspManager` и MCP-сервер. Все зависимости собираются здесь — новые сервисы подключаются через Container.
- **`src/domain/`** — чистый домен, **не импортирует `vscode`, `fs`, `path`**. Ключевое: `MetaTypes.ts` — единый реестр `META_TYPES` (`Record<MetaKind, MetaTypeDef>`). Добавление нового типа метаданных = одна запись здесь, без параллельных словарей. Также `ChildTag`, `ModuleSlot`, `Configuration`, `MetaObject`, `Ownership` (свой/заимствованный для CFE).
- **`src/infra/`** — файловая система, парсинг/редактирование XML, окружение, git, хранилище, CFE, роли, standalone-сервер, ИИ-навыки. `infra/xml/` — ридеры/эдиторы (`ConfigXmlReader`, `ObjectXmlReader`, `ConfigurationXmlEditor`, `MetadataXmlCreator/Remover`, `PropertySchema` и др.). `infra/fs/MetaPathResolver` — единый резолвер путей XML и всех модулей по `ModuleSlot`.
- **`src/ui/`** — команды (`ui/commands/CommandRegistry.ts` + подпапки по доменам), дерево, webview-провайдеры (`ui/views/`), readonly-guard, MCP (`ui/mcp/`).
- **`src/lsp/`** — `LspManager` запускает/перезапускает **внешний** `bsl-analyzer lsp` (встроенного LSP-сервера нет). `analyzer/BslAnalyzerService` — установка/обновление/путь к бинарнику.
- **`src/cli/`** — `onec-tools.ts` и команды (`exportConfiguration`, `importConfiguration`, `syncConfiguration`, `updateConfiguration`, …) для синхронизации с базой 1С через vrunner; `cli/core/` — connection, hashCache (определение изменённых конфигураций), projectLayout.

### Основной UI — webview, а не TreeView

**`UniversalPanelViewProvider` (`src/ui/views/universal/`) — основной UI навигатора** (HTML/Vue-webview: дерево, поиск, контекстное меню, операции). Нативный `MetadataTreeProvider` (`ui/tree/`) существует только как источник данных (`treeProvider.getChildren()`); сам TreeView-виджет — атавизм и **не основной UI**.

Следствия:
- Контекстное меню узлов формируется в `UniversalPanelViewProvider.getNodeActions()` / `addModuleActions()`, **а не** через `package.json → contributes.menus`.
- Источник правды для команд узла — `META_TYPES.modules`.
- Новая команда узла: добавить в `MODULE_SLOT_ACTIONS` (в `UniversalPanelViewProvider.ts`) + зарегистрировать в `CommandRegistry`. Правка `package.json → menus` — опциональна (для нативного TreeView).

### Webview (`src-ui/`)

Vue-приложения (сборка `vite.webview.config.ts`, проверка типов `vue-tsc`/`tsconfig.ui.json`). `src-ui/apps/*` — отдельные панели (`universal`, `dynamic-panel`, `environment`, `subsystem`, `repository-*`, `standalone`, `ai`, `tree-search`). `src-ui/shared/` — общий код: `protocol/` (контракт сообщений webview ↔ расширение), `state/`, `components/`, `api/`. При изменении взаимодействия панели и расширения правьте обе стороны протокола.

### MCP-сервер

`src/ui/mcp/V8McpServer.ts` — локальный MCP-сервер для ИИ-агентов: навигация, чтение контрактов свойств, безопасное изменение метаданных. Канонический формат путей метаданных и типов — `docs/mcp-paths.md` (соблюдать при работе с MCP-инструментами).

## Ключевые принципы

- Один декларативный реестр `META_TYPES` → один конвейер, использующий его везде. Поведение — функции/сервисы поверх таблицы, без дублирующих словарей.
- Все пути (XML и BSL-модули) резолвятся только через `MetaPathResolver`.
- `bsl-analyzer` — единственный LSP; BSL-файлы открываются напрямую через `file://`.
- Ленивая загрузка дерева: дочерние узлы строятся при раскрытии.

## `.cursor/` — это контент для пользователей расширения, не для разработки самого расширения

`.cursor/rules/` (например `project_rules.mdc`, `anti-patterns.mdc`) и `.cursor/skills/` содержат **стандарты написания кода 1С/BSL и навыки работы с метаданными конфигураций 1С** — расширение устанавливает их как проектные ИИ-роли. Они относятся к редактируемым конфигурациям 1С, **не** к TypeScript-коду этого репозитория. При разработке самого расширения руководствуйтесь этим файлом и `AGENTS.md`, а не BSL-правилами из `.cursor/rules/`.
