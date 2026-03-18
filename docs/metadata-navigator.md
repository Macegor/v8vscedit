# Навигатор метаданных

## Назначение

Отображает структуру конфигураций и расширений 1С (XML-выгрузка) в виде дерева в Activity Bar VSCode. Поддерживает CF (основная конфигурация) и CFE (расширение).

Связанные модули: `MetadataTreeProvider.ts`, `MetadataNode.ts`, `MetadataGroups.ts`, `CommandRegistry.ts`, `ConfigFinder.ts`, `ModulePathResolver.ts`, `nodes/`.

## Поиск конфигураций (ConfigFinder)

`findConfigurations(rootDir)` рекурсивно (до 10 уровней) обходит файловую систему воркспейса, пропуская `node_modules`, `.git`, `.cursor`, `dist`, `out`.

При нахождении `Configuration.xml` читает **первые 8 КБ** и определяет тип:
- `cfe` — если присутствует тег `<ConfigurationExtensionPurpose>`
- `cf` — во всех остальных случаях

Внутрь найденной конфигурации рекурсия не заходит — это предотвращает обнаружение вложенных Configuration.xml внутри самой конфигурации.

Результат — массив `ConfigEntry[]`:
```typescript
interface ConfigEntry {
  rootPath: string;   // абсолютный путь к каталогу с Configuration.xml
  kind: 'cf' | 'cfe';
}
```

## Дерево узлов (MetadataTreeProvider)

Реализует `vscode.TreeDataProvider<MetadataNode>`. Стратегия — **полностью ленивая загрузка**: каждый узел хранит `childrenLoader: () => MetadataNode[]`, который вычисляется только при раскрытии узла в UI.

### Иерархия дерева

```
Конфигурация (configuration / extension)
  └── Общие (group-common)
  │     ├── Подсистемы (Subsystem)
  │     ├── Общие модули (CommonModule)
  │     ├── Роли (Role)
  │     └── ... (16 подгрупп из COMMON_SUBGROUPS)
  └── Справочники (group-type)
  │     ├── МойСправочник (Catalog)
  │     │     ├── Реквизиты (group-type)
  │     │     │     └── Наименование (Attribute)
  │     │     ├── Табличные части (group-type)
  │     │     │     └── МояТЧ (TabularSection)
  │     │     │           └── Колонка (Column)
  │     │     ├── Формы (group-type)
  │     │     │     └── ФормаЭлемента (Form)
  │     │     └── ...
  │     └── ...
  └── Документы / Регистры / ...
```

### Синонимы объектов (ленивые)

Синоним каждого объекта загружается из его XML только при первом обращении через `Object.defineProperty` с getter:

```typescript
Object.defineProperty(node, 'tooltip', {
  get: getSynonym,   // читает XML и кэширует результат в cachedSynonym
  enumerable: true,
  configurable: true,
});
```

### OWN / BORROWED (для расширений CFE)

Для узлов расширения определяется признак заимствования по `namePrefix` из `Configuration.xml`:
- `OWN` (`[свой]`) — имя объекта начинается с `namePrefix`
- `BORROWED` (`[заим.]`) — имя не начинается с `namePrefix` (объект заимствован из основной конфигурации)

## Тип узла (MetadataNode)

```typescript
class MetadataNode extends vscode.TreeItem {
  nodeKind: NodeKind;           // ~50 литеральных типов
  xmlPath?: string;             // путь к XML-файлу объекта
  childrenLoader?: () => MetadataNode[];
  ownershipTag?: 'OWN' | 'BORROWED';
}
```

`contextValue` = `nodeKind` или `nodeKind-hasXml` (суффикс `-hasXml` добавляется при наличии `xmlPath`). Этот суффикс используется в `when`-условиях контекстного меню `package.json`.

## Дескриптор-ориентированная архитектура (nodes/)

Каждый тип узла описан отдельным файлом-дескриптором `NodeDescriptor`:

```typescript
interface NodeDescriptor {
  icon: string;                         // имя SVG-иконки
  folderName?: string;                  // папка в выгрузке (Catalogs, Documents, ...)
  children?: ReadonlyArray<ChildTag>;   // допустимые дочерние теги XML
  singleClickCommand?: CommandId;       // команда при одиночном клике
}
```

