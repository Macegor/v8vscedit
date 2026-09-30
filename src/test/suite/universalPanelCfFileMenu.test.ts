/**
 * Новое требование пользователя: пункты меню выгрузки/загрузки CF-файла
 * должны быть в контекстном меню КОРНЕВОГО узла конфигурации/расширения, а не
 * только доступны из палитры команд. Контекстное меню в этом проекте строится
 * в `UniversalPanelViewProvider.getNodeActions()` (приватный метод), а НЕ через
 * `package.json → contributes.menus` (запрет №14 CLAUDE.md).
 *
 * `getNodeActions` — приватный метод, поэтому дёргаем его через ЕДИНСТВЕННЫЙ
 * публичный путь, которым он реально исполняется: `resolveWebviewView`
 * (реальный `WebviewHtmlFactory`, читающий собранный `dist/ui/manifest.json`)
 * встраивает начальное состояние дерева (`rootNodes[].actions`) в HTML;
 * дочерние узлы — через протокол `{type:'request', name:'loadChildren'}`,
 * ответ на который (`{type:'childrenLoaded', children}`) тоже несёт `actions`.
 * Тот же приём, что в `treeSearchViewProvider.test.ts`/
 * `metadataChangesViewProvider.test.ts`: реальный `vscode.WebviewView` в
 * headless Extension Host собрать нельзя (нет видимой панели) — единственная
 * внешняя недоступная система здесь, `webview` реализован вручную с реальной
 * семантикой (`postMessage` копит историю, а не фиксирует факт вызова).
 *
 * Дерево строится РЕАЛЬНЫМ `MetadataTreeProvider` над двумя настоящими
 * фикстурами из `example/` (а не над одним корнем `findConfigurations`,
 * специально ЧТОБЫ не тянуть в тест циклопический `example/2.21/src/cf`,
 * 44 000+ XML-объектов — время его полного разбора несопоставимо с задачей
 * теста): `example/2.20/src/cf` (612 объектов, полноценная основная
 * конфигурация, но БЕЗ расширений в комплекте) и `example/2.21/src/cfe/EVOLC`
 * (68 объектов, полноценное расширение). `ConfigEntry` — это просто
 * `{kind, rootPath}` (`domain/Configuration.ts`), ничто не требует, чтобы обе
 * записи жили под одним корнем выгрузки — комбинация двух настоящих фикстур
 * в один список `entries` не выдумывает данные, а лишь ускоряет тест.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConfigEntry } from '../../infra/fs/ConfigLocator';
import type { NodeArg } from '../../ui/commands/_shared';
import { toDialogTarget } from '../../ui/commands/ext/CfFileCommands';
import { buildCfApplyTarget } from '../../ui/commands/ext/CfFileTarget';
import { GitMetadataStatusService } from '../../infra/git/GitMetadataStatusService';
import { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { UniversalPanelViewProvider } from '../../ui/views/universal/UniversalPanelViewProvider';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';
import { skipWithoutCorpus } from './support/corpus';

const EXTENSION_ROOT = path.resolve(__dirname, '../../../');
const CF_ROOT = path.resolve(__dirname, '../../../example/2.20/src/cf');
const CFE_EVOLC_ROOT = path.resolve(__dirname, '../../../example/2.21/src/cfe/EVOLC');

const DUMP_COMMAND_ID = 'v8vscedit.dumpConfigurationToCf';
const LOAD_COMMAND_ID = 'v8vscedit.loadConfigurationFromCf';

interface ActionDto {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly icon?: { readonly kind: string; readonly name?: string };
}

interface TreeNodeDtoLike {
  readonly id: string;
  readonly kind?: string;
  readonly label: string;
  readonly actions: readonly ActionDto[];
}

interface InitialStateLike {
  readonly state: { readonly rootNodes: readonly TreeNodeDtoLike[] };
}

interface ChildrenLoadedMessage {
  readonly type: 'childrenLoaded';
  readonly nodeId: string;
  readonly children: readonly TreeNodeDtoLike[];
  readonly done: boolean;
}

/** Простейший в-памяти `vscode.Memento`: реальная семантика get/update, без внешнего хранилища. */
function createFakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T): T => (store.has(key) ? (store.get(key) as T) : (defaultValue as T)),
    update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); },
    keys: () => [...store.keys()],
  };
}

