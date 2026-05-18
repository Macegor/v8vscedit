# AGENTS.md — инструкции для агентов

Документация проекта ведётся в `./docs`. Этот файл — контракт для любого агента, вносящего изменения в расширение.

## Что это за проект

VSCode / Cursor-расширение `v8vscedit` — редактор выгрузки конфигураций и расширений 1С:Предприятие. Две независимые подсистемы:

1. **Навигатор метаданных** — дерево объектов из XML-выгрузки (CF и CFE), свойства, открытие BSL-модулей.
2. **Языковая поддержка BSL** — LSP-клиент для внешнего `bsl-analyzer`.

Главное: расширение читает уже выгруженные XML-файлы 1С и обеспечивает удобную навигацию + редактирование BSL-модулей; запись XML сейчас не реализована.

### Основной пользовательский интерфейс

**Основным UI навигатора является `UniversalPanelViewProvider` (`ui/views/universal/`)** — HTML-webview-панель со встроенным деревом метаданных, поиском, контекстным меню и быстрыми операциями.

Нативный VSCode TreeView (`ui/tree/MetadataTreeProvider`) существует как вспомогательная структура данных — `UniversalPanelViewProvider` использует его как источник узлов (`treeProvider.getChildren()`), но сам TreeView-виджет в боковой панели является атавизмом и **не должен рассматриваться как основной UI**.

Следствия:
- Контекстное меню узлов (команды открытия модулей, XML и т.п.) формируется в `UniversalPanelViewProvider.getNodeActions()` / `addModuleActions()`, а **не** через `package.json → contributes.menus.view/item/context`.
- Правила меню в `package.json` обновляются для совместимости, но **основной источник правды для команд узлов — `META_TYPES.modules`**, читаемый из `addModuleActions`.
- При добавлении новой команды для узла: добавить в `MODULE_SLOT_ACTIONS` (в `UniversalPanelViewProvider.ts`) и зарегистрировать в `CommandRegistry`. Правки `package.json → menus` — по желанию, для нативного TreeView.

---

## Базовые правила общения

- Отвечать на русском языке.
- Комментарии и документация в коде — только на русском.
- Никаких декоративных эмодзи в коде и ответах.
- Избегать высокоуровневых ответов — давать конкретные решения применительно к проекту.
- Не писать «комментарии-капитаны» (`// импортируем X`, `// возвращаем результат`). Комментарий имеет право на жизнь, если объясняет *почему*, а не *что*.
- Коммиты — на русском.

## Технологический стек

- TypeScript ≥ 5.3, target ES2020, strict.
- VS Code API ≥ 1.85, `vscode-languageclient`.
- Webpack 5 (сборка в `dist/`). Три entry: `extension`, `server`, `test/runTests`.
- `iconv-lite` — декодирование OEM-866/Win1251 вывода vrunner.
- Тесты — Mocha через `@vscode/test-electron`.

---

## Целевая архитектура

Единый принцип: **одна декларативная таблица типов метаданных → один конвейер, использующий её везде**. Всё поведение — функции и сервисы поверх этой таблицы.

### Раскладка каталогов

