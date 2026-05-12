# План перехода webview UI на Vue и Vite

## Цель

Перевести проект с webpack на Vite и перенести все HTML-webview интерфейсы расширения на Vue 3. `src-ui` должен быть не отдельным проектом с собственным package/config, а обычной папкой исходников единого npm-проекта в корне репозитория.

- `src/**` остается extension host: VS Code API, команды, XML, сервисы, дерево метаданных, файловые операции.
- `src-ui/**` становится чистым frontend-слоем внутри того же проекта: Vue-компоненты, UI-kit'ы, состояние webview, клиентский роутинг внутри конкретной webview, typed message protocol.
- Webview UI получает данные только через DTO и сообщения. Прямых импортов `vscode`, `fs`, `path`, `domain/**`, `infra/**`, `ui/tree/**` в `src-ui` быть не должно.
- Все production/dev бандлы собираются Vite: extension host, CLI entry и webview UI.
- TypeScript typecheck остается отдельной проверкой, потому что Vite транспилирует быстро, но не заменяет полноценный `tsc`/`vue-tsc`.
- Основной UI навигатора остается `UniversalPanelViewProvider`, но его HTML/JS/CSS должны переехать во Vue-приложение.
- UI расширения должен иметь общий UI-kit в стиле VS Code для всех webview: навигатор, свойства, настройки, редактор форм как рабочая оболочка.
- Визуальный редактор форм должен поддерживать два независимых preview kit'а для предпросмотра управляемых форм:
  - предпросмотр в стиле 1С Такси;
  - предпросмотр в стиле нового интерфейса 1С 8.5.

## Исходные ориентиры

- VS Code webview работает как изолированный iframe и обменивается данными с extension host через `postMessage` / `onDidReceiveMessage`: https://code.visualstudio.com/api/extension-guides/webview
- Локальные JS/CSS/иконки нужно подключать через `webview.asWebviewUri(...)`, а доступ ограничивать `localResourceRoots`: https://code.visualstudio.com/api/extension-guides/webview#loading-local-content
- Для webview обязателен строгий CSP: `default-src 'none'`, scripts через nonce, ресурсы через `${webview.cspSource}`: https://code.visualstudio.com/api/extension-guides/webview#security
- VS Code рекомендует бандлить расширения: один бандл быстрее загружается и надежнее упаковывается в VSIX: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- Для embedded-сборки webview нужен относительный base: `base: './'` или `base: ''`: https://vite.dev/guide/build.html#relative-base
- Vite можно использовать как единый сборщик проекта; для разных targets нужны разные root-level конфиги или build-скрипт, но не отдельный npm-проект: https://vite.dev/guide/build.html
- Vue 3 SFC и Composition API подходят для декомпозиции больших интерфейсов и TypeScript: https://vuejs.org/guide/scaling-up/sfc.html

## Главные архитектурные правила

1. `src-ui` не знает о внутренней модели extension host. Только DTO.
2. Вся работа с XML, BSL, путями, командами, `META_TYPES`, `MetadataNode`, `SupportInfoService`, репозиторием и настройками остается в `src/**`.
3. Каждый webview provider в `src/**` после миграции должен делать только:
   - создать или показать webview;
   - выдать HTML через общий `WebviewHtmlFactory`;
   - отправить начальное состояние;
   - принять команду из UI;
   - вызвать сервис или команду;
   - отправить новое состояние или ошибку.
4. Vue-приложения не перерисовываются заменой `webview.html` при каждом изменении. После первичной загрузки состояние обновляется только через `postMessage`.
5. `retainContextWhenHidden` использовать только там, где восстановление состояния дорогое или нарушает UX. По умолчанию состояние хранить через `vscode.getState()` / `vscode.setState()`.
6. UI-kit расширения и preview kit'ы не смешиваются:
   - `kits/vscode` используется для всего рабочего UI расширения, включая оболочку редактора форм;
   - `kits/onec-taxi` и `kits/onec-85` используются только внутри панели предпросмотра формы;
   - компоненты VS Code-интерфейса не используются для визуализации формы 1С;
   - компоненты 1С Такси не используются в 8.5;
   - общими могут быть только headless-композиции, типы, утилиты, геометрия, drag/drop, keyboard navigation.
7. Декомпозиция максимальная: отдельными компонентами являются даже строка дерева, иконка, кнопка панели, пункт меню, splitter, tab, ячейка свойства, бейдж поддержки.
8. Webpack после миграции удаляется полностью: `webpack.config.js`, `webpack`, `webpack-cli`, `ts-loader`, старый `CopyFilePlugin` и webview entry для `src/formEditor/webview`.

## Целевая структура

```text
vite.shared.ts
vite.node.config.ts
vite.webview.config.ts
tsconfig.json
tsconfig.ui.json
tsconfig.test.json
src/
├── extension.ts
├── Container.ts
├── domain/
├── infra/
├── ui/
├── formEditor/
├── lsp/
├── cli/
└── test/
src-ui/
├── env.d.ts
├── public/
│   └── README.md
├── shared/
│   ├── api/
│   │   ├── vscodeApi.ts
│   │   ├── messageBus.ts
│   │   ├── webviewState.ts
│   │   └── requestReply.ts
│   ├── protocol/
│   │   ├── hostMessages.ts
│   │   ├── uiMessages.ts
│   │   ├── universal.ts
│   │   ├── formEditor.ts
│   │   ├── properties.ts
│   │   ├── subsystem.ts
│   │   ├── environment.ts
│   │   ├── standalone.ts
│   │   └── repository.ts
│   ├── state/
│   │   ├── loadInitialState.ts
│   │   ├── createStatusStore.ts
│   │   └── createSelectionStore.ts
│   ├── types/
│   │   ├── command.ts
│   │   ├── icon.ts
│   │   ├── tree.ts
│   │   ├── property.ts
│   │   └── form.ts
│   ├── utils/
│   │   ├── assertNever.ts
│   │   ├── escape.ts
│   │   ├── keyboard.ts
│   │   └── geometry.ts
│   └── styles/
│       ├── reset.css
│       ├── webview-base.css
│       └── accessibility.css
├── kits/
│   ├── vscode/
│   ├── onec-taxi/
│   └── onec-85/
└── apps/
    ├── universal/
    ├── form-editor/
    ├── properties/
    ├── subsystem/
    ├── environment/
    ├── standalone/
    ├── repository-connection/
    ├── repository-commit/
    └── tree-search/
```

