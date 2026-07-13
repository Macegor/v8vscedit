# Изменения метаданных (семантический git по объектам 1С)

## Назначение

Webview-панель `v8vsceditChanges` в контейнере активности `v8vscedit`, показывающая `git status`
рабочей копии не построчно по файлам, а в терминах объектов метаданных 1С и их частей («Свойства»,
«МодульОбъекта», «Форма.ФормаЭлемента» и т.п.), с полноценными git-операциями —
stage/unstage/discard/commit/diff, как в штатном SCM VS Code. Дополняет (а не заменяет) существующие
git-декорации навигатора (`infra/git/GitMetadataStatusService.ts` → `GitMetadataDecorationProvider`),
которые красят узлы основного webview-дерева; это представление — самостоятельный список изменений
рядом с ним, со своей моделью данных.

Презентация — **webview, а не нативный `TreeView`**: панель переиспользует тот же Vue-компонент дерева,
что и основной навигатор (`UniversalPanelViewProvider`), и добавляет собственную SCM-шапку (сообщение
коммита, кнопки «Закоммитить»/«Обновить»/«Проиндексировать всё»). Итерация 1 этого представления была
нативным `TreeDataProvider` — он полностью удалён вместе с шестью командами `v8vscedit.changes.*` и
меню `package.json → contributes.menus`; текущая архитектура их не имеет и не нуждается в них.

Итерация 2 заменила ПЛОСКОЕ дерево «секция → объект → части» на **навигаторную иерархию**: секции
`staged`/`unstaged` теперь повторяют группировку основного дерева конфигурации (`Общее → Общие модули →
<модуль>`, `Справочники → <Имя> → <части>` и т.д.), обрезанную только до изменённых объектов и их
предков. Секция «Прочие» (нераспознанные/`unresolved` файлы) остаётся плоской — у таких файлов нет
владеющего объекта метаданных, обрезать их иерархию не по чему.

## Архитектура по слоям

### `infra/git/` — чистая логика, без `vscode` (не менялась при пивоте презентации)

| Модуль | Ответственность |
|---|---|
| `GitPorcelainReader.ts` | `parsePorcelain(output)` — единый парсер `git status --porcelain` (v1) в `PorcelainEntry[]` с РАЗДЕЛЬНЫМИ символами индекса (X) и рабочего дерева (Y); снимает кавычки и декодирует восьмеричные C-escapes (`core.quotepath`) для кириллических имён. `GitMetadataStatusService` отрефакторен на этот парсер — устранён дубль-парсер, который раньше жил внутри сервиса декораций. |
| `MetadataChangeResolver.ts` | `resolveFilePart(configRoot, absFilePath)` — путь файла (в т.ч. удалённого — резолвинг идёт по СТРОКЕ пути, без обращения к ФС) → `MetadataChangePart` (тип объекта, имя, часть `objectProperties\|module\|form\|command\|template\|help\|raw`, слот модуля, каноничный путь владельца). |
| `MetadataChangeAggregator.ts` | `aggregateMetadataChanges(entries, gitRoot, configRoots)` → `ChangesModel { staged, unstaged, unresolved }` — группирует файлы по объекту, разносит X/Y по сторонам staged/unstaged, схлопывает статусы частей и объекта (`combineStatus`), файлы вне известной структуры выгрузки — в `unresolved`. |
| `GitBlobReader.ts` | `readBlobAtHead`/`readBlobAtIndex` (`git show HEAD:<path>` / `git show :<path>`) — левая/правая сторона diff без мутаций; мягкий `null`, если blob отсутствует или git недоступен. |
| `GitStatusReader.ts` | `readPorcelainEntries`/`resolveGitRoot` — раннер git-процесса для UI-слоя (провайдер сам процессов не запускает). |
| `GitWriteService.ts` | Мутации над НАБОРОМ файлов: `stage`/`unstage`/`discard`/`commit`. `discard` различает `modified`/`deleted` (`git checkout --`) и `untracked` (удаление файла с диска). |

`ChangesModel` — единственная граница между движком и презентацией: всё, что ниже, про webview ничего
не знает, а всё, что выше, про git-процессы ничего не знает.

