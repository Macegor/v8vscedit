/**
 * P1: контракт сообщений host → webview панели «Действия» (TreeSearch).
 *
 * `TreeSearchViewProvider` и `src-ui/apps/tree-search/TreeSearchApp.vue` должны
 * говорить на одном протоколе. Остальные панели (universal, subsystem) уже
 * используют вариант A — единый конверт `{ type: 'state', state: {...} }`
 * (см. `HostToUiMessage` в `src-ui/shared/protocol/hostMessages.ts`). Сейчас
 * `TreeSearchViewProvider.handleMessage` при обработке запроса поиска шлёт
 * рассинхронизированное сообщение `{ type: 'searchState', value: query }`,
 * которое `TreeSearchApp.vue` не понимает (слушает `type === 'state'` и читает
 * `msg.state.searchQuery`). В реальности после ввода текста в поиск строка
 * состояния во webview никогда не обновляется дальше первичного рендера —
 * баг воспроизводим сквозным путём "входящее сообщение webview → исходящий
 * postMessage хоста", без имитации самого факта вызова.
 *
 * `resolveWebviewView` вызывается по-настоящему (не заглушка): используется
 * реальный `WebviewHtmlFactory`, реально читающий собранный
 * `dist/ui/manifest.json` (тесты запускаются после `pretest`/`npm run build`).
 * Единственное, что физически невозможно получить в headless Extension Host
 * тесте, — это настоящий `vscode.WebviewView` от реальной панели (VS Code не
 * даёт публичного конструктора и не поднимает UI webview без видимого окна
 * панели). Поэтому `webview` реализован вручную как объект с реальной
 * семантикой (не фиксация факта вызова): `postMessage` действительно копит
 * историю сообщений, `asWebviewUri`/`cspSource` — реальные значения, как в
 * настоящем vscode.Webview.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConfigEntry } from '../../infra/fs/ConfigLocator';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { TreeSearchViewProvider } from '../../ui/views/search/TreeSearchViewProvider';

// Корень расширения нужен реальный (не заглушка) — WebviewAssetManifestReader
// читает настоящий dist/ui/manifest.json, собранный шагом pretest.
const EXTENSION_ROOT = path.resolve(__dirname, '../../../');

/**
 * Реальный (не заглушка ради покрытия) минимальный носитель состояния поиска
 * дерева — воспроизводит поведение `MetadataTreeProvider.setSearchQuery` /
 * `getSearchQuery` (фильтр короче 3 символов сбрасывается), без построения
 * полного дерева метаданных из файловой системы, которое здесь не участвует
 * в проверяемом поведении протокола.
 */
class FakeSearchStateTree {
  private query = '';

  setSearchQuery(value: string): void {
    const next = value.trim();
    this.query = next.length > 2 ? next : '';
  }

  getSearchQuery(): string {
    return this.query;
  }

  getEntries(): ConfigEntry[] {
    return [];
  }
}