Пояснения:

- `src-ui` не имеет своего `package.json`, `package-lock.json`, `vite.config.ts` и отдельной установки зависимостей.
- Все зависимости живут в корневом `package.json`.
- Vite-конфиги лежат в корне, чтобы проект собирался как единое расширение.
- `src/` остается основным кодом расширения и не переезжает в `src-ui`.
- `src-ui/` не содержит дополнительной вложенной папки `src`: это уже корень frontend-исходников.
- `src-ui/public` использовать только для статичных webview assets, которые действительно должны попасть в `dist/ui`. Иконки метаданных расширения остаются в `src/icons/**` и подключаются через host-side DTO.
- Production webview не использует `index.html`: HTML-документ строит `WebviewHtmlFactory`, а Vite отдает JS/CSS entry.

## UI-kit 1: VS Code Extension Kit

Назначение: весь рабочий UI расширения внутри webview: навигатор, свойства, настройки проекта, автономный сервер, подключение хранилища, commit-панель, поиск, редактор формы как оболочка редактирования. Этот kit не является режимом предпросмотра формы.

Папка:

```text
src-ui/kits/vscode/
├── tokens/
│   ├── colors.css
│   ├── spacing.css
│   ├── typography.css
│   ├── borders.css
│   └── zIndex.css
├── icons/
│   ├── VscodeIcon.vue
│   ├── IconButton.vue
│   ├── ProductIcon.vue
│   └── MetadataIcon.vue
├── primitives/
│   ├── VButton.vue
│   ├── VIconButton.vue
│   ├── VInput.vue
│   ├── VSelect.vue
│   ├── VCheckbox.vue
│   ├── VRadio.vue
│   ├── VTextarea.vue
│   ├── VBadge.vue
│   ├── VTag.vue
│   ├── VTooltip.vue
│   ├── VMenu.vue
│   ├── VMenuItem.vue
│   ├── VContextMenu.vue
│   ├── VTabs.vue
│   ├── VTab.vue
│   ├── VToolbar.vue
│   ├── VToolbarButton.vue
│   ├── VPanel.vue
│   ├── VSection.vue
│   ├── VSplitter.vue
│   ├── VProgress.vue
│   ├── VSpinner.vue
│   └── VEmptyState.vue
├── tree/
│   ├── VTree.vue
│   ├── VTreeNode.vue
│   ├── VTreeRow.vue
│   ├── VTreeExpander.vue
│   ├── VTreeIcon.vue
│   ├── VTreeLabel.vue
│   ├── VTreeDescription.vue
│   ├── VTreeBadge.vue
│   ├── VTreeActions.vue
│   ├── VTreeActionButton.vue
│   ├── VTreeDropIndicator.vue
│   └── VTreeSearchHighlight.vue
├── forms/
│   ├── VForm.vue
│   ├── VFormRow.vue
│   ├── VFormLabel.vue
│   ├── VFormHint.vue
│   ├── VFormError.vue
│   ├── VFieldGroup.vue
│   ├── VPathPickerField.vue
│   └── VSecretField.vue
└── layout/
    ├── VAppShell.vue
    ├── VSidebarShell.vue
    ├── VPanelShell.vue
    ├── VHeaderBar.vue
    ├── VFooterBar.vue
    └── VScrollable.vue
```

Правила:

- Цвета брать из CSS-переменных VS Code: `--vscode-foreground`, `--vscode-editor-background`, `--vscode-button-background`, `--vscode-list-hoverBackground` и т.д.
- Никаких декоративных палитр, которые конфликтуют с темой VS Code.
- Любая кнопка с иконкой должна быть отдельным компонентом с tooltip и aria-label.
- Дерево навигатора и деревья выбора состава подсистем используют один набор headless tree-composables, но разные app-level DTO.

## UI-kit 2: 1С Такси Preview Kit

Назначение: предпросмотр управляемой формы в редакторе форм так, чтобы визуально напоминать интерфейс 1С Такси. Это не UI самого расширения, а режим предпросмотра формы.

Папка:

```text
src-ui/kits/onec-taxi/
├── tokens/
│   ├── taxi-colors.css
│   ├── taxi-spacing.css
│   ├── taxi-typography.css
│   ├── taxi-borders.css
│   └── taxi-shadows.css
├── primitives/
│   ├── TaxiButton.vue
│   ├── TaxiCommandButton.vue
│   ├── TaxiInput.vue
│   ├── TaxiCheckbox.vue
│   ├── TaxiSelect.vue
│   ├── TaxiDateField.vue
│   ├── TaxiNumberField.vue
│   ├── TaxiLink.vue
│   ├── TaxiIcon.vue
│   ├── TaxiSeparator.vue
│   └── TaxiCaption.vue
├── form/
│   ├── TaxiFormWindow.vue
│   ├── TaxiFormRoot.vue
│   ├── TaxiFormHeader.vue
│   ├── TaxiCommandBar.vue
│   ├── TaxiCommandBarGroup.vue
│   ├── TaxiFormGroup.vue
│   ├── TaxiUsualGroup.vue
│   ├── TaxiPageGroup.vue
│   ├── TaxiPages.vue
│   ├── TaxiPage.vue
│   ├── TaxiTable.vue
│   ├── TaxiTableHeader.vue
│   ├── TaxiTableRow.vue
│   ├── TaxiTableCell.vue
│   ├── TaxiField.vue
│   ├── TaxiLabel.vue
│   ├── TaxiDecoration.vue
│   └── TaxiUnknownElement.vue
└── renderer/
    ├── renderTaxiElement.ts
    ├── taxiElementRegistry.ts
    └── taxiPreviewLayout.ts
```