### `ui/views/changes/` — построение состояния и webview-провайдер

- **`changesDtoBuilder.ts`** — чистые функции-строители ЛИСТЬЕВ дерева, БЕЗ `vscode`. Экспортирует:
  `buildObjectNode(side, group, groupIndex, iconResolver)` — объектный узел одной `ObjectChangeGroup`
  (иконка через инъектируемый `IconResolver` по `rootKind`, тот же принцип, что и в навигаторе:
  `getIconUris`/`META_TYPES`; метка — `canonicalPath` во множественном числе; `id` вида `staged#0`);
  `buildPartNode(objectId, part, partIndex)` — узел изменённой части объекта без иконки (метка
  `Свойства`/`МодульОбъекта`/`Форма.<Имя>`, статус `A`/`M`/`D` в поле `gitStatus`, `id` вида
  `staged#0.1`); `buildOtherSection(unresolved)` — плоская секция «Прочие» целиком (`other#2`);
  `SECTION_LABELS` — метки трёх секций («Проиндексировано»/«Не проиндексировано»/«Прочие»). Сама
  навигаторная иерархия НАД объектным узлом (group-узлы «Справочники»/«Общие» и т.п.) этим модулем не
  строится — это забота `changesTreeAssembler.ts` и `MetadataChangesViewProvider` (см. ниже); прежний
  плоский `buildChangesState`, собиравший секцию целиком, удалён вместе с итерацией 1 UI.

  Обратная функция `resolveChangeAddress(model, nodeId)` по `id` узла (`staged#0`, `staged#0.1`,
  `other#2`) восстанавливает набор ОТНОСИТЕЛЬНЫХ путей файлов и записи для `discard` (`DiscardStatus` —
  `modified`/`deleted`/`untracked`) — этот id-контракт (`side#i`, `side#i.j`, `other#k`) НЕ изменился при
  переходе на навигаторную иерархию: group-узлы иерархии получают собственные синтетические `id`
  (`${side}#nav#<keyPath>`), не матчащие `NODE_ID_RE`, поэтому клик по ним тихо не даёт действия — id
  адресуемых (actionable) узлов всегда указывает на лист.

  `src-ui` исключён из `tsconfig.test.json`, поэтому модуль объявляет ЛОКАЛЬНЫЕ зеркала типов
  `TreeNodeDto`/`IconDto`/`ChangesViewState` по конвенции `ui/views/<область>/_types.ts` — их форма
  обязана совпадать с `src-ui/shared/types/{tree,icon,changes}.ts`. Это единственное место в
  `infra`/`ui`-слое, где такое зеркалирование оправдано: тестовый `tsconfig` физически не видит `src-ui`.

- **`changesTreeAssembler.ts`** — чистая (без `vscode`) сборка дерева ОДНОЙ секции по навигаторной
  иерархии. `assembleNavigatorSection(side, chains, sectionLabel)` принимает набор `ChangeChain`
  (`{ ancestors: NavAncestorDto[], leaf: TreeNodeDto }` — путь предков + уже готовый лист от
  `buildObjectNode`) и сворачивает их в `ChangesSectionDto`: одинаковая последовательность предков
  (сравнение по накопленному `NavAncestorDto.key`) схлопывается в ОДИН общий group-узел — два изменённых
  справочника делят один узел-коллекцию «Справочники», а не дублируют его. Group-узел получает
  синтетический `id = ${side}#nav#<keyPath>`, `kind: 'changeGroup'`, пустой `actions: []` — резолвинг
  реального навигаторного дерева и синтез цепочки для удалённых объектов в этот модуль не входят, это
  ответственность вызывающей стороны.