```
src/
├── extension.ts                      # composition root (10 строк): new Container(ctx).activate()
├── container.ts                      # IoC-сборка: создаёт все сервисы, регистрирует команды/watcher/view
│
├── domain/                           # Чистый домен — НЕ импортирует vscode, fs, path из этой папки
│   ├── MetaTypes.ts                  # Единый реестр META_TYPES: Record<MetaKind, MetaTypeDef>
│   ├── MetaKind.ts                   # type MetaKind = keyof typeof META_TYPES
│   ├── ChildTag.ts                   # Перечисление тегов дочерних элементов + CHILD_TAG_CONFIG
│   ├── ModuleSlot.ts                 # Слоты модулей: 'Object'|'Manager'|'Form'|'Command'|…
│   ├── Configuration.ts              # ConfigInfo, ConfigEntry, ChildObjectsMap
│   ├── MetaObject.ts                 # MetaObject, MetaChild (результат парсинга XML объекта)
│   └── Ownership.ts                  # определение «свой/заимствованный» по namePrefix для CFE
│
├── infra/                            # Работа с файловой системой и XML; vscode не импортировать
│   ├── xml/
│   │   ├── ConfigXmlReader.ts        # парсер Configuration.xml → ConfigInfo
│   │   ├── ObjectXmlReader.ts        # парсер XML объекта → MetaObject
│   │   ├── PropertySchema.ts         # декларативные схемы свойств по MetaKind
│   │   ├── XmlUtils.ts               # extractSimpleTag, extractSynonym, extractNestingAwareBlock
│   │   ├── ConfigurationXmlEditor.ts # сервис редактирования Configuration.xml
│   │   ├── SubsystemXmlService.ts    # работа с Subsystems.xml
│   │   ├── ExchangePlanContentService.ts  # работа с ExchangePlanContent.xml
│   │   ├── BasedOnXmlService.ts      # чтение/запись BasedOnConfigurationName
│   │   ├── MetadataXmlCreator.ts     # создание новых XML-объектов метаданных
│   │   └── MetadataXmlRemover.ts     # удаление XML-объектов метаданных
│   ├── fs/
│   │   ├── ConfigLocator.ts          # рекурсивный поиск Configuration.xml (bывш. ConfigFinder)
│   │   └── MetaPathResolver.ts       # единый resolver: XML + все модули по ModuleSlot
│   ├── support/
│   │   ├── SupportInfoReader.ts      # чтение ParentConfigurations.bin, parse UUID → SupportMode
│   │   ├── SupportInfoService.ts     # кэш по SHA-1 ParentConfigurations.bin
│   │   └── Logger.ts                 # канал OutputChannel логгера
│   ├── cache/
│   │   ├── MetadataCache.ts          # кэш метаданных
│   │   └── hashCache.ts              # кэш хешей файлов (CLI)
│   ├── repository/
│   │   └── RepositoryService.ts      # работа с хранилищем 1С, локальные захваты
│   ├── git/
│   │   └── GitMetadataStatusService.ts  # статус Git для узлов метаданных
│   ├── environment/
│   │   ├── BslAnalyzerConfigService.ts  # генерация bsl-analyzer.toml
│   │   ├── ProjectEnvironmentService.ts # управление окружением проекта
│   │   └── InfoBaseRegistryService.ts   # парсинг списка баз из v8i
│   ├── process/
│   │   ├── OnecPlatform.ts           # поиск платформы 1С
│   │   ├── ProcessRunner.ts          # spawn с кодировкой
│   │   └── OutputDecoder.ts          # декодер OEM/Win1251 вывода
│   └── skills/
│       └── AiSkillsInstaller.ts      # установка AI-навыков
│
├── ui/                               # Всё, что знает про vscode API
│   ├── tree/
│   │   ├── MetadataTreeProvider.ts   # TreeDataProvider: только getTreeItem/getChildren/refresh
│   │   ├── TreeNode.ts               # vscode.TreeItem-обёртка над TreeNodeModel (тонкий)
│   │   ├── TreeNodeModel.ts          # POJO-модель узла (kind, xmlPath, ownership, metaContext, …)
│   │   ├── nodeBuilders/
│   │   │   ├── ConfigRootBuilder.ts      # корневые узлы конфигурации/расширения
│   │   │   ├── GroupBuilder.ts           # группа «Общие», группы типов, «Документы» с подветками
│   │   │   ├── MetaObjectBuilder.ts      # универсальный builder листа и структурного объекта
│   │   │   ├── MetaChildBuilder.ts       # реквизиты, ТЧ+колонки, формы, команды, макеты
│   │   │   └── SubsystemBuilder.ts       # спец-builder для рекурсивной иерархии подсистем
│   │   └── decorations/
│   │       ├── SupportDecorator.ts       # добавляет -supportN суффикс к contextValue
│   │       ├── SupportDecorationProvider.ts  # FileDecorationProvider для цвета в Explorer
│   │       └── GitMetadataDecorationProvider.ts # FileDecorationProvider для статуса Git
│   ├── views/
│   │   ├── PropertiesViewProvider.ts     # singleton WebviewPanel (как сейчас)
│   │   ├── UniversalPanelViewProvider.ts # основной UI — универсальная панель с деревом
│   │   ├── properties/
│   │   │   ├── PropertyBuilder.ts        # один builder по PropertySchema
│   │   │   └── _types.ts                 # типы значений свойств
│   │   ├── subsystem/                    # редактор подсистем
│   │   ├── search/                       # поиск по дереву
│   │   ├── repository/                   # UI подключения и захвата хранилища
│   │   ├── environment/                  # UI управления окружением проекта
│   │   ├── standalone/                   # автономный сервер
│   │   ├── webview/                      # общие утилиты webview (nonce)
│   │   └── dto/                          # DTO для Vue-компонентов
│   ├── commands/
│   │   ├── CommandRegistry.ts            # registerAll(ctx, services) — диспатч по классам-командам
│   │   ├── open/
│   │   │   ├── OpenXmlCommand.ts
│   │   │   └── OpenModuleCommand.ts      # один на все слоты модулей
│   │   ├── properties/
│   │   │   └── ShowPropertiesCommand.ts
│   │   ├── support/
│   │   │   └── SupportIndicatorCommands.ts
│   │   └── ext/
│   │       ├── VrunnerRunner.ts          # spawn + декодер кодировок + прогресс
│   │       ├── DecompileExtensionCommand.ts
│   │       ├── CompileExtensionCommand.ts
│   │       ├── UpdateExtensionCommand.ts
│   │       ├── CompileAndUpdateExtensionCommand.ts
│   │       └── ShowConfigActionsCommand.ts
│   └── readonly/
│       └── BslReadonlyGuard.ts           # ReadonlySession для BSL-файлов под замком поддержки
│
├── lsp/                                  # Подсистема языковой поддержки BSL через bsl-analyzer
│   ├── LspManager.ts
│   ├── analyzer/
│   │   ├── BslAnalyzerService.ts
│   │   └── BslAnalyzerStatusBar.ts
├── ui/mcp/                               # Локальный MCP-сервер для ИИ-агентов
│   ├── V8McpServer.ts                    # Streamable HTTP endpoint localhost после reloadEntries()
│   ├── McpNodeRegistry.ts                # стабильные nodeId поверх дерева UniversalPanel
│   └── McpPropertyService.ts             # контракт и безопасная запись свойств
│
├── cli/                                  # Node CLI entry для операций 1С без vscode API
│   ├── onec-tools.ts
│   ├── commands/
│   └── core/                             # только CLI-адаптеры; общая логика живёт в infra
│
└── test/
    ├── runTests.ts
    └── suite/…
```