Правила:

- Такси-компоненты не должны ссылаться на CSS-переменные VS Code, кроме внешнего контейнера масштабирования.
- Если элемент формы 1С неизвестен, рендерить `TaxiUnknownElement.vue`, а не падать.
- Визуальные неточности допустимы на первом этапе, но структура компонентов должна сразу позволять точную доводку.
- Все размеры и цвета идут через `tokens`, а не через локальные inline-стили.

## UI-kit 3: 1С 8.5 Preview Kit

Назначение: отдельный предпросмотр управляемой формы под новый интерфейс 1С 8.5. Его нельзя делать темой поверх Такси, потому что визуальные правила, плотность, акценты, навигация и поведение элементов могут расходиться.

Папка:

```text
src-ui/kits/onec-85/
├── tokens/
│   ├── onec85-colors.css
│   ├── onec85-spacing.css
│   ├── onec85-typography.css
│   ├── onec85-borders.css
│   └── onec85-elevation.css
├── primitives/
│   ├── Onec85Button.vue
│   ├── Onec85CommandButton.vue
│   ├── Onec85Input.vue
│   ├── Onec85Checkbox.vue
│   ├── Onec85Select.vue
│   ├── Onec85DateField.vue
│   ├── Onec85NumberField.vue
│   ├── Onec85Link.vue
│   ├── Onec85Icon.vue
│   ├── Onec85Separator.vue
│   └── Onec85Caption.vue
├── form/
│   ├── Onec85FormWindow.vue
│   ├── Onec85FormRoot.vue
│   ├── Onec85FormHeader.vue
│   ├── Onec85CommandBar.vue
│   ├── Onec85CommandBarGroup.vue
│   ├── Onec85FormGroup.vue
│   ├── Onec85UsualGroup.vue
│   ├── Onec85PageGroup.vue
│   ├── Onec85Pages.vue
│   ├── Onec85Page.vue
│   ├── Onec85Table.vue
│   ├── Onec85TableHeader.vue
│   ├── Onec85TableRow.vue
│   ├── Onec85TableCell.vue
│   ├── Onec85Field.vue
│   ├── Onec85Label.vue
│   ├── Onec85Decoration.vue
│   └── Onec85UnknownElement.vue
└── renderer/
    ├── renderOnec85Element.ts
    ├── onec85ElementRegistry.ts
    └── onec85PreviewLayout.ts
```

Правила:

- `onec-85` не импортирует компоненты из `onec-taxi`.
- Общий код между Такси и 8.5 допускается только в `src-ui/apps/form-editor/preview-core` или `src-ui/shared`, если он не содержит визуального решения.
- Переключение режима предпросмотра происходит на уровне `FormPreviewPane.vue`, а не внутри отдельных элементов.
- Каждый preview kit получает одинаковый `FormPreviewViewModel`, но рендерит его своим registry.

## Общий preview-core для форм

Папка:

```text
src-ui/apps/form-editor/preview-core/
├── types/
│   ├── FormPreviewMode.ts
│   ├── FormPreviewViewModel.ts
│   ├── FormPreviewElement.ts
│   └── FormPreviewCommand.ts
├── adapters/
│   ├── formModelToPreviewViewModel.ts
│   ├── normalizeFormLayout.ts
│   ├── resolveElementVisibility.ts
│   └── resolveElementTitle.ts
├── layout/
│   ├── measureFormElement.ts
│   ├── buildGroupLayout.ts
│   ├── buildTableLayout.ts
│   └── buildCommandBarLayout.ts
└── diagnostics/
    ├── collectPreviewWarnings.ts
    └── previewDiagnosticTypes.ts
```

Контракт:

- `FormModel` из `src/formEditor/FormModel.ts` не используется напрямую в компонентах Vue.
- Extension host отправляет сериализуемый `FormEditorState`.
- Vue адаптирует его в `FormPreviewViewModel`.
- Preview kit получает только нормализованную модель:
  - id элемента;
  - тип элемента;
  - заголовок;
  - путь данных;
  - команды;
  - дочерние элементы;
  - layout-настройки;
  - readonly/visible/enabled;
  - diagnostics.

## Сборка

Цель: полностью заменить webpack на Vite, но не превращать `src-ui` в отдельный проект. Сборка остается единой на уровне корневого `package.json`.

Добавить зависимости:

```json
{
  "dependencies": {
    "vue": "^3"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^latest",
    "vite": "^latest",
    "vue-tsc": "^latest"
  }
}
```

Удалить после перехода:

```json
{
  "devDependencies": {
    "ts-loader": "...",
    "webpack": "...",
    "webpack-cli": "..."
  }
}
```

Добавить scripts:

```json
{
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "npm run clean && npm run build:node && npm run build:webview",
    "build:node": "vite build --config vite.node.config.ts",
    "build:webview": "vite build --config vite.webview.config.ts",
    "watch": "node scripts/vite-watch.mjs",
    "watch:node": "vite build --watch --config vite.node.config.ts",
    "watch:webview": "vite build --watch --config vite.webview.config.ts",
    "compile": "npm run typecheck",
    "typecheck": "tsc -p tsconfig.json --noEmit && vue-tsc -p tsconfig.ui.json --noEmit",
    "test:compile": "tsc -p tsconfig.test.json",
    "test": "node ./out/test/runTests.js",
    "pretest": "npm run typecheck && npm run build && npm run test:compile",
    "clean": "node scripts/clean-dist.mjs"
  }
}
```

На время миграции, если `scripts/vite-watch.mjs` еще не готов, можно запускать две Vite-сборки в отдельных терминалах:

```bash
npm run watch:node
npm run watch:webview
```

Дополнительные правила:

- `clean` удаляет только `dist/**`. `out/**` принадлежит тестовой TypeScript-сборке и не нужен в VSIX.
- `tsconfig.json` становится typecheck-конфигом для `src/**` без emit.
- `tsconfig.ui.json` становится typecheck-конфигом для `src-ui/**` с `DOM`, `ES2020`, `module: ESNext`, `moduleResolution: Bundler`.
- `tsconfig.test.json` компилирует `src/test/**` и тестируемые TS-файлы в `out/**`, потому что текущий Mocha runner динамически грузит `out/test/suite/*.js`.
- Тестовый runner можно позже перевести на Vite, но это отдельное улучшение. Для первого перехода важно заменить webpack в production/dev bundle, не ломая тестовый контур.