- **`MetadataChangesViewProvider.ts`** — `vscode.WebviewViewProvider` (`viewType = 'v8vsceditChanges'`).
  Конструктору необходим `treeProvider: MetadataTreeProvider` (передаётся через `Container` вместе с
  `gitRoot`/`getConfigRoots` в `MetadataChangesViewServices`) — источник навигаторной иерархии, которую
  повторяет дерево панели. Модель `ChangesModel` вычисляется ЛЕНИВО: при первом `resolveWebviewView`,
  далее — только в `refresh()`/`updateConfigRoots()` (запрет №11, никакого синхронного I/O на hot path).

  Построение секции (`buildNavigatorSection`) для каждой `ObjectChangeGroup`:
  1. `findNavigatorNode` ищет узел объекта в дереве навигатора через `treeProvider.findNode` по
     `nodeKind`+`textLabel` (ограничено `configRoot` группы, дизамбигуация — `Boolean(node.xmlPath) &&
     !node.metaContext`, чтобы не попасть на дочерний элемент с тем же именем).
  2. Если узел найден — `ancestorsFromTree` поднимается `treeProvider.getParent(...)` от объекта до
     корня конфигурации (`configuration`/`extension`/`extensions-root`), разворачивает цепочку и строит
     ключи предков `buildNodeKey` — тем же способом, что `UniversalPanelViewProvider.buildNodeKey`
     (nodeKind + label + xmlPath + decorationPath + владеющий XML/имя ТЧ + ownershipTag), иконки —
     через общий `buildAssetIcon`→`getIconUris`.
  3. Если узел НЕ найден (объект удалён — в кэше навигатора его больше нет), `synthesizeAncestors`
     строит цепочку из `META_TYPES[group.rootKind]`: для `group === 'common'` — «Общие» + коллекция типа
     (напр. «Общие модули»), иначе — одна коллекция (напр. «Справочники»).
  4. Готовые цепочки (`ChangeChain[]`) сворачивает `assembleNavigatorSection` в секцию.

  Протокол ui → host: `{ type: 'command', command, payload: { nodeId? } | { message? } }`, где `command`
  ∈ `stage | unstage | discard | commit | openDiff | refresh`; host → ui: `{ type: 'state', state:
  ChangesViewState }`. Действия транслируются в существующие функции `infra/git/GitWriteService`
  (`stage`/`unstage`/`discard`/`commit`) и в `vscode.diff` с URI `onec-git` (`buildOnecGitUri`);
  `commit` берёт текст сообщения из `payload.message`, `discard` — с модальным подтверждением
  (`showWarningMessage`). Иконка объекта строится через `getIconUris(kind, undefined, extensionUri)` и
  доводится до `webview.asWebviewUri(...)` — тот же источник, что у навигатора. Webview-опции:
  CSP `{ allowStyles: true, allowImages: true }`, `localResourceRoots` через
  `resolveWebviewLocalResourceRoots(extensionUri, { includeIcons: true })`.

### `ui/git/` — тонкая обёртка diff-схемы

