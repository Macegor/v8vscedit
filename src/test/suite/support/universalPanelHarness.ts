/**
 * Обвязка для тестов контекстного меню `UniversalPanelViewProvider`
 * (`getNodeActions` — приватный метод, поэтому он дёргается через единственный
 * публичный путь: `resolveWebviewView` встраивает начальное состояние дерева
 * (`rootNodes[].actions`) в HTML, а дочерние узлы приходят сообщением
 * `childrenLoaded` — то же самое, что делает `universalPanelCfFileMenu.test.ts`).
 *
 * Дерево строится РЕАЛЬНЫМ `MetadataTreeProvider` над двумя настоящими
 * фикстурами `example/` — основной конфигурацией 2.20 и расширением EVOLC 2.21
 * (полная 2.21-конфигурация — 44 000+ объектов, разбор которых несопоставим с
 * задачей теста). Единственная внешняя недоступная система — сам `WebviewView`:
 * в headless-хосте видимой панели нет, поэтому `webview` реализован вручную с
 * настоящей семантикой (`postMessage` копит историю).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ConfigEntry } from '../../../infra/fs/ConfigLocator';
import { GitMetadataStatusService } from '../../../infra/git/GitMetadataStatusService';
import { MetadataTreeProvider } from '../../../ui/tree/MetadataTreeProvider';
import { UniversalPanelViewProvider } from '../../../ui/views/universal/UniversalPanelViewProvider';

const EXTENSION_ROOT = path.resolve(__dirname, '../../../../');
const CF_ROOT = path.resolve(EXTENSION_ROOT, 'example/2.20/src/cf');
const CFE_EVOLC_ROOT = path.resolve(EXTENSION_ROOT, 'example/2.21/src/cfe/EVOLC');

export interface ActionDto {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly icon?: { readonly kind: string; readonly name?: string };
}

export interface TreeNodeDtoLike {
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

export interface UniversalPanelFixture {
  readonly rootNodes: readonly TreeNodeDtoLike[];
  /** Загружает дочерние узлы через протокол webview и возвращает их (как это делает UI при раскрытии). */
  loadChildren(nodeId: string): Promise<readonly TreeNodeDtoLike[]>;
  dispose(): void;
}

/**
 * Ждёт появления значения, опрашивая очередь микрозадач: возвращает управление
 * сразу, как только условие выполнено. Тайм-аут — страховка от зависания
 * (тест должен падать с внятным текстом, а не висеть), а не единица ожидания.
 */
async function waitFor<T>(probe: () => T | undefined, failureMessage: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(failureMessage);
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createFakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T): T => (store.has(key) ? (store.get(key) as T) : (defaultValue as T)),
    update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); },
    keys: () => [...store.keys()],
  };
}

function extractInitialState(html: string): InitialStateLike {
  const match = /<script[^>]*id="v8vscedit-initial-state"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) {
    throw new Error(`в HTML не найден блок начального состояния: ${html.slice(0, 200)}...`);
  }
  return JSON.parse(match[1]) as InitialStateLike;
}

export function createUniversalPanelFixture(): UniversalPanelFixture {
  const cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-universal-panel-')));
  const entries: ConfigEntry[] = [
    { kind: 'cf', rootPath: CF_ROOT },
    { kind: 'cfe', rootPath: CFE_EVOLC_ROOT },
  ];
  const treeProvider = new MetadataTreeProvider(entries, vscode.Uri.file(EXTENSION_ROOT), cacheRoot);

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

  const provider = new UniversalPanelViewProvider(vscode.Uri.file(EXTENSION_ROOT), {
    state: createFakeMemento(),
    treeProvider,
    setTreeMessage: () => undefined,
    isProjectInitialized: () => true,
    getStandaloneServerStatus: () => standaloneStatus,
    refreshStandaloneServerStatus: () => Promise.resolve(standaloneStatus),
    getProcessingState: () => ({ active: false }),
    gitMetadataStatusService: new GitMetadataStatusService(EXTENSION_ROOT),
    refreshActionsView: () => undefined,
  });

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
  const webviewView = {
    webview,
    visible: true,
    onDidChangeVisibility: new vscode.EventEmitter<void>().event,
    onDidDispose: new vscode.EventEmitter<void>().event,
  } as unknown as vscode.WebviewView;
  provider.resolveWebviewView(webviewView);
  const initialState = extractInitialState(webview.html);

  let requestCounter = 0;
  return {
    rootNodes: initialState.state.rootNodes,
    loadChildren: async (nodeId: string) => {
      requestCounter += 1;
      messageEmitter.fire({ type: 'request', requestId: `load-${String(requestCounter)}`, name: 'loadChildren', payload: { nodeId } });
      // Провайдер шлёт детей НЕСКОЛЬКИМИ чанками асинхронно и закрывает серию
      // чанком `done: true`. Ждём именно его, а не «достаточную» паузу: пауза
      // угадывает тайминг и на загруженной машине даёт флейк, причём молчаливый
      // — тест увидел бы часть детей и счёл её полным ответом.
      const finalChunk = await waitFor(
        () => postedMessages.find(
          (item): item is ChildrenLoadedMessage =>
            typeof item === 'object' && item !== null
            && (item as { type?: string }).type === 'childrenLoaded'
            && (item as { nodeId?: string }).nodeId === nodeId
            && (item as { done?: boolean }).done === true
        ),
        `не получено завершающее сообщение childrenLoaded (done) для узла ${nodeId}`
      );
      const children = postedMessages.filter(
        (item): item is ChildrenLoadedMessage =>
          typeof item === 'object' && item !== null
          && (item as { type?: string }).type === 'childrenLoaded'
          && (item as { nodeId?: string }).nodeId === nodeId
      ).flatMap((message) => [...message.children]);
      return children.length > 0 ? children : [...finalChunk.children];
    },
    dispose: () => {
      treeProvider.dispose();
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    },
  };
}
