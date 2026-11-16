# Редактор конфигураций (v8vscedit)

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

### Инвариант узла формы: `xmlPath` принадлежит владельцу

У узла формы **объекта** (`nodeKind === 'Form'`, `Справочники.X.Форма.Y`) `xmlPath` — это XML
**объекта-владельца** (`Catalogs/X.xml`), а не путь формы. Так задумано: `resolveLeafXmlPath`
(`ui/tree/nodeBuilders/metaObjectTreeBuilder.ts`, симметрично `infra/cache/MetadataCache.ts`) задаёт адрес
открытия по клику, и то же поле читают панель свойств (`PropertiesTargetResolver`), гейт блокировок
(`McpMutationGate`), заимствование в CFE и декорации. Смена контракта затронула бы шесть потребителей поля (перечислены основные).
У общей формы (`nodeKind === 'CommonForm'`) `xmlPath` — дескриптор `CommonForms/X.xml`, поэтому на ней
ошибочная трактовка «работала», и дефект выглядел плавающим.

Следствие: поле по названию «лжёт», поэтому **адрес самой формы обязан выводиться арифметикой, а не
читаться из `xmlPath`**. Единая точка — `ui/tree/formNodePaths.ts`
(`resolveObjectFormNodeParts` → XML владельца + имя формы, `resolveFormBodyFromNode` → тело
`…/Ext/Form.xml`), внутри — `MetaPathResolver.resolveChildFormXml`/`resolveChildFormDescriptor`/
`resolveFormXmlByDescriptor`. Модуль лежит в `ui/tree/`, а не в `ui/mcp/`: MCP-инструменты и команды
навигатора (`v8vscedit.form.info`/`validate`/`remove`) — равноправные потребители дерева, адаптер в одном
из них связал бы их между собой.