`OnecGitContentProvider.ts` — `TextDocumentContentProvider` со схемой `onec-git`; URI самодостаточен
(`gitRoot` + `ref` в query), поэтому не зависит от глобального состояния. `buildOnecGitUri(gitRoot,
absFilePath, ref)` строит URI для `HEAD`/`index` либо (после обобщения ради панели «История», см.
[git-history-graph.md](./git-history-graph.md#uigit--обобщение-diff-схемы-на-произвольный-ref)) любого
commit-ish. Эта панель по-прежнему передаёт только `'HEAD'`/`'index'` — контракт для неё не изменился.

### `src-ui/apps/changes/` — Vue-приложение панели

- `main.ts` — точка входа (entry `changes` в `vite.webview.config.ts`): `loadInitialState<ChangesViewState
  | null>('changes')`, `MessageBus`, монтирование `ChangesApp`.
- `ChangesApp.vue` — три секции (`staged`/`unstaged`/`unresolved`), каждая рисует общий
  `UniversalTree` (см. ниже) с уже готовой навигаторной иерархией из `state.<секция>.nodes` — компонент
  дерево не строит и не обрезает, только рендерит присланное. `expandAll()` рекурсивно раскрывает ВСЮ
  обрезанную ветвь (group-узлы и объектные узлы) при монтировании и после каждого `state`-сообщения,
  чтобы изменения были видны сразу без ручного разворота промежуточных узлов-коллекций. Контекстное меню
  узла собирается ЛОКАЛЬНО в компоненте (набор пунктов зависит от стороны: `staged` → сравнение/снять
  индексацию/отменить, `unstaged` → сравнение/проиндексировать/отменить, `other` → проиндексировать/
  отменить) и не хардкодится в `package.json → contributes.menus` — тот же принцип, что и у
  `UniversalPanelViewProvider.getNodeActions()` (см. `CLAUDE.md`, запрет №14/15), просто здесь применён к
  отдельной панели, а не к основному навигатору. Двойной клик по узлу → `openDiff`. Внешние отступы
  `body`/`#app` сброшены изолированно в стилях компонента (`:global(html,body,#app){margin:0;padding:0}`,
  `scoped`-стиль бандла `changes`, на остальные панели не влияет) — дерево панели рисуется встык к краям
  контейнера активности, как у навигатора.
- `ChangesCommitBox.vue` — SCM-шапка: textarea сообщения коммита + кнопка «Закоммитить»
  (`disabled`, пока пусто сообщение или `canCommit === false`) + тулбар «Проиндексировать всё»/«Обновить»
  (образец компоновки — `src-ui/apps/repository-commit`).

### Переиспользование дерева навигатора

Переиспользование двухуровневое:

1. **Компонент.** `UniversalTree.vue`/`UniversalTreeNode.vue`/`UniversalTreeRow.vue` вынесены (`git mv`)
   в `src-ui/shared/components/tree/` и используются одновременно навигатором (`universal`, `subsystem`,
   `dynamic-panel`) и панелью изменений — это ОБЩИЙ компонент, а не форк под новую задачу. Поле
   `TreeNodeDto.gitStatus` (`added|modified|deleted`) уже существовало в общем протоколе (декорации
   навигатора красят те же узлы тем же полем) — панели изменений не потребовалось расширять контракт
   дерева, только заполнить существующее поле в `changesDtoBuilder`.
2. **Структура.** Начиная с итерации 2 панель переиспользует и саму ИЕРАРХИЮ навигаторного дерева, а не
   только компонент отрисовки: `MetadataChangesViewProvider` строит цепочки предков через
   `treeProvider.getParent(...)` на реальном `MetadataTreeProvider` навигатора, поэтому группировка
   секций staged/unstaged буквально совпадает с группировкой основного дерева конфигурации (см.
   [metadata-navigator.md](./metadata-navigator.md)), просто обрезанная до изменённых объектов. Панель
   при этом НЕ хранит собственный кэш метаданных и не строит альтернативную группировку — источник
   правды по иерархии один, `MetadataTreeProvider`/`MetadataCache` навигатора.

### Wiring (`Container.ts`)

`MetadataChangesViewProvider` создаётся ПОСЛЕ `treeProvider` (порядок важен — конструктор получает на
него ссылку через `MetadataChangesViewServices.treeProvider`) и ДО `wireMetadataChangesView()`:

1. `changesGitRoot` — реальный toplevel git-репозитория (`resolveGitRoot`, может быть ВЫШЕ workspace-папки), с фолбэком на саму папку воркспейса, если git недоступен.
2. `vscode.window.registerWebviewViewProvider('v8vsceditChanges', metadataChangesViewProvider, { webviewOptions: { retainContextWhenHidden: true } })`.
3. `registerTextDocumentContentProvider(ONEC_GIT_SCHEME, onecGitContentProvider)`.
4. `onDidChangeWorkspaceFolders(() => metadataChangesViewProvider.refresh())`.

Всё — в `context.subscriptions`. Обновление панели подвешено на ТЕ ЖЕ пути, что и git-декорации
навигатора: `scheduleDecorationRefresh()` (дебаунс 500 мс на `.git/HEAD`, `.git/index`,
`.git/packed-refs`, `.git/refs/**`, а также на изменения XML/BSL-файлов выгрузки через `onSourceChange`)
в конце вызывает `metadataChangesViewProvider.refresh()` — так же, как `gitMetadataDecorationProvider.refresh()`
и `treeProvider.refreshDecorations()`. Дополнительно `reloadEntries()` вызывает
`metadataChangesViewProvider.updateConfigRoots()` при смене состава найденных конфигураций/расширений.
Модель `git status` никогда не пересчитывается на старте расширения и не пересчитывается в конструкторе
провайдера — только лениво при первом `resolveWebviewView` или явном `refresh()`.

`package.json`: `viewsContainers.activitybar` → `v8vscedit` содержит `v8vsceditUniversal` и
`v8vsceditChanges` — ОБА `type: "webview"`. Активация — через `onView:v8vsceditChanges` в
`activationEvents` (по правилу из
[vscode-extension-best-practices.md](./vscode-extension-best-practices.md#1-активация-и-производительность)
узкие `onView:*`/`onCommand:*`, дублирующие `contributes`, для VS Code ≥ 1.74 избыточны, но здесь
оставлены явно для совместимости с более старыми клиентами `engines.vscode`). Команд
`v8vscedit.changes.*` и меню `view/item/context`/`view/title` для этого view в `package.json` больше
нет — все действия идут через внутренний протокол webview, а не через палитру команд/контекстное меню
VS Code.

## Поток данных

```
git status --porcelain --untracked-files=all   (GitStatusReader.readPorcelainEntries)
        │
        ▼
PorcelainEntry[]  (GitPorcelainReader.parsePorcelain — раздельные X/Y, unquote путей)
        │
        ▼  для каждой записи: абсолютный путь → владеющий configRoot (по самому длинному совпадению)
resolveFilePart(configRoot, absPath)  (MetadataChangeResolver)
        │
        ▼
MetadataChangePart  (rootKind, rootName, part, partLabel, slot?, childName?, canonicalOwnerPath)
        │
        ▼  группировка по (configRoot, canonicalOwnerPath), разнос X→staged / Y→unstaged
aggregateMetadataChanges(entries, gitRoot, configRoots)  (MetadataChangeAggregator)
        │
        ▼
ChangesModel { staged: ObjectChangeGroup[], unstaged: ObjectChangeGroup[], unresolved: RawChange[] }
        │
        ▼  ЛЕНИВО, при первом resolveWebviewView / явном refresh()
        │  для каждой ObjectChangeGroup:
        ├─ buildObjectNode(side, group, i, iconResolver)         (changesDtoBuilder)  → лист TreeNodeDto
        └─ resolveAncestors(group)                        (MetadataChangesViewProvider)
               ├─ найден в дереве → treeProvider.findNode + getParent* → ancestorsFromTree
               └─ удалён (нет в кэше) → synthesizeAncestors из META_TYPES
        │
        ▼  { ancestors: NavAncestorDto[], leaf: TreeNodeDto } — ChangeChain
assembleNavigatorSection(side, chains, sectionLabel)  (changesTreeAssembler)
        │  дедупликация общих предков по key → group-узлы «Справочники»/«Общие»/…
        ▼
ChangesViewState { staged, unstaged, unresolved: ChangesSectionDto, canCommit, commitMessage }
        │
        ▼  postMessage({ type: 'state', state })
ChangesApp.vue → UniversalTree  (общий Vue-компонент дерева навигатора, дерево уже навигаторной формы)
```

Секция «Прочие» (`unresolved`) в эту схему не входит — `buildOtherSection` строит её отдельно, плоско,
напрямую из `model.unresolved`, без обращения к `treeProvider`/ассемблеру.

`resolveFilePart` строит принадлежность СТРОГО по строке относительного пути внутри `configRoot`
(свёртки существующих реестров — `META_TYPES.folder` → `MetaKind` и `MODULE_SEGMENT_MAP` → слоты
объектных модулей; дизамбигуация одинаковых относительных путей вроде `Ext/Module.bsl` — через
`META_TYPES[kind].modules`). Благодаря этому корректно разбираются и уже удалённые/переименованные
файлы, для которых нет смысла лезть в ФС.

## Семантика staged/unstaged и diff — модель трёх деревьев git

Как и штатный SCM VS Code, представление работает с тремя состояниями файла: `HEAD` (последний
коммит), индекс (staging area) и рабочее дерево. Отсюда — два РАЗНЫХ diff в зависимости от стороны
узла (`MetadataChangesViewProvider.openDiff`):

- **unstaged** (Y-статус) — сравнение **индекс ↔ рабочее дерево**: слева `onec-git`-URI на blob индекса
  (`readBlobAtIndex` — фактически берётся через `buildOnecGitUri(gitRoot, absPath, 'index')`), справа
  реальный `file://`. Для untracked-файла индексного blob-а нет — левая сторона пуста; для удалённого
  файла нет правой стороны на диске.
- **staged** (X-статус) — сравнение **HEAD ↔ индекс**: обе стороны — `onec-git`-URI (`ref='HEAD'` /
  `ref='index'`). Сравнивать staged-файл с рабочей копией НЕЛЬЗЯ: для чисто застейдженного файла
  `индекс == рабочее дерево`, и такой diff всегда был бы пустым — именно поэтому обе стороны staged-diff
  идут через `onec-git`, а не через `file://`.

Diff открывается только для узла с ЕДИНСТВЕННЫМ представляющим файлом (`ChangeAddress.single === true`
в `resolveChangeAddress`) — для многофайлового узла (объект из нескольких частей) однозначного diff нет;
контекстное меню в `ChangesApp.vue` всё равно предлагает пункт «Открыть сравнение» на любом узле секции,
но обработчик молча не срабатывает, если адрес не единственный (см. `applyDiscard`-подобную защиту в
`MetadataChangesViewProvider.openDiff`).

## Формат сообщений протокола

Панель — обычный `WebviewHtmlFactory`-webview (entry `changes`, `viewKind: 'changes'`), поэтому базовый
транспорт (`MessageBus`, `loadInitialState`) — общий с остальными панелями `src-ui`. Специфика этой
панели — набор команд:

| Направление | Форма | Когда |
|---|---|---|
| ui → host | `{ type: 'command', command: 'stage'\|'unstage'\|'discard'\|'openDiff', payload: { nodeId } }` | клик по действию узла/меню |
| ui → host | `{ type: 'command', command: 'commit', payload: { message } }` | кнопка «Закоммитить» |
| ui → host | `{ type: 'command', command: 'refresh' }` | кнопка «Обновить» |
| host → ui | `{ type: 'state', state: ChangesViewState }` | после `resolveWebviewView`, после любой мутации, после `refresh()`/`updateConfigRoots()` |

`nodeId` — тот же `id`, что и в `TreeNodeDto` (`<side>#<groupIndex>[.<partIndex>]` либо
`other#<rawIndex>`); `resolveChangeAddress` — единственное место, где `id` расшифровывается обратно в
файлы. Расширение протокола (новая команда) описано в `CLAUDE.md` («Инвариант изменений» → «Новая
git-мутация над панелью изменений»).

## Соответствие канону имён

`canonicalOwnerPath` в `MetadataChangeResolver` строится через `domain/CanonicalNames.ts`
(`canonicalRootPath`) — тот же единственный источник правды, что и у MCP-инструментов
(см. [mcp-paths.md](./mcp-paths.md)). Два уточнения, специфичных для этого представления:

1. **«Свойства» — UI-метка узла, а НЕ сегмент канона.** Корневой путь объекта
   (`Справочники.Контрагенты`) в каноне уже и есть его свойства; `canonicalOwnerPath` для корневого XML
   НЕ содержит сегмента «Свойства» — метка `Свойства` добавляется только при построении узла части в
   `changesDtoBuilder.partLabelOf`, в модель канона она не просачивается.
2. **Мн. число корней** соблюдается так же, как в MCP-канoне: `ОбщиеМодули.ОбщегоНазначения`,
   `Справочники.Контрагенты` — единственное число только у подсистем/псевдо-корней (см.
   [mcp-paths.md §1.2](./mcp-paths.md#12-единственное-число-для-подсистем-и-псевдо-корней)), что здесь
   неприменимо (у объектов панели изменений всегда есть родительская коллекция).

## Известные ограничения

Зафиксировано честно — кандидаты на доработку, а не скрытые баги:

- **Глубина листа — «объект → изменённые части», ниже части дерево не раскрывается.** С итерации 2
  ветка ОТ КОРНЯ ДО объекта повторяет полную навигаторную иерархию (обрезанную по изменениям), но сам
  объектный узел раскрывается только до списка изменённых частей (модуль/Свойства/форма) — ЧАСТЬ дальше
  не разворачивается (например, до конкретного реквизита или колонки ТЧ), в отличие от основного дерева
  навигатора, где объект раскрывается до полной структуры. Осознанный выбор — показывать дельту, а не
  весь объект; узлы части — терминальные (`hasChildren: false`).
- **`findNavigatorNode` — O(изменённых объектов × размер дерева) на `refresh()`.** Для КАЖДОЙ изменённой
  `ObjectChangeGroup` вызывается `treeProvider.findNode(...)` — DFS по навигаторному дереву с ленивой
  достройкой непосещённых узлов. На конфигурациях с большим числом одновременно изменённых объектов
  (крупный merge/rebase) это может дать заметную задержку `refresh()`. Кандидат на доработку — построить
  один раз индекс `Map<rootKind + '~' + textLabel, MetadataNode>` за единственный проход по дереву вместо
  отдельного поиска на каждую группу. Не hot path (только `resolveWebviewView`/`refresh()`), но
  масштабируется хуже линейного.
- **`synthesizeAncestors` не восстанавливает промежуточную ветвь для удалённых `documents-branch`.** Для
  удалённого объекта группы `documents-branch` (например `DocumentNumerator`, `Sequence`,
  `DocumentJournal`) синтезированная цепочка предков — одна коллекция своего типа, БЕЗ промежуточного
  узла «Документы», который показал бы живой навигатор для такого же объекта до удаления. Косметическое
  расхождение только для удалённых объектов этой группы; на `stage`/`unstage`/`discard`/`diff` не влияет
  (адресация узла не зависит от предков).
- **Переименования (`R`) сводятся к `M`** и учитывают только НОВЫЙ путь — старый путь не входит в набор
  файлов узла, поэтому «переименовано без изменений» неотличимо от «изменено».
- **`discard` на застейдженной стороне для чисто застейдженного файла — фактически no-op**: `git
  checkout --` восстанавливает из индекса, а когда `worktree == index`, это ничего не меняет. Штатный
  SCM в этом случае вовсе не показывает discard на staged-стороне; здесь пункт меню показан
  безусловно. Кандидат на доработку — `reset` перед `checkout`, либо скрытие пункта discard для
  staged-узлов без расхождения с рабочим деревом.
- **Гранулярность — до части объекта, не до атрибута/колонки.** Корневой XML объекта в этой панели —
  ОДНА часть «Свойства» целиком; block-diff внутри XML (по конкретному реквизиту/колонке) уже
  существует в `GitMetadataStatusService` (для декораций навигатора), но в модель этой панели не
  проброшен.
- **Дублирование git-вызовов.** `GitStatusReader` (`readPorcelainEntries`/`resolveGitRoot`) дублирует
  логику `GitMetadataStatusService.ensureStatusMap`/получения корня git — кандидат на объединение,
  явно вынесенное сюда, а не скрытое.
- **Конфликты (`U`) не обрабатываются** — вне текущей области.

## Связанные документы

- [mcp-paths.md](./mcp-paths.md) — канон путей, общий с `canonicalRootPath`/`MODULE_SEGMENT_MAP`.
- [metadata-navigator.md](./metadata-navigator.md) — основное дерево навигатора и его git-декорации
  (`GitMetadataStatusService`), к которому эта панель не относится напрямую, но переиспользует общий
  парсер porcelain, общий Vue-компонент дерева и, с итерации 2, саму навигаторную иерархию
  (`MetadataTreeProvider.getParent`).
- [git-history-graph.md](./git-history-graph.md) — панель «История» (граф git-коммитов по объектам 1С),
  read-only потребитель движка этой панели: `aggregateMetadataChanges`, `changesDtoBuilder`
  (`buildObjectNode`/`buildOtherSection`/`resolveChangeAddress`) и `changesTreeAssembler`
  (`assembleNavigatorSection`/`synthesizeAncestors`) переиспользуются БЕЗ ИЗМЕНЕНИЙ, `synthesizeAncestors`
  ради этого вынесен из приватного метода `MetadataChangesViewProvider` в отдельный экспортируемый модуль.
- [architecture.md](./architecture.md) — общая раскладка каталогов и слоёв.