## Единый проект, но разные Vite targets

Делать отдельный npm-проект внутри `src-ui` не нужно. Но один физический Vite build для всего сразу тоже нежелателен, потому что у extension host и webview разные runtime:

- extension host и CLI: Node/CommonJS, внешний модуль `vscode`, доступ к Node builtins;
- webview: browser/ES modules, Vue SFC, CSS assets, строгий CSP, без Node polyfills.

Поэтому целевой компромисс:

- один корневой `package.json`;
- один `node_modules`;
- один lockfile;
- одна команда `npm run build`;
- две Vite-конфигурации в корне: `vite.node.config.ts` и `vite.webview.config.ts`;
- общий файл `vite.shared.ts` для алиасов, output naming и manifest helpers.

Это остается единым проектом, но не смешивает несовместимые targets в одном Rollup output.

## Vite configs и entry points

### `vite.node.config.ts`

Собирает Node-side entry расширения:

```text
dist/
├── extension.js
└── cli/
    └── onec-tools.js
```

Entry:

```ts
{
  extension: 'src/extension.ts',
  'cli/onec-tools': 'src/cli/onec-tools.ts'
}
```

Требования:

- target: Node runtime extension host, ориентир `node18` или совместимый с текущей минимальной версией VS Code.
- output format: CommonJS, чтобы сохранить `"main": "./dist/extension.js"`.
- external:
  - `vscode`;
  - `@vscode/test-electron`;
  - нативные Node builtins.
- `fast-xml-parser`, `iconv-lite`, `vscode-languageclient` бандлить или externalize осознанно. Предпочтение: бандлить JS-зависимости, чтобы VSIX не зависел от `node_modules`.
- source maps можно оставлять в dev, но `.vscodeignore` сейчас исключает `**/*.map`; это правило можно сохранить для релиза.

### `vite.webview.config.ts`

Собирает Vue/webview entry в `dist/ui`:

```text
dist/ui/
├── universal.js
├── formEditor.js
├── properties.js
├── subsystem.js
├── environment.js
├── standalone.js
├── repositoryConnection.js
├── repositoryCommit.js
├── treeSearch.js
└── assets/
    ├── *.css
    └── *.woff2 / *.svg / *.png
```

Требования:

- `base: './'`.
- `outDir: 'dist/ui'`.
- `emptyOutDir: false`, потому что `dist/extension.js` уже может быть создан `build:node`.
- Имена entry стабильные, без hash, чтобы extension host мог подключать их по имени.
- CSS можно оставлять отдельным asset-файлом, но `WebviewHtmlFactory` должен уметь подключать список CSS-файлов для entry.
- Webview bundle target: browser, без Node polyfills.
- Dynamic imports внутри webview использовать осторожно: CSP и `asWebviewUri` проще держать под контролем, если entry и CSS явно перечислены в manifest.

### `vite.shared.ts`

Общие настройки:

- aliases:
  - `@ui` → `src-ui`;
  - `@ui-shared` → `src-ui/shared`;
  - `@ui-kits` → `src-ui/kits`;
- общий helper для стабильных output names;
- общий список external для Node;
- helper для генерации webview manifest.

### Webview asset manifest

После `build:webview` должен появляться manifest, например:

```text
dist/ui/manifest.json
```

Минимальный формат:

```json
{
  "environment": {
    "script": "environment.js",
    "styles": ["assets/environment.css"]
  },
  "formEditor": {
    "script": "formEditor.js",
    "styles": ["assets/formEditor.css"]
  }
}
```

`WebviewHtmlFactory` читает manifest из `dist/ui/manifest.json`, конвертирует пути через `webview.asWebviewUri(...)` и не хардкодит CSS-файлы.

## Webview HTML Factory

Создать:

```text
src/ui/views/webview/
├── WebviewHtmlFactory.ts
├── WebviewAssetManifest.ts
├── WebviewNonce.ts
└── _types.ts
```

Ответственность:

- строить полный HTML-документ;
- подключать JS entry из `dist/ui/manifest.json`;
- подключать CSS из manifest;
- выставлять CSP;
- добавлять `<div id="app"></div>`;
- безопасно передавать начальное состояние;
- поддерживать `viewKind`, чтобы один Vue bootstrap мог проверять, что загружен правильный entry.

Пример целевого API:

```ts
renderVueWebviewHtml({
  webview,
  extensionUri,
  title: 'Настройки проекта',
  entry: 'environment',
  initialState,
  csp: {
    allowImages: true,
    allowStyles: true
  }
});
```

## Message protocol

Каждая webview имеет два union-типа:

- `HostToUiMessage`
- `UiToHostMessage`

Правила:

- У каждого сообщения есть `type`.
- Для команд с ответом использовать `requestId`.
- Ошибки возвращать сообщением `{ type: 'error', requestId?, message }`.
- Не отправлять функции, классы, `Map`, `Set`, `Uri`, `Date`. Только JSON-compatible DTO.
- Не отправлять HTML из host в Vue, кроме временного этапа миграции `UniversalPanel`.

Базовые сообщения:

```ts
type HostToUiMessage =
  | { type: 'init'; state: unknown }
  | { type: 'state'; state: unknown }
  | { type: 'status'; kind: 'idle' | 'loading' | 'success' | 'error'; message: string }
  | { type: 'error'; requestId?: string; message: string };

type UiToHostMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'command'; command: string; payload?: unknown }
  | { type: 'request'; requestId: string; name: string; payload?: unknown };
```

## Миграция текущих webview

### 1. Малые панели настроек

Файлы:

- `src/ui/views/environment/ProjectEnvironmentViewProvider.ts`
- `src/ui/views/standalone/StandaloneServerViewProvider.ts`