/**
 * Реальный объект vscode.Webview собрать в headless-тесте нельзя (нужна
 * видимая панель) — единственная внешняя недоступная система в этом тесте.
 * `postMessage` и `html`/`options` реализованы с настоящей семантикой
 * (накопление истории, реальные Uri), а не как фиксация факта вызова.
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
    postMessage: (message: unknown) => {
      postedMessages.push(message);
      return Promise.resolve(true);
    },
    asWebviewUri: (uri: vscode.Uri) => uri,
  };

  return {
    webview,
    postedMessages,
    receiveMessage: async (message: unknown) => {
      messageEmitter.fire(message);
      // onDidReceiveMessage-обработчик у TreeSearchViewProvider асинхронный —
      // дожидаемся конца текущего микротаска, чтобы handleMessage завершился.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

suite('TreeSearchViewProvider — протокол host → webview (P1)', () => {
  let tree: FakeSearchStateTree;
  let provider: TreeSearchViewProvider;
  let fakeWebview: ReturnType<typeof createFakeWebview>;
  let treeMessages: (string | undefined)[];

  setup(() => {
    tree = new FakeSearchStateTree();
    treeMessages = [];
    fakeWebview = createFakeWebview();

    provider = new TreeSearchViewProvider(vscode.Uri.file(EXTENSION_ROOT), {
      treeProvider: tree as unknown as MetadataTreeProvider,
      setTreeMessage: (message) => treeMessages.push(message),
      isProjectInitialized: () => true,
      getStandaloneServerStatus: () =>
        ({
          configured: false,
          state: 'unconfigured',
          message: '',
          pid: null,
          url: null,
          settings: {
            ibsrvPath: '',
            platformPath: '',
            dataPath: '',
            databasePath: '',
            httpAddress: '',
            httpPort: 0,
            httpBase: '',
            name: '',
            distributeLicenses: 'deny',
            scheduleJobs: 'deny',
          },
          logPath: '',
        }),
    });

    const fakeWebviewView = {
      webview: fakeWebview.webview,
      visible: true,
      onDidChangeVisibility: new vscode.EventEmitter<void>().event,
      onDidDispose: new vscode.EventEmitter<void>().event,
    } as unknown as vscode.WebviewView;

    provider.resolveWebviewView(fakeWebviewView);
  });

  test('запрос поиска обновляет treeProvider.setSearchQuery реальным значением запроса', async () => {
    await fakeWebview.receiveMessage({ type: 'request', requestId: 'search', name: 'search', payload: 'foo' });

    // Критерий приёмки: применение поиска — реальный побочный эффект над
    // деревом, а не просто пересылка сообщения дальше.
    assert.strictEqual(tree.getSearchQuery(), 'foo');
  });

  test('хост отвечает конвертом {type: "state", state: {searchQuery}} — НЕ {type: "searchState", value}', async () => {
    await fakeWebview.receiveMessage({ type: 'request', requestId: 'search', name: 'search', payload: 'foo' });

    const stateMessages = fakeWebview.postedMessages.filter(
      (message): message is { type: string; state?: { searchQuery?: string } } =>
        typeof message === 'object' && message !== null && 'type' in message
    );

    // Красный ожидаемо: сейчас провайдер шлёт { type: 'searchState', value: 'foo' },
    // которое TreeSearchApp.vue не распознаёт (слушает только type === 'state').
    const stateMessage = stateMessages.find((message) => message.type === 'state');
    assert.ok(
      stateMessage,
      `Ожидалось сообщение с type === 'state', реально отправлены: ${JSON.stringify(fakeWebview.postedMessages)}`
    );
    assert.strictEqual(stateMessage.state?.searchQuery, 'foo');

    // Явно фиксируем отсутствие устаревшего конверта — если реализация
    // продолжит слать legacy-вариант параллельно с новым, тест должен упасть.
    const legacyMessage = fakeWebview.postedMessages.find(
      (message): message is { type: string } =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === 'searchState'
    );
    assert.strictEqual(legacyMessage, undefined, 'Устаревший конверт type: "searchState" не должен отправляться');
  });

  test('payload в форме объекта {query} применяется так же, как строковый payload', async () => {
    // Протокол поиска допускает payload либо строкой, либо объектом с полем
    // query (см. handleMessage: `typeof message.payload === 'string' ? ... : (payload as {query}).query ?? ''`).
    // Оба варианта должны приводить к одному и тому же побочному эффекту и
    // одному и тому же исходящему конверту состояния.
    await fakeWebview.receiveMessage({
      type: 'request',
      requestId: 'search',
      name: 'search',
      payload: { query: 'bar' },
    });

    assert.strictEqual(tree.getSearchQuery(), 'bar');

    const stateMessage = fakeWebview.postedMessages.find(
      (message): message is { type: string; state?: { searchQuery?: string } } =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === 'state'
    );
    assert.ok(stateMessage, 'Ожидалось сообщение состояния для объектного payload');
    assert.strictEqual(stateMessage.state?.searchQuery, 'bar');
  });

  test('payload в форме объекта без поля query приводит к пустому запросу (фоллбэк ?? \'\')', async () => {
    await fakeWebview.receiveMessage({
      type: 'request',
      requestId: 'search',
      name: 'search',
      payload: {},
    });

    assert.strictEqual(tree.getSearchQuery(), '');
  });

  test('короткий запрос (<=2 символов) сбрасывает фильтр дерева и не считается активным поиском', async () => {
    await fakeWebview.receiveMessage({ type: 'request', requestId: 'search', name: 'search', payload: 'аб' });

    // setSearchQuery у MetadataTreeProvider игнорирует строки короче 3
    // символов — состояние во webview должно синхронизироваться с этим же
    // инвариантом, а не с сырым введённым значением.
    assert.strictEqual(tree.getSearchQuery(), '');

    const stateMessage = fakeWebview.postedMessages.find(
      (message): message is { type: string; state?: { searchQuery?: string } } =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === 'state'
    );
    assert.ok(stateMessage, 'Ожидалось сообщение состояния даже при коротком запросе');
    assert.strictEqual(stateMessage.state?.searchQuery, '');
  });
});