`cli/` — отдельный потребитель `domain/` и `infra/`. Нижние слои не импортируют
`cli/**`; если код нужен и расширению, и CLI, он переносится в `infra/<подпапка>/`,
а `cli/core/*` может оставить только тонкий совместимый re-export.

### Центральный контракт — `META_TYPES`

Единственный источник правды по типам метаданных. Всё остальное (иконки, папки выгрузки, дочерние элементы, слоты модулей, группировка в дереве, свойства) описывается здесь.

```typescript
// domain/MetaTypes.ts
export interface MetaTypeDef {
  kind: MetaKind;                  // 'Catalog'
  label: string;                   // 'Справочник'
  pluralLabel: string;             // 'Справочники'
  folder: string;                  // 'Catalogs'
  icon: string;                    // имя SVG без расширения
  group: 'common' | 'top' | 'documents' | 'hidden';
  groupOrder: number;
  childTags?: readonly ChildTag[]; // ['Attribute','TabularSection','Form','Command','Template']
  modules?: readonly ModuleSlot[]; // ['Object','Manager']
  propertySchema?: string;         // ключ в PROPERTY_SCHEMAS
  singleClickCommand?: CommandId;
}
```

Правила:
- **Добавление нового типа метаданных — ТОЛЬКО одна запись в `META_TYPES`.** Если пришлось править что-то ещё — это признак утечки знаний из реестра.
- Никаких параллельных словарей `typeToFolder`, `NODE_DESCRIPTORS`, `HANDLER_REGISTRY`.
- `ConfigXmlReader`, `MetaPathResolver`, `MetaObjectBuilder`, `GroupBuilder`, `PropertyBuilder` — все читают данные из `META_TYPES`.

### Центральный контракт — `MetaPathResolver`

Один класс вместо 9 функций:

```typescript
class MetaPathResolver {
  resolveXml(kind: MetaKind, name: string, root: string): string | null;
  resolveModule(node: TreeNodeModel, slot: ModuleSlot): string | null;
  ensureCommonModuleFile(node: TreeNodeModel): string | null;
  getObjectLocation(xmlPath: string): ObjectLocation;
}
```

Карта слотов модулей (`Object→Ext/ObjectModule.bsl` и т.п.) — внутри класса как данные.

### Слои и правила зависимостей

```
domain          ←   никто (самый низ)
infra           ←   domain
ui              ←   domain, infra
lsp             ←   infra (на чтение файлов), domain (опционально)
container/ext   ←   всё
```

Запреты:
- `domain/**` не импортирует `vscode`, `fs`, `path`.
- `infra/**` не импортирует `vscode`.
- `domain/**` и `infra/**` не импортируют `cli/**`; CLI всегда потребитель, а не зависимость.
- `ui/**` не содержит regex-парсинга XML и вычислений путей — только вызовы `infra/*`.
- LSP-подсистема не содержит встроенного сервера; все языковые возможности идут через внешний `bsl-analyzer`.

