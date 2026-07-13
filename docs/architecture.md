# Архитектура расширения 1С: Редактор конфигураций

## Назначение

VSCode-расширение `v8vscedit` предоставляет два независимых блока:

1. **[Навигатор метаданных](./metadata-navigator.md)** — дерево объектов конфигураций и расширений из XML-выгрузки.
2. **[Языковая поддержка BSL](./bsl-language-support.md)** — LSP-клиент для внешнего `bsl-analyzer`.

Дополнительно — независимая webview-панель **[«Изменения метаданных»](./git-metadata-changes.md)**
(`v8vsceditChanges`): `git status` рабочей копии в терминах объектов метаданных, с полноценными
git-операциями (stage/unstage/discard/commit/diff); дерево панели повторяет навигаторную иерархию
основного дерева конфигурации (обрезанную по изменениям), переиспользуя и Vue-компонент отрисовки,
и саму структуру `MetadataTreeProvider`.

Внутри той же панели — второй сворачиваемый блок **[«История»](./git-history-graph.md)**: граф
git-коммитов всего репозитория (свёрнут по умолчанию, грузится лениво при первом раскрытии), где выбор
коммита раскрывает inline изменённые объекты метаданных того же коммита — read-only потребитель движка
панели изменений (`aggregateMetadataChanges`, `changesDtoBuilder`, `changesTreeAssembler`), с собственным
чистым ядром раскладки графа по дорожкам (`infra/git/GitLogReader`, `GitLogParser`, `GitGraphLayout`) и
тонким чистым helper'ом состояния (`ui/views/changes/changesHistorySection.ts`), которым владеет тот же
`MetadataChangesViewProvider` — отдельного webview-провайдера/вкладки/команды для истории нет.

## Структура модулей

```
src/
├── extension.ts                      # тонкий activate/deactivate
├── Container.ts                      # composition root
├── domain/                           # чистый домен без vscode/fs/path
├── infra/                            # файловая система, XML, окружение, хранилище, git/, mcp/
│   ├── mcp/                          # McpServerIdentity/McpStartDecision/McpPortProbe/
│   │                                  # McpConflictPrompt/McpHost — чистая логика жизненного цикла
│   │                                  # встроенного MCP-сервера (без vscode), см.
│   │                                  # docs/mcp-server-lifecycle.md
│   └── git/                          # GitMetadataStatusService (декорации навигатора) +
│                                      # GitPorcelainReader/MetadataChangeResolver/
│                                      # MetadataChangeAggregator/GitBlobReader/GitStatusReader/
│                                      # GitWriteService (движок панели «Изменения метаданных») +
│                                      # GitLogReader/GitLogParser/GitGraphLayout/
│                                      # GitCommitChangesReader (чистое ядро блока «История»,
│                                      # см. docs/git-history-graph.md)
├── ui/                               # команды, дерево, webview, readonly guard
│   ├── views/changes/                # changesDtoBuilder (листья дерева) + changesTreeAssembler
│   │                                  # (сборка навигаторной иерархии секции) + changesHistorySection
│   │                                  # (чистый helper состояния блока «История» поверх
│   │                                  # historyGraphController/historyGraphDtoBuilder) +
│   │                                  # MetadataChangesViewProvider (единственный webview-провайдер
│   │                                  # v8vsceditChanges — строит цепочки предков через
│   │                                  # treeProvider.getParent на реальном MetadataTreeProvider и
│   │                                  # диспетчеризует команды блока «История»)
│   ├── views/history/                # ТОЛЬКО чистые модули (без vscode): historyGraphDtoBuilder/
│   │                                  # historyGraphController — см. docs/git-history-graph.md
│   └── git/                          # OnecGitContentProvider (схема onec-git для diff HEAD/индекс
│                                      # и произвольного commit-ish для блока «История»)
├── lsp/
│   ├── LspManager.ts                 # запуск и перезапуск bsl-analyzer
│   └── analyzer/
│       ├── BslAnalyzerService.ts     # установка, обновление, путь к бинарнику
│       └── BslAnalyzerStatusBar.ts   # индикатор состояния
└── test/
```

Встроенного LSP-сервера в `src/lsp/server` нет. Языковые возможности
предоставляет только внешний процесс `bsl-analyzer lsp`.

### Декомпозиция God-классов на тонкий фасад + подмодули

Правило зафиксировано в `CLAUDE.md` (раздел «Инвариант изменений» → «Декомпозиция
God-класса», запрет №17): большой класс дробится на тонкий фасад/барель + набор
файлов-подмодулей по ответственности **в подпапке того же слоя**, публичный API и
поведение не меняются байт-в-байт. Для XML-генераторов обязателен предварительный
байт-golden-тест как входное условие рефакторинга.

Реализованные образцы паттерна:

- `ui/mcp/V8McpServer.ts` (фасад, только HTTP-транспорт/сессии/Host-Origin-защита)
  + `ui/mcp/registration/*` — регистрация MCP-инструментов по доменам
  (`McpNavigationTools`, `McpConfigInfoTools`, `McpTemplateTools`,
  `McpExternalObjectTools`, `McpFormTools`, `McpSubsystemTools`, `McpRoleTools`,
  `McpConfigLifecycleTools`, `McpPropertyTools`) + `McpMutationGate` (общий
  post-mutation шлюз и формат-хелперы ответов) + `McpRegistrationDeps` (контракт
  зависимостей, разделяемых всеми доменными модулями).