Vue apps:

- `src-ui/apps/environment`
- `src-ui/apps/standalone`

Компоненты:

```text
EnvironmentApp.vue
EnvironmentForm.vue
PlatformPathField.vue
InfoBaseSelect.vue
CredentialsFields.vue
EnvironmentStatusBar.vue
EnvironmentActions.vue

StandaloneApp.vue
StandaloneForm.vue
HttpSettingsSection.vue
DatabasePathField.vue
IbsrvPathField.vue
StandaloneFlagsSection.vue
StandaloneStatusBar.vue
StandaloneActions.vue
```

Критерий готовности:

- HTML/CSS/JS удалены из providers.
- Provider отправляет snapshot и принимает `save` / `refresh`.
- `npm run compile` проходит.

### 2. Repository panels

Файлы:

- `src/ui/views/RepositoryConnectionViewProvider.ts`
- `src/ui/views/RepositoryCommitViewProvider.ts`

Vue apps:

- `src-ui/apps/repository-connection`
- `src-ui/apps/repository-commit`

Компоненты:

```text
RepositoryConnectionApp.vue
RepositoryModeTabs.vue
RepositoryTargetSummary.vue
RepositoryCredentialsForm.vue
RepositoryBindingStatus.vue
RepositoryConnectionActions.vue

RepositoryCommitApp.vue
CommitTargetSummary.vue
CommitMessageEditor.vue
CommitLockToggle.vue
CommitValidationMessage.vue
CommitActions.vue
```

Критерий готовности:

- Секреты не сохраняются в проектные файлы.
- Все ошибки отображаются в UI и дублируются в host через существующий output channel.

### 3. TreeSearch

Файл:

- `src/ui/views/search/TreeSearchViewProvider.ts`

Vue app:

- `src-ui/apps/tree-search`

Компоненты:

```text
TreeSearchApp.vue
TreeSearchInput.vue
TreeSearchClearButton.vue
TreeSearchToolbar.vue
TreeSearchStatus.vue
TreeSearchCommandButton.vue
```

Критерий готовности:

- Поиск обновляет context `v8vscedit.hasTreeSearch` через provider.
- Clear search синхронизируется с `UniversalPanelViewProvider`.

### 4. Properties

Файлы:

- `src/ui/views/PropertiesViewProvider.ts`
- `src/ui/views/properties/rendering/**`

Vue app:

- `src-ui/apps/properties`

Целевая схема:

- `PropertiesViewController` остается в `src/**`.
- Рендеры HTML из `rendering/**` постепенно заменяются построением `PropertiesViewState`.
- Vue получает `sections`, `controls`, `actions`, `diagnostics`, `readonly`.

Компоненты:

```text
PropertiesApp.vue
PropertiesShell.vue
PropertiesHeader.vue
PropertiesEmptyState.vue
PropertySectionList.vue
PropertySection.vue
PropertySectionHeader.vue
PropertyRow.vue
PropertyLabel.vue
PropertyValue.vue
PropertyTextControl.vue
PropertyBooleanControl.vue
PropertyEnumControl.vue
PropertyNumberControl.vue
PropertyTypeControl.vue
PropertyReferenceControl.vue
PropertyReferenceList.vue
PropertyReferenceChip.vue
PropertySubsystemMembership.vue
PropertyCommandInterfaceGroup.vue
PropertyValidationMessage.vue
PropertyFooterActions.vue
```

Критерий готовности:

- В UI-слое больше нет строкового рендера HTML свойств.
- Справочники свойств остаются в `infra/xml/PropertySchema.ts`.
- Vue не знает, как читать XML.

### 5. Subsystem editor

Файл:

- `src/ui/views/subsystem/SubsystemEditorViewProvider.ts`

Vue app:

- `src-ui/apps/subsystem`

Компоненты:

```text
SubsystemApp.vue
SubsystemShell.vue
SubsystemTabs.vue
SubsystemTabButton.vue
SubsystemPropertiesTab.vue
SubsystemContentTab.vue
SubsystemChildrenTab.vue
SubsystemCommandInterfaceTab.vue
SubsystemContentTree.vue
SubsystemContentTreeNode.vue
SubsystemContentTreeRow.vue
SubsystemContentCheckbox.vue
SubsystemSelectedList.vue
SubsystemSelectedItem.vue
SubsystemChildList.vue
SubsystemChildItem.vue
SubsystemAddChildForm.vue
SubsystemActions.vue
SubsystemLockedBanner.vue
```

Критерий готовности:

- `SubsystemXmlService` остается единственным местом записи XML.
- Provider получает команды `propertyChanged`, `addContent`, `removeContent`, `addChild`, `removeChild`, `openCommandInterface`.
- Состояние состава обновляется через `state`, а не заменой всего HTML.

### 6. Form editor

Файлы:

- `src/formEditor/FormEditorProvider.ts`
- `src/formEditor/webview/**`

Vue app:

- `src-ui/apps/form-editor`

Целевая структура:

```text
src-ui/apps/form-editor/
├── main.ts
├── FormEditorApp.vue
├── protocol/
│   └── formEditorMessages.ts
├── store/
│   ├── formEditorStore.ts
│   ├── selectionStore.ts
│   ├── dragDropStore.ts
│   ├── previewModeStore.ts
│   └── commandStateStore.ts
├── components/
│   ├── shell/
│   │   ├── FormEditorShell.vue
│   │   ├── FormEditorToolbar.vue
│   │   ├── FormEditorToolbarButton.vue
│   │   ├── FormEditorStatusBar.vue
│   │   ├── FormEditorPanel.vue
│   │   ├── FormEditorSplitter.vue
│   │   └── FormEditorTabBar.vue
│   ├── tree/
│   │   ├── FormElementTree.vue
│   │   ├── FormElementTreeNode.vue
│   │   ├── FormElementTreeRow.vue
│   │   ├── FormElementExpander.vue
│   │   ├── FormElementIcon.vue
│   │   ├── FormElementTitle.vue
│   │   ├── FormElementDataPath.vue
│   │   ├── FormElementBadges.vue
│   │   ├── FormElementActions.vue
│   │   └── FormElementDropMarker.vue
│   ├── data/
│   │   ├── FormDataPanel.vue
│   │   ├── FormDataTabs.vue
│   │   ├── FormAttributesList.vue
│   │   ├── FormAttributeRow.vue
│   │   ├── FormCommandsList.vue
│   │   ├── FormCommandRow.vue
│   │   ├── FormParametersList.vue
│   │   └── FormParameterRow.vue
│   ├── properties/
│   │   ├── FormPropertyPanel.vue
│   │   ├── FormPropertySection.vue
│   │   ├── FormPropertyRow.vue
│   │   ├── FormPropertyLabel.vue
│   │   ├── FormPropertyTextInput.vue
│   │   ├── FormPropertySelect.vue
│   │   ├── FormPropertyCheckbox.vue
│   │   ├── FormPropertyEventHandler.vue
│   │   └── FormPropertyActionButton.vue
│   ├── preview/
│   │   ├── FormPreviewPane.vue
│   │   ├── FormPreviewToolbar.vue
│   │   ├── FormPreviewModeToggle.vue
│   │   ├── FormPreviewScaleControl.vue
│   │   ├── FormPreviewDiagnostics.vue
│   │   ├── FormPreviewCanvas.vue
│   │   ├── TaxiPreviewRoot.vue
│   │   └── Onec85PreviewRoot.vue
│   └── module/
│       ├── FormModulePane.vue
│       ├── FormModuleOpenButton.vue
│       └── FormModuleHandlerLink.vue
├── preview-core/
└── composables/
    ├── useFormEditorMessages.ts
    ├── useFormSelection.ts
    ├── useFormDragDrop.ts
    ├── useFormKeyboard.ts
    ├── useFormSplitters.ts
    ├── useFormPreviewMode.ts
    └── useFormPropertyEditing.ts
```

Состояние:

```ts
interface FormEditorState {
  readonly model: FormModelDto;
  readonly selectedElementId?: number;
  readonly previewMode: 'taxi' | 'onec85';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly diagnostics: readonly FormEditorDiagnosticDto[];
}
```

Критерий готовности:

- `src/formEditor/webview/**` удален.
- `FormEditorProvider.ts` подключает только `dist/ui/formEditor.js`.
- Все текущие сообщения сохранены или типизированно заменены:
  - `moveElement`
  - `updateProperty`
  - `deleteElement`
  - `createElement`
  - `createElementWithDataPath`
  - `openModule`
  - `goToHandler`
  - `selectElement`
  - `undo`
  - `redo`
- Переключение preview mode не влияет на модель формы и не отправляет лишние XML-изменения.
- Предпросмотр Такси и 8.5 рендерятся через разные kit registry.

### 7. UniversalPanel

Файл:

- `src/ui/views/universal/UniversalPanelViewProvider.ts`

Vue app:

- `src-ui/apps/universal`

Это основной UI проекта, поэтому переносить последним.

Целевая модель:

```ts
interface UniversalPanelState {
  readonly initialized: boolean;
  readonly processing: UniversalPanelProcessingStateDto;
  readonly searchQuery: string;
  readonly selectedNodeId?: string;
  readonly openNodeIds: readonly string[];
  readonly rootNodes: readonly UniversalTreeNodeDto[];
  readonly actions: readonly UniversalActionDto[];
  readonly standaloneStatus: StandaloneServerStatusDto;
}

interface UniversalTreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly ownership?: 'own' | 'borrowed' | 'unknown';
  readonly supportMode?: 'none' | 'editable' | 'locked';
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: readonly UniversalTreeNodeDto[];
  readonly actions: readonly UniversalNodeActionDto[];
  readonly defaultCommand?: string;
}
```

Компоненты:

```text
UniversalApp.vue
UniversalShell.vue
UniversalProcessingOverlay.vue
UniversalOperationsBar.vue
UniversalStandaloneActions.vue
UniversalTreeArea.vue
UniversalTree.vue
UniversalTreeNode.vue
UniversalTreeRow.vue
UniversalTreeIndent.vue
UniversalTreeExpander.vue
UniversalTreeIcon.vue
UniversalTreeLabel.vue
UniversalTreeDescription.vue
UniversalTreeOwnershipBadge.vue
UniversalTreeSupportBadge.vue
UniversalTreeGitBadge.vue
UniversalTreeActions.vue
UniversalTreeActionButton.vue
UniversalContextMenu.vue
UniversalContextMenuItem.vue
UniversalSearchBox.vue
UniversalSearchClearButton.vue
UniversalEmptyState.vue
UniversalUninitializedState.vue
UniversalLoadMoreSentinel.vue
UniversalChunkLoader.vue
```

Переходный этап:

1. Сначала оставить host-side построение node DTO, но Vue рендерит дерево.
2. Затем убрать передачу HTML чанков из `postNodeChildren`.
3. После стабилизации перенести lazy rendering и virtual scroll в Vue.

Критерий готовности:

- В `UniversalPanelViewProvider` нет HTML/CSS/JS строк.
- Контекстное меню строится из DTO, сформированных на основе `META_TYPES[nodeKind].modules` и `MODULE_SLOT_ACTIONS`.
- Дерево грузит детей лениво через сообщение `loadChildren`.
- Поиск, раскрытие, selection и default action полностью синхронизированы с provider.

## Компонентная декомпозиция: обязательный минимум

Ни один крупный app-компонент не должен содержать разметку ниже одного уровня композиции.

Пример для дерева:

- `Tree.vue` управляет списком.
- `TreeNode.vue` отвечает за рекурсию.
- `TreeRow.vue` отвечает за строку.
- `TreeExpander.vue` отвечает только за раскрытие.
- `TreeIcon.vue` отвечает только за иконку.
- `TreeLabel.vue` отвечает только за текст.
- `TreeBadge.vue` отвечает только за бейдж.
- `TreeActions.vue` отвечает только за список действий.
- `TreeActionButton.vue` отвечает только за одну кнопку.