### Composition root

```typescript
// extension.ts
export function activate(context: vscode.ExtensionContext): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }
  container = Container.bootstrap(context, folders[0]);
}
export function deactivate(): Promise<void> | undefined {
  return container?.lspManager.stop();
}
```

`Container` — единственное место создания всех сервисов. `Container.bootstrap()`:
1. Создаёт `OutputChannel` и все сервисы домена/инфры.
2. Регистрирует `TreeView`, `SupportDecorationProvider`, `FileSystemWatcher`.
3. Вызывает `CommandRegistry.registerAll(ctx, services)`.
4. Вызывает `reloadEntries()`.
5. После полной загрузки дерева запускает `V8McpServer` (если включён `v8vscedit.mcp.enabled`).
6. Стартует `LspManager`.

### MCP-сервер для ИИ-агентов

Локальный MCP-сервер — официальный канал автоматизации для ИИ-агентов. Он
запускается только после `reloadEntries()`, слушает loopback-адрес и не должен
давать агенту прямой доступ к shell, произвольным путям или произвольным VS Code
командам.

Правила:
- SDK: использовать production-ветку `@modelcontextprotocol/sdk` v1.x. Переход на новые split-пакеты SDK допускается только отдельной миграцией с проверкой транспорта.
- Транспорт: Streamable HTTP на `127.0.0.1`/`localhost`/`::1`; удалённый bind запрещён без отдельной модели авторизации.
- Инструменты MCP регистрируются в `ui/mcp/V8McpServer.ts`, но бизнес-логика живёт в общих сервисах (`infra/*`, `ui/commands/*/*Service.ts`). UI-команда и MCP-инструмент для одного действия обязаны вызывать один и тот же код.
- Для новых и будущих команд, меняющих конфигурацию или базу (импорт, обновление, создание/удаление/редактирование метаданных), добавлять MCP-инструмент или явно документировать, почему команда не должна быть доступна агенту.
- Нельзя делать MCP-инструмент, который исполняет произвольную строку команды, произвольный `vscode.commands.executeCommand` или пишет XML напрямую в обход существующего сервиса.
- Любой инструмент записи сначала валидирует входные данные и права редактирования, возвращает список изменённых файлов и маркирует конфигурацию изменённой тем же механизмом, что UI.
- Для редактирования свойств обязательны два шага: сначала `get_property_contract` для конкретного узла и свойства, затем запись только значения, допустимого контрактом. Enum/boolean/multiEnum/readonly проверяются до изменения XML; свойства со сложными типами получают отдельные специализированные инструменты.
- Значения enum, boolean/localized-классификация и схемы свойств остаются в `infra/xml/PropertySchema.ts` или специализированном infra-реестре, а MCP только публикует этот контракт.

---

## Инвариант изменений — как добавлять функциональность

Для каждого сценария указано, какие файлы трогать. Если требуется править что-то сверх списка — это признак, что задача решается в другом слое.

### Новый тип метаданных

1. Добавить запись в `META_TYPES` (`domain/MetaTypes.ts`).
2. Если у объекта есть специфический модуль — добавить `ModuleSlot` в `domain/ModuleSlot.ts` и в карту слотов внутри `infra/fs/MetaPathResolver.ts`.
3. Если нужен набор свойств — добавить схему в `PROPERTY_SCHEMAS` (`infra/xml/PropertySchema.ts`).
4. Иконку положить в `src/icons/{light,dark}/<icon>.svg` (имя — ровно то, что указано в `icon` записи `META_TYPES`).
5. При нестандартной логике сборки узла (например, рекурсия подсистем) — добавить builder в `ui/tree/nodeBuilders/<имя>.ts` и подключить в диспетчере `metaObjectTreeBuilder.ts`. Иначе — ничего.
6. Добавить тест `ObjectXmlReader` на реальный пример из `example/`.

### Новый слот модуля (`ModuleSlot`)

Нужен, когда появляется новый BSL-файл объекта (например, `VariantChangeModule` у отчёта).

1. Добавить литерал в `domain/ModuleSlot.ts`.
2. Зарегистрировать путь в карте слотов внутри `infra/fs/MetaPathResolver.ts` (`Ext/<Имя>.bsl`).
3. Если нужна команда «Открыть модуль …» — добавить `OpenModuleCommandId` и команду в `ui/commands/CommandRegistry.ts`.
4. Подвязать к типам: расширить поле `modules` в нужных записях `META_TYPES`.

### Новый тип дочернего элемента (`ChildTag`)

