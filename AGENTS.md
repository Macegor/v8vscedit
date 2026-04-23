# AGENTS.md — инструкции для агентов

Документация проекта ведётся в `./docs`. Этот файл — контракт для любого агента, вносящего изменения в расширение.

## Что это за проект

VSCode / Cursor-расширение `v8vscedit` — редактор выгрузки конфигураций и расширений 1С:Предприятие. Две независимые подсистемы:

1. **Навигатор метаданных** — дерево объектов из XML-выгрузки (CF и CFE), свойства, открытие BSL-модулей.
2. **Языковая поддержка BSL** — LSP-клиент (bsl-analyzer внешний или встроенный tree-sitter).

Главное: расширение читает уже выгруженные XML-файлы 1С и обеспечивает удобную навигацию + редактирование BSL-модулей; запись XML сейчас не реализована.

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
- VS Code API ≥ 1.85, `vscode-languageclient`/`vscode-languageserver`.
- Webpack 5 (сборка в `dist/`). Три entry: `extension`, `server`, `test/runTests`.
- `web-tree-sitter` + `tree-sitter-bsl` — для встроенного LSP.
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
│   │   └── XmlUtils.ts               # extractSimpleTag, extractSynonym, extractNestingAwareBlock
│   ├── fs/
│   │   ├── ConfigLocator.ts          # рекурсивный поиск Configuration.xml (bывш. ConfigFinder)
│   │   └── MetaPathResolver.ts       # единый resolver: XML + все модули по ModuleSlot
│   └── support/
│       ├── SupportInfoReader.ts      # чтение ParentConfigurations.bin, parse UUID → SupportMode
│       └── SupportInfoService.ts     # кэш по SHA-1 ParentConfigurations.bin
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
│   │       └── SupportDecorationProvider.ts  # FileDecorationProvider для цвета в Explorer
│   ├── views/
│   │   ├── PropertiesViewProvider.ts     # singleton WebviewPanel (как сейчас)
│   │   └── properties/
│   │       └── PropertyBuilder.ts        # один builder по PropertySchema
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
│   ├── vfs/
│   │   ├── OnecFileSystemProvider.ts
│   │   └── OnecUriBuilder.ts
│   └── readonly/
│       └── BslReadonlyGuard.ts           # ReadonlySession для BSL-файлов под замком поддержки
│
├── lsp/                                  # Подсистема языковой поддержки BSL (одна)
│   ├── LspManager.ts
│   ├── analyzer/
│   │   ├── BslAnalyzerService.ts
│   │   └── BslAnalyzerStatusBar.ts
│   └── server/                           # Встроенный LSP-сервер (tree-sitter)
│       ├── server.ts                     # entry для dist/server.js
│       ├── BslContextService.ts
│       ├── BslDocumentContext.ts
│       ├── BslParserService.ts
│       ├── lspUtils.ts
│       └── providers/…                   # semanticTokens, diagnostics, hover, completion, …
│
└── test/
    ├── runTests.ts
    └── suite/…