Пример для кнопки:

- `VButton.vue` - текстовая кнопка.
- `VIconButton.vue` - кнопка с иконкой.
- `VToolbarButton.vue` - кнопка панели инструментов.
- `VMenuItem.vue` - пункт меню.
- `FormEditorToolbarButton.vue` - app-specific обертка, если нужна команда редактора форм.

Пример для иконок:

- `MetadataIcon.vue` - иконка метаданных из extension assets.
- `ProductIcon.vue` - codicon/product icon.
- `FormElementIcon.vue` - иконка элемента формы.
- `TaxiIcon.vue` - иконка внутри Такси preview.
- `Onec85Icon.vue` - иконка внутри 8.5 preview.

## Типы и DTO

Добавить в `src/**` host-side DTO builders:

```text
src/ui/views/dto/
├── iconDto.ts
├── treeNodeDto.ts
├── propertyDto.ts
├── formEditorDto.ts
├── subsystemDto.ts
└── statusDto.ts
```

Правила:

- DTO builders могут импортировать `domain`, `infra`, `MetadataNode`, `vscode.Uri`.
- В DTO не должно быть `vscode.Uri`. Только строки URI, уже преобразованные через `webview.asWebviewUri`, или logical icon id.
- Для иконок предпочтительно передавать logical icon id, а URI строить host-side централизованно.
- В `src-ui/shared/types/**` должны быть зеркальные типы DTO без зависимости от host.

## Работа с иконками

Проблема: сейчас иконки метаданных лежат в `src/icons/{light,dark}` и подключаются через `webview.asWebviewUri`.

Целевой подход:

1. Host формирует `IconDto`:

```ts
interface IconDto {
  readonly kind: 'codicon' | 'metadata' | 'asset' | 'none';
  readonly name?: string;
  readonly lightUri?: string;
  readonly darkUri?: string;
  readonly ariaLabel?: string;
}
```

2. Vue-компоненты не знают о файловой системе.
3. `MetadataIcon.vue` рендерит `picture` или `img` с light/dark URI.
4. `ProductIcon.vue` рендерит codicon class, если codicons будут подключены в bundle.
5. Для preview kit'ов 1С использовать отдельные иконки, не смешивая их с VS Code metadata icons.

## Стили и темы

Слои CSS:

1. `shared/styles/reset.css` - минимальный reset для webview.
2. `shared/styles/webview-base.css` - базовые правила body, font, box sizing.
3. `kits/vscode/tokens/*.css` - mapping к VS Code theme variables.
4. `kits/onec-taxi/tokens/*.css` - стили Такси preview.
5. `kits/onec-85/tokens/*.css` - стили 8.5 preview.
6. App-level CSS - только layout конкретного приложения.

Запреты:

- Не использовать один глобальный CSS-файл для всех webview.
- Не задавать preview-стили 1С через VS Code CSS-переменные.
- Не использовать inline-style для постоянных визуальных правил.
- Не добавлять декоративные фоны, которые конфликтуют с утилитарным UI расширения.

## Accessibility и keyboard

Обязательные требования:

- Все кнопки с иконками имеют `aria-label`.
- Tree row поддерживает keyboard selection.
- Context menu закрывается по `Escape`.
- Tab panels используют корректные роли или понятную keyboard-навигацию.
- Поля форм имеют label.
- Ошибки форм связаны с полем через `aria-describedby`.
- В preview mode 1С элементы могут быть визуально disabled, но редакторская оболочка должна оставаться доступной.

## Тестирование

### Host tests

Оставить существующие Mocha-тесты в `src/test/suite/**`.

Добавить тесты на DTO builders:

```text
src/test/suite/webviewDto.test.ts
src/test/suite/formEditorDto.test.ts
src/test/suite/universalPanelDto.test.ts
```

Проверять:

- JSON-serializable DTO;
- отсутствие `vscode.Uri`, `Map`, `Set`;
- корректные actions для модулей из `META_TYPES.modules`;
- корректное представление поддержки/заимствования.

### UI tests

После добавления тестового стека для `src-ui`:

```text
src-ui/**/*.spec.ts
src-ui/**/*.spec.tsx
```

Проверять:

- stores;
- message bus;
- preview model adapters;
- tree keyboard behavior;
- property control rendering;
- переключение Такси / 8.5.

### E2E / screenshots

Для form editor нужны screenshot-регрессии:

- shell редактора;
- дерево элементов;
- панель свойств;
- preview Taxi;
- preview 8.5;
- drag/drop marker;
- состояние ошибки парсинга.

## Этапы выполнения

### Этап 0. Переход с webpack на Vite

- Добавить `vite.node.config.ts`, `vite.webview.config.ts`, `vite.shared.ts`.
- Добавить `tsconfig.ui.json` и `tsconfig.test.json`.
- Добавить `scripts/clean-dist.mjs`.
- Добавить `scripts/vite-watch.mjs` или временно использовать два watch-скрипта.
- Перенести текущие webpack entry:
  - `src/extension.ts` → `dist/extension.js`;
  - `src/cli/onec-tools.ts` → `dist/cli/onec-tools.js`;
  - временно `src/formEditor/webview/formEditor.ts` → `dist/ui/formEditor.js`, пока редактор форм еще не на Vue.
- Временно скопировать `src/formEditor/webview/styles.css` в `dist/ui/assets/formEditor.css` через Vite asset pipeline или маленький Vite plugin.
- Обновить `package.json` scripts с webpack на Vite.
- Обновить `.vscodeignore`:
  - убрать `webpack.config.js`;
  - добавить `vite*.config.ts`, `vite.shared.ts`, `src-ui/**`, `scripts/**` при необходимости;
  - убедиться, что `dist/**` не исключен.
- Удалить `webpack.config.js` только после прохождения сборки.

Готово, когда:

- `npm run build` создает `dist/extension.js`, `dist/cli/onec-tools.js`, временный `dist/ui/formEditor.js`.
- Расширение запускается в Extension Development Host.
- `npm run typecheck` проходит.
- `npm test` проходит или известные падения не связаны со сборкой.
- `webpack`, `webpack-cli`, `ts-loader` больше не нужны.