Нужен, когда в XML объекта появляется новый вложенный тег (например, `AddressingAttribute` у задачи).

1. Добавить значение в `domain/ChildTag.ts` + `CHILD_TAG_CONFIG` (иконка, лейбл, порядок сортировки).
2. Если элемент идёт внутри собственного контейнера ТЧ-подобного типа — расширить `ObjectXmlReader.parseChildren`.
3. В нужных записях `META_TYPES` добавить тег в `childTags`.

### Новая схема свойств объекта

1. Добавить объект-схему в `infra/xml/PropertySchema.ts → PROPERTY_SCHEMAS` (ключ = значение `propertySchema` в `META_TYPES`).
2. Если появляется новый `PropertyValueKind` (например, ссылка на другой объект) — расширить `ui/views/properties/_types.ts` и добавить рендер в `PropertyBuilder.ts`.
3. Регулярки для парсинга свойств — только в `infra/xml/`, не в UI.

### Новая команда

1. Класс (или функция) в `ui/commands/...` с явным `readonly id: string` и обработчиком.
2. Регистрация в `CommandRegistry.registerAll(ctx, services)`.
3. `package.json → contributes.commands` — title/category/icon.
4. Если команда должна появляться в контекстном меню узла дерева — `contributes.menus.view/item/context` c предикатом `when: viewItem =~ /…/`. Контекст-значения задаются в `TreeNode` через `contextValue` и формируются из `MetaKind` + опциональных суффиксов (`-supportN`, `-own`, `-borrowed`).
5. Если нужна горячая клавиша — `contributes.keybindings`.

### Новый builder узла дерева

Нужен только когда тип имеет нестандартное поведение (рекурсия, группировка, спец-дети).

1. Создать `ui/tree/nodeBuilders/<имя>.ts` с функцией `build<Имя>(ctx: HandlerContext): MetadataNode[]` или `build<Имя>Children(node): MetadataNode[]`.
2. Зарегистрировать в диспетчере `ui/tree/nodeBuilders/metaObjectTreeBuilder.ts` (или напрямую в `MetadataTreeProvider` для корневых групп).
3. Любые XML-чтения — через `parseObjectXml` / `ObjectXmlReader`, никаких прямых регулярок.
4. `MetadataTreeProvider` остаётся тонким — он только делегирует в builder.

### Новая декорация узла (цвет / бейдж / суффикс контекста)

1. Если декорация зависит от состояния файла (поддержка, блокировка, «свой/заимствованный») — создать класс в `ui/tree/decorations/` по образцу `SupportDecorationProvider.ts`, реализовать `vscode.FileDecorationProvider`.
2. Зарегистрировать провайдер в `Container.wireTreeView`.
3. Для суффикса `contextValue` (чтобы команды появлялись в меню) — расширять формирование `contextValue` только в `TreeNode`, а признак пробрасывать через POJO-поле узла.

### Новый view / webview-панель

1. Класс в `ui/views/<Имя>ViewProvider.ts` — работа со своим `WebviewPanel`, без прямых XML/FS-вызовов.
2. Данные готовит отдельный сервис в `ui/views/.../` (как `MetadataXmlPropertiesService`).
3. Создание и команда «открыть панель» — через `Container`, не из команд напрямую.

### Новый сервис инфраструктуры

1. Класс в `infra/<подпапка>/<Имя>Service.ts` без `vscode`-импортов. Логгер принимать через параметр конструктора (`Logger`).
2. Если сервис нужен UI — создать его в `Container.bootstrap` и прокинуть как зависимость в потребителей.
3. Добавить тест в `src/test/suite/<имя>.test.ts` на пример из `example/`.

### Новая возможность языковой поддержки BSL

Встроенных LSP-провайдеров в расширении нет. Новые completion / hover / diagnostics /
signature и похожие возможности добавляются в `bsl-analyzer`, а в этом проекте
проверяется только интеграция `LspManager` и настройки клиента.

### Новая настройка расширения

1. Блок в `package.json → contributes.configuration.properties` с префиксом `v8vscedit.<область>.<ключ>`, обязательный `description` на русском, тип и default.
2. Чтение — только через `vscode.workspace.getConfiguration('v8vscedit')` и только в UI-слое или `Container`. В `domain/` и `infra/` настройки пробрасываются параметрами.
3. Если настройка влияет на поведение во время работы — подписаться на `workspace.onDidChangeConfiguration` в `Container`.

### Новый watcher / реакция на файловую систему