`MetadataTreeProvider` использует дескрипторы через `getNodeDescriptor(kind)` — реестр `NODE_DESCRIPTORS` в `nodes/index.ts`. Никаких `switch/case` по типу узла в провайдере нет.

### Дочерние теги (ChildTag / CHILD_TAG_CONFIG)

Конфигурация в `_types.ts`:

| ChildTag | XML-тег | Метка группы | NodeKind |
|---|---|---|---|
| `Attribute` | `Attribute` | Реквизиты | `Attribute` |
| `TabularSection` | `TabularSection` | Табличные части | `TabularSection` |
| `Form` | `Form` | Формы | `Form` |
| `Command` | `Command` | Команды | `Command` |
| `Template` | `Template` | Макеты | `Template` |
| `Dimension` | `Dimension` | Измерения | `Dimension` |
| `Resource` | `Resource` | Ресурсы | `Resource` |
| `EnumValue` | `EnumValue` | Значения | `EnumValue` |

## Команды навигатора (CommandRegistry)

Зарегистрированы 8 команд:

| Команда | Описание | Когда доступна |
|---|---|---|
| `1cNavigator.refresh` | Обновить дерево | Всегда (toolbar) |
| `1cNavigator.openXmlFile` | Открыть XML объекта | `.*-hasXml$` |
| `1cNavigator.openObjectModule` | Открыть модуль объекта | Catalog, Document, ... |
| `1cNavigator.openManagerModule` | Открыть модуль менеджера | Catalog, Document, Enum, ... |
| `1cNavigator.openConstantModule` | Открыть модуль константы | `Constant-hasXml` |
| `1cNavigator.openFormModule` | Открыть модуль формы | CommonForm, Form |
| `1cNavigator.openCommandModule` | Открыть модуль команды | CommonCommand, Command |
| `1cNavigator.openServiceModule` | Открыть модуль сервиса | WebService, HTTPService |
| `1cNavigator.openCommonModuleCode` | Открыть модуль | `CommonModule-hasXml` |

`CommandRegistry` также создаёт `FileSystemWatcher` на `**/Configuration.xml` — при изменении, создании или удалении вызывается `reloadEntries()`.

## Резолвинг путей к BSL-модулям (ModulePathResolver)

`getObjectLocationFromXml(xmlPath)` определяет структуру выгрузки по пути XML:

- **Глубокая структура**: `<Root>/<Folder>/<Name>/<Name>.xml` → `objectDir = <Root>/<Folder>/<Name>`
- **Плоская структура**: `<Root>/<Folder>/<Name>.xml` → `objectDir = <Root>/<Folder>/<Name>`

Все функции используют `firstExisting(candidates)` — возвращает первый существующий путь из списка:

| Функция | Путь |
|---|---|
| `getObjectModulePath` | `{objectDir}/Ext/ObjectModule.bsl` |
| `getManagerModulePath` | `{objectDir}/Ext/ManagerModule.bsl` |
| `getConstantModulePath` | `{objectDir}/Ext/ValueManagerModule.bsl` |
| `getServiceModulePath` | `{objectDir}/Ext/Module.bsl` |
| `getCommonFormModulePath` | `{objectDir}/Ext/Form/Module.bsl` |
| `getCommonCommandModulePath` | `{objectDir}/Ext/CommandModule.bsl` |
| `getCommonModuleCodePath` | `{objectDir}/Ext/Module.bsl` |
| `getFormModulePathForChild` | `{objectDir}/Forms/{name}/Ext/Form/Module.bsl` |
| `getCommandModulePathForChild` | `{objectDir}/Commands/{name}/Ext/CommandModule.bsl` |

`resolveObjectXmlPath(configRoot, objectType, objectName)` находит XML объекта: сначала пробует глубокую структуру, затем плоскую.

## Иконки (nodes/presentation/)

`getIconUris(nodeKind, ownershipTag, extensionUri)` возвращает пару URI для светлой и тёмной темы. Для заимствованных объектов (`BORROWED`) добавляет суффикс `-borrowed` к имени иконки.

`getIconName(kind)` в `iconMap.ts` читает `descriptor.icon` и возвращает имя SVG-файла. Иконки хранятся в `src/icons/light/` и `src/icons/dark/`.
