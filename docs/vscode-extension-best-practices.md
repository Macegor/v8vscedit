# Лучшие практики разработки расширений VS Code

Обязательный стандарт для агентов **architect** и **reviewer** (см. [agentic-pipeline.md](./agentic-pipeline.md)).
Каждое правило: формулировка — почему — источник. Фокус — TypeScript-расширение с webview-навигатором,
LSP-клиентом (`vscode-languageclient`) и локальным MCP-сервером, то есть под архитектуру v8vscedit.

Многие правила уже закреплены в корневом `CLAUDE.md`; здесь они собраны вместе с внешними источниками
и дополнены тем, чего в проекте пока нет. Отметки **[совпадает с CLAUDE.md]** — правило уже действует.

---

## 1. Активация и производительность

- **Никогда не использовать `"*"` в `activationEvents`.** Активирует расширение при старте редактора и
  бьёт по времени запуска; допустимо только когда ни одно другое событие не подходит.
  [activation-events](https://code.visualstudio.com/api/references/activation-events)
- **С VS Code 1.74 команды/языки/views/custom editors активируются автоматически** — не дублировать
  `onCommand:*`, `onView:*`, `onLanguage:*` в `activationEvents`, если ресурс объявлен в `contributes`.
  [activation-events](https://code.visualstudio.com/api/references/activation-events)
- **Использовать максимально узкие события, комбинируя несколько специфичных** вместо одного широкого —
  расширение грузится строго когда нужно.
- **Для фоновой инициализации предпочитать `onStartupFinished` вместо `"*"`** — работа стартует после
  критичного пути запуска редактора, не задерживая его.
- **Тяжёлые зависимости импортировать лениво (`await import(...)`)** внутри `activate()` по факту первого
  использования (парсеры, MCP SDK, LSP-клиент), а не на верхнем уровне модуля — меньше cold-start.
  [Optimizing Extensions](https://www.swiftorial.com/tutorials/development_tools/vs_code/performance_optimization/optimizing_extensions/)
- **Бандлить расширение (у проекта — Vite).** Один файл вместо сотен снижает install/startup-time;
  production-режим даёт минификацию. **[совпадает с CLAUDE.md: `main: ./dist/extension.js`]**
  [bundling-extension](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- **Extension host пока на CommonJS — tree-shaking ограничен** (миграция VS Code на ESM в процессе).
  Не рассчитывать на удаление мёртвого кода как в web-бандле.
  [devclass ESM](https://www.devclass.com/development/2024/10/14/vs-code-migration-to-ecmascript-modules-massively-improves-startup-performance-but-extensions-left-behind-for-now/1624637)
- **TreeDataProvider: ленивая загрузка через `getChildren(element)`** — дети грузятся только при раскрытии
  узла, никогда не строить всё дерево на инициализации. **[совпадает с CLAUDE.md: ленивое дерево]**
  [Tree View guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- **Точечный рефреш: `onDidChangeTreeData.fire(element)` обновляет только детей узла**; `fire()` без
  аргумента — только при изменении корня. [issue #34789](https://github.com/Microsoft/vscode/issues/34789)
- **Никакого синхронного I/O в hot path** — в `getTreeItem`, `tooltip`, геттерах, `FileDecorationProvider`.
  **[совпадает с CLAUDE.md: запрет №11]**
- **Профилировать активацию** через `Developer: Show Running Extensions` — измерять, а не гадать.

---

## 2. Архитектура расширения

- **Тонкий `extension.ts`: только `activate`/`deactivate`, делегирующие в composition root.**
  **[совпадает с CLAUDE.md: `Container.bootstrap()`]**
  [patterns-and-principles](https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/)
- **Единый composition root собирает сервисы; никаких `new Service()` в командах/builder'ах.**
  **[совпадает с CLAUDE.md: запрет №7]**
- **Строго разделять слой vscode-API и чистую логику** — домен/инфру покрывать unit-тестами без запуска
  extension host. **[совпадает с CLAUDE.md: `vscode` запрещён в `domain/`/`infra/`]**
  [testing-extension](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- **`deactivate()` возвращает `Promise`, если есть асинхронная очистка** (остановка LSP-клиента,
  MCP-сервера) — VS Code дожидается завершения перед выгрузкой.
  [extension-anatomy](https://code.visualstudio.com/api/get-started/extension-anatomy)
- **Webview: `default-src 'none'` + nonce для скриптов — базовый CSP.** Разрешать только
  `${webview.cspSource}` для скриптов/стилей; inline-скрипты запрещены.
  [webview guide](https://code.visualstudio.com/api/extension-guides/webview)
- **`getState()`/`setState()` — предпочтительный способ хранить состояние webview, не
  `retainContextWhenHidden`** (высокий memory overhead; включать только для несериализуемого состояния).
- **`acquireVsCodeApi()` вызывать один раз и держать приватно** — нельзя утечь в глобальную область
  и нельзя получить повторно.
- **Message passing со строгой типизацией/валидацией** — обе стороны протокола типизированы
  (`src-ui/shared/protocol/`); данные из webview валидировать перед действием.
- **Чистить ресурсы webview в `onDidDispose()`** — таймеры/подписки/соединения, чтобы фон не писал
  в уничтоженный webview.
- **LSP-клиент: один `LanguageClient`, `client.start()`, disposable в `context.subscriptions`.**
  [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node)
- **Рестарт-политику LSP задавать через `LanguageClientOptions.errorHandler`** (дефолт перезапускает,
  пока не ≥5 падений за 3 мин) — переопределять при своей стратегии для `bsl-analyzer`.
- **Не диспозить LSP-клиент до завершения инициализации** — иначе команды сервера не разрегистрируются
  (утечка). [issue #725](https://github.com/microsoft/vscode-languageserver-node/issues/725)

---

## 3. Безопасность

- **Webview CSP + nonce — обязательный первый рубеж** от инъекций; nonce регенерируется на каждую
  загрузку. [trailofbits](https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/)
- **`localResourceRoots` сузить до конкретной папки, пути прогонять через `asWebviewUri()`** — сам по
  себе не полная защита, комбинировать с CSP.
- **`enableScripts: true` включать только при реальной необходимости** — скрипты главный вектор
  исполнения кода в webview.
- **Секреты — только через `SecretStorage` API, никогда в файлы проекта/`settings.json`** (OS keyring).
  **[совпадает с CLAUDE.md: запрет №9]**
  [SecretStorage](https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco)
- **Недоверенный workspace: объявить `capabilities.untrustedWorkspaces` в `package.json`** и не исполнять
  код (запуск vrunner, LSP на недоверенных путях) в Restricted Mode.
  [workspace-trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- **Проверять `vscode.workspace.isTrusted` и `onDidGrantWorkspaceTrust`** перед операциями, исполняющими
  код или трогающими внешние процессы.
- **MCP/локальный сервер: bind только на loopback (`127.0.0.1`/`::1`), никогда `0.0.0.0`.**
  **[совпадает с CLAUDE.md: политика MCP]**
  [MCP security](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- **Loopback ≠ достаточно: валидировать `Host`/`Origin`** против DNS-rebinding из браузера. *(TODO проекта:
  V8McpServer сейчас только bind на loopback.)*
  [descope](https://www.descope.com/blog/post/mcp-server-security-best-practices)
- **MCP-инструмент не исполняет произвольную строку/`executeCommand`, не пишет XML в обход сервиса.**
  **[совпадает с CLAUDE.md: правила MCP]**
- **Санитизировать динамический контент в webview** (содержимое файлов, пути, настройки) как defense in
  depth с CSP.

---

## 4. Тестирование

- **`@vscode/test-cli` + `@vscode/test-electron` — стандарт integration-тестов** с доступом к vscode API;
  тесты в отдельной стираемой инсталляции редактора.
  [testing-extension](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- **Конфиг `.vscode-test.mjs`: `files`, `version`, `workspaceFolder`, `mocha`** — декларативная точка
  входа CLI. *(TODO проекта: свой runner на `@vscode/test-electron`; миграция на `test-cli` упростит
  запуск/дебаг отдельных тестов.)* [vscode-test](https://github.com/microsoft/vscode-test)
- **Пирамида: максимум логики — в unit-тестах домена/инфры без extension host**, тонкий UI-адаптер —
  integration-тестом. **[совпадает с CLAUDE.md: политика покрытия]**
- **Пиновать версию редактора (`version` / `VSCODE_TEST_VERSION`)** — воспроизводимость и проверка
  минимального `engines.vscode`. **[совпадает с CLAUDE.md: `VSCODE_TEST_VERSION=...`]**
- **TDD (красный→зелёный) на реальных фикстурах, без заглушек ради покрытия** — мокать только внешнюю
  недоступную систему. **[совпадает с CLAUDE.md: раздел TDD]**
- **Тесты — часть CI, прогон на нескольких версиях VS Code** через matrix.

---

## 5. API-контракты и contributions

- **`engines.vscode = ^X.Y.Z` объявляет минимально требуемую версию API** — поднимать при использовании
  новых API. [publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- **Proposed API — только в Insiders/разработке, публиковать с ним нельзя** (`enabledApiProposals`).
  [using-proposed-api](https://code.visualstudio.com/api/advanced-topics/using-proposed-api)
- **Каждая настройка — уникальный ID `<extension>.<область>.<ключ>`** (у проекта `v8vscedit.<область>.<ключ>`).
  **[совпадает с CLAUDE.md: раздел «Новая настройка»]**
  [contribution-points](https://code.visualstudio.com/api/references/contribution-points)
- **Команды — title-case, короткие предлоги не капитализировать.**
  [command guide](https://code.visualstudio.com/api/extension-guides/command)
- **Видимость команд/меню/views — через `when`-clauses**; кастомный контекст через `setContext` только
  когда штатных ключей не хватает.
  [when-clause](https://code.visualstudio.com/api/references/when-clause-contexts)
- **Настройку в `when` брать через `config.<ключ>`** — реактивное вкл/выкл UI.
- **Каждая команда из `contributes.commands` должна быть реально зарегистрирована.**
  **[совпадает с CLAUDE.md: запрет №3 + `CommandRegistry`]**

> Примечание для v8vscedit: основной UI — webview `UniversalPanelViewProvider`, контекстное меню узлов
> формируется в коде (`getNodeActions`/`MODULE_SLOT_ACTIONS`), а не через `contributes.menus`. См.
> `CLAUDE.md` (раздел про основной UI). Правила выше про `contributes` применяются к нативному TreeView.

---

## 6. UX-гайдлайны

- **Webview — крайняя мера: сначала штатные компоненты (tree/quick pick/status bar)** — webview не
  наследует тему/доступность/навигацию автоматически и дороже. *(У проекта webview оправдан: сложный
  навигатор + Vue.)* [webviews UX](https://code.visualstudio.com/api/ux-guidelines/webviews)
- **Tree View: избегать глубокой вложенности** — пара уровней оптимальна.
  [views UX](https://code.visualstudio.com/api/ux-guidelines/views)
- **Уведомления — экономно** (перебивают внимание); не спамить прогрессом/успехом.
  [notifications UX](https://code.visualstudio.com/api/ux-guidelines/notifications)
- **Фоновый прогресс — Status Bar с loading-иконкой; progress-notification только при необходимости
  внимания.** [status-bar UX](https://code.visualstudio.com/api/ux-guidelines/status-bar)
- **Долгие внешние операции (vrunner/импорт) — через `window.withProgress` с отменой.**
  **[совпадает с CLAUDE.md: раздел про vrunner]**
- **Quick Pick — когда нужен гибкий ввод/выбор**, которого не дают более простые механизмы.

---

## 7. Публикация и качество

- **`.vscodeignore`: исключать всё, что не нужно в рантайме** (`**/*.ts`, исходники, тесты, конфиги
  сборки); `devDependencies` игнорируются автоматически.
  [publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- **Публиковать забандленный артефакт** (`main` = один бандл) — меньше файлов, быстрее install/startup.
- **SemVer: `vsce publish major|minor|patch`** автоинкрементит версию + git-tag.
  [vsce cli](https://vscode-docs.readthedocs.io/en/latest/tools/vscecli/)
- **`vscode:prepublish` в `scripts` для сборки перед упаковкой.**
- **CI-публикация: Entra ID вместо PAT** (глобальные PAT в Azure DevOps выводятся из строя с 1 дек 2026),
  `vsce >= 2.26.1`.
- **strict TS + lint без warnings как gate перед публикацией.**
  **[совпадает с CLAUDE.md: `npm run compile` / `lint --max-warnings=0`]**
- **Вести `CHANGELOG.md`** — Marketplace показывает его на странице расширения.

---

## 8. Управление ресурсами

- **Всё, что возвращает `Disposable` (команды, listeners, providers, watchers, tree view, status bar),
  — в `context.subscriptions`** — VS Code диспозит при деактивации.
  [patterns-and-principles](https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/)
- **Каждая подписка на событие должна быть отписана** — незакрытые listeners = утечка памяти.
  [VS Blog](https://devblogs.microsoft.com/visualstudio/avoiding-memory-leaks-in-visual-studio-editor-extensions/)
- **Ресурсы с временем жизни короче расширения диспозить вручную** (пересоздаваемый webview/LSP-клиент/
  MCP-сервер), не только через `subscriptions`.
- **`FileSystemWatcher` создавать в composition root/support-слое и диспозить.**
  **[совпадает с CLAUDE.md: watcher только в `Container`]**
- **`deactivate()` явно останавливает LSP-клиент и MCP-сервер** (`client.stop()`, закрытие
  HTTP-listener), дожидаясь `Promise`.
- **Не полагаться на диспоуз `subscriptions` при аварийном завершении** — критичную очистку (порты,
  временные файлы) делать явно. [issue #140697](https://github.com/microsoft/vscode/issues/140697)

---

## Соответствие текущей архитектуре и точки улучшения

Практики совпадают с уже принятыми в `CLAUDE.md`: тонкий `extension.ts` + `Container.bootstrap()`,
ленивое дерево, запрет `vscode` в `domain/`/`infra/`, MCP на loopback без произвольных команд, секреты
в `SecretStorage`, `writeTextFilePreservingBomAndEol`, 100% покрытие на реальных фикстурах.

Кандидаты на улучшение (не реализованы, фиксируются как рекомендации):
1. **`onStartupFinished`** для фоновой инициализации вместо любых широких событий активации.
2. Миграция тест-раннера на **`@vscode/test-cli`** (`.vscode-test.mjs`) — проще запуск/дебаг отдельных тестов.
3. Для MCP-сервера — явная **валидация `Host`/`Origin`** (не только bind на loopback) против DNS-rebinding.
4. Проверить, что **`deactivate()`** дожидается остановки LSP-клиента и закрытия MCP-listener (возврат `Promise`).

Любую из этих задач следует проводить по конвейеру (см. [agentic-pipeline.md](./agentic-pipeline.md)).

---

## Источники

- https://code.visualstudio.com/api/references/activation-events
- https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- http://datho7561.dev/blog/vscode-webpack-to-esbuild/
- https://www.devclass.com/development/2024/10/14/vs-code-migration-to-ecmascript-modules-massively-improves-startup-performance-but-extensions-left-behind-for-now/1624637
- https://www.swiftorial.com/tutorials/development_tools/vs_code/performance_optimization/optimizing_extensions/
- https://code.visualstudio.com/api/extension-guides/tree-view
- https://github.com/Microsoft/vscode/issues/34789
- https://code.visualstudio.com/api/extension-guides/webview
- https://blog.trailofbits.com/2023/02/21/vscode-extension-escape-vulnerability/
- https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
- https://code.visualstudio.com/api/extension-guides/workspace-trust
- https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- https://www.descope.com/blog/post/mcp-server-security-best-practices
- https://christian-schneider.net/blog/securing-mcp-defense-first-architecture/
- https://code.visualstudio.com/api/working-with-extensions/testing-extension
- https://github.com/microsoft/vscode-test
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://vscode-docs.readthedocs.io/en/latest/tools/vscecli/
- https://code.visualstudio.com/api/advanced-topics/using-proposed-api
- https://code.visualstudio.com/api/references/contribution-points
- https://code.visualstudio.com/api/references/when-clause-contexts
- https://code.visualstudio.com/api/extension-guides/command
- https://code.visualstudio.com/api/ux-guidelines/views
- https://code.visualstudio.com/api/ux-guidelines/notifications
- https://code.visualstudio.com/api/ux-guidelines/status-bar
- https://code.visualstudio.com/api/ux-guidelines/webviews
- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
- https://devblogs.microsoft.com/visualstudio/avoiding-memory-leaks-in-visual-studio-editor-extensions/
- https://github.com/microsoft/vscode-languageserver-node
- https://github.com/microsoft/vscode-languageserver-node/issues/725
- https://github.com/microsoft/vscode/issues/140697