1. Регистрация `FileSystemWatcher` — только в `Container` или выделенном файле в `ui/support/` (как `SupportWatcher.ts`).
2. Обработчик делегирует в сервис (`SupportInfoService.invalidate`, `MetadataTreeProvider.refresh`), не выполняет работу напрямую.

### Новая внешняя интеграция (vrunner и прочие CLI)

1. Код запуска процесса — в `ui/commands/ext/` (после миграции `CommandRegistry`), пока — в `CommandRegistry.ts`.
2. Декодирование OEM/Win1251 вывода — через `iconv-lite`, централизованно.
3. Прогресс/отмена — через `vscode.window.withProgress`. Длительные операции не блокируют extension host.

### Открытие BSL-модулей

BSL-модули открываются только как реальные `file://` документы. Виртуальная схема
`onec://` удалена вместе со встроенным LSP. Readonly-режим обеспечивают команды
открытия модулей и `ui/readonly/BslReadonlyGuard.ts`.

### Новый тест

1. Файл в `src/test/suite/<имя>.test.ts`, Mocha (`suite` / `test`).
2. Использовать `example/src/cf` и `example/src/cfe/EVOLC` как фикстуры. Не создавать временные XML — правила тестирования опираются на реальные файлы.
3. Для тестов домена и `infra` — никаких mock-ов VS Code. Для UI — `@vscode/test-electron`.

### TDD и покрытие

1. **Любое изменение поведения начинается с теста.** Сначала добавить или изменить тест, увидеть красный прогон, затем вносить production-код и доводить прогон до зелёного.
2. **Покрытие production-кода — 100% по строкам, веткам, функциям и операторам.** Новые или изменённые участки без полного покрытия не принимаются.
3. **Заглушки, фиктивные ассёрты и тесты ради покрытия запрещены.** Каждый тест должен проверять реальное поведение на настоящих XML-фикстурах из `example/`, реальных временных файлах/каталогах или реальном процессе; mock/stub/fake допустимы только для внешней недоступной системы и только с явным обоснованием в тесте.
4. Если код невозможно покрыть напрямую из-за VS Code API, вынести чистую логику в `domain/` или `infra/` и покрыть её unit-тестом; тонкий UI-адаптер проверить интеграционным тестом через `@vscode/test-electron`.
5. Перед завершением задачи обязательно выполнить `npm test` и `npm run coverage`. Если команда не может быть выполнена локально, зафиксировать конкретную причину и не считать задачу завершённой.

---

## Запреты и анти-паттерны

1. **Никаких regex-парсеров XML вне `infra/xml/`.** Вся работа с XML идёт через `ConfigXmlReader`/`ObjectXmlReader`.
2. **Нет дублирующих реестров типов.** Если видишь `Record<string, string>` с `Catalog: 'Catalogs'` где-то вне `META_TYPES` — это баг архитектуры.
3. **Нет массивов команд в `package.json`, не покрытых `CommandRegistry`.** Все команды — в `ui/commands/`.
4. **`MetadataTreeProvider` не знает про типы метаданных.** Он делегирует в builder'ы.
5. **`MetadataNode`/`TreeNode` не хранит XML-логику.** Только отображение и ссылку на `TreeNodeModel`.
6. **Не импортировать `vscode` в `domain/` и `infra/`.** Проверка: `import.*vscode` в этих папках запрещён.
7. **Сервисы не создаются через `new` в командах/builder'ах.** Только через `Container`.
8. **Не использовать `any`.** Если неизбежно — комментарий `// any: <причина>`.
9. **Не сохранять пароли и токены в файлы проекта.** `env.json`, `.v8vscedit/**` и похожие служебные файлы не должны получать secret-значения. Для секретов использовать VS Code SecretStorage или одноразовый ввод.
10. **Не создавать файлы при команде «Открыть».** Команды открытия XML/BSL открывают только существующие файлы; создание файлов разрешено только явным командам добавления/генерации.
11. **Не вешать синхронный I/O на getters, tooltip, decoration и hot path дерева.** Данные для подсказок и декораций читаются заранее, кэшируются сервисом или пропускаются.
12. **Не терять формат XML.** Любой редактор существующего XML сохраняет BOM и стиль переводов строк исходного файла.
13. **Справочники свойств не живут в UI.** Подписи, boolean/enum/localized-классификация и значения enum должны жить в `infra/xml/PropertySchema.ts` или специализированном infra-реестре; UI только рендерит готовые данные.
14. **Команды контекстного меню не хардкодятся в `UniversalPanelViewProvider`.** Метод `addModuleActions` читает `META_TYPES[nodeKind].modules` и строит меню через `MODULE_SLOT_ACTIONS`. Добавление нового типа или слота — только через `META_TYPES` + `MODULE_SLOT_ACTIONS`, без новых `if`/regex в `addModuleActions`.
15. **Нативный TreeView — не основной UI.** Контекстное меню `package.json → menus.view/item/context` не является основным для пользователя — основной UI это `UniversalPanelViewProvider`. Не тратить усилия на дублирование логики меню в `package.json`, если оно уже реализовано в `addModuleActions`.