/**
 * Реальный `vscode.Webview` собрать в headless-тесте нельзя (нужна видимая
 * панель) — единственная внешняя недоступная система в этом файле.
 * `postMessage`/`html` реализованы с настоящей семантикой (накопление истории,
 * реальный HTML), а не как фиксация факта вызова — см. образец в
 * `treeSearchViewProvider.test.ts`.
 */
function createFakeWebview(): {
  webview: vscode.Webview;
  postedMessages: unknown[];
  receiveMessage: (message: unknown) => Promise<void>;
} {
  const postedMessages: unknown[] = [];
  const messageEmitter = new vscode.EventEmitter<unknown>();
  const webview: vscode.Webview = {
    options: {},
    html: '',
    cspSource: 'vscode-webview://fake',
    onDidReceiveMessage: messageEmitter.event,
    postMessage: (message: unknown) => { postedMessages.push(message); return Promise.resolve(true); },
    asWebviewUri: (uri: vscode.Uri) => uri,
  };
  return {
    webview,
    postedMessages,
    receiveMessage: async (message: unknown) => {
      messageEmitter.fire(message);
      // loadChildren может слать НЕСКОЛЬКО чанков асинхронно (setTimeout(0)
      // между ними) — ждём микротаск с запасом, а не один нулевой setTimeout.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

function extractInitialState(html: string): InitialStateLike {
  const match = /<script[^>]*id="v8vscedit-initial-state"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, `в HTML не найден блок начального состояния: ${html.slice(0, 200)}...`);
  return JSON.parse(match[1]) as InitialStateLike;
}

function findChildrenLoaded(posted: readonly unknown[], nodeId: string): ChildrenLoadedMessage | undefined {
  return posted.find(
    (m): m is ChildrenLoadedMessage =>
      typeof m === 'object' && m !== null
      && (m as { type?: string }).type === 'childrenLoaded'
      && (m as { nodeId?: string }).nodeId === nodeId
  );
}

function actionCommands(node: TreeNodeDtoLike): string[] {
  return node.actions.map((a) => a.command);
}

suite('UniversalPanelViewProvider — пункты меню CF-файла в контекстном меню корня (новое требование)', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  let cacheRoot: string;
  let treeProvider: MetadataTreeProvider;
  let provider: UniversalPanelViewProvider;
  let fakeWebview: ReturnType<typeof createFakeWebview>;
  let initialState: InitialStateLike;

  suiteSetup(function () {
    this.timeout(30_000);
    cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-universal-cf-menu-')));
    const entries: ConfigEntry[] = [
      { kind: 'cf', rootPath: CF_ROOT },
      { kind: 'cfe', rootPath: CFE_EVOLC_ROOT },
    ];
    treeProvider = new MetadataTreeProvider(entries, vscode.Uri.file(EXTENSION_ROOT), cacheRoot);

    const standaloneStatus = {
      configured: false,
      state: 'unconfigured' as const,
      message: '',
      pid: null,
      url: null,
      settings: {
        ibsrvPath: '', platformPath: '', dataPath: '', databasePath: '',
        httpAddress: '', httpPort: 0, httpBase: '', name: '',
        distributeLicenses: 'deny' as const, scheduleJobs: 'deny' as const,
      },
      logPath: '',
    };

    provider = new UniversalPanelViewProvider(vscode.Uri.file(EXTENSION_ROOT), {
      state: createFakeMemento(),
      treeProvider,
      setTreeMessage: () => undefined,
      isProjectInitialized: () => true,
      getStandaloneServerStatus: () => standaloneStatus,
      refreshStandaloneServerStatus: () => Promise.resolve(standaloneStatus),
      getProcessingState: () => ({ active: false }),
      // Реальный сервис (не заглушка): для фикстур `example/` без git-специфики
      // в проверяемых сценариях он просто не найдёт релевантного статуса —
      // ровно так же ведёт себя настоящий навигатор вне git-репозитория.
      gitMetadataStatusService: new GitMetadataStatusService(EXTENSION_ROOT),
      refreshActionsView: () => undefined,
    });

    fakeWebview = createFakeWebview();
    const fakeWebviewView = {
      webview: fakeWebview.webview,
      visible: true,
      onDidChangeVisibility: new vscode.EventEmitter<void>().event,
      onDidDispose: new vscode.EventEmitter<void>().event,
    } as unknown as vscode.WebviewView;
    provider.resolveWebviewView(fakeWebviewView);
    initialState = extractInitialState(fakeWebview.webview.html);
  });

  suiteTeardown(() => {
    treeProvider.dispose();
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  });

  test('корень основной конфигурации (configuration-hasXml) получает пункты выгрузки/загрузки CF с непустыми title/icon', () => {
    const configRoot = initialState.state.rootNodes.find((n) => n.kind === 'configuration');
    assert.ok(configRoot, `в корнях дерева не найден узел kind==='configuration': ${JSON.stringify(initialState.state.rootNodes)}`);

    const dumpAction = configRoot.actions.find((a) => a.command === DUMP_COMMAND_ID);
    const loadAction = configRoot.actions.find((a) => a.command === LOAD_COMMAND_ID);
    assert.ok(dumpAction, `узел конфигурации должен получить пункт меню ${DUMP_COMMAND_ID}, реально: ${JSON.stringify(actionCommands(configRoot))}`);
    assert.ok(loadAction, `узел конфигурации должен получить пункт меню ${LOAD_COMMAND_ID}, реально: ${JSON.stringify(actionCommands(configRoot))}`);
    assert.ok(dumpAction.label.trim().length > 0, 'у пункта выгрузки должен быть непустой заголовок');
    assert.ok(loadAction.label.trim().length > 0, 'у пункта загрузки должен быть непустой заголовок');
    assert.ok(dumpAction.icon, 'у пункта выгрузки должна быть иконка');
    assert.ok(loadAction.icon, 'у пункта загрузки должна быть иконка');
  });

  test('корень расширения (extension-hasXml) получает пункты выгрузки/загрузки CF с непустыми title/icon', async () => {
    const extensionsRoot = initialState.state.rootNodes.find((n) => n.kind === 'extensions-root');
    assert.ok(extensionsRoot, `в корнях дерева не найден контейнер расширений: ${JSON.stringify(initialState.state.rootNodes)}`);

    await fakeWebview.receiveMessage({
      type: 'request', requestId: 'load-extensions-root', name: 'loadChildren',
      payload: { nodeId: extensionsRoot.id },
    });
    const childrenMsg = findChildrenLoaded(fakeWebview.postedMessages, extensionsRoot.id);
    assert.ok(childrenMsg, 'ожидалось сообщение childrenLoaded для контейнера расширений');
    const extensionNode = childrenMsg.children.find((c) => c.kind === 'extension');
    assert.ok(extensionNode, `среди детей контейнера расширений не найден узел kind==='extension': ${JSON.stringify(childrenMsg.children)}`);

    const dumpAction = extensionNode.actions.find((a) => a.command === DUMP_COMMAND_ID);
    const loadAction = extensionNode.actions.find((a) => a.command === LOAD_COMMAND_ID);
    assert.ok(dumpAction, `узел расширения должен получить пункт меню ${DUMP_COMMAND_ID}, реально: ${JSON.stringify(actionCommands(extensionNode))}`);
    assert.ok(loadAction, `узел расширения должен получить пункт меню ${LOAD_COMMAND_ID}, реально: ${JSON.stringify(actionCommands(extensionNode))}`);
    assert.ok(dumpAction.label.trim().length > 0, 'у пункта выгрузки должен быть непустой заголовок');
    assert.ok(loadAction.label.trim().length > 0, 'у пункта загрузки должен быть непустой заголовок');
    assert.ok(dumpAction.icon, 'у пункта выгрузки должна быть иконка');
    assert.ok(loadAction.icon, 'у пункта загрузки должна быть иконка');
  });

  test('обычный объект метаданных (не корень) НЕ получает пункты выгрузки/загрузки CF', async () => {
    const configRoot = initialState.state.rootNodes.find((n) => n.kind === 'configuration');
    assert.ok(configRoot);

    // Спускаемся РОВНО на один реальный шаг: корень конфигурации → группа
    // «Справочники» (META_TYPES.Catalog.pluralLabel) → конкретный справочник
    // из настоящей фикстуры example/2.20/src/cf/Catalogs.
    await fakeWebview.receiveMessage({
      type: 'request', requestId: 'load-cf-root', name: 'loadChildren',
      payload: { nodeId: configRoot.id },
    });
    const level1 = findChildrenLoaded(fakeWebview.postedMessages, configRoot.id);
    assert.ok(level1, 'ожидалось сообщение childrenLoaded для корня основной конфигурации');
    const catalogsGroup = level1.children.find((c) => c.label === 'Справочники');
    assert.ok(catalogsGroup, `в детях корня конфигурации не найдена группа "Справочники": ${JSON.stringify(level1.children.map((c) => c.label))}`);

    await fakeWebview.receiveMessage({
      type: 'request', requestId: 'load-catalogs-group', name: 'loadChildren',
      payload: { nodeId: catalogsGroup.id },
    });
    const level2 = findChildrenLoaded(fakeWebview.postedMessages, catalogsGroup.id);
    assert.ok(level2, 'ожидалось сообщение childrenLoaded для группы "Справочники"');
    assert.ok(level2.children.length > 0, 'в примере example/2.20/src/cf должен быть хотя бы один справочник');

    const catalogNode = level2.children[0];
    assert.strictEqual(catalogNode.kind, 'Catalog', 'ожидался реальный узел справочника (kind === Catalog)');
    assert.ok(
      !actionCommands(catalogNode).includes(DUMP_COMMAND_ID),
      `обычный справочник "${catalogNode.label}" не должен получать пункт ${DUMP_COMMAND_ID}: ${JSON.stringify(actionCommands(catalogNode))}`
    );
    assert.ok(
      !actionCommands(catalogNode).includes(LOAD_COMMAND_ID),
      `обычный справочник "${catalogNode.label}" не должен получать пункт ${LOAD_COMMAND_ID}: ${JSON.stringify(actionCommands(catalogNode))}`
    );
  });
});

// ─── resolveCfFileTargetFromNode — чистая функция разрешения цели по узлу (без диалогов) ───

type CfFileTarget = { readonly kind: 'main' } | { readonly kind: 'extension'; readonly extensionName: string };

interface CfFileTargetModule {
  resolveCfFileTargetFromNode(node: NodeArg | undefined): CfFileTarget | undefined;
}

suite('resolveCfFileTargetFromNode — разрешение цели dump/load CF по узлу дерева (без QuickPick)', () => {
  let mod: CfFileTargetModule | undefined;

  suiteSetup(() => {
    mod = tryRequireProductionModule('../../../ui/commands/ext/CfFileTarget') as CfFileTargetModule | undefined;
  });

  test('модуль ui/commands/ext/CfFileTarget.ts существует и экспортирует resolveCfFileTargetFromNode', () => {
    assert.ok(mod, 'src/ui/commands/ext/CfFileTarget.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function resolve(node: NodeArg | undefined): CfFileTarget | undefined {
    if (!mod) {
      assert.fail('CfFileTarget.ts не реализован — см. первый тест сьюта');
    }
    return mod.resolveCfFileTargetFromNode(node);
  }

  const cases: readonly { readonly name: string; readonly node: NodeArg | undefined; readonly expected: CfFileTarget | undefined }[] = [
    {
      name: 'узел расширения (nodeKind=extension, есть xmlPath, непустой label) → {kind:"extension", extensionName: label}',
      node: { xmlPath: '/proj/src/cfe/EVOLC/Configuration.xml', nodeKind: 'extension', label: 'EVOLC' },
      expected: { kind: 'extension', extensionName: 'EVOLC' },
    },
    {
      name: 'узел основной конфигурации (nodeKind=configuration, есть xmlPath) → {kind:"main"}',
      node: { xmlPath: '/proj/src/cf/Configuration.xml', nodeKind: 'configuration', label: 'Основная конфигурация' },
      expected: { kind: 'main' },
    },
    {
      name: 'узел не передан (вызов из палитры команд) → undefined',
      node: undefined,
      expected: undefined,
    },
    {
      name: 'узел конфигурации без xmlPath → undefined (нечего резолвить)',
      node: { nodeKind: 'configuration', label: 'Основная конфигурация' },
      expected: undefined,
    },
    {
      name: 'узел расширения без xmlPath → undefined (нечего резолвить)',
      node: { nodeKind: 'extension', label: 'EVOLC' },
      expected: undefined,
    },
    {
      name: 'узел расширения с пустым label → undefined (имя расширения не выдумывается)',
      node: { xmlPath: '/proj/src/cfe/_empty/Configuration.xml', nodeKind: 'extension', label: '' },
      expected: undefined,
    },
    {
      name: 'узел другого вида метаданных (обычный справочник) с xmlPath → undefined (не корень)',
      node: { xmlPath: '/proj/src/cf/Catalogs/Банки.xml', nodeKind: 'Catalog', label: 'Банки' },
      expected: undefined,
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      assert.deepStrictEqual(resolve(testCase.node), testCase.expected);
    });
  }
});

/**
 * `toDialogTarget` переводит результат `resolveCfFileTargetFromNode` во
 * внутреннюю форму диалогов (`{ extensionName }`), где ПУСТАЯ СТРОКА означает
 * основную конфигурацию. Соглашение неочевидно: замена `''` на `undefined`
 * выглядела бы безобидной, но увела бы выгрузку основной конфигурации в ветку
 * «цель не выбрана», то есть команда молча перестала бы работать.
 *
 * Функция чистая, поэтому она вынесена из диалогового `c8 ignore`-региона
 * `CfFileCommands.ts` и проверяется здесь напрямую: `ignore`, обоснованный
 * недоступностью модальных окон в CI, не должен заодно накрывать логику,
 * которую можно проверить.
 */
suite('toDialogTarget — соглашение «пустое имя = основная конфигурация»', () => {
  test('узел основной конфигурации → пустое имя расширения, а НЕ undefined', () => {
    const result = toDialogTarget({ xmlPath: '/proj/src/cf/Configuration.xml', nodeKind: 'configuration', label: 'Основная конфигурация' });
    assert.deepStrictEqual(result, { extensionName: '' }, 'основная конфигурация обязана давать цель с пустым именем: undefined здесь означал бы «пользователь ничего не выбрал»');
  });

  test('узел расширения → имя из узла', () => {
    const result = toDialogTarget({ xmlPath: '/proj/src/cfe/EVOLC/Configuration.xml', nodeKind: 'extension', label: 'EVOLC' });
    assert.deepStrictEqual(result, { extensionName: 'EVOLC' });
  });

  test('узел не задан (вызов из палитры) → undefined, чтобы сработал QuickPick', () => {
    assert.strictEqual(toDialogTarget(undefined), undefined);
  });

  test('неподходящий узел (обычный справочник) → undefined', () => {
    assert.strictEqual(toDialogTarget({ xmlPath: '/proj/src/cf/Catalogs/Банки.xml', nodeKind: 'Catalog', label: 'Банки' }), undefined);
  });
});

/**
 * `buildCfApplyTarget` — единственный источник знания о том, куда применять
 * изменения после загрузки CF/CFE. До правки ревью эта функция существовала в
 * ДВУХ копиях (UI и MCP), причём копия в UI лежала под `c8 ignore` и не была
 * покрыта вовсе, а раскладка проекта («src/cf», «src/cfe/<имя>») жила ещё и в
 * `infra/fs/ProjectLayout`. Расхождение копий означало бы применение к базе с
 * параметрами подключения от другой конфигурации — молча, без диагностики,
 * потому что `rootPath` определяет выбор файла настроек.
 *
 * Сравниваем объект целиком (`deepStrictEqual`), а не только `rootPath`: в
 * `runApplyDatabaseConfiguration` уходят все поля, и подмена `kind` или
 * `extensionName` так же увела бы операцию не туда.
 */
suite('buildCfApplyTarget — единая цель применения изменений к базе', () => {
  const root = path.join(path.sep, 'proj');

  test('основная конфигурация: kind=cf, путь src/cf, без extensionName', () => {
    assert.deepStrictEqual(buildCfApplyTarget(root, ''), {
      kind: 'cf',
      name: 'Основная конфигурация',
      rootPath: path.join(root, 'src', 'cf'),
    });
  });

  test('расширение: kind=cfe, путь src/cfe/<имя>, имя продублировано в extensionName', () => {
    assert.deepStrictEqual(buildCfApplyTarget(root, 'EVOLC'), {
      kind: 'cfe',
      name: 'EVOLC',
      rootPath: path.join(root, 'src', 'cfe', 'EVOLC'),
      extensionName: 'EVOLC',
    });
  });

  test('пробельное имя расширения трактуется как основная конфигурация, а не как расширение с пустым именем', () => {
    assert.deepStrictEqual(buildCfApplyTarget(root, '   '), {
      kind: 'cf',
      name: 'Основная конфигурация',
      rootPath: path.join(root, 'src', 'cf'),
    });
  });
});
