# История изменений (граф git-коммитов по объектам 1С)

## Назначение

Webview-панель `v8vsceditHistory` — граф истории git (как Git Graph/GitLens), но выбор коммита
показывает не список файлов, а изменённые ОБЪЕКТЫ метаданных 1С, полностью переиспользуя движок
панели [«Изменения метаданных»](./git-metadata-changes.md). Презентация отличается от неё
принципиально: это не `WebviewView` в контейнере активности, а самостоятельная **вкладка редактора**
(`vscode.WebviewPanel`, singleton) — открывается командой `v8vscedit.history.open`, вызываемой кнопкой
`view/title` в шапке панели «Изменения метаданных» (`when: view == v8vsceditChanges`).

Панель read-only: коммит истории нельзя проиндексировать/снять индексацию/закоммитить — только
посмотреть состав изменений и открыть diff одного файла. Это единственное, что качественно отличает её
модель данных от `ChangesModel` панели изменений; остальное — прямое переиспользование.

## Архитектура по слоям

### `infra/git/` — новые чистые модули графа (без `vscode`)

| Модуль | Ответственность |
|---|---|
| `GitLogReader.ts` | `readGitLog(gitRoot, maxCount?)` — раннер `git log --all --decorate=full --parents --topo-order --pretty=format:'%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e'`. `--decorate=full` обязателен — иначе `%D` не различает локальную/удалённую ветку. `maxCount` транслируется в `--max-count` (постраничная подгрузка). Мягкий `[]` при недоступном git. |
| `GitLogParser.ts` | `parseGitLog(output) → RawCommit[]` — чистый разбор по разделителям `\x1f`(поле)/`\x1e`(запись). `parseRefs` разбирает `%D`: `HEAD -> refs/heads/<name>` схлопывается в ОДНУ ссылку `kind: 'head'` (не в пару HEAD+localBranch), одиночный detached `HEAD` отбрасывается; `refs/heads/`→`localBranch`, `refs/remotes/`→`remoteBranch`, `refs/tags/`/`tag: refs/tags/`→`tag`. |
| `GitGraphLayout.ts` | `assignLanes(commits) → GraphLayout { rows, laneCount }` — чистая раскладка коммитов (в топологическом порядке, ребёнок раньше родителя) по дорожкам. Алгоритм и инварианты — см. ниже. |
| `GitCommitChangesReader.ts` | `readCommitChanges(gitRoot, commit, { root? }) → PorcelainEntry[]` — раннер `git diff-tree --no-commit-id --name-status -r -M --first-parent [--root] <commit>`; `parseNameStatus` разбирает вывод в существующую форму `PorcelainEntry` (переиспользует `unquotePorcelainPath` из `GitPorcelainReader`, без дублей). Единственный статусный символ на строку → `worktree` всегда `' '` (пробел). Мягкий `[]` при недоступном git. |
| `GitBlobReader.ts` | Дополнен `readBlobAtRef(gitRoot, ref, absFilePath)` — обобщение `readBlobAtHead`/`readBlobAtIndex` на произвольный commit-ish (`git show <ref>:<rel>`). `readBlobAtHead`/`readBlobAtIndex` не изменились (используются панелью изменений). |