---

## Рабочий процесс

### Запуск и отладка

```bash
npm install
npm run watch        # webpack --mode development --watch
```

В VSCode/Cursor открыть корень проекта, нажать `F5` — откроется Extension Development Host с расширением. `Ctrl+Shift+F5` — перезапуск после изменения кода.

### Сборка

```bash
npm run compile      # tsc -p ./  (быстрая проверка типов)
npm run lint         # eslint . --max-warnings=0  (конфиг eslint.config.mjs)
npm run build        # webpack production
```

Перед любым коммитом: `npm run compile` и **`npm run lint`** должны проходить без ошибок (у линтера — также без предупреждений).

### Тесты

```bash
npm test
npm run coverage
npm run coverage:report
```

`npm test` сначала выполняет `npm run compile` и dev-сборку webpack, затем запускает
`node ./out/test/runTests.js`. Тестовый runner берётся из `out/`, потому что Mocha
загружает `out/test/suite/*.js`; webpack собирает только extension/CLI entry.

`npm run coverage` запускает тот же интеграционный прогон через `c8` и падает, если
строки, ветки, функции или операторы покрыты меньше чем на 100%. Для диагностики
без падения по порогу использовать `npm run coverage:report`.

Тесты лежат в `src/test/suite/`. Покрываются минимум:
- `ConfigLocator` — поиск конфигураций в `example/`.
- `ConfigXmlReader` — парсинг `Configuration.xml`.
- `ObjectXmlReader` — парсинг XML объектов (реквизиты, ТЧ, формы).
- `MetaPathResolver` — резолв XML и всех модулей.
- `PropertyBuilder` — корректность свойств для ключевых типов.

При добавлении нового типа метаданных **обязательно** добавлять тест `ObjectXmlReader` на реальный пример из `example/`.

### Отладка LSP

- Канал «BSL LSP Trace» (`traceOutputChannel`) показывает все JSON-RPC-сообщения.
- Канал «1С Редактор» — лог самого расширения.
- Канал «BSL Analyzer» — stdout/stderr внешнего сервера.

---

## Фактическое состояние миграции на целевую архитектуру

Весь legacy-код удалён и перемещён в целевые папки. Раскладка `src/` полностью соответствует разделу «Целевая архитектура» выше. **Любой новый код пишется сразу в правильном слое.**

### Готово (весь проект)

- `domain/` — `MetaTypes.ts` (единый реестр), `ChildTag.ts`, `ModuleSlot.ts`, `MetaObject.ts`, `Configuration.ts`, `Ownership.ts`, `index.ts`.
- `infra/xml/` — `XmlUtils.ts`, `ConfigXmlReader.ts`, `ObjectXmlReader.ts`, `PropertySchema.ts`, `index.ts` (публичный API c функциями `parseConfigXml`, `parseObjectXml`, `resolveObjectXmlPath`).
- `infra/fs/` — `ConfigLocator.ts` (+ `findConfigurations`), `MetaPathResolver.ts` (+ 9 функций-обёрток для path), `ObjectLocation.ts`.
- `infra/cache/` — кэши метаданных и хешей; запрещено импортировать кэш из `cli/core`.
- `infra/support/` — `Logger.ts`, `SupportInfoService.ts`.
- `ui/tree/` — `TreeNode.ts` (бывший `MetadataNode.ts`), `MetadataTreeProvider.ts`, `nodes/` (декларативные дескрипторы из `META_TYPES`), `presentation/`, `nodeBuilders/` (все builder-ы типов), `decorations/SupportDecorationProvider.ts`, `decorations/GitMetadataDecorationProvider.ts`.
- `ui/views/` — `PropertiesViewProvider.ts`, `properties/` (`PropertyBuilder.ts`, `MetadataXmlPropertiesService.ts`, `PropertiesSelectionService.ts`, `_types.ts`).
- `ui/commands/` — `CommandRegistry.ts`.
- `ui/readonly/` — `BslReadonlyGuard.ts`.
- `ui/support/` — `SupportIndicatorCommands.ts`, `SupportWatcher.ts`.
- `lsp/` — `LspManager.ts`, `analyzer/`; встроенный сервер удалён.
- `cli/` — отдельный Node entry `dist/cli/onec-tools.js`; команды используют `domain/` и `infra/`, но нижние слои не зависят от CLI.
- `Container.ts` — композиционный корень; `extension.ts` — тонкий активатор.
- Legacy-папки `src/handlers/`, `src/nodes/`, `src/services/`, `src/views/`, `src/language-server/`, `src/language/`, `src/formEditor/` удалены.
- Дубликаты карты `typeToFolder` устранены — единственный источник `META_TYPES`.

