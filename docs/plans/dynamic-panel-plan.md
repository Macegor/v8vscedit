# Динамическая панель — план реализации

## Цель

Добавить новую боковую панель `dynamic-panel`, которая показывает **разный контент в зависимости от текущего контекста**:

- Активен редактор `.bsl`/`.os` → **структура модуля** (как нативный Outline, но через свой UI и/или bsl-analyzer LSP).
- Выделен узел дерева конфигурации (в универсальной панели) → **свойства объекта** (вертикальная компоновка, без карточек).
- В будущем — другие блоки (план оставляет место для расширения).

Текущее открытие свойств в виде отдельной вкладки (`WebviewPanel`) **упраздняется** — свойства теперь живут только в динамической панели.

---

## Архитектурное решение

### Размещение панели

- VSCode API позволяет регистрировать view только в `activitybar` или `panel` через `package.json`. Гарантированно поместить view в **Secondary Side Bar (правая боковая)** на старте через манифест нельзя.
- **Фактический подход**: регистрируем как второй view внутри уже существующего контейнера `v8vscedit` — он окажется **под универсальной панелью** (это явный fallback от пользователя).
- Пользователь сам может перетащить панель в Secondary Side Bar (правую) — это стандартное поведение VSCode и панель его поддерживает.
- Опционально (если успеем без рисков) — на первой активации попробуем `vscode.commands.executeCommand('vscode.moveViews', ...)` чтобы автоматически переместить view в auxiliary bar.

### Точка входа

- Новое Vue-приложение `src-ui/apps/dynamic-panel/` с корневым компонентом `DynamicPanelApp.vue`.
- Новый entry `dynamicPanel` в [vite.webview.config.ts](vite.webview.config.ts).
- Новый view `v8vsceditDynamicPanel` в [package.json](package.json).

### Backend (TypeScript)

```
src/ui/views/dynamic-panel/
├── DynamicPanelViewProvider.ts          // WebviewViewProvider (как UniversalPanel)
├── DynamicPanelController.ts            // Главный контроллер контекста (роутер)
├── _types.ts                            // DynamicPanelState (discriminated union)
└── contexts/
    ├── PropertiesContextHandler.ts      // Адаптер над PropertiesViewController
    └── ModuleStructureContextHandler.ts // Документ-символы для активного .bsl
```

**DynamicPanelController** — ядро роутинга:
- Хранит текущее состояние `{ kind, data }`.
- Слушает `vscode.window.onDidChangeActiveTextEditor` → если файл `.bsl`/`.os`, переключается на `'module-structure'`.
- Слушает события выбора узла из универсальной панели → переключается на `'properties'`.
- Pushит state в webview через `postMessage`.
- Делегирует команды UI (изменение свойства, переход к символу) соответствующему handler-у.

**PropertiesContextHandler** — переиспользует существующий [PropertiesViewController](src/ui/views/properties/PropertiesViewController.ts) (он уже агностичен к транспорту). Адаптер собирает `PropertiesViewState` и пересылает в webview.

**ModuleStructureContextHandler**:
- При смене активного редактора на `.bsl`/`.os` вызывает `vscode.commands.executeCommand<DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri)`.
- Сериализует символы в DTO (`name`, `kind`, `range`, `selectionRange`, `children`).
- При клике в UI → `vscode.window.showTextDocument(uri, { selection })` и `revealRange`.
- **Источник символов**: `bsl-analyzer` LSP. Если он не отдаёт `documentSymbol` — добавим минимальный собственный `DocumentSymbolProvider` для языка `bsl` в `src/lsp/BslDocumentSymbolProvider.ts` (парсинг по regex: `Процедура`, `Функция`, `Перем`, `#Область`).

### Frontend (Vue)

```
src-ui/apps/dynamic-panel/
├── main.ts                              // Bootstrap (loadInitialState + MessageBus)
├── DynamicPanelApp.vue                  // Switch по state.kind
├── messages.ts                          // Типы host↔ui
└── views/
    ├── EmptyView.vue                    // Пустое состояние
    ├── ModuleStructureView.vue          // Дерево символов (как Outline)
    └── properties/
        ├── PropertiesView.vue           // Переработанная вертикальная компоновка
        └── controls/                    // Переехавшие из apps/properties контролы
```

**`DynamicPanelApp.vue`** — простой switch:
```vue
<EmptyView v-if="state.kind === 'empty'" />
<ModuleStructureView v-else-if="state.kind === 'module-structure'" :state="state" />
<PropertiesView v-else-if="state.kind === 'properties'" :state="state" />
```

