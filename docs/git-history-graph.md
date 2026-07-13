# История изменений (граф git-коммитов по объектам 1С)

## Назначение

Граф истории git (как Git Graph/GitLens), но выбор коммита показывает не список файлов, а изменённые
ОБЪЕКТЫ метаданных 1С — полностью переиспользуя движок панели
[«Изменения метаданных»](./git-metadata-changes.md). **Это НЕ отдельная вкладка редактора и не отдельный
`WebviewViewProvider`** — граф является ВТОРЫМ сворачиваемым блоком («История») внутри уже существующей
webview-панели `v8vsceditChanges` (провайдер `MetadataChangesViewProvider`), под первым блоком
(«Изменения»). Изначально спроектированная как самостоятельная вкладка (`vscode.WebviewPanel`, команда
`v8vscedit.history.open`), фича была РЕДИЗАЙНЕНА: `HistoryGraphViewProvider`, эта команда, кнопка
`view/title`, activation event `onCommand:v8vscedit.history.open`, vite-entry `history` и всё
Vue-приложение `src-ui/apps/history/*` **удалены**. Ниже описана только актуальная модель.

По умолчанию блок «История» свёрнут. Читать `git log` при открытии панели «Изменения метаданных» не
требуется — граф грузится **лениво**: только при ПЕРВОМ разворачивании блока пользователем панель шлёт
команду `loadHistory`, и только тогда `MetadataChangesViewProvider` первый раз обращается к
`git log` (запрет №11 — никакого синхронного I/O на hot path открытия панели).

Клик по строке графа раскрывает коммит **inline, прямо внутри графа** (а не в отдельной панели снизу, как
было в вкладке-варианте): под строкой коммита появляется блок деталей (короткий хеш, автор, относительная
дата с `title`-подсказкой в виде абсолютной, полный текст subject) и read-only дерево изменённых объектов
1С (переиспользован общий `UniversalTree`). Двойной клик по листу этого дерева открывает diff
`commit^ ↔ commit`.

Блок «История» read-only: коммит нельзя проиндексировать/снять индексацию/закоммитить — только
посмотреть состав изменений и открыть diff одного файла. Это единственное, что качественно отличает его
модель данных от `ChangesModel` блока «Изменения»; остальное — прямое переиспользование.

## Архитектура по слоям

### `infra/git/` — чистые модули графа (без `vscode`), не менялись при редизайне презентации

| Модуль | Ответственность |
|---|---|
| `GitLogReader.ts` | `readGitLog(gitRoot, maxCount?)` — раннер `git log --all --decorate=full --parents --topo-order --pretty=format:'%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e'`. `--decorate=full` обязателен — иначе `%D` не различает локальную/удалённую ветку. `maxCount` транслируется в `--max-count` (постраничная подгрузка). Мягкий `[]` при недоступном git. |
| `GitLogParser.ts` | `parseGitLog(output) → RawCommit[]` — чистый разбор по разделителям `\x1f`(поле)/`\x1e`(запись). `parseRefs` разбирает `%D`: `HEAD -> refs/heads/<name>` схлопывается в ОДНУ ссылку `kind: 'head'` (не в пару HEAD+localBranch), одиночный detached `HEAD` отбрасывается; `refs/heads/`→`localBranch`, `refs/remotes/`→`remoteBranch`, `refs/tags/`/`tag: refs/tags/`→`tag`. |
| `GitGraphLayout.ts` | `assignLanes(commits) → GraphLayout { rows, laneCount }` — чистая раскладка коммитов (в топологическом порядке, ребёнок раньше родителя) по дорожкам. Алгоритм и инварианты — см. ниже. |
| `GitCommitChangesReader.ts` | `readCommitChanges(gitRoot, commit, { root? }) → PorcelainEntry[]` — раннер `git diff-tree --no-commit-id --name-status -r -M --first-parent [--root] <commit>`; `parseNameStatus` разбирает вывод в существующую форму `PorcelainEntry` (переиспользует `unquotePorcelainPath` из `GitPorcelainReader`, без дублей). Единственный статусный символ на строку → `worktree` всегда `' '` (пробел). Мягкий `[]` при недоступном git. |
| `GitBlobReader.ts` | Дополнен `readBlobAtRef(gitRoot, ref, absFilePath)` — обобщение `readBlobAtHead`/`readBlobAtIndex` на произвольный commit-ish (`git show <ref>:<rel>`). `readBlobAtHead`/`readBlobAtIndex` не изменились (используются блоком «Изменения»). |