- `infra/xml/MetadataXmlCreator.ts` (фасад) + `infra/xml/creator/*`
  (`creatorShared`, `rootObjectBuilders`, `auxiliaryFileBuilders`,
  `childElementBuilders`) — построение корневых XML-объектов, вспомогательных
  файлов и дочерних элементов метаданных.
- `infra/xml/ExternalObjectService.ts` (фасад) + `infra/xml/external/*`
  (`externalObjectShared`, `externalObjectXml`, `bspRegistration`,
  `externalObjectFiles`, `externalObjectValidation`) — работа с EPF/ERF.
- `infra/xml/DataCompositionSchemaService.ts` (фасад) + `infra/xml/dcs/*`
  (`dcsShared`, `schemaParse`, `schemaBuilders`, `editOperations`) — СКД.
- `infra/xml/form/FormBuilders.ts` (реэкспорт-барель) + `infra/xml/form/builders/*`
  (`formBuilderShared`, `formElements`, `formAttributes`, `formCommands`,
  `formDocument`) — построение XML управляемых форм.
- `ui/views/properties/PropertyBuilder.ts` (фасад) + `propertyKeyOrder.ts`
  (порядок ключей свойств корневых объектов) + `propertyExtractors.ts`
  (XML-экстракторы и форматтеры значений).
- `ui/views/properties/PropertiesViewController.ts` + `propertyEditLock.ts`
  (резолвер блокировки редактирования) + `propertyNodeClassification.ts`
  (классификация и snapshot узлов).

Во всех случаях `switch` по `MetaKind`/виду объекта, где он был, оставлен как есть
(это диспетчер поведения, а не реестр данных) — декомпозиция не подменяла его
таблицей, это отдельная задача при появлении настоящего дублирования данных.

## Граф зависимостей

```
extension.ts
  └── Container
      ├── infra/*
      ├── ui/tree/*
      ├── ui/commands/*
      ├── ui/readonly/BslReadonlyGuard
      └── lsp/LspManager
            ├── analyzer/BslAnalyzerService
            ├── analyzer/BslAnalyzerStatusBar
            └── LanguageClient
                  └── bsl-analyzer lsp
```

## Точка входа

`activate()` создаёт `Container` и делегирует ему регистрацию подсистем.

`Container.bootstrap()`:

1. Создаёт инфраструктурные сервисы.
2. Регистрирует дерево, webview-панели, декорации, watcher-ы и команды.
3. Загружает найденные XML-выгрузки конфигураций.
4. Регистрирует `BslReadonlyGuard`.
5. Запускает `LspManager`.

`deactivate()` останавливает активный LSP-клиент через `client.stop()`.

## Ключевые архитектурные решения

| Решение | Обоснование |
|---|---|
| `META_TYPES` как единый реестр типов | Добавление типа метаданных не требует параллельных словарей |
| `MetaPathResolver` как единый resolver путей | Все XML и BSL-модули резолвятся через один инфраструктурный контракт |
| `bsl-analyzer` как единственный LSP | Нет дублирования возможностей и расхождения диагностики между режимами |
| Прямое открытие BSL через `file://` | Внешний LSP работает с реальными файлами, без виртуальной схемы |
| `BslReadonlyGuard` для BSL | Запрет редактирования не зависит от способа открытия файла |
| Ленивая загрузка дерева | Дочерние узлы строятся при раскрытии, а не при старте расширения |
| God-класс → тонкий фасад + подмодули в подпапке слоя | Убирает файлы 1000+ строк без риска регресса: рефактор косметический, публичный API и поведение неизменны (см. выше) |
| MCP-сервер: одна попытка bind, без авто-инкремента порта; конфликт разрешается зондом `/identity` | Авто-инкремент молча подключал агента не к тому проекту; явное `reuse`/`conflict-foreign`/`conflict-unknown` не даёт агенту работать с чужой конфигурацией (см. [mcp-server-lifecycle.md](./mcp-server-lifecycle.md)) |
| `stop()` MCP-сервера форсирует `closeAllConnections()` до `close()` | Долгоживущие SSE-соединения не давали `httpServer.close()` освободить порт естественным путём (см. [mcp-server-lifecycle.md](./mcp-server-lifecycle.md)) |
| Модель трёх деревьев git (HEAD/индекс/рабочее дерево) в представлении изменений | Единственный способ получить непустой diff для staged-файла — сравнивать HEAD↔индекс, а не индекс↔рабочее дерево (см. [git-metadata-changes.md](./git-metadata-changes.md)) |
| Предки объекта в блоке «История» синтезируются из `META_TYPES`, а не берутся из живого дерева навигатора | Живое дерево отражает только текущую рабочую копию и врало бы для исторического состояния коммита (см. [git-history-graph.md](./git-history-graph.md)) |

## Подробная документация

- [Навигатор метаданных](./metadata-navigator.md) — дерево, команды, path resolver.
- [Языковая поддержка BSL](./bsl-language-support.md) — запуск `bsl-analyzer` и настройки.
- [Парсинг XML конфигурации](./metadata-parser.md) — алгоритмы разбора Configuration.xml и объектных XML.
- [Изменения метаданных](./git-metadata-changes.md) — семантический git по объектам 1С, представление `v8vsceditChanges`.
- [История изменений](./git-history-graph.md) — граф git-коммитов по объектам 1С, сворачиваемый блок панели `v8vsceditChanges`.
- [Жизненный цикл MCP-сервера](./mcp-server-lifecycle.md) — старт/остановка, освобождение порта, обнаружение и разрешение конфликта порта; канон путей MCP-инструментов — отдельно, в [mcp-paths.md](./mcp-paths.md).