**`ModuleStructureView.vue`**:
- Древовидный список символов с иконками `$(symbol-function)`, `$(symbol-method)`, `$(symbol-variable)`, `$(symbol-namespace)` (для регионов).
- Кликабельные узлы → отправляют команду `revealSymbol` с `range`.
- Поведение и UX максимально похоже на нативный Outline VSCode.

**`PropertiesView.vue`** — переработка [PropertiesApp.vue](src-ui/apps/properties/PropertiesApp.vue):
- Убрать двухколоночный `grid-template-columns: repeat(2, ...)`.
- Сделать `display: flex; flex-direction: column; gap: 0`.
- Убрать визуал карточки (background, border, box-shadow, border-radius), оставить **разделитель** между секциями (`border-bottom: 1px solid var(--vscode-panel-border)`).
- Заголовок секции остаётся (`section-title`), стилизованный как заголовок «секции» в нативных боковых панелях VSCode (мелкий uppercase или просто полужирный).
- Сохранить всю функциональность контролов и спец-карточек (`SubsystemMembershipCard`, `ExchangePlanContentCard` — теперь без визуальной «карточки»).

### Транспорт сообщений

**Host → UI** (через `MessageBus`):
```ts
type HostToUiMessage =
  | { type: 'state', state: DynamicPanelState };
```

**UI → Host**:
```ts
type UiToHostMessage =
  | { type: 'command', command: 'revealSymbol', payload: { range: RangeDto } }
  | { type: 'command', command: 'propertyChanged', payload: { key, value } }
  | { type: 'command', command: 'openTypePicker', payload: ... }
  | ... (остальные команды свойств, перенесённые из текущего PropertiesViewProvider)
```

`DynamicPanelState`:
```ts
type DynamicPanelState =
  | { kind: 'empty' }
  | { kind: 'module-structure', uri: string, languageId: string, symbols: SymbolDto[] }
  | { kind: 'properties', view: PropertiesViewState };
```

---

## Что удаляем / переносим

| Что | Действие |
|---|---|
| Команда `v8vscedit.showProperties` | **Сохраняем** как тонкий роутер: вызывает `dynamicPanelController.showProperties(node)` и показывает динамическую панель через `view.show()`. Бывшая иконка/контекстное меню «Свойства» в дереве продолжают работать. |
| [src/ui/views/PropertiesViewProvider.ts](src/ui/views/PropertiesViewProvider.ts) | **Удалить** (отдельная вкладка свойств больше не нужна). |
| Регистрация PropertiesViewProvider в Container.ts | **Удалить**. |
| [src-ui/apps/properties/](src-ui/apps/properties/) | **Перенести** контролы в `src-ui/apps/dynamic-panel/views/properties/controls/`. Сам `PropertiesApp.vue` — переработать в `PropertiesView.vue`. |
| Entry `properties` в [vite.webview.config.ts](vite.webview.config.ts) | **Удалить**. |
| [PropertiesViewController.ts](src/ui/views/properties/PropertiesViewController.ts) | **Оставить как есть** — переиспользуем. Адаптируем callback `refresh()` на динамическую панель вместо `WebviewPanel`. |

---

## Шаги реализации

### Шаг 1. Каркас панели (минимум, чтобы открывалась пустая)
1. Добавить view `v8vsceditDynamicPanel` в [package.json](package.json) (`name: "Контекстная панель"`, `type: "webview"`).
2. Добавить entry `dynamicPanel` в [vite.webview.config.ts](vite.webview.config.ts).
3. Создать `src-ui/apps/dynamic-panel/main.ts` + `DynamicPanelApp.vue` + `messages.ts` (рисует EmptyView).
4. Создать `src/ui/views/dynamic-panel/DynamicPanelViewProvider.ts` (по образцу [UniversalPanelViewProvider.ts](src/ui/views/universal/UniversalPanelViewProvider.ts)).
5. Зарегистрировать провайдер в [Container.ts](src/Container.ts).
6. Собрать (`npm run build`), убедиться что панель появляется под универсальной.