```

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
- `ui/**` не содержит regex-парсинга XML и вычислений путей — только вызовы `infra/*`.
- LSP-сервер (`lsp/server/*`) не импортирует ничего из `ui/**` — он работает в отдельном процессе.

### Composition root

```typescript
// extension.ts
export function activate(ctx: vscode.ExtensionContext): void {
  container = new Container(ctx);
  container.activate();
}
export function deactivate(): Promise<void> | undefined {
  return container?.deactivate();
}
```

`Container` — единственное место создания всех сервисов. Он:
1. Создаёт `OutputChannel` и все сервисы домена/инфры.
2. Регистрирует `OnecFileSystemProvider`, `TreeView`, `SupportDecorationProvider`, `FileSystemWatcher`.
3. Вызывает `CommandRegistry.registerAll(ctx, services)`.
4. Стартует `LspManager`.

---

## Инвариант изменений — как добавлять функциональность

### Новый тип метаданных

1. Добавить запись в `META_TYPES` (`domain/MetaTypes.ts`).
2. Если у объекта есть специфический модуль — добавить `ModuleSlot` в `domain/ModuleSlot.ts` и в карту слотов `MetaPathResolver`.
3. Если нужен набор свойств — добавить схему в `PROPERTY_SCHEMAS` (`infra/xml/PropertySchema.ts`).
4. Иконку положить в `src/icons/{light,dark}/<icon>.svg`.
5. Больше ничего менять не нужно.

### Новая команда

1. Создать класс в `ui/commands/...` с методами `readonly id: string`, `handler(arg: unknown): Promise<void>`.
2. Зарегистрировать в `CommandRegistry.registerAll`.
3. Описать в `package.json → contributes.commands`.
4. Если команда привязана к типу узла — `package.json → contributes.menus.view/item/context` с `when: viewItem =~ /…/`.

### Новое свойство объекта

- **Не** писать парсер регулярками в handler'е. Добавить описание в `PROPERTY_SCHEMAS` и, при необходимости, расширить `PropertyBuilder` новым `PropertyValueKind`.

### Новая подсистема на уровне приложения

- Создать сервис в `infra/` или `ui/`, зарегистрировать в `Container`. Не инициализировать напрямую из `extension.ts`.

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
npm run build        # webpack production
```

Перед любым коммитом: `npm run compile` должен проходить без ошибок.

### Тесты

```bash
npm test
```

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
- Канал «BSL Analyzer» (при `v8vscedit.lsp.mode=bsl-analyzer`) — stdout/stderr внешнего сервера.

---

## Фактическое состояние миграции на целевую архитектуру

Весь legacy-код удалён и перемещён в целевые папки. Раскладка `src/` полностью соответствует разделу «Целевая архитектура» выше. **Любой новый код пишется сразу в правильном слое.**

### Готово (весь проект)

- `domain/` — `MetaTypes.ts` (единый реестр), `ChildTag.ts`, `ModuleSlot.ts`, `MetaObject.ts`, `Configuration.ts`, `Ownership.ts`, `index.ts`.
- `infra/xml/` — `XmlUtils.ts`, `ConfigXmlReader.ts`, `ObjectXmlReader.ts`, `PropertySchema.ts`, `index.ts` (публичный API c функциями `parseConfigXml`, `parseObjectXml`, `resolveObjectXmlPath`).
- `infra/fs/` — `ConfigLocator.ts` (+ `findConfigurations`), `MetaPathResolver.ts` (+ 9 функций-обёрток для path), `ObjectLocation.ts`.
- `infra/support/` — `Logger.ts`, `SupportInfoService.ts`.
- `ui/tree/` — `TreeNode.ts` (бывший `MetadataNode.ts`), `MetadataTreeProvider.ts`, `MetadataGroups.ts`, `nodes/` (декларативные дескрипторы из `META_TYPES`), `presentation/`, `nodeBuilders/` (все builder-ы типов), `decorations/SupportDecorationProvider.ts`.
- `ui/views/` — `PropertiesViewProvider.ts`, `properties/` (`PropertyBuilder.ts`, `MetadataXmlPropertiesService.ts`, `PropertiesSelectionService.ts`, `_types.ts`).
- `ui/vfs/` — `OnecFileSystemProvider.ts`, `OnecUriBuilder.ts`.
- `ui/commands/` — `CommandRegistry.ts`.
- `ui/readonly/` — `BslReadonlyGuard.ts`.
- `ui/support/` — `SupportIndicatorCommands.ts`, `SupportWatcher.ts`.
- `lsp/` — `LspManager.ts`, `analyzer/`, `server/` (перенос `src/language-server/*`, webpack entry обновлён).
- `Container.ts` — композиционный корень; `extension.ts` — тонкий активатор.
- Legacy-папки `src/handlers/`, `src/nodes/`, `src/services/`, `src/views/`, `src/language-server/`, `src/language/` удалены.
- Дубликаты карты `typeToFolder` устранены — единственный источник `META_TYPES`.

### Известные технические долги

1. **`CommandRegistry.ts` — один файл**, пока не разбит на `open/`, `properties/`, `support/`, `ext/` как предусмотрено архитектурой. Разделение — при следующем изменении команд.
2. **`TreeNode.ts` не разделён на `TreeNodeModel` (POJO) + vscode-обёртку.** Сейчас один класс совмещает данные и отображение.
3. **`MetadataGroups.ts`** — отдельный файл, хотя данные группировки должны полностью жить в `META_TYPES.group/groupOrder`.
4. **Миграция XML-парсинга на `fast-xml-parser`.** Внутри `infra/xml/*` — регулярки. Замена должна пройти без изменения публичного API `ConfigXmlReader`/`ObjectXmlReader`.
5. **Редактирование XML.** Пока реализовано только чтение. После миграции на настоящий XML-парсер — добавить `ObjectXmlWriter` для панели свойств.
6. **Built-in LSP.** Сейчас в ограниченном состоянии; основной режим — `bsl-analyzer`.
7. **Сильная типизация дерева.** `TreeNodeModel` → discriminated union по `kind` вместо общего интерфейса.
8. **`ui/views/properties/_types.ts`** — пока re-export из `ui/tree/nodeBuilders/_types.ts`. Нужно окончательно отделить типы панели свойств от `ObjectHandler`.

---

## Инструкции агентам

- **Перед любым изменением читать `AGENTS.md` целиком.** Архитектурные правила выше — не рекомендации, а контракт.
- **Инкрементальность.** Менять не более одного слоя за коммит. Сломанный промежуточный коммит недопустим — `npm run compile` должен проходить после каждого коммита.
- **Документация.** Публичные типы и функции — JSDoc на русском, объясняющий *зачем*. Мёртвые классы удалять, не помечать «deprecated».
- **При затруднении** — проверить, не решается ли задача изменением таблицы `META_TYPES` или `PROPERTY_SCHEMAS`. В 90% случаев — да.
- **Никакой автоинициативы** при встрече с legacy-кодом, не связанным с текущей задачей. Но если правишь функцию, которая лежит не по архитектуре — перенести её в правильный слой.

### Правила работы с архитектурой

- **Новый код — только в целевых папках.** Создание новых файлов в `src/` на верхнем уровне запрещено (кроме `Container.ts` и `extension.ts`).
- Каталоги `src/handlers/`, `src/nodes/`, `src/services/`, `src/views/`, `src/language-server/` больше не существуют — не создавать их снова.
- При переименовании/переносе файла: перенести `git mv`, обновить импорты во всех потребителях, проверить `npm run compile`.
- Запрещено создавать параллельные версии сервисов («v2»). Либо миграция завершена, либо файл не трогается.

### Sanity-чек после изменений

1. `npm run compile` — 0 ошибок.
2. `npm run build` — webpack собирается без ошибок.
3. `rg "typeToFolder\s*:" src` — 0 результатов (карта папок только в `META_TYPES`).
4. `rg "import .* from 'vscode'" src/domain src/infra` — 0 результатов.
5. `rg "require\(|readFileSync" src/domain` — 0 результатов (`domain/` — чистый).
6. `Get-ChildItem src -Directory` — в списке не должно быть ни одной из папок: `handlers`, `services`, `views`, `language`, `language-server`, `nodes`. Корректные подкаталоги первого уровня: `domain`, `infra`, `lsp`, `ui`, `test` и файлы `Container.ts`, `extension.ts`.