### Этап 1. Подготовка Vue-слоя

- Добавить `src-ui` как папку исходников единого проекта.
- Добавить Vue/Vite plugin/vue-tsc.
- Добавить `WebviewHtmlFactory`.
- Добавить общий message bus.
- Добавить первый пустой Vue entry `environment`.
- Настроить `dist/ui/manifest.json`.

Готово, когда:

- `npm run build:webview` создает `dist/ui/environment.js` и manifest.
- `npm run typecheck` проверяет `src` и `src-ui`.
- Один provider может открыть пустой Vue webview.

### Этап 2. Простые панели

- Перенести `ProjectEnvironmentViewProvider`.
- Перенести `StandaloneServerViewProvider`.
- Перенести repository panels.
- Перенести `TreeSearchViewProvider`.

Готово, когда:

- Эти providers больше не содержат больших HTML-шаблонов.
- Все операции работают через typed messages.

### Этап 3. UI-kit VS Code

- Вынести общие компоненты, появившиеся на этапе 2, в `kits/vscode`.
- Покрыть tree, forms, toolbar, menu, tabs, buttons.
- Запретить app-level копипасту кнопок/полей/панелей.

Готово, когда:

- Новая панель может быть собрана из kit-компонентов без локальных базовых контролов.

### Этап 4. Properties

- Сформировать `PropertiesViewState`.
- Перенести controls в Vue.
- Удалить строковый JS из `PropertiesWebviewHtml.ts`.
- Постепенно удалить HTML renderers, оставив host-side построение данных.

Готово, когда:

- Свойства редактируются через Vue.
- Все существующие сценарии выбора типа, формы, ссылки, подсистемы работают.

### Этап 5. Subsystem editor

- Сформировать `SubsystemEditorState`.
- Перенести вкладки, деревья состава и дочерние подсистемы.
- Сохранить запись XML только через `SubsystemXmlService`.

Готово, когда:

- Состав подсистемы редактируется без перезагрузки HTML.

### Этап 6. Form editor shell

- Перенести текущие TS-модули `src/formEditor/webview/**` во Vue.
- Вынести splitter, tabs, tree row, property row, toolbar buttons.
- Сохранить текущий protocol с минимальными изменениями.

Готово, когда:

- Поведение текущего редактора форм сохранено.
- `src/formEditor/webview/**` больше не нужен.

### Этап 7. Preview kits

- Добавить `preview-core`.
- Добавить `onec-taxi`.
- Добавить `onec-85`.
- В `FormPreviewModeToggle` переключать renderer.
- Сначала покрыть базовые элементы:
  - form root;
  - group;
  - pages;
  - field;
  - label;
  - button;
  - command bar;
  - table;
  - unknown element.

Готово, когда:

- Одна и та же форма открывается в режиме Такси и 8.5.
- Переключение не меняет XML.
- Каждый режим имеет отдельные tokens и компоненты.

### Этап 8. UniversalPanel

- Создать `UniversalPanelState`.
- Перевести toolbar/search/actions.
- Перевести дерево на DTO.
- Перевести context menu.
- Убрать HTML chunks.
- Добавить lazy loading children через request/reply.

Готово, когда:

- `UniversalPanelViewProvider.ts` становится thin adapter.
- Основной навигатор работает без строкового HTML.

### Этап 9. Очистка

- Удалить старые webview HTML helpers.
- Удалить `src/formEditor/webview`.
- Удалить webpack полностью:
  - `webpack.config.js`;
  - `webpack`;
  - `webpack-cli`;
  - `ts-loader`;
  - старые webpack-команды из README/docs.
- Проверить `.vscodeignore`, чтобы `dist/ui` попадал в VSIX.
- Проверить, что `src-ui/**`, `vite*.config.ts`, `tsconfig.ui.json`, `tsconfig.test.json`, `scripts/**` не попадают в VSIX, если они не нужны runtime.
- Обновить README/docs.
- Запустить:

```bash
npm run compile
npm run lint
npm test
npm run build
```

## Риски

1. **UniversalPanel слишком большой для одномоментного переноса.**
   Решение: сначала передавать DTO и рендерить Vue без изменения командной логики.

2. **Preview 1С может начать смешиваться с рабочим UI расширения.**
   Решение: физически разные kit-папки и запрет cross-import между `kits/vscode`, `kits/onec-taxi`, `kits/onec-85`.

3. **Слишком много локального состояния в Vue.**
   Решение: source of truth для модели остается в host. Vue хранит только UI-state: selection, expanded rows, active tab, preview mode, splitter sizes.

4. **CSP сломает inline bootstrapping.**
   Решение: весь JS в bundle, inline script только с nonce и минимальным JSON initial state, либо initial state отправлять сообщением после `ready`.

5. **CSS ассеты Vite будут трудно подключаться.**
   Решение: стабильный manifest и `WebviewAssetManifest.ts`.

6. **Типы DTO разъедутся между `src` и `src-ui`.**
   Решение: либо генерировать типы, либо держать зеркальные типы в одном формате и проверять JSON fixtures тестами.

## Definition of Done для всей миграции

- Все webview UI живут в `src-ui`.
- Providers в `src/**` не содержат больших HTML/CSS/JS строк.
- Extension host и Vue общаются через типизированные DTO/messages.
- Общий UI-kit расширения и два preview kit'а форм физически разделены:
  - `kits/vscode` — рабочий UI всего расширения;
  - `kits/onec-taxi` — предпросмотр форм в стиле 1С Такси;
  - `kits/onec-85` — предпросмотр форм в стиле 1С 8.5.
- Редактор форм умеет переключать предпросмотр Такси / 8.5 без изменения XML.
- `UniversalPanelViewProvider` остается основным UI навигатора и использует Vue.
- `META_TYPES.modules` и `MODULE_SLOT_ACTIONS` остаются источником правды для команд модулей.
- `npm run compile`, `npm run lint`, `npm test`, `npm run build` проходят.
