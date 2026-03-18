# Архитектура расширения 1С: Навигатор метаданных

## Назначение

VSCode-расширение (`1c-metadata-navigator`) предоставляет два независимых функциональных блока для работы с 1С:Предприятие:

1. **[Навигатор метаданных](./metadata-navigator.md)** — дерево объектов конфигураций и расширений из XML-выгрузки
2. **[Языковая поддержка BSL](./bsl-language-support.md)** — подсветка, автодополнение, навигация по коду `.bsl`

## Структура модулей

```
src/
├── extension.ts                  # Точка входа — activate() / deactivate()
│
├── ConfigFinder.ts               # Поиск Configuration.xml в воркспейсе
│
├── MetadataTreeProvider.ts       # TreeDataProvider — построение дерева метаданных
├── MetadataNode.ts               # TreeItem-узел дерева, тип NodeKind
├── MetadataGroups.ts             # Конфигурация групп верхнего уровня (TOP_GROUPS, COMMON_SUBGROUPS)
├── CommandRegistry.ts            # Регистрация 8 команд навигатора + FileSystemWatcher
├── ModulePathResolver.ts         # Резолвинг путей к BSL-модулям объектов конфигурации
│
├── ConfigParser.ts               # Regex-парсинг Configuration.xml и объектных XML
│
├── nodes/                        # Дескрипторы узлов (один файл = один тип объекта)
│   ├── index.ts                  # Реестр NODE_DESCRIPTORS: Record<NodeKind, NodeDescriptor>
│   ├── _types.ts                 # Интерфейс NodeDescriptor, ChildTag, CommandId, CHILD_TAG_CONFIG
│   ├── _base.ts                  # Фабрика buildNode() — создаёт MetadataNode по дескриптору
│   ├── root/                     # configuration, extension
│   ├── groups/                   # group-common, group-type
│   ├── common/                   # Общие объекты (CommonModule, Role, CommonForm, ...)
│   ├── objects/                  # Объекты верхнего уровня (Catalog, Document, ...)
│   ├── children/                 # Дочерние элементы (Attribute, TabularSection, Form, ...)
│   └── presentation/
│       ├── icon.ts               # getIconUris() — URI иконок light/dark
│       └── iconMap.ts            # getIconName() — имя SVG по NodeKind
│
└── language/
    ├── BslParserService.ts       # Синглтон tree-sitter, кэш деревьев, инкрементальный парсинг
    ├── BslLanguageRegistrar.ts   # Регистрация провайдеров в context.subscriptions
    ├── BslDiagnosticsProvider.ts # Диагностика синтаксических ошибок (дебаунс 500 мс)
    └── providers/
        ├── SemanticTokensProvider.ts  # Семантическая подсветка (13 типов токенов)
        ├── DocumentSymbolProvider.ts  # Outline и хлебные крошки
        ├── FoldingRangeProvider.ts    # Сворачивание блоков и #Область
        ├── CompletionProvider.ts      # Автодополнение (&, #, ключевые слова, метаданные)
        ├── HoverProvider.ts           # Подсказка при наведении (сигнатура функции)
        └── DefinitionProvider.ts      # Переход к определению функции/процедуры
```

## Граф зависимостей

```
extension.ts
  ├── ConfigFinder.ts
  ├── MetadataTreeProvider.ts
  │     ├── ConfigParser.ts
  │     ├── MetadataNode.ts
  │     ├── MetadataGroups.ts
  │     ├── ModulePathResolver.ts (resolveObjectXmlPath)
  │     ├── nodes/presentation/icon.ts
  │     ├── nodes/_base.ts
  │     ├── nodes/index.ts  ← все ~50 дескрипторов
  │     └── nodes/_types.ts
  ├── CommandRegistry.ts
  │     └── ModulePathResolver.ts (все get*Path функции)
  ├── BslParserService.ts
  └── BslLanguageRegistrar.ts
        ├── BslDiagnosticsProvider.ts
        └── providers/* (6 провайдеров)
              └── BslParserService.ts (у каждого)
```

## Точка входа

`activate()` в `extension.ts` выполняет строго последовательно:

1. Создаёт `MetadataTreeProvider` с пустым списком конфигураций
2. Регистрирует `TreeView` и команды навигатора (`registerCommands`)
3. Запускает `findConfigurations(rootPath)` → заполняет `currentEntries`
4. Создаёт `BslParserService` и немедленно вызывает `ensureInit()` (WASM загружается заранее)
5. После инициализации WASM — вызывает `registerBslLanguage()` с замыканием `() => currentEntries`

Замыкание на `currentEntries` позволяет `CompletionProvider` видеть актуальный список конфигураций после `refresh` без перерегистрации.

## Ключевые архитектурные решения

| Решение | Обоснование |
|---|---|
| Regex-парсинг XML вместо DOM | XML-выгрузка 1С имеет предсказуемую структуру; DOM-парсер — лишняя зависимость |
| Ленивая загрузка узлов дерева | `childrenLoader()` вызывается только при раскрытии узла, синонимы через `Object.defineProperty` getter |
| Инициализация WASM до открытия файла | Подсветка появляется без задержки при первом открытии `.bsl` |
| Дескриптор-ориентированная архитектура | `MetadataTreeProvider` не содержит switch/case по типам — вся логика в дескрипторах |
| `emitted: Set<number>` в SemanticTokensProvider | Предотвращает двойную эмиссию при пересечении структурных и листовых узлов AST |

## Подробная документация

- [Навигатор метаданных](./metadata-navigator.md) — дерево, дескрипторы, команды, path resolver
- [Языковая поддержка BSL](./bsl-language-support.md) — парсер, провайдеры, диагностика
- [Парсинг XML конфигурации](./metadata-parser.md) — алгоритмы разбора Configuration.xml и объектных XML
- [Провайдеры BSL](./bsl-providers.md) — детали каждого языкового провайдера