`GitPorcelainReader`, `MetadataChangeResolver`, `MetadataChangeAggregator`, `GitWriteService` панель
истории переиспользует БЕЗ ИЗМЕНЕНИЙ — см. их описание в
[git-metadata-changes.md](./git-metadata-changes.md#infragit--чистая-логика-без-vscode-не-менялась-при-пивоте-презентации).
`GitWriteService` в графе истории вообще не вызывается — панель read-only.

### Раскладка коммитов по дорожкам (`GitGraphLayout.assignLanes`)

Классический алгоритм графа веток без внешних зависимостей: массив `lanes[]`, где значение — хеш
коммита, который дорожка «ожидает» (или `null`, если дорожка свободна). Для каждого коммита (в порядке
`--topo-order`, т.е. родитель всегда обрабатывается после всех детей):

1. **Дорожка коммита** — левейшая, уже ожидающая его хеш, иначе левейшая свободная, иначе новая справа
   (`lanes.push(null)`).
2. **Схлопывание сходящихся веток** — все ОСТАЛЬНЫЕ дорожки, ожидавшие тот же хеш (несколько детей
   указывали на один родительский коммит раньше по истории), освобождаются: их восходящие рёбра уже
   записаны у соответствующих детей, повторно рисовать нечего.
3. **Родители**: первый родитель продолжает дорожку коммита (линейная история не «расползается»);
   каждый следующий родитель (merge) получает свою дорожку — левейшую, уже ожидающую его хеш, иначе
   левейшую свободную/новую.
4. Дорожка коммита освобождается ДО обработки родителей (`lanes[commitLane] = null`), чтобы первый
   родитель мог её переиспользовать той же итерацией.

Результат — `GraphRow { commit, lane, edges: LaneEdge[] }` на каждый коммит; `edges[i] = { fromLane,
toLane, color }`, где `color = toLane` (цвет ребра — индекс дорожки родителя, стабильный per-lane, а не
per-коммит — палитра из 8 цветов в `CommitGraph.vue` берёт его по модулю). Переиспользование левейшей
свободной дорожки не даёт графу «расползаться» вширь после каждого закрытия ветки — тот же приём, что у
Git Graph/gitk.

### `ui/git/` — обобщение diff-схемы на произвольный ref

`OnecGitContentProvider`/`buildOnecGitUri` (`src/ui/git/OnecGitContentProvider.ts`) обобщены с типа
`'HEAD' | 'index'` до `OnecGitRef = string` — любой commit-ish (полный/короткий хеш, `HEAD^`, имя
ветки/тега). `provideTextDocumentContent`: `ref === 'index'` читает индекс (`readBlobAtIndex`), любой
другой `ref` — `readBlobAtRef(gitRoot, ref, absFilePath)`. Пустой/отсутствующий `ref` в URI трактуется
как `HEAD` — обратная совместимость со старыми URI и защита от «висящего» родителя корневого коммита
(`<root>^` не существует → `readBlobAtRef` вернёт `null` → пустая сторона diff, а не исключение).
Панель «Изменения метаданных» по-прежнему передаёт только `'HEAD'`/`'index'` — контракт для неё не
изменился, обобщение расширило множество допустимых значений, не сузив его.

### `ui/views/history/` — сборка состояния и webview-провайдер

- **`historyGraphDtoBuilder.ts`** — чистые (без `vscode`) функции:
  - `formatRelativeDate(timestampSec, nowSec)` — относительная дата на русском («только что» для
    diff < 60 с, иначе «‹число› ‹единица› назад» с полной русской плюрализацией через 3 словоформы и
    особую группу 11–14; единицы: минуты(<1 ч)/часы(<1 сут)/дни(<30 сут)/месяцы(<365 сут,
    `floor(дни/30)`)/годы(`floor(дни/365)`). Отрицательная разница (коммит «из будущего» при
    рассинхроне часов) не бросает исключение — попадает в ветку «только что».
  - `buildGraphRows(layout, nowSec) → GraphRowDto[]` — построчный маппинг `GraphLayout` в плоские DTO
    (`shortHash` — первые 7 символов, `laneColor = lane`), без искажения дорожек/рёбер/родителей/refs.
  - `buildHistoryGraphState(layout, nowSec, hasMore, selectedHash?) → HistoryGraphState` — агрегирует
    `rows`/`laneCount`/`hasMore`/`selectedHash`.
  - `buildCommitChangesSection(model, iconResolver) → ChangesSectionDto` — **read-only** секция
    «Изменения коммита»: навигаторная иерархия строится ТЕМИ ЖЕ функциями, что и панель изменений
    (`buildObjectNode('staged', …, { readonly: true })`, `synthesizeAncestors`,
    `assembleNavigatorSection('staged', chains, 'Изменения коммита')`), плюс плоские узлы
    `buildOtherSection(model.unresolved)` в конце. Работает только с `model.staged` — см. ниже, почему
    изменения коммита всегда попадают именно в `staged`, а не в `unstaged`.
  - Как и `changesDtoBuilder.ts`, объявляет ЛОКАЛЬНЫЕ зеркала типов (`RefDto`, `LaneEdgeDto`,
    `GraphRowDto`, `HistoryGraphState`) по той же причине: `src-ui` исключён из `tsconfig.test.json`.
    Форма обязана совпадать с `src-ui/shared/types/history.ts`.

- **`historyGraphController.ts`** — чистый (без `vscode`, `path` допустим только для имени файла в
  заголовке diff) контроллер, склеивающий уже покрытые слои:
  - `loadHistoryState(gitRoot, pageSize, nowSec, selectedHash?)` — `assignLanes(readGitLog(gitRoot,
    pageSize))` → `buildHistoryGraphState(...)`. `hasMore` вычисляется как `rows.length === pageSize`
    (см. «Пагинация» ниже).
  - `loadCommitChanges(gitRoot, configRoots, hash, isRoot)` — `aggregateMetadataChanges(
    readCommitChanges(gitRoot, hash, { root: isRoot }), gitRoot, configRoots)`. `isRoot` определяет
    провайдер по `row.parents.length === 0` найденной строки графа — для корневого коммита
    `diff-tree` запускается с `--root`, иначе неявно даёт пустой вывод (нет базы для сравнения).
  - `resolveCommitDiff(model, hash, nodeId) → CommitDiff | undefined` — восстанавливает адрес
    ОДИНОЧНОГО файла узла через существующий `resolveChangeAddress` (переиспользован из
    `changesDtoBuilder`, не продублирован); `undefined`, если узел не одиночный (объект из нескольких
    частей) или `nodeId` не резолвится. `CommitDiff = { relFile, leftRef: '<hash>^', rightRef: hash,
    title }` — семантика diff коммита описана ниже отдельно.

- **`HistoryGraphViewProvider.ts`** — тонкая vscode-оболочка. Ключевые отличия от
  `MetadataChangesViewProvider`:
  - **Singleton `vscode.WebviewPanel`**, а не `WebviewView`: `open()` создаёт панель один раз
    (`viewType = 'v8vsceditHistory'`, `ViewColumn.Active`, заголовок «История изменений»), повторный
    вызов — `panel.reveal(...)`. `onDidDispose` сбрасывает всё внутреннее состояние (`panel`,
    `selectedHash`, `selectedModel`, `pageSize`) — следующий `open()` начинает с чистого листа.
  - `refresh()` — **no-op при закрытой панели** (запрет №11: `git log` не читается на hot path, если
    панель никто не открыл).
  - `handleMessage(message)` — публичный метод (не приватный колбэк), обработчик команд протокола;
    тесты вызывают его напрямую, минуя реальное событие `onDidReceiveMessage` (недостижимая для c8
    ветка помечена `/* c8 ignore */`).
  - `renderHtml` встраивает НАЧАЛЬНЫЙ граф прямо в HTML (`initialState`), как `MetadataChangesViewProvider`
    свою модель — граф виден сразу при открытии, без ожидания первого `postMessage`. Обёрнут в
    `try/catch` (по образцу `SubsystemEditorViewProvider`): при отсутствии/повреждении Vite-манифеста
    `history` панель остаётся пустой, но не падает; `refresh`/кнопка «Обновить» дошлют граф отдельным
    сообщением.
  - Иконка объекта строится через `buildIcon` — тот же источник (`getIconUris` по `META_TYPES`,
    доведённая до `webview.asWebviewUri`), что у панели изменений; при отсутствии активной панели или
    ошибке — `{ kind: 'none' }`.

### `ui/commands/history/` и `Container`

`HistoryCommands.ts` регистрирует ОДНУ команду `v8vscedit.history.open` →
`services.historyGraphViewProvider.open()`. В `Container.ts`:

- `historyGraphViewProvider` создаётся ПОСЛЕ `metadataChangesViewProvider`, с теми же
  `gitRoot`/`getConfigRoots` (`changesGitRoot`/`changesConfigRoots`) — единый источник корней,
  переиспользованный, а не задублированный.
- Регистрируется как `vscode.Disposable` в `wireMetadataChangesView()` (вместе с
  `registerWebviewViewProvider` панели изменений и `registerTextDocumentContentProvider` схемы
  `onec-git`) — единая точка wiring обеих панелей.
- `refresh()` подвешен на ТЕ ЖЕ триггеры, что и `metadataChangesViewProvider.refresh()`:
  `onDidChangeWorkspaceFolders`, `refreshTreeCacheForFiles` (после изменений XML/BSL выгрузки),
  `scheduleDecorationRefresh` (дебаунс 500 мс на `.git/HEAD`/`.git/index`/`.git/packed-refs`/
  `.git/refs/**`). Оба провайдера обновляются одним и тем же git-событием — история не может
  «отстать» от панели изменений.

`package.json`: команда `v8vscedit.history.open` объявлена в `contributes.commands` и в
`activationEvents` (`onCommand:v8vscedit.history.open` — явная активация для совместимости со старыми
клиентами, тот же принцип, что у `onView:v8vsceditChanges`, см.
[vscode-extension-best-practices.md](./vscode-extension-best-practices.md#1-активация-и-производительность)).
Единственная точка входа в UI — кнопка `view/title` панели изменений (`when: view ==
v8vsceditChanges`), палитра команд тоже доступна (нет `when: false`, в отличие от скрытых BSL-команд
surround).

### `src-ui/apps/history/` — Vue-приложение

- **`main.ts`** — entry `history` (добавлен в `vite.webview.config.ts`): `loadInitialState<
  HistoryGraphState | null>('history')`, `MessageBus`, монтирование `HistoryApp`.
- **`HistoryApp.vue`** — раскладка «граф сверху / дерево изменений коммита снизу» (`flex-direction:
  column`, `60%/40%`). Верхняя часть — `CommitGraph`, нижняя — общий `UniversalTree` (переиспользован,
  не форк — тот же компонент, что у навигатора и панели изменений, см.
  [git-metadata-changes.md](./git-metadata-changes.md#переиспользование-дерева-навигатора)) с
  `commitSection.nodes`. `expandSection` раскрывает ВСЮ ветвь дерева коммита при получении
  `commitChanges` (по образцу `ChangesApp.expandAll`) — те же принципы UX, тот же паттерн кода.
  Двойной клик по листу (`@default`) → `openDiff`. Кнопка «Обновить» → `refresh`; кнопка «Загрузить
  ещё» (видна только при `graph.hasMore`) → `loadMore`.
- **`CommitGraph.vue`** — чистый презентационный компонент: на каждую строку — SVG-ячейка с рёбрами
  (`<line>` от `laneX(fromLane)` к `laneX(toLane)`, цвет — `laneColor(edge.color)` по модулю
  8-цветной палитры) и кружком коммита (`<circle>`, цвет — `laneColor(row.laneColor)`), затем тема
  коммита, «пилюли» refs (иконка codicon по `ref.kind`: `head→target`, `localBranch→git-branch`,
  `remoteBranch→cloud`, `tag→tag`), автор, относительная дата (title — абсолютная) и короткий хеш.
  Палитра `LANE_PALETTE` — 8 контрастных тонов, НЕ привязанных к `--vscode-*` переменным (цвет
  дорожки — семантический идентификатор ветки, устойчивый к смене темы, а не элемент UI-темизации).
- **`src-ui/shared/types/history.ts`** — ui-зеркало DTO хост-стороны (`RefDto`, `LaneEdgeDto`,
  `GraphRowDto`, `HistoryGraphState`) — форма обязана совпадать с `historyGraphDtoBuilder.ts`.
- **`hostMessages.ts`** — варианты `{ type: 'graph'; state: HistoryGraphState }` и
  `{ type: 'commitChanges'; hash: string; section: ChangesSectionDto }` добавлены в
  `HostToUiMessage`. `UiToHostMessage` не расширялся — панель истории использует существующий
  универсальный `{ type: 'command'; command: string; payload?: unknown }`.

### Извлечение `synthesizeAncestors` в общий модуль

`synthesizeAncestors` (синтез цепочки предков для объекта, которого нет в живом дереве навигатора) был
приватным методом `MetadataChangesViewProvider`; теперь это экспортируемая чистая функция в
`ui/views/changes/changesTreeAssembler.ts`, принимающая `buildIcon` инъекцией. `MetadataChangesViewProvider`
и `historyGraphDtoBuilder.buildCommitChangesSection` вызывают ОДНУ и ту же функцию — никакого
дублирования логики синтеза между панелью изменений и панелью истории. `buildObjectNode`/`buildPartNode`
получили опциональный `options.readonly`/`readonly` параметр: при `true` поле `inlineActions` не
заполняется (`stageUnstageInline` не вызывается) — узлы коммита нельзя проиндексировать/снять
индексацию, т.к. коммит уже неизменяем.

## Поток данных

### Граф (при открытии панели / `loadMore` / `refresh`)

```
git log --all --decorate=full --parents --topo-order --pretty=format:'…' [--max-count=N]
        │                                          (GitLogReader.readGitLog)
        ▼
RawCommit[]                                          (GitLogParser.parseGitLog)
        │
        ▼
GraphLayout { rows: GraphRow[], laneCount }           (GitGraphLayout.assignLanes)
        │
        ▼
HistoryGraphState { rows: GraphRowDto[], laneCount, hasMore, selectedHash? }
        │                            (historyGraphDtoBuilder.buildHistoryGraphState)
        ▼  postMessage({ type: 'graph', state })  /  либо встроено в initialState HTML
CommitGraph.vue — отрисовка дорожек/рёбер/refs
```

### Изменения коммита (по клику на строку графа — `selectCommit`)

```
git diff-tree --no-commit-id --name-status -r -M --first-parent [--root] <hash>
        │                                    (GitCommitChangesReader.readCommitChanges)
        ▼
PorcelainEntry[]  (index-статус, worktree всегда ' ')
        │
        ▼
ChangesModel { staged, unstaged: [], unresolved }     (MetadataChangeAggregator — переиспользован)
        │        (все записи попадают ТОЛЬКО в staged: toUnstagedStatus(' ') === null)
        ▼
ChangesSectionDto «Изменения коммита»     (historyGraphDtoBuilder.buildCommitChangesSection)
        │  buildObjectNode(readonly: true) + synthesizeAncestors + assembleNavigatorSection
        │  + buildOtherSection(unresolved) в конце
        ▼  postMessage({ type: 'commitChanges', hash, section })
HistoryApp.vue → UniversalTree (та же навигаторная форма, что и в панели изменений)
```

Изменения коммита строятся из `git diff-tree`, а не из `git status` — поэтому в `ChangesModel`
задействована только сторона `staged` (единственный статусный символ `diff-tree --name-status`
трактуется существующим `MetadataChangeAggregator` как X-статус индекса; `unstaged` у панели истории
всегда пуст). `buildCommitChangesSection` явно читает только `model.staged` + `model.unresolved`.

## Синтез предков вместо живого дерева навигатора

**Ключевое архитектурное решение.** Предки объекта в дереве коммита ВСЕГДА строятся синтезом из
`META_TYPES` (`synthesizeAncestors`), а НЕ через `treeProvider.findNode`/`getParent` по живому дереву
навигатора (как это делает `MetadataChangesViewProvider` для панели изменений). Причина: живое дерево
отражает ТОЛЬКО текущую рабочую копию. Для исторического коммита это давало бы неверный результат —
объект мог быть с тех пор переименован, перемещён между подсистемами, вообще удалён из текущей выгрузки,
либо, наоборот, ещё не существовать (при разглядывании коммита в прошлом, где путь к объекту иной).
Синтез по типу объекта (`META_TYPES[group.rootKind]`) — единственный способ построить непротиворечивую
иерархию «Общие модули»/«Справочники»/… для ЛЮБОГО коммита истории, не полагаясь на состояние, которого
уже (или ещё) нет. Плата за это — ограничения синтеза (см. «Известные ограничения» ниже) те же, что у
`synthesizeAncestors` в панели изменений: без промежуточной ветви «Документы» для `documents-branch`.

## Семантика diff коммита: `<commit>^ ↔ <commit>`

Двойной клик по одиночному листу дерева изменений коммита открывает `vscode.diff` между СОСТОЯНИЕМ
ПЕРЕД коммитом и состоянием коммита — классический per-commit diff, отличный от diff'ов панели
изменений (индекс/рабочее дерево/HEAD):

- **left** = `onec-git`-URI с `ref = '<hash>^'` (родитель коммита через `readBlobAtRef`);
- **right** = `onec-git`-URI с `ref = hash` (сам коммит);
- заголовок — `<имя файла> (<short>^ ↔ <short>)`.

**Корневой коммит.** `<root-hash>^` не существует как ref — `git show <root-hash>^:<path>` завершится с
ошибкой, `readBlobAtRef` мягко вернёт `null`, `OnecGitContentProvider` отдаст пустую строку. Левая
сторона diff для корневого коммита автоматически пуста (файл «появился с нуля»), без специального кода
на стороне `resolveCommitDiff`/`HistoryGraphViewProvider` — обобщённый `OnecGitContentProvider`
обрабатывает это как частный случай отсутствующего blob-а, тем же путём, что и untracked-файл в панели
изменений.

Как и в панели изменений, diff открывается только для узла с ЕДИНСТВЕННЫМ представляющим файлом
(`resolveChangeAddress(...).single === true`) — многофайловые объектные узлы diff не предлагают
(`resolveCommitDiff` вернёт `undefined`, обработчик тихо не сработает).

## Пагинация: полная перераскладка окна, без курсора

`pageSize` начинается с `PAGE_SIZE_STEP = 200` и растёт на тот же шаг при каждом `loadMore`. При
КАЖДОМ построении графа (открытие панели, `loadMore`, `refresh`, `selectCommit`, смена рабочих папок)
`loadHistoryState` заново читает `git log --max-count=<pageSize>` С НАЧАЛА (топологически от самых
свежих коммитов) и заново прогоняет ВСЮ выборку через `assignLanes` — курсор/`--skip` не используется.

Осознанный выбор, а не недосмотр: раскладка по дорожкам («левейшая свободная дорожка») зависит от ВСЕГО
предшествующего окна — при инкрементальной подгрузке через `--skip` новые более старые коммиты могли бы
получить другую раскладку, чем если бы читались сразу в увеличенном окне, и уже отрисованные дорожки
«поехали» бы при подгрузке. Полная перераскладка ценой лишнего чтения `git log` даёт ДЕТЕРМИНИРОВАННЫЙ
граф — раскладка коммита не зависит от того, каким `pageSize` она была получена.

`hasMore = layout.rows.length === pageSize` — эвристика «возможно есть ещё»: если `git log
--max-count=N` вернул РОВНО `N` строк, история, вероятно, не исчерпана (может оказаться, что коммитов
ровно `N` — тогда следующий `loadMore` вернёт тот же список и `hasMore` станет `false`). Разумный
компромисс без дополнительного `git rev-list --count`.

## Формат сообщений протокола

Панель — обычный `WebviewHtmlFactory`-webview (entry `history`, `viewKind: 'history'`), базовый
транспорт (`MessageBus`, `loadInitialState`) общий с остальными панелями `src-ui`.

| Направление | Форма | Когда |
|---|---|---|
| ui → host | `{ type: 'command', command: 'selectCommit', payload: { hash } }` | клик по строке графа |
| ui → host | `{ type: 'command', command: 'openDiff', payload: { nodeId } }` | двойной клик по листу дерева изменений коммита |
| ui → host | `{ type: 'command', command: 'loadMore' }` | кнопка «Загрузить ещё» (видна при `hasMore`) |
| ui → host | `{ type: 'command', command: 'refresh' }` | кнопка «Обновить» |
| host → ui | `{ type: 'graph', state: HistoryGraphState }` | после `open()` (плюс встроено в HTML), после `loadMore`/`refresh` |
| host → ui | `{ type: 'commitChanges', hash, section: ChangesSectionDto }` | после `selectCommit` |

`nodeId` в `openDiff` — тот же `id`-контракт, что и в панели изменений (`staged#<i>[.<j>]` либо
`other#<k>`), т.к. `buildCommitChangesSection` строит дерево через `buildObjectNode`/`buildOtherSection`
c той же схемой id; `resolveChangeAddress` (переиспользован из `changesDtoBuilder`) — та же единственная
точка расшифровки `nodeId` в файлы, что и там.

## Известные ограничения

Зафиксировано честно — кандидаты на доработку, а не скрытые баги:

- **Переименования (`R`) сводятся к `M`.** `git diff-tree -M --name-status` даёт `R100\t<old>\t<new>`,
  но `parseNameStatus` кладёт в `PorcelainEntry` только НОВЫЙ путь (`index: 'R'`, `oldRelPath`
  отбрасывается на уровне `MetadataChangeAggregator`, который трактует `R` как `M`) — то же
  ограничение, что у панели изменений (см.
  [git-metadata-changes.md](./git-metadata-changes.md#известные-ограничения)), унаследованное через
  переиспользованный агрегатор.
- **Синтез предков не даёт «живой» иерархии исторического состояния.** Объект, переименованный/
  перемещённый между подсистемами ПОСЛЕ рассматриваемого коммита, в дереве изменений коммита всё равно
  окажется под ТЕКУЩЕЙ коллекцией своего типа (`META_TYPES[rootKind].pluralLabel`), а не под тем путём,
  что был на момент коммита. Это плата за то, что синтез вообще возможен без живого дерева на каждый
  коммит истории (см. раздел «Синтез предков» выше) — альтернатива (парсинг Configuration.xml на
  историческом ref) не реализована.
- **`documents-branch` без промежуточной ветви «Документы».** Наследуется от `synthesizeAncestors`
  (общий модуль с панелью изменений) — для объектов группы `documents-branch` (например
  `DocumentNumerator`, `Sequence`, `DocumentJournal`) синтезированная цепочка — одна коллекция своего
  типа, без промежуточного узла «Документы», который показал бы живой навигатор.
- **Пагинация без курсора — полная перераскладка окна на каждый `loadMore`.** Осознанный выбор ради
  детерминизма графа (см. «Пагинация» выше), но на очень больших репозиториях (десятки тысяч коммитов)
  повторное чтение `git log --max-count` растущего окна на каждый `loadMore` — О(итоговый размер окна)
  работы `git log`, а не O(шаг подгрузки). Кандидат на оптимизацию — стабильная раскладка с курсором,
  если производительность станет проблемой на практике.
- **Гранулярность — объект → часть, глубже часть не раскрывается.** Дерево изменений коммита строится
  ТЕМИ ЖЕ функциями (`buildObjectNode`/`buildPartNode`), что и панель изменений, поэтому наследует то же
  ограничение: узел части (модуль/Свойства/форма) терминален (`hasChildren: false`) — до конкретного
  реквизита/колонки не раскрывается, см.
  [git-metadata-changes.md](./git-metadata-changes.md#известные-ограничения).
- **Merge-коммиты diff-ятся только по первому родителю (`--first-parent`).** Изменения, привнесённые
  ИСКЛЮЧИТЕЛЬНО веткой, слитой в merge (а не переприменённые в первом родителе), в состав изменений
  merge-коммита не попадают — то же соглашение, что у большинства git-инструментов для «сводного» diff
  merge-коммита.
- **Исторические config-roots не пересчитываются под коммит.** `loadCommitChanges` резолвит
  принадлежность файлов объектам через ТЕКУЩИЙ список `configRoots` (`Container.changesConfigRoots`).
  Если структура выгрузки конфигурации переехала (сменился корень `Configuration.xml`) уже ПОСЛЕ
  рассматриваемого коммита, файлы под старым корнем попадут в `unresolved`, а не будут привязаны к
  объекту — резолвинг «как сейчас», а не «как на момент коммита».
- **Конфликты (`U`) вне области** — то же ограничение, что у панели изменений.

## Связанные документы

- [git-metadata-changes.md](./git-metadata-changes.md) — движок (`ChangesModel`,
  `MetadataChangeAggregator`, `changesDtoBuilder`, `changesTreeAssembler`, общий Vue-компонент дерева),
  который эта панель переиспользует целиком; там же — исходное описание модели трёх деревьев git и
  канона путей.
- [mcp-paths.md](./mcp-paths.md) — канон путей, общий с `canonicalRootPath`, на котором строится
  `canonicalPath` объектных узлов.
- [architecture.md](./architecture.md) — общая раскладка каталогов и слоёв.