### Шаг 2. Свойства в динамической панели (вертикальная компоновка)
1. Перенести компоненты `controls/*` из `src-ui/apps/properties/` в `src-ui/apps/dynamic-panel/views/properties/controls/`.
2. Создать `PropertiesView.vue` (на основе `PropertiesApp.vue`) с вертикальной компоновкой без карточек.
3. Создать `DynamicPanelController` и `PropertiesContextHandler` (вызывает `PropertiesViewController.getViewState()`).
4. Перепрошить команду `v8vscedit.showProperties` на показ через DynamicPanelController.
5. Удалить `PropertiesViewProvider.ts` и его регистрацию.
6. Удалить entry `properties` из vite-конфига и (после переноса) папку `src-ui/apps/properties/`.
7. Проверить: клик по узлу дерева → свойства открываются в боковой панели.

### Шаг 3. Структура модуля
1. Проверить отдаёт ли bsl-analyzer `textDocument/documentSymbol` (отправить запрос вручную через LspManager и логировать ответ; если нет — реализовать `BslDocumentSymbolProvider` regex-парсером).
2. Создать `ModuleStructureContextHandler`: слушает `onDidChangeActiveTextEditor`, тянет символы, эмитит state в провайдер.
3. Создать `ModuleStructureView.vue` — дерево с иконками, клик → команда `revealSymbol`.
4. В DynamicPanelController обработать `revealSymbol`: `showTextDocument(uri).then(ed => ed.revealRange(range); ed.selection = new Selection(...))`.
5. Проверить: открытие `.bsl` файла → панель показывает структуру; смена редактора — обновляет.

### Шаг 4. Полировка
1. Иконка панели (опционально — view имеет иконку только если живёт в собственном viewsContainer; внутри `v8vscedit` достаточно `name`).
2. Сохранение последнего состояния (если переключились на `.bsl`, потом на дерево, потом обратно — какое поведение). По умолчанию: **последний сигнал выигрывает**, состояние не персистится между сессиями.
3. Пустое состояние с подсказкой («Откройте модуль или выберите объект конфигурации»).
4. Финальная сборка, ручной тест.

---

## Открытые вопросы (решены автономно)

- **Что делать, если активен .bsl И выделен узел дерева одновременно?** — Последнее действие пользователя выигрывает. Если он сейчас кликнул в дереве — показываем свойства; если переключил вкладку редактора — показываем структуру модуля.
- **Что показывать при старте?** — `EmptyView` с подсказкой.
- **Нужны ли табы переключения «Свойства» / «Структура»?** — Нет (пользователь сказал «динамическая» — то есть автоматическая, не ручное переключение). Если в будущем потребуется ручной выбор — добавим позже.
- **Удалять ли совсем папку `src-ui/apps/properties/`?** — Да, после переноса контролов. Не оставляем мёртвый код.

---

## Файлы, которые будут изменены/созданы (сводка)

**Создать**:
- `src-ui/apps/dynamic-panel/main.ts`
- `src-ui/apps/dynamic-panel/DynamicPanelApp.vue`
- `src-ui/apps/dynamic-panel/messages.ts`
- `src-ui/apps/dynamic-panel/views/EmptyView.vue`
- `src-ui/apps/dynamic-panel/views/ModuleStructureView.vue`
- `src-ui/apps/dynamic-panel/views/properties/PropertiesView.vue`
- `src-ui/apps/dynamic-panel/views/properties/controls/*` (перенос)
- `src/ui/views/dynamic-panel/DynamicPanelViewProvider.ts`
- `src/ui/views/dynamic-panel/DynamicPanelController.ts`
- `src/ui/views/dynamic-panel/_types.ts`
- `src/ui/views/dynamic-panel/contexts/PropertiesContextHandler.ts`
- `src/ui/views/dynamic-panel/contexts/ModuleStructureContextHandler.ts`
- (опционально) `src/lsp/BslDocumentSymbolProvider.ts`

**Изменить**:
- `package.json` — добавить view, возможно команду
- `vite.webview.config.ts` — добавить/удалить entries
- `src/Container.ts` — зарегистрировать новый провайдер, удалить старый
- `src/ui/commands/properties/ShowPropertiesCommand.ts` — роутить в новую панель
- `src-ui/shared/types/property.ts` — без изменений (DTO остаётся)

**Удалить**:
- `src/ui/views/PropertiesViewProvider.ts`
- `src-ui/apps/properties/` (после переноса)

---

## Риски

- **bsl-analyzer может не отдавать documentSymbol** → fallback на собственный regex-парсер процедур/функций/областей.
- **Существующие пользователи привыкли к свойствам в отдельной вкладке** → это явное требование пользователя, не обсуждается.
- **Дизайн вертикальной компоновки свойств может оказаться громоздким** при широких списках типов → решаем при тестировании, в крайнем случае добавим скролл и/или сворачиваемые секции (но это уже после согласования визуала).