**Новый потребитель, которому нужен путь формы** (тело, дескриптор, каталог формы), обязан идти через
этот адаптер. Трактовка `node.xmlPath` узла формы как пути формы воспроизводит исходный дефект: до
исправления `validate_form` давал ложное «AutoCommandBar element missing» (разбирал XML справочника как
форму), `compile_form` строил `Catalogs/X.xml/Ext/Form.xml` и падал на ENOTDIR (и для общей формы тоже),
а `edit_form` **писал правку формы поверх XML объекта метаданных**. Вторая линия защиты — guard по
корневому элементу в `infra/xml/form/FormShared.ts` (см.
[mcp-paths.md](./mcp-paths.md#формы-тело-и-дескриптор)).

Тестовая ловушка: фикстура узла формы должна строиться так же, как продакшн-билдер — с `xmlPath`
владельца. Прежняя фикстура в `mcpToolsCatalog.test.ts` вела `xmlPath` прямо на `Ext/Form.xml`, чего
билдер не делает никогда, — `edit_form` был зелёным в тестах и разрушающим в жизни. Тест на контракт
узла — `formNodeContract.test.ts`.

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
| `URLTemplate` | `URLTemplate` | URL-шаблоны | `URLTemplate` |
| `Method` | `Method` | Методы | `Method` |

### Контейнерные дочерние узлы: ТЧ→Колонка и HTTPСервис→URLШаблон→Метод

У части дочерних типов есть собственные вложенные листья — контейнерный узел
хранит список своих детей, а не только простое значение. Первый прецедент —
табличная часть с колонками, второй — HTTP-сервис с трёхуровневой
вложенностью `HTTPService → URLTemplate → Method`: `URLTemplate` — контейнер
(со своими свойствами `Template`), `Method` — его лист (`HTTPMethod`,
`Handler`).

Оба прецедента переиспользуют один и тот же слот `MetaChild.columns`
(`domain/MetaObject.ts`): для ТЧ там лежат колонки (`Attribute`), для
`URLTemplate` — методы (`Method`). Узел дерева для контейнера строится
**симметрично в двух источниках**:
- `infra/cache/MetadataCache.ts` — `buildTabularSectionNode`/`buildUrlTemplateNode`,
  фактический источник дерева основного UI (webview `UniversalPanelViewProvider`);
- `ui/tree/nodeBuilders/metaObjectTreeBuilder.ts` — те же билдеры для нативного
  `TreeView` и панели свойств.

Имя родителя-контейнера при обращении к листу передаётся отдельным
параллельным полем контекста — `tabularSectionName` у колонки, `urlTemplateName`
у метода (`ui/tree/TreeNodeModel.ts`, `domain/CanonicalNames.ts`). Это
осознанное дублирование одного и того же смыслового слота под разные
контейнеры, а не переименование существующего поля и не новый параллельный
реестр типов (см. запрет №2 в `CLAUDE.md`).

Полный канон путей `HTTPСервисы.X.URLШаблон.T[.Метод.M]` и состав
MCP-инструментов `v8vscedit_add_url_template`/`v8vscedit_add_method` — в
[mcp-paths.md](./mcp-paths.md).

## Команды навигатора (CommandRegistry)

Зарегистрированы 8 команд:

| Команда | Описание | Когда доступна |
|---|---|---|
| `v8vscedit.refresh` | Обновить дерево | Всегда (toolbar) |
| `v8vscedit.openXmlFile` | Открыть XML объекта | `.*-hasXml$` |
| `v8vscedit.openObjectModule` | Открыть модуль объекта | Catalog, Document, ... |
| `v8vscedit.openManagerModule` | Открыть модуль менеджера | Catalog, Document, Enum, ... |
| `v8vscedit.openConstantModule` | Открыть модуль константы | `Constant-hasXml` |
| `v8vscedit.openFormModule` | Открыть модуль формы | CommonForm, Form |
| `v8vscedit.openCommandModule` | Открыть модуль команды | CommonCommand, Command |
| `v8vscedit.openServiceModule` | Открыть модуль сервиса | WebService, HTTPService |
| `v8vscedit.openCommonModuleCode` | Открыть модуль | `CommonModule-hasXml` |

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
| `resolveChildFormXml` (тело формы) | `{objectDir}/Forms/{name}/Ext/Form.xml` |
| `resolveChildFormDescriptor` | `{objectDir}/Forms/{name}.xml` |
| `resolveFormXmlByDescriptor` | `<dir>/<имя>/Ext/Form.xml` по `<dir>/<имя>.xml` |
| `getCommandModulePathForChild` | `{objectDir}/Commands/{name}/Ext/CommandModule.bsl` |

`resolveObjectXmlPath(configRoot, objectType, objectName)` находит XML объекта: сначала пробует глубокую структуру, затем плоскую.

## Поддержка поставщика (`ParentConfigurations.bin`)

Режим поддержки объекта (на замке / разрешена правка / снят / собственный) читается из
`<корень конфигурации>/Ext/ParentConfigurations.bin`. Код: `infra/support/` (`ParentConfigurationsParser`,
`SupportMode`, `SupportInfoService`), представление: `ui/support/supportPresentation.ts`. Раздел помещён
сюда, а не в `architecture.md`, потому что результат работы — состояние узлов дерева и гейты правки.

### Формат файла

UTF-8 с BOM, одна скобочная структура:

```
{6,0,<N поставщиков>,
  <uuid>,0,<uuid>,"<версия>","<поставщик>","<имя>",<count>,
    count × (code,0,localUuid,vendorUuid)
  ,0,0,
  <следующий блок поставщика>…
  ,<хвост флагов>}
```

Строки в кавычках экранируют `"` удвоением. Поля записи:

| Поле | Смысл |
|---|---|
| `code` — **первое** поле, перед парой uuid | `0` → `Locked` (не редактируется), `1` → `Editable` (редактируется с сохранением поддержки), `2` → `Removed` (снят с поддержки, ограничений нет). Записи нет → `None` (собственный объект). Неизвестный код → `Locked` (консервативно, считается `unknownCodeCount`) |
| второе | всегда `0`, игнорируется |
| `localUuid` | **ключ индекса** — uuid объекта в этой конфигурации |
| `vendorUuid` | uuid того же объекта у поставщика, не индексируется |

Пара uuid может различаться: так выглядит сопоставленный объект (локальный, поставщика). На реальной
конфигурации БП КОРП таких записей 535, поэтому фильтр «оба uuid совпадают» теряет их. Сумма объявленных
`count` должна равняться числу найденных записей; расхождение пишется в лог предупреждением (формат
файла мог измениться).

**Несколько поставщиков** (пример: БП КОРП + «Диадок»): один объект может числиться у обоих. Слияние —
«строгий побеждает»: `Locked` > `Editable` > `Removed`. Иначе разрешение одного поставщика молча сняло бы
запрет другого.

### Прецедент ошибки (не «чинить обратно»)

Прежний разбор брал `<uuid>,<uuid>,(\d)` — цифру, стоящую ПОСЛЕ пары. Это код СЛЕДУЮЩЕЙ записи (код —
перед парой), то есть режим каждого объекта читался у соседа. Вдобавок `0` трактовался как «не на
поддержке», а `2` — как «запрещено», тогда как на деле `0` = замок, `2` = снят; фильтр «пара совпадает»
терял сопоставленные объекты. Замер на реальной БП КОРП после исправления: 115 358 запрещено / 131
разрешено / 3 снято. Корректность закреплена регрессией позиции в `parentConfigurationsParser.test.ts`.

### Кэш и поиск корня

- `SupportInfoService.loadConfig`: сначала `stat` (mtime+size) — совпал, файл не читается; иначе чтение,
  `sha1` — совпал, разбор пропускается, `stat` обновляется; иначе `parseParentConfigurations`.
- Корень без bin хранится маркером `hasData: false`, а не удаляется: иначе файл вложенного корня (CFE
  внутри CF) попал бы под префикс внешней конфигурации и получил чужой режим. Для маркера режим — `None`.
- Корень файла — по САМОМУ ДЛИННОМУ совпадающему префиксу среди кэшированных (`getSupportMode`,
  `hasConfigData`, `getSupportModeByUuid`).
- uuid объекта читается из первых 2048 байт его XML (`uuid="…"`); максимальное смещение по 43 225
  файлам выгрузок — 942 байта.

### XML-владелец содержимого `Ext`

Режим принадлежит XML объекта, а не модулю. `MetaPathResolver.resolveOwnerXmlForExtContent(configRoot,
filePath)` (и одноимённая функция-фасад) находит этот XML для всего, что лежит внутри каталога `Ext`:

- `Ext` прямо в корне (модули конфигурации) → `Configuration.xml`;
- иначе для каталога `<Папка>/<Имя>` кандидаты в порядке: плоский `<Папка>/<Имя>.xml`, затем глубокий
  `<Папка>/<Имя>/<Имя>.xml`. Плоский первым, потому что дескрипторы форм, команд и макетов выгружаются
  всегда плоско, а у объектов бывают обе раскладки;
- дескриптора нет (у формы бывает только тело) → подъём на ДВА уровня (`Forms/<Имя>` → объект-владелец),
  то есть модуль формы без дескриптора берёт режим объекта;
- иначе `null` (например `<Папка>/Ext/x.bsl`, путь вне корня, нет сегмента `Ext`).

`.xml` вне `Ext` считается XML самого объекта и читается как есть. Старый `resolveObjectXmlForBsl` удалён.

### Представление

`SupportMode` — строковый enum (`none|locked|editable|removed`). Все соответствия режима UI живут в одной
таблице `SUPPORT_PRESENTATION` (`ui/support/supportPresentation.ts`):

| Режим | Суффикс `contextValue` | DTO webview | Иконка | Подпись |
|---|---|---|---|---|
| `None` | `-supportNone` | `'none'` | `support-none` | Не на поддержке |
| `Locked` | `-supportLocked` | `'locked'` | `support-locked` | На поддержке, редактирование запрещено |
| `Editable` | `-supportEditable` | `'editable'` | `support-editable` | На поддержке, редактирование разрешено |
| `Removed` | `-supportRemoved` | `'removed'` | `support-removed` | Снят с поддержки |

`withSupportSuffix` удаляет любой прежний токен режима в любом месте строки (после него дописывается
`-repo…`) — иначе `getTreeItem` копил бы суффиксы. Конфигурация без bin режима не имеет: узлы без
суффикса и без иконки поддержки. Блокирует правку и открытие в режиме правки ТОЛЬКО `Locked`
(`isLocked`, `=== SupportMode.Locked` во всех гейтах); `Removed` и `Editable` не блокируют.
Нативной файловой декорации поддержки нет (`SupportDecorationProvider` удалён как мёртвый), состояние
показывают иконка узла и `stateIcons` webview; сброс кэша по изменению bin — `ui/support/SupportWatcher`.

Тесты строят синтетический bin хелпером `src/test/suite/support/parentConfigurationsBin.ts`
(`buildParentConfigurationsBin`) во временном каталоге — реальные выгрузки и `example/` не используются.

## Иконки (nodes/presentation/)

`getIconUris(nodeKind, ownershipTag, extensionUri)` возвращает пару URI для светлой и тёмной темы. Для заимствованных объектов (`BORROWED`) добавляет суффикс `-borrowed` к имени иконки.

`getIconName(kind)` в `iconMap.ts` читает `descriptor.icon` и возвращает имя SVG-файла. Иконки хранятся в `src/icons/light/` и `src/icons/dark/`.

## Панель свойств: где живёт порядок ключей и секция «Формы»

Порядок и состав ключей свойств корневого объекта в панели задаёт `ui/views/properties/propertyKeyOrder.ts`
(`getRootPropertyKeyOrder(rootMetaKind)`), а не реестр `PROPERTY_SCHEMAS` из `infra/xml/PropertySchema.ts`:
последний ничем не читается (кроме собственного определения и `export *`), правка его наборов
(`COMMON_ROOT_KEYS`/`ENUM_ROOT_KEYS`) поведения не меняет. Его судьба (удалить или оживить) — открытый пункт
бэклога; до решения не править его «чтобы появилось свойство». Действующие источники в `PropertySchema.ts` —
`PROPERTY_TITLE_RU` (подписи), `ENUM_OPTIONS`, множества boolean/localized-тегов и
`FORM_PROPERTY_KEYS_BY_KIND`.

Секция «Формы» (контрол выбора формы `PropertyFormsSection.vue`) показывается у всех видов, у которых по
эталону есть свойства форм: справочник, план видов характеристик, документ, обработка, отчёт, регистры (сведений, накопления,
бухгалтерии, расчёта), перечисление, план обмена, бизнес-процесс, задача, планы счетов и видов расчёта,
журнал документов, критерий отбора, хранилище настроек, константа, а также корень конфигурации и
расширения. Состав ключей по виду — `FORM_PROPERTY_KEYS_BY_KIND` (`infra/xml/PropertySchema.ts`), методика
снятия и оговорка про виды без экземпляров в эталоне —
[xml-format-rulesets.md](./xml-format-rulesets.md#свойства-выбора-форм-по-виду-метаданных). Секцию
проставляет `applyFormPropertySection` по `isFormPropertyKey`; заголовок — константа
`FORM_PROPERTY_SECTION` (`propertyKeyOrder.ts`), с которой webview сравнивает
`card.section.title` (`src-ui/apps/dynamic-panel/views/properties/PropertiesView.vue`). Литерал `'Формы'`
в расширении не дублируется — его стережёт `formSectionContract.test.ts`.

## Отдельно: панель «Изменения метаданных»

Рядом с навигатором в том же контейнере активности `v8vscedit` есть независимая webview-панель
`v8vsceditChanges` — семантический `git status` в терминах объектов метаданных (stage/unstage/discard/
commit/diff). Она держит свою модель данных изменений (`ChangesModel` из `infra/git/*`, а не
`MetadataCache`), но её дерево **повторяет навигаторную иерархию** этой панели, обрезанную только до
изменённых объектов и их предков: `MetadataChangesViewProvider` для каждого изменённого объекта находит
его узел в `MetadataTreeProvider` (`findNode` по `nodeKind`+`textLabel`) и поднимается `getParent` до
корня конфигурации, собирая реальную цепочку групп (`Общее → Общие модули → ...`, `Справочники → ...` и
т.д.); для удалённых объектов (уже отсутствующих в дереве) цепочка синтезируется из `META_TYPES`. Секция
«Прочие» (файлы вне структуры выгрузки) исключение — она остаётся плоской, у таких файлов нет
владеющего объекта. Переиспользуется и сам Vue-компонент дерева
(`src-ui/shared/components/tree/UniversalTree*.vue`), что и у `UniversalPanelViewProvider`.
Подробности, включая ограничения синтеза для удалённых объектов и производительность поиска узла, — в
[git-metadata-changes.md](./git-metadata-changes.md#известные-ограничения).