### Известные технические долги

1. **`CommandRegistry.ts` — один файл**, пока не разбит на `open/`, `properties/`, `support/`, `ext/` как предусмотрено архитектурой. Разделение — при следующем изменении команд.
2. **`TreeNode.ts` не разделён на `TreeNodeModel` (POJO) + vscode-обёртку.** Сейчас один класс совмещает данные и отображение.
3. **Миграция XML-парсинга на `fast-xml-parser`.** Внутри `infra/xml/*` — регулярки. Замена должна пройти без изменения публичного API `ConfigXmlReader`/`ObjectXmlReader`.
4. **Редактирование XML.** Пока реализовано только чтение. После миграции на настоящий XML-парсер — добавить `ObjectXmlWriter` для панели свойств.
5. **Сильная типизация дерева.** `TreeNodeModel` → discriminated union по `kind` вместо общего интерфейса.
6. **`ui/views/properties/_types.ts`** — пока re-export из `ui/tree/nodeBuilders/_types.ts`. Нужно окончательно отделить типы панели свойств от `ObjectHandler`.

---

## Инструкции агентам

- **Перед любым изменением читать `AGENTS.md` целиком.** Архитектурные правила выше — не рекомендации, а контракт.
- **Перед исправлением замечания аудита подтверждать его в коде.** Если файл/класс из аудита уже удалён или переименован, не создавать фантомную правку; зафиксировать фактический аналог или отметить пункт как неактуальный.
- **Инкрементальность.** Менять не более одного слоя за коммит. Сломанный промежуточный коммит недопустим — после каждого коммита должны проходить `npm run compile` и **`npm run lint`**.
- **ESLint.** После **каждого** изменения кода обязательно запускать **`npm run lint`** (из корня репозитория). Ослаблять правила или добавлять отключения в `eslint.config.mjs` ради «зелёной» проверки запрещено — устранять замечания в коде.
- **Документация.** Публичные типы и функции — JSDoc на русском, объясняющий *зачем*. Мёртвые классы удалять, не помечать «deprecated».
- **При затруднении** — проверить, не решается ли задача изменением таблицы `META_TYPES` или `PROPERTY_SCHEMAS`. В 90% случаев — да.
- **Никакой автоинициативы** при встрече с legacy-кодом, не связанным с текущей задачей. Но если правишь функцию, которая лежит не по архитектуре — перенести её в правильный слой.

### Правила работы с архитектурой

- **Новый код — только в целевых папках.** Создание новых файлов в `src/` на верхнем уровне запрещено (кроме `Container.ts` и `extension.ts`).
- Каталоги `src/handlers/`, `src/nodes/`, `src/services/`, `src/views/`, `src/language-server/` больше не существуют — не создавать их снова.
- При переименовании/переносе файла: перенести `git mv`, обновить импорты во всех потребителях, проверить `npm run compile` и `npm run lint`.
- Запрещено создавать параллельные версии сервисов («v2»). Либо миграция завершена, либо файл не трогается.

### Sanity-чек после изменений

1. `npm run compile` — 0 ошибок.
2. **`npm run lint`** — 0 ошибок и 0 предупреждений (`eslint.config.mjs`, `--max-warnings=0`).
3. `npm run build` — webpack собирается без ошибок.
4. `rg "typeToFolder\s*:" src` — 0 результатов (карта папок только в `META_TYPES`).
5. `rg "import .* from 'vscode'" src/domain src/infra` — 0 результатов.
6. `rg "from ['\"].*cli|from ['\"].*/cli" src/domain src/infra` — 0 результатов.
7. `rg "require\(|readFileSync" src/domain` — 0 результатов (`domain/` — чистый).
8. `rg "FOLDER_MAP|FOLDER_RU" src` — 0 результатов.
9. `ls src -d */` — в списке не должно быть ни одной из папок: `handlers`, `services`, `views`, `language`, `language-server`, `nodes`, `formEditor`. Корректные подкаталоги первого уровня: `domain`, `infra`, `lsp`, `ui`, `cli`, `test` и файлы `Container.ts`, `extension.ts`.