`GitPorcelainReader`, `MetadataChangeResolver`, `MetadataChangeAggregator`, `GitWriteService` блок
истории переиспользует БЕЗ ИЗМЕНЕНИЙ — см. их описание в
[git-metadata-changes.md](./git-metadata-changes.md#infragit--чистая-логика-без-vscode-не-менялась-при-пивоте-презентации).
`GitWriteService` в графе истории вообще не вызывается — блок read-only.

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
Блок «Изменения» по-прежнему передаёт только `'HEAD'`/`'index'` — контракт для него не изменился,
обобщение расширило множество допустимых значений, не сузив его. Это обобщение сделано ради блока
«История» и осталось в силе после редизайна презентации.

### `ui/views/history/` — только чистые модули, без vscode-провайдера

После редизайна в этой папке **нет** `vscode`-специфичного кода — `HistoryGraphViewProvider.ts` удалён
целиком, весь vscode-код графа истории теперь живёт в `ui/views/changes/` (см. ниже).

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
    «Изменения коммита»: навигаторная иерархия строится ТЕМИ ЖЕ функциями, что и блок «Изменения»
    (`buildObjectNode('staged', …, { readonly: true })`, `synthesizeAncestors`,
    `assembleNavigatorSection('staged', chains, 'Изменения коммита')`), плюс плоские узлы
    `buildOtherSection(model.unresolved)` в конце. Работает только с `model.staged` — см. ниже, почему
    изменения коммита всегда попадают именно в `staged`, а не в `unstaged`.
  - Объявляет ЛОКАЛЬНЫЕ зеркала типов (`RefDto`, `LaneEdgeDto`, `GraphRowDto`, `HistoryGraphState`) по
    той же причине, что и `changesDtoBuilder.ts`: `src-ui` исключён из `tsconfig.test.json`. Форма
    обязана совпадать с `src-ui/shared/types/history.ts`.

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

  Эти два экспорта не изменились при редизайне (сигнатуры и логика — те же, что и у прежней вкладки);
  изменился только вызывающий их слой.

### `ui/views/changes/changesHistorySection.ts` — новый чистый helper: состояние графа истории

**Ключевой новый модуль редизайна.** `ChangesHistorySection` — чистый (без `vscode`) класс, склеивающий
`historyGraphController`/`historyGraphDtoBuilder` в состояние, которое раньше по кусочкам хранил
`HistoryGraphViewProvider` (`pageSize`, `selectedHash`, `selectedModel`, `loaded`). Инкапсулирует именно
ленивость и пагинацию — `MetadataChangesViewProvider` благодаря этому helper'у остаётся тонким.

Конструктор принимает `{ gitRoot, getConfigRoots }` — те же зависимости, что и у блока «Изменения»
(единый источник, `Container` передаёт одни и те же `changesGitRoot`/`changesConfigRoots` в оба места,
дублирования нет). Методы:

- `isLoaded()` — загружалась ли история хотя бы раз.
- `load(nowSec)` — первичная загрузка: помечает `loaded = true`, читает граф текущим `pageSize`.
- `refresh(nowSec)` — пересчёт ТОЛЬКО если уже загружена, иначе `undefined` (ленивость: watcher-триггеры
  не должны заставлять читать `git log`, если пользователь ни разу не открывал блок).
- `loadMore(nowSec)` — увеличивает `pageSize` на `PAGE_SIZE_STEP = 200` и перечитывает граф целиком (см.
  «Пагинация» ниже), переводя историю в загруженное состояние.
- `selectCommit(hash, iconResolver)` — определяет корневой ли коммит (по `parents` найденной строки
  графа), агрегирует состав изменений в `ChangesModel` через `loadCommitChanges`, кеширует
  `selectedHash`/`selectedModel`, возвращает `{ section: ChangesSectionDto }` через
  `buildCommitChangesSection`.
- `resolveDiff(nodeId)` — адрес одиночного файла узла ВЫБРАННОГО коммита для `vscode.diff`; без
  выбранного коммита — `undefined`.

Приватный `readState(nowSec)` — единственная точка вызова `loadHistoryState`, что не позволяет разным
методам разойтись в параметрах чтения графа.

### `MetadataChangesViewProvider.ts` — абсорбировал панель «История»

Провайдер (`viewType = 'v8vsceditChanges'`) создаёт `private readonly history: ChangesHistorySection` в
конструкторе с теми же `gitRoot`/`getConfigRoots`, что и сам провайдер. Добавились:

- **Команды протокола** (`handleMessage`, ветка `switch (message.command)`):
  - `loadHistory` → `history.load(nowSec())`, результат уходит как `{ type: 'history', state }`. Шлётся
    UI ровно один раз — при ПЕРВОМ разворачивании блока «История» (`historyLoaded`-флаг в `ChangesApp.vue`,
    см. ниже).
  - `historyLoadMore` → `history.loadMore(nowSec())` — кнопка «Загрузить ещё» (видна только при
    `history.hasMore`).
  - `historyRefresh` → `history.load(nowSec())` — явная кнопка «Обновить» блока «История»: в отличие от
    ленивого watcher-triggered `maybePostHistory`, ВСЕГДА (пере)читает граф (комментарий в коде явно
    разводит эти два пути).
  - `selectCommit { hash }` → `history.selectCommit(hash, iconResolver)`, результат — `{ type:
    'commitChanges', hash, section }`.
  - `openCommitDiff { nodeId }` → `history.resolveDiff(nodeId)` → `vscode.diff` между `<hash>^` и
    `<hash>` (см. «Семантика diff» ниже).
- **`maybePostHistory()`** — вызывается в конце `refresh()` (той же точке, что и `postState()` для
  секций «Изменения»): пере-излучает граф `{ type: 'history', state }` ТОЛЬКО если `history.isLoaded()`
  вернёт `true` (иначе `history.refresh()` возвращает `undefined` и `postHistory` тихо ничего не шлёт).
  Это единственный автоматический (не по команде пользователя) путь обновления графа — например, после
  `git commit`, сделанного этой же панелью, или после срабатывания `scheduleDecorationRefresh` на
  `.git/HEAD`.
- **`openCommitDiff` — ОТДЕЛЬНАЯ команда от `openDiff`.** Причина не косметическая, а разводка коллизии
  адресации: узлы дерева «Изменения коммита» строятся тем же `buildObjectNode('staged', …)`, что и
  секция `staged` рабочего дерева, поэтому их `nodeId` — из ТОЙ ЖЕ схемы (`staged#0`, `staged#0.1`).
  Единая команда `openDiff` резолвила бы такой `nodeId` через `this.model` (модель рабочего дерева
  HEAD/индекс) — для коммита это был бы неверный (либо вовсе отсутствующий) адрес. `openCommitDiff`
  резолвит `nodeId` через `history.resolveDiff` (т.е. через `this.selectedModel` внутри
  `ChangesHistorySection`, модель ИМЕННО выбранного коммита) и строит diff `hash^ ↔ hash`, а не
  `HEAD ↔ индекс`/`индекс ↔ рабочее дерево`.

Никакого отдельного `Container`-сервиса, команды `package.json → contributes.commands` или
activation event для истории больше нет — всё wiring осталось прежним (одна регистрация
`MetadataChangesViewProvider` в `wireMetadataChangesView()`), просто провайдер стал «шире» по
ответственности внутри своего файла за счёт вынесенного `ChangesHistorySection`.

### Извлечение `synthesizeAncestors` в общий модуль (актуально и после редизайна)

`synthesizeAncestors` — экспортируемая чистая функция в `ui/views/changes/changesTreeAssembler.ts`,
принимающая `buildIcon` инъекцией. И `MetadataChangesViewProvider.resolveAncestors` (для рабочего
дерева), и `historyGraphDtoBuilder.buildCommitChangesSection` (для дерева коммита) вызывают ОДНУ и ту же
функцию — дублирования логики синтеза предков нет. `buildObjectNode`/`buildPartNode` получили
опциональный `options.readonly`/`readonly` параметр: при `true` поле `inlineActions` не заполняется
(`stageUnstageInline` не вызывается) — узлы коммита нельзя проиндексировать/снять индексацию, т.к.
коммит уже неизменяем.

### `src-ui/apps/changes/` — Vue-приложение с двумя блоками

Отдельного приложения `src-ui/apps/history/*` больше нет — граф целиком встроен в приложение `changes`.

- **`ChangesApp.vue`** — два сворачиваемых блока (`.panel-block`), каждый со своим заголовком-кнопкой
  (`toggleChanges`/`toggleHistory`) и шевроном:
  - **«Изменения»** (`changesOpen`, по умолчанию `true`) — прежнее содержимое: `ChangesCommitBox` +
    секции `staged`/`unstaged`/`unresolved` через `UniversalTree`. Не изменилось при редизайне.
  - **«История»** (`historyOpen`, по умолчанию `false`) — `CommitGraph` со слотом `#details`. Заголовок
    блока при раскрытии показывает кнопки «Обновить» (`historyRefresh`) и, если `history.hasMore`,
    «Загрузить ещё» (`historyLoadMore`).
  - **Ленивость на стороне UI**: `toggleHistory()` шлёт `loadHistory` ТОЛЬКО если `historyOpen` стало
    `true` и `historyLoaded === false`; повторные сворачивания/разворачивания блока после первой загрузки
    команду больше не шлют — `historyLoaded` защищает от повторного чтения `git log` при простом
    сворачивании/разворачивании блока пользователем.
  - **Inline-раскрытие коммита**: клик по строке графа (`onSelectCommit`) шлёт `selectCommit`; ответ
    `{ type: 'commitChanges', hash, section }` кладётся в `commitSection`, дерево раскрывается целиком
    (`expandCommitSection`, по образцу `expandAll` для секций «Изменения»). Блок деталей рендерится через
    именованный слот `CommitGraph`'а (`#details="{ row }"`) НЕПОСРЕДСТВЕННО под выбранной строкой графа —
    хеш/автор/дата/полный subject + `UniversalTree` дерева изменений.
  - **Изолированное состояние дерева коммита**: `commitOpenIds`/`commitSelectedId`/`commitLoadingIds`
    заведены ОТДЕЛЬНО от `openIds`/`selectedId`/`loadingIds` дерева секций «Изменения» — id узлов обеих
    моделей совпадают по форме (`staged#N[.M]`), смешивание раскрытия двух разных деревьев в одном
    reactive-объекте перепутало бы их состояние.
  - Двойной клик по листу дерева коммита (`onCommitDefault`) → `openCommitDiff` (не `openDiff`).
- **`CommitGraph.vue`** — компактная строка на коммит (одна строка, без отдельных колонок даты/хеша):
  SVG-ячейка дорожек+рёбер, тема коммита (`commit-subject`, растягивается), приглушённый автор
  (`commit-author`, `color: var(--vscode-descriptionForeground)`), «пилюли» refs (иконка codicon по
  `ref.kind`: `head→target`, `localBranch→git-branch`, `remoteBranch→cloud`, `tag→tag`). Дата и короткий
  хеш из отдельных колонок строки графа УБРАНЫ — они переехали в inline-блок деталей выбранного коммита
  (`.commit-meta`), т.к. в узкой ширине сайдбар-панели (в отличие от прежней полноширинной вкладки
  редактора) колонкам не хватало места; при клике коммит всё равно раскрывает эти данные. Палитра
  `LANE_PALETTE` — 8 контрастных тонов, НЕ привязанных к `--vscode-*` переменным (цвет дорожки —
  семантический идентификатор ветки, устойчивый к смене темы, а не элемент UI-темизации), не изменилась.
  Компонент принимает именованный слот `#details` и рендерит его содержимое сразу под выбранной строкой
  (`v-if="isSelected(row)"`), с отступом `detailsIndent()` под ширину дорожек и левой чертой в цвет
  дорожки коммита.
- **`src-ui/shared/types/history.ts`** — ui-зеркало DTO (`RefDto`, `LaneEdgeDto`, `GraphRowDto`,
  `HistoryGraphState`), не изменилось при редизайне — форма обязана совпадать с
  `historyGraphDtoBuilder.ts`.
- **`hostMessages.ts`** — варианты `{ type: 'history'; state: HistoryGraphState }` (переименован из
  `'graph'` времён вкладки — в актуальном протоколе тип сообщения `'history'`, единообразно с командой
  `loadHistory`/`historyRefresh`) и `{ type: 'commitChanges'; hash: string; section: ChangesSectionDto }`
  добавлены в `HostToUiMessage`. `UiToHostMessage` не расширялся — блок «История» использует тот же
  универсальный `{ type: 'command'; command: string; payload?: unknown }`, что и остальной протокол
  панели `changes`.

## Поток данных

### Граф (при первом раскрытии блока / `historyLoadMore` / `historyRefresh` / watcher-refresh при уже загруженной истории)

```
{ type: 'command', command: 'loadHistory' | 'historyLoadMore' | 'historyRefresh' }
        │                                            (ChangesApp.vue → MessageBus)
        ▼
MetadataChangesViewProvider.handleMessage → ChangesHistorySection.load/loadMore
        │
        ▼
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
        ▼  postMessage({ type: 'history', state })
CommitGraph.vue — отрисовка дорожек/рёбер/refs
```

Помимо явных команд, `refresh()` провайдера в конце вызывает `maybePostHistory()` — тот же путь, но
БЕЗ повторного захода со стороны UI, и только если `history.isLoaded()`.

### Изменения коммита (по клику на строку графа — `selectCommit`)

```
{ type: 'command', command: 'selectCommit', payload: { hash } }
        │
        ▼
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
ChangesApp.vue (слот #details внутри CommitGraph) → UniversalTree (навигаторная форма)
```

Изменения коммита строятся из `git diff-tree`, а не из `git status` — поэтому в `ChangesModel`
задействована только сторона `staged` (единственный статусный символ `diff-tree --name-status`
трактуется существующим `MetadataChangeAggregator` как X-статус индекса; `unstaged` у блока истории
всегда пуст). `buildCommitChangesSection` явно читает только `model.staged` + `model.unresolved`.

## Синтез предков вместо живого дерева навигатора

**Ключевое архитектурное решение.** Предки объекта в дереве коммита ВСЕГДА строятся синтезом из
`META_TYPES` (`synthesizeAncestors`), а НЕ через `treeProvider.findNode`/`getParent` по живому дереву
навигатора (как это делает `MetadataChangesViewProvider.resolveAncestors` для секций «Изменения»).
Причина: живое дерево отражает ТОЛЬКО текущую рабочую копию. Для исторического коммита это давало бы
неверный результат — объект мог быть с тех пор переименован, перемещён между подсистемами, вообще удалён
из текущей выгрузки, либо, наоборот, ещё не существовать (при разглядывании коммита в прошлом, где путь к
объекту иной). Синтез по типу объекта (`META_TYPES[group.rootKind]`) — единственный способ построить
непротиворечивую иерархию «Общие модули»/«Справочники»/… для ЛЮБОГО коммита истории, не полагаясь на
состояние, которого уже (или ещё) нет. Плата за это — ограничения синтеза (см. «Известные ограничения»
ниже) те же, что у `synthesizeAncestors` для удалённых объектов рабочего дерева: без промежуточной ветви
«Документы» для `documents-branch`.

## Семантика diff коммита: `<commit>^ ↔ <commit>`

Двойной клик по одиночному листу дерева изменений коммита (`openCommitDiff`) открывает `vscode.diff`
между СОСТОЯНИЕМ ПЕРЕД коммитом и состоянием коммита — классический per-commit diff, отличный от diff'ов
блока «Изменения» (индекс/рабочее дерево/HEAD, команда `openDiff`, см.
[git-metadata-changes.md](./git-metadata-changes.md#семантика-stagedunstaged-и-diff--модель-трёх-деревьев-git)):

- **left** = `onec-git`-URI с `ref = '<hash>^'` (родитель коммита через `readBlobAtRef`);
- **right** = `onec-git`-URI с `ref = hash` (сам коммит);
- заголовок — `<имя файла> (<short>^ ↔ <short>)`.

**Корневой коммит.** `<root-hash>^` не существует как ref — `git show <root-hash>^:<path>` завершится с
ошибкой, `readBlobAtRef` мягко вернёт `null`, `OnecGitContentProvider` отдаст пустую строку. Левая
сторона diff для корневого коммита автоматически пуста (файл «появился с нуля»), без специального кода
на стороне `resolveCommitDiff`/`MetadataChangesViewProvider` — обобщённый `OnecGitContentProvider`
обрабатывает это как частный случай отсутствующего blob-а, тем же путём, что и untracked-файл в блоке
«Изменения».

Как и в блоке «Изменения», diff открывается только для узла с ЕДИНСТВЕННЫМ представляющим файлом
(`resolveChangeAddress(...).single === true`) — многофайловые объектные узлы diff не предлагают
(`resolveCommitDiff` вернёт `undefined`, обработчик тихо не сработает).

## Пагинация: полная перераскладка окна, без курсора

`pageSize` начинается с `PAGE_SIZE_STEP = 200` и растёт на тот же шаг при каждом `historyLoadMore`. При
КАЖДОМ построении графа (первая загрузка, `historyLoadMore`, `historyRefresh`, `selectCommit`, смена
рабочих папок) `loadHistoryState` заново читает `git log --max-count=<pageSize>` С НАЧАЛА (топологически
от самых свежих коммитов) и заново прогоняет ВСЮ выборку через `assignLanes` — курсор/`--skip` не
используется.

Осознанный выбор, а не недосмотр: раскладка по дорожкам («левейшая свободная дорожка») зависит от ВСЕГО
предшествующего окна — при инкрементальной подгрузке через `--skip` новые более старые коммиты могли бы
получить другую раскладку, чем если бы читались сразу в увеличенном окне, и уже отрисованные дорожки
«поехали» бы при подгрузке. Полная перераскладка ценой лишнего чтения `git log` даёт ДЕТЕРМИНИРОВАННЫЙ
граф — раскладка коммита не зависит от того, каким `pageSize` она была получена.

`hasMore = layout.rows.length === pageSize` — эвристика «возможно есть ещё»: если `git log
--max-count=N` вернул РОВНО `N` строк, история, вероятно, не исчерпана (может оказаться, что коммитов
ровно `N` — тогда следующий `historyLoadMore` вернёт тот же список и `hasMore` станет `false`). Разумный
компромисс без дополнительного `git rev-list --count`.

## Формат сообщений протокола

История использует тот же транспорт, что и остальная панель `v8vsceditChanges` (`MessageBus`,
`{ type: 'command', command, payload? }` от UI, единый `postMessage` от хоста) — полное описание базового
протокола и команд секций «Изменения» см.
[git-metadata-changes.md](./git-metadata-changes.md#формат-сообщений-протокола). Ниже — только
команды/сообщения, специфичные для блока «История»:

| Направление | Форма | Когда |
|---|---|---|
| ui → host | `{ type: 'command', command: 'loadHistory' }` | первое разворачивание блока «История» (`historyLoaded === false`) |
| ui → host | `{ type: 'command', command: 'historyLoadMore' }` | кнопка «Загрузить ещё» (видна при `history.hasMore`) |
| ui → host | `{ type: 'command', command: 'historyRefresh' }` | кнопка «Обновить» заголовка блока |
| ui → host | `{ type: 'command', command: 'selectCommit', payload: { hash } }` | клик по строке графа |
| ui → host | `{ type: 'command', command: 'openCommitDiff', payload: { nodeId } }` | двойной клик по листу дерева изменений коммита |
| host → ui | `{ type: 'history', state: HistoryGraphState }` | ответ на `loadHistory`/`historyLoadMore`/`historyRefresh`, а также после любого `refresh()` панели, ЕСЛИ история уже была загружена (`maybePostHistory`) |
| host → ui | `{ type: 'commitChanges', hash, section: ChangesSectionDto }` | после `selectCommit` |

`nodeId` в `openCommitDiff` — тот же `id`-контракт, что и в секции «Изменения» (`staged#<i>[.<j>]` либо
`other#<k>`), т.к. `buildCommitChangesSection` строит дерево через `buildObjectNode`/`buildOtherSection`
c той же схемой id; `resolveChangeAddress` (переиспользован из `changesDtoBuilder`) — та же единственная
точка расшифровки `nodeId` в файлы, что и там. Именно из-за совпадения схемы id `openCommitDiff` заведена
ОТДЕЛЬНОЙ командой от `openDiff` — см. раздел про `MetadataChangesViewProvider` выше.

## Известные ограничения

Зафиксировано честно — кандидаты на доработку, а не скрытые баги:

- **Переименования (`R`) сводятся к `M`.** `git diff-tree -M --name-status` даёт `R100\t<old>\t<new>`,
  но `parseNameStatus` кладёт в `PorcelainEntry` только НОВЫЙ путь (`index: 'R'`, `oldRelPath`
  отбрасывается на уровне `MetadataChangeAggregator`, который трактует `R` как `M`) — то же
  ограничение, что у блока «Изменения» (см.
  [git-metadata-changes.md](./git-metadata-changes.md#известные-ограничения)), унаследованное через
  переиспользованный агрегатор.
- **Синтез предков не даёт «живой» иерархии исторического состояния.** Объект, переименованный/
  перемещённый между подсистемами ПОСЛЕ рассматриваемого коммита, в дереве изменений коммита всё равно
  окажется под ТЕКУЩЕЙ коллекцией своего типа (`META_TYPES[rootKind].pluralLabel`), а не под тем путём,
  что был на момент коммита. Это плата за то, что синтез вообще возможен без живого дерева на каждый
  коммит истории (см. раздел «Синтез предков» выше) — альтернатива (парсинг Configuration.xml на
  историческом ref) не реализована.
- **`documents-branch` без промежуточной ветви «Документы».** Наследуется от `synthesizeAncestors`
  (общий модуль с блоком «Изменения») — для объектов группы `documents-branch` (например
  `DocumentNumerator`, `Sequence`, `DocumentJournal`) синтезированная цепочка — одна коллекция своего
  типа, без промежуточного узла «Документы», который показал бы живой навигатор.
- **Пагинация без курсора — полная перераскладка окна на каждый `historyLoadMore`.** Осознанный выбор
  ради детерминизма графа (см. «Пагинация» выше), но на очень больших репозиториях (десятки тысяч
  коммитов) повторное чтение `git log --max-count` растущего окна на каждый `historyLoadMore` —
  О(итоговый размер окна) работы `git log`, а не O(шаг подгрузки). Кандидат на оптимизацию — стабильная
  раскладка с курсором, если производительность станет проблемой на практике.
- **Синхронное чтение `git log` в сайдбар-панели гасится только ленивостью первого раскрытия.**
  В отличие от прежней отдельной вкладки (где чтение графа было привязано к явному `open()`), блок
  «История» теперь физически часть панели `v8vsceditChanges`; при неаккуратном изменении кода (например,
  вызове `history.load` из `resolveWebviewView` вместо реакции на команду `loadHistory`) синхронный
  `git log` попал бы на hot path открытия ЛЮБОЙ панели сайдбара, а не только графа. Единственная защита —
  дисциплина: `history.load`/`loadMore` вызываются ТОЛЬКО из `handleMessage` по явной команде, `refresh()`
  панели вызывает исключительно `history.refresh()` (no-op при `!isLoaded()`).
- **Гранулярность — объект → часть, глубже часть не раскрывается.** Дерево изменений коммита строится
  ТЕМИ ЖЕ функциями (`buildObjectNode`/`buildPartNode`), что и блок «Изменения», поэтому наследует то же
  ограничение: узел части (модуль/Свойства/форма) терминален (`hasChildren: false`) — до конкретного
  реквизита/колонки не раскрывается, см.
  [git-metadata-changes.md](./git-metadata-changes.md#известные-ограничения).
- **Merge-коммиты diff-ятся только по первому родителю (`--first-parent`).** Изменения, привнесённые
  ИСКЛЮЧИТЕЛЬНО веткой, слитой в merge (а не переприменённые в первом родителе), в состав изменений
  merge-коммита не попадают — то же соглашение, что у большинства git-инструментов для «сводного» diff
  merge-коммита.
- **Исторические config-roots не пересчитываются под коммит.** `ChangesHistorySection.selectCommit` (через
  `loadCommitChanges`) резолвит принадлежность файлов объектам через ТЕКУЩИЙ список `configRoots`
  (`Container.changesConfigRoots`, тот же, что и у секций «Изменения»). Если структура выгрузки
  конфигурации переехала (сменился корень `Configuration.xml`) уже ПОСЛЕ рассматриваемого коммита, файлы
  под старым корнем попадут в `unresolved`, а не будут привязаны к объекту — резолвинг «как сейчас», а не
  «как на момент коммита».
- **Конфликты (`U`) вне области** — то же ограничение, что у блока «Изменения».

## Связанные документы

- [git-metadata-changes.md](./git-metadata-changes.md) — панель `v8vsceditChanges` целиком: движок
  (`ChangesModel`, `MetadataChangeAggregator`, `changesDtoBuilder`, `changesTreeAssembler`, общий
  Vue-компонент дерева), который блок «История» переиспользует; там же — исходное описание модели трёх
  деревьев git, канона путей и базового протокола панели.
- [mcp-paths.md](./mcp-paths.md) — канон путей, общий с `canonicalRootPath`, на котором строится
  `canonicalPath` объектных узлов.
- [architecture.md](./architecture.md) — общая раскладка каталогов и слоёв.
