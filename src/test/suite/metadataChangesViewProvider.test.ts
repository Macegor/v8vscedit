/**
 * ПИВОТ: представление «Изменения метаданных» переходит с нативного TreeView
 * на webview `v8vsceditChanges`, переиспользующий Vue-дерево универсальной
 * панели (та же DTO-модель, что строит `changesDtoBuilder`), со SCM-шапкой
 * (сообщение коммита, кнопки commit/refresh/stage-all). Движок ВЕХИ 1
 * (`infra/git/*`, `ui/git/OnecGitContentProvider`) не меняется — провайдер
 * лишь оборачивает его в протокол webview.
 *
 * Стиль теста — по образцу `treeSearchViewProvider.test.ts`: реальный
 * `vscode.WebviewView` собрать в headless Extension Host нельзя (нет видимой
 * панели) — единственная внешняя недоступная система здесь, поэтому `webview`
 * реализован вручную с настоящей семантикой (`postMessage` копит историю,
 * `onDidReceiveMessage` — реальный `vscode.EventEmitter`). Все git-эффекты
 * (`stage`/`unstage`/`discard`/`commit`) проверяются РЕАЛЬНЫМ git через
 * `changesFixtures.statusOf`/`git log`, а не стабами.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findConfigurations, type ConfigEntry } from '../../infra/fs/ConfigLocator';
import { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { ONEC_GIT_SCHEME } from '../../ui/git/OnecGitContentProvider';
// ПИВОТ, новый webview-провайдер представления «Изменения метаданных».
// Модуль ещё не реализован.
import {
  MetadataChangesViewProvider,
  type MetadataChangesViewServices,
} from '../../ui/views/changes/MetadataChangesViewProvider';
import type { ChangesViewState, TreeNodeDto } from '../../ui/views/changes/changesDtoBuilder';
import {
  appendLine,
  buildChangesBaselineRepo,
  git,
  removeFixtureRepo,
  statusOf,
  type ChangesFixture,
} from './support/changesFixtures';

// Корень расширения нужен реальный — WebviewHtmlFactory читает настоящий
// dist/ui/manifest.json, собранный шагом pretest (см. treeSearchViewProvider.test.ts).
const EXTENSION_ROOT = path.resolve(__dirname, '../../../');

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
      // Обработчик у провайдера асинхронный (git-мутации/перепостройка модели) —
      // дожидаемся конца микротаска, чтобы handleMessage успел завершиться.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** Находит узел (рекурсивно среди children) по предикату во всех трёх секциях. */
function findNode(
  state: ChangesViewState,
  predicate: (node: TreeNodeDto) => boolean
): TreeNodeDto | undefined {
  const visit = (nodes: readonly TreeNodeDto[]): TreeNodeDto | undefined => {
    for (const node of nodes) {
      if (predicate(node)) {
        return node;
      }
      if (node.children) {
        const found = visit(node.children);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  return visit(state.staged.nodes) ?? visit(state.unstaged.nodes) ?? visit(state.unresolved.nodes);
}

/**
 * Зеркало приватной `NODE_ID_RE` из `changesDtoBuilder.ts` (см. обоснование
 * в `changesTreeAssembler.test.ts`) — здесь используется, чтобы отличить
 * actionable-лист (объект/часть) от промежуточного group-узла навигаторной
 * иерархии («Общие», «Общие модули», «Справочники» и т.п.) по одной только
 * форме `id`, без знания конкретной реализации сборщика дерева.
 */
const ACTIONABLE_NODE_ID_RE = /^(staged|unstaged|other)#(\d+)(?:\.(\d+))?$/;

/** Собирает ВСЕ узлы дерева (рекурсивно, все уровни) — для дедупа/поиска по меткам. */
function collectAllNodes(nodes: readonly TreeNodeDto[]): TreeNodeDto[] {
  const result: TreeNodeDto[] = [];
  const visit = (list: readonly TreeNodeDto[]): void => {
    for (const node of list) {
      result.push(node);
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return result;
}

/** Ищет ПЕРВЫЙ узел с данной меткой где угодно в лесе (без привязки к уровню вложенности). */
function findNodeByLabel(nodes: readonly TreeNodeDto[], label: string): TreeNodeDto | undefined {
  return collectAllNodes(nodes).find((n) => n.label === label);
}

/** Ищет узел с данной меткой СРЕДИ ПОТОМКОВ переданного узла (проверка реальной вложенности). */
function findDescendantByLabel(node: TreeNodeDto, label: string): TreeNodeDto | undefined {
  return collectAllNodes(node.children ?? []).find((n) => n.label === label);
}

/**
 * Строит реальный `MetadataTreeProvider` над кэшем метаданных фикстуры —
 * источник навигаторной иерархии, которую обязана повторять панель «Изменения
 * метаданных». Кэш (`.v8vscedit/meta/*.json`) кладётся В ОТДЕЛЬНОМ temp-каталоге
 * ВНЕ git-репозитория фикстуры: иначе он попал бы в `git status` как untracked
 * файл и ломал бы точные проверки количества «Прочих» изменений в других тестах.
 */
function createTreeProvider(entries: ConfigEntry[]): { treeProvider: MetadataTreeProvider; dispose: () => void } {
  const cacheRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-changes-treecache-')));
  const treeProvider = new MetadataTreeProvider(entries, vscode.Uri.file(EXTENSION_ROOT), cacheRoot);
  return {
    treeProvider,
    dispose: () => {
      treeProvider.dispose();
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    },
  };
}

function stateMessages(posted: readonly unknown[]): ChangesViewState[] {
  return posted
    .filter((m): m is { type: string; state: ChangesViewState } =>
      typeof m === 'object' && m !== null && (m as { type?: string }).type === 'state')
    .map((m) => m.state);
}

function lastState(posted: readonly unknown[]): ChangesViewState {
  const states = stateMessages(posted);
  assert.ok(states.length > 0, `ожидалось хотя бы одно сообщение состояния, отправлены: ${JSON.stringify(posted)}`);
  return states[states.length - 1];
}

suite('MetadataChangesViewProvider — webview-презентация представления «Изменения метаданных»', () => {
  let fixture: ChangesFixture;
  let provider: MetadataChangesViewProvider;
  let fakeWebview: ReturnType<typeof createFakeWebview>;
  let services: MetadataChangesViewServices;
  let treeProvider: MetadataTreeProvider;
  let disposeTreeProvider: () => void;
  // Позволяет отдельным тестам подменить состав корней выгрузки (updateConfigRoots)
  // без переприсваивания readonly-поля services.getConfigRoots.
  let configRootsOverride: ChangesFixture['configRoots'] | undefined;

  let originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  let originalShowInputBox: typeof vscode.window.showInputBox;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  const windowRef = vscode.window as { showWarningMessage: typeof vscode.window.showWarningMessage; showInputBox: typeof vscode.window.showInputBox };
  const commandsRef = vscode.commands as { executeCommand: typeof vscode.commands.executeCommand };

  let warningCalls: unknown[][];
  let warningResolution: string | undefined;
  let inputBoxCalls: number;
  let executeCommandCalls: unknown[][];

  setup(() => {
    fixture = buildChangesBaselineRepo();
    configRootsOverride = undefined;
    const builtTreeProvider = createTreeProvider(fixture.configRoots);
    treeProvider = builtTreeProvider.treeProvider;
    disposeTreeProvider = builtTreeProvider.dispose;
    services = {
      gitRoot: fixture.gitRoot,
      getConfigRoots: () => configRootsOverride ?? fixture.configRoots,
      treeProvider,
    };

    warningCalls = [];
    warningResolution = undefined;
    inputBoxCalls = 0;
    executeCommandCalls = [];

    originalShowWarningMessage = vscode.window.showWarningMessage;
    originalShowInputBox = vscode.window.showInputBox;
    originalExecuteCommand = vscode.commands.executeCommand;

    windowRef.showWarningMessage = ((message: string, ...rest: unknown[]) => {
      warningCalls.push([message, ...rest]);
      return Promise.resolve(warningResolution);
    });

    windowRef.showInputBox = (() => {
      inputBoxCalls += 1;
      return Promise.resolve(undefined);
    });

    commandsRef.executeCommand = ((command: string, ...rest: unknown[]) => {
      executeCommandCalls.push([command, ...rest]);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;

    provider = new MetadataChangesViewProvider(vscode.Uri.file(EXTENSION_ROOT), services);
    fakeWebview = createFakeWebview();
  });

  teardown(() => {
    windowRef.showWarningMessage = originalShowWarningMessage;
    windowRef.showInputBox = originalShowInputBox;
    commandsRef.executeCommand = originalExecuteCommand;
    disposeTreeProvider();
    removeFixtureRepo(fixture);
  });

  function resolve(): void {
    const fakeWebviewView = {
      webview: fakeWebview.webview,
      visible: true,
      onDidChangeVisibility: new vscode.EventEmitter<void>().event,
      onDidDispose: new vscode.EventEmitter<void>().event,
    } as unknown as vscode.WebviewView;
    provider.resolveWebviewView(fakeWebviewView);
  }

  test('CSP отрендеренного HTML разрешает изображения (иконки метаданных грузятся как background-image)', () => {
    appendLine(fixture.objectModuleBsl, '// правка');

    resolve();

    // Иконки узлов рисуются через background-image: url(webview-uri) в общем
    // компоненте дерева; без директивы img-src их заблокирует default-src 'none'.
    const html = fakeWebview.webview.html;
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
    assert.ok(csp.includes('img-src'), `CSP должен содержать img-src для иконок, получено: ${csp}`);
  });

  test('resolveWebviewView не бросает и постит state с секциями staged/unstaged/unresolved по внесённым правкам', () => {
    appendLine(fixture.objectModuleBsl, '// staged-правка модуля объекта');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    fs.rmSync(fixture.formXml);

    assert.doesNotThrow(() => resolve());

    const state = lastState(fakeWebview.postedMessages);
    assert.strictEqual(state.staged.nodes.length, 1, 'ожидался один застейдженный объект');
    assert.strictEqual(state.unstaged.nodes.length, 1, 'ожидался один unstaged-объект (удалённая форма)');
    assert.strictEqual(state.unresolved.nodes.length, 0);
    assert.strictEqual(state.canCommit, true);
  });

  test('команда stage реально индексирует файл узла и провайдер пере-постит state', async () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка модуля объекта');
    resolve();
    const before = lastState(fakeWebview.postedMessages);
    const unstagedNode = findNode(before, (n) => n.label === 'МодульОбъекта');
    assert.ok(unstagedNode, 'ожидалась часть «МодульОбъекта» в unstaged');
    const postedBefore = fakeWebview.postedMessages.length;

    await fakeWebview.receiveMessage({ type: 'command', command: 'stage', payload: { nodeId: unstagedNode.id } });

    const relPath = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    assert.strictEqual(statusOf(fixture.gitRoot, relPath), `M  ${relPath}`, 'файл должен реально проиндексироваться');
    assert.ok(fakeWebview.postedMessages.length > postedBefore, 'после stage должен быть отправлен обновлённый state');

    const after = lastState(fakeWebview.postedMessages);
    assert.strictEqual(after.staged.nodes.length, 1, 'объект должен переместиться в staged');
    assert.strictEqual(after.unstaged.nodes.length, 0, 'unstaged должен опустеть');
  });

  test('команда unstage возвращает застейдженный файл в рабочее дерево, не теряя правку', async () => {
    appendLine(fixture.objectModuleBsl, '// правка, которую застейджим вручную');
    const relPath = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    git(fixture.gitRoot, ['add', relPath]);
    resolve();
    const before = lastState(fakeWebview.postedMessages);
    const stagedNode = findNode(before, (n) => n.label === 'МодульОбъекта');
    assert.ok(stagedNode, 'ожидалась застейдженная часть «МодульОбъекта»');

    await fakeWebview.receiveMessage({ type: 'command', command: 'unstage', payload: { nodeId: stagedNode.id } });

    assert.strictEqual(statusOf(fixture.gitRoot, relPath), ` M ${relPath}`);
    const after = lastState(fakeWebview.postedMessages);
    assert.strictEqual(after.staged.nodes.length, 0);
    assert.strictEqual(after.unstaged.nodes.length, 1);
  });

  test('команда discard с подтверждением откатывает modified-файл к HEAD', async () => {
    const baseline = fs.readFileSync(fixture.objectModuleBsl, 'utf-8');
    appendLine(fixture.objectModuleBsl, '// локальная правка на отмену');
    resolve();
    const before = lastState(fakeWebview.postedMessages);
    const node = findNode(before, (n) => n.label === 'МодульОбъекта');
    assert.ok(node);

    // Подтверждение — реальный побочный эффект: стаб `showWarningMessage`
    // отвечает последним переданным пунктом (симулирует клик по кнопке
    // подтверждения, каким бы текстом её ни назвал разработчик).
    windowRef.showWarningMessage = ((message: string, ...rest: unknown[]) => {
      warningCalls.push([message, ...rest]);
      const lastStringItem = [...rest].reverse().find((item): item is string => typeof item === 'string');
      return Promise.resolve(lastStringItem);
    });

    await fakeWebview.receiveMessage({ type: 'command', command: 'discard', payload: { nodeId: node.id } });

    assert.strictEqual(fs.readFileSync(fixture.objectModuleBsl, 'utf-8'), baseline, 'файл должен вернуться к HEAD');
    assert.strictEqual(warningCalls.length, 1, 'discard обязан спрашивать подтверждение перед необратимой отменой');
  });

  test('discard без подтверждения (пользователь отменил диалог) НЕ трогает файл', async () => {
    const baseline = fs.readFileSync(fixture.objectModuleBsl, 'utf-8');
    appendLine(fixture.objectModuleBsl, '// правка, которая должна уцелеть');
    const modified = fs.readFileSync(fixture.objectModuleBsl, 'utf-8');
    resolve();
    const before = lastState(fakeWebview.postedMessages);
    const node = findNode(before, (n) => n.label === 'МодульОбъекта');
    assert.ok(node);

    warningResolution = undefined; // пользователь закрыл диалог без подтверждения

    await fakeWebview.receiveMessage({ type: 'command', command: 'discard', payload: { nodeId: node.id } });

    assert.strictEqual(fs.readFileSync(fixture.objectModuleBsl, 'utf-8'), modified, 'без подтверждения правка должна остаться нетронутой');
    assert.notStrictEqual(modified, baseline);
  });

  test('команда commit коммитит застейдженное с сообщением из payload, без showInputBox', async () => {
    appendLine(fixture.objectModuleBsl, '// правка для коммита');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    resolve();

    const beforeLog = git(fixture.gitRoot, ['log', '--oneline']).trim().split('\n').length;
    await fakeWebview.receiveMessage({
      type: 'command',
      command: 'commit',
      payload: { message: 'коммит из панели изменений метаданных' },
    });

    const afterLog = git(fixture.gitRoot, ['log', '--oneline']).trim().split('\n').length;
    assert.strictEqual(afterLog, beforeLog + 1, 'должен появиться ровно один новый коммит');
    assert.strictEqual(
      git(fixture.gitRoot, ['log', '-1', '--pretty=%s']).trim(),
      'коммит из панели изменений метаданных'
    );
    assert.strictEqual(inputBoxCalls, 0, 'сообщение коммита приходит из payload, а не через showInputBox');
  });

  test('unstaged-часть: openDiff открывает diff слева onec-git(index), справа file:// рабочего файла', async () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка для diff');
    resolve();
    const state = lastState(fakeWebview.postedMessages);
    const node = findNode(state, (n) => n.label === 'МодульОбъекта');
    assert.ok(node);

    await fakeWebview.receiveMessage({ type: 'command', command: 'openDiff', payload: { nodeId: node.id } });

    assert.strictEqual(executeCommandCalls.length, 1);
    const [cmdName, leftUri, rightUri] = executeCommandCalls[0] as [string, vscode.Uri, vscode.Uri];
    assert.strictEqual(cmdName, 'vscode.diff');
    assert.strictEqual(leftUri.scheme, ONEC_GIT_SCHEME);
    assert.ok(leftUri.query.includes('ref=index'), `unstaged слева сравнивается с индексом, query=${leftUri.query}`);
    assert.strictEqual(rightUri.scheme, 'file');
    assert.strictEqual(rightUri.fsPath, fixture.objectModuleBsl);
  });

  test('staged-часть: openDiff — обе стороны onec-git (HEAD слева, index справа), а не рабочий файл', async () => {
    appendLine(fixture.objectModuleBsl, '// staged-правка для diff');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    resolve();
    const state = lastState(fakeWebview.postedMessages);
    const node = findNode(state, (n) => n.label === 'МодульОбъекта');
    assert.ok(node);

    await fakeWebview.receiveMessage({ type: 'command', command: 'openDiff', payload: { nodeId: node.id } });

    const [, leftUri, rightUri] = executeCommandCalls[0] as [string, vscode.Uri, vscode.Uri];
    assert.strictEqual(leftUri.scheme, ONEC_GIT_SCHEME);
    assert.ok(leftUri.query.includes('ref=HEAD'), `staged слева сравнивается с HEAD, query=${leftUri.query}`);
    assert.strictEqual(rightUri.scheme, ONEC_GIT_SCHEME, 'staged справа — index-blob, а не рабочий файл');
    assert.ok(rightUri.query.includes('ref=index'), `staged справа — индекс, query=${rightUri.query}`);
  });

  test('без явного refresh модель не пересчитывается; команда refresh пересчитывает её и пере-постит state', async () => {
    resolve();
    const postedAfterResolve = fakeWebview.postedMessages.length;

    // Внешняя правка рабочего дерева ПОСЛЕ первичного postState — до refresh
    // провайдер о ней не знает и не обязан спонтанно пересчитывать модель.
    appendLine(fixture.objectModuleBsl, '// правка после первичного state, до refresh');
    await new Promise((resolve2) => setTimeout(resolve2, 0));
    assert.strictEqual(
      fakeWebview.postedMessages.length,
      postedAfterResolve,
      'провайдер не должен спонтанно пересчитывать модель без явной команды refresh'
    );

    await fakeWebview.receiveMessage({ type: 'command', command: 'refresh' });

    assert.ok(fakeWebview.postedMessages.length > postedAfterResolve, 'refresh должен отправить обновлённый state');
    const after = lastState(fakeWebview.postedMessages);
    const node = findNode(after, (n) => n.label === 'МодульОбъекта');
    assert.ok(node, 'после refresh новая правка должна отразиться в состоянии');
  });

  test('updateConfigRoots пересчитывает модель (новый корень выгрузки) и пере-постит state', () => {
    resolve();
    const postedAfterResolve = fakeWebview.postedMessages.length;

    // Второй корень выгрузки появляется ПОСЛЕ первичного resolve — до
    // updateConfigRoots провайдер о нём не знает (модель считается лениво).
    const secondCfRoot = path.join(fixture.workspaceRoot, 'second', 'src', 'cf');
    fs.mkdirSync(path.join(secondCfRoot, 'Catalogs'), { recursive: true });
    fs.cpSync(fixture.cfRoot, secondCfRoot, { recursive: true });
    git(fixture.gitRoot, ['add', '-A']);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'второй корень выгрузки']);
    fs.appendFileSync(
      path.join(secondCfRoot, 'Catalogs', 'ПричиныВозврата', 'Ext', 'ObjectModule.bsl'),
      '\n// правка во втором корне\n',
      'utf-8',
    );
    configRootsOverride = [
      ...fixture.configRoots,
      ...findConfigurations(path.join(fixture.workspaceRoot, 'second')),
    ];

    provider.updateConfigRoots();

    assert.ok(fakeWebview.postedMessages.length > postedAfterResolve, 'updateConfigRoots должен пере-постить state');
    const after = lastState(fakeWebview.postedMessages);
    assert.strictEqual(after.unstaged.nodes.length, 1, 'правка во втором корне должна попасть в пересчитанную модель');
  });

  test('handleMessage игнорирует сообщения не типа command (например, служебные ui→host из другого канала)', async () => {
    resolve();
    const postedBefore = fakeWebview.postedMessages.length;

    await fakeWebview.receiveMessage({ type: 'ready', command: 'stage', payload: { nodeId: 'staged#0' } });

    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore, 'сообщение не типа command не должно вызывать пересчёт/действие');
  });

  test('handleMessage с неизвестной командой — мягкий no-op (default-ветка)', async () => {
    resolve();
    const postedBefore = fakeWebview.postedMessages.length;

    await fakeWebview.receiveMessage({ type: 'command', command: 'unknownCommand' });

    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore, 'неизвестная команда не должна ничего менять');
  });

  test('stage с невалидным/отсутствующим nodeId — мягкий no-op, без git-эффектов', async () => {
    appendLine(fixture.objectModuleBsl, '// правка, которая не должна быть тронута');
    resolve();
    const postedBefore = fakeWebview.postedMessages.length;
    const relPath = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    const statusBefore = statusOf(fixture.gitRoot, relPath);

    await fakeWebview.receiveMessage({ type: 'command', command: 'stage', payload: {} });
    await fakeWebview.receiveMessage({ type: 'command', command: 'stage', payload: { nodeId: 'not-a-node-id' } });

    assert.strictEqual(statusOf(fixture.gitRoot, relPath), statusBefore, 'файл не должен быть тронут при невалидном nodeId');
    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore, 'при раннем return не должно быть повторного postState');
  });

  test('unstage с невалидным nodeId — мягкий no-op, без git-эффектов', async () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    resolve();
    const postedBefore = fakeWebview.postedMessages.length;
    const relPath = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    const statusBefore = statusOf(fixture.gitRoot, relPath);

    await fakeWebview.receiveMessage({ type: 'command', command: 'unstage', payload: { nodeId: 'other#999' } });

    assert.strictEqual(statusOf(fixture.gitRoot, relPath), statusBefore, 'файл должен остаться застейдженным при невалидном nodeId');
    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore);
  });

  test('discard с невалидным nodeId — мягкий no-op, диалог подтверждения не показывается', async () => {
    const baseline = fs.readFileSync(fixture.objectModuleBsl, 'utf-8');
    appendLine(fixture.objectModuleBsl, '// правка, которая должна уцелеть');
    resolve();
    const postedBefore = fakeWebview.postedMessages.length;

    await fakeWebview.receiveMessage({ type: 'command', command: 'discard', payload: { nodeId: 'unstaged#999' } });

    assert.strictEqual(warningCalls.length, 0, 'без адреса подтверждение необратимого действия запрашивать не за чем');
    assert.notStrictEqual(fs.readFileSync(fixture.objectModuleBsl, 'utf-8'), baseline, 'локальная правка должна уцелеть');
    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore);
  });

  test('commit с пустым/пробельным сообщением НЕ коммитит и не сбрасывает staged', async () => {
    appendLine(fixture.objectModuleBsl, '// staged-правка, которая должна остаться в индексе');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    resolve();
    const beforeLog = git(fixture.gitRoot, ['log', '--oneline']).trim().split('\n').length;
    const postedBefore = fakeWebview.postedMessages.length;

    await fakeWebview.receiveMessage({ type: 'command', command: 'commit', payload: { message: '   ' } });
    await fakeWebview.receiveMessage({ type: 'command', command: 'commit', payload: {} });

    const afterLog = git(fixture.gitRoot, ['log', '--oneline']).trim().split('\n').length;
    assert.strictEqual(afterLog, beforeLog, 'пустое/пробельное сообщение не должно порождать коммит');
    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore, 'без реального коммита state не должен пере-поститься');
    const relPath = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    assert.strictEqual(statusOf(fixture.gitRoot, relPath), `M  ${relPath}`, 'файл должен остаться застейдженным');
  });

  test('openDiff с невалидным nodeId — vscode.diff не вызывается', async () => {
    resolve();

    await fakeWebview.receiveMessage({ type: 'command', command: 'openDiff', payload: { nodeId: 'staged#999' } });

    assert.strictEqual(executeCommandCalls.length, 0);
  });

  test('openDiff по объектному узлу (несколько файлов, single=false) — vscode.diff не вызывается', async () => {
    // У объекта две изменённые части (макет добавлен, модуль объекта правится) — objectNode.single=false.
    const templateDir = path.join(fixture.catalogsDir, 'ПричиныВозврата', 'Templates', 'Т3', 'Ext');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'Template.xml'), 'макет\n', 'utf-8');
    appendLine(fixture.objectModuleBsl, '// вторая изменённая часть того же объекта');
    resolve();
    const state = lastState(fakeWebview.postedMessages);
    // Узел объекта теперь вложен в навигаторную иерархию («Справочники» → …),
    // а не лежит на верхнем уровне секции — ищем рекурсивно по всему дереву.
    const objectNode = findNode(state, (n) => n.kind === 'changeObject');
    assert.ok(objectNode);
    assert.ok(objectNode.children && objectNode.children.length > 1, 'предусловие: у объекта должно быть больше одной изменённой части');

    await fakeWebview.receiveMessage({ type: 'command', command: 'openDiff', payload: { nodeId: objectNode.id } });

    assert.strictEqual(executeCommandCalls.length, 0, 'diff для составного (не single) объектного узла не открывается');
  });

  test('buildIcon: пустой webview-URI (falsy toString) даёт kind=none без исключения', () => {
    appendLine(fixture.objectModuleBsl, '// изменение, чтобы был хотя бы один объектный узел');
    // Реальный asWebviewUri из WebviewHtmlFactory (dist/ui/...) отрабатывает как
    // обычно — фальшивый результат подставляется ТОЛЬКО для запроса иконки
    // объекта (src/icons/...), чтобы не сломать сборку самого HTML.
    const mutableWebview = fakeWebview.webview as unknown as { asWebviewUri: (uri: vscode.Uri) => vscode.Uri };
    const originalAsWebviewUri = mutableWebview.asWebviewUri.bind(fakeWebview.webview);
    mutableWebview.asWebviewUri = (uri: vscode.Uri) =>
      uri.fsPath.includes(`${path.sep}icons${path.sep}`)
        ? (({ toString: () => '' }) as unknown as vscode.Uri)
        : originalAsWebviewUri(uri);

    assert.doesNotThrow(() => resolve());

    const state = lastState(fakeWebview.postedMessages);
    // Объектный узел теперь вложен в навигаторную иерархию — ищем рекурсивно.
    const objectNode = findNode(state, (n) => n.kind === 'changeObject');
    assert.ok(objectNode, 'для проверки иконки нужен хотя бы один объектный узел');
    assert.strictEqual(objectNode.icon?.kind, 'none');
  });

  test('buildIcon: исключение при получении webview-URI перехватывается — kind=none', () => {
    appendLine(fixture.objectModuleBsl, '// изменение, чтобы был хотя бы один объектный узел');
    const mutableWebview = fakeWebview.webview as unknown as { asWebviewUri: (uri: vscode.Uri) => vscode.Uri };
    const originalAsWebviewUri = mutableWebview.asWebviewUri.bind(fakeWebview.webview);
    mutableWebview.asWebviewUri = (uri: vscode.Uri) => {
      if (uri.fsPath.includes(`${path.sep}icons${path.sep}`)) {
        throw new Error('нет доступа к webview-ресурсам (тестовый сбой)');
      }
      return originalAsWebviewUri(uri);
    };

    assert.doesNotThrow(() => resolve());

    const state = lastState(fakeWebview.postedMessages);
    const objectNode = findNode(state, (n) => n.kind === 'changeObject');
    assert.ok(objectNode);
    assert.strictEqual(objectNode.icon?.kind, 'none');
  });

  // ─── Навигаторная иерархия внутри секций (доработка ВЕХИ 2) ─────────────
  //
  // Дерево внутри staged/unstaged обязано повторять НАВИГАТОРНУЮ иерархию
  // основного дерева конфигурации («Общее → Общие модули → модуль»,
  // «Справочники → Имя → части»), обрезанную по изменённым объектам, а не
  // быть плоским списком объектов на верхнем уровне секции (см. устранённое
  // известное ограничение в `docs/git-metadata-changes.md`).

  test('изменение общего модуля — навигаторная иерархия «Общие → Общие модули → объект → Модуль»', () => {
    appendLine(fixture.commonModuleBsl, '// unstaged-правка общего модуля');

    resolve();

    const state = lastState(fakeWebview.postedMessages);
    const commonGroup = findNodeByLabel(state.unstaged.nodes, 'Общие');
    assert.ok(commonGroup, `ожидался узел-коллекция «Общие» где-либо в дереве секции, получено: ${JSON.stringify(state.unstaged.nodes)}`);
    const commonModulesGroup = findDescendantByLabel(commonGroup, 'Общие модули');
    assert.ok(commonModulesGroup, 'ожидался узел-коллекция «Общие модули» среди потомков «Общие»');
    const objectNode = findDescendantByLabel(commonModulesGroup, 'GoogleПереводчик');
    assert.ok(objectNode, `ожидался объектный узел общего модуля внутри «Общие модули», получено: ${JSON.stringify(commonModulesGroup.children)}`);
    const modulePart = objectNode.children?.find((n) => n.label === 'Модуль');
    assert.ok(modulePart, `ожидалась часть «Модуль», получено: ${JSON.stringify(objectNode.children)}`);
    assert.strictEqual(modulePart.gitStatus, 'modified');

    // id листа обязан парситься resolveChangeAddress (actionable-узел), а
    // group-узлы навигаторной иерархии — НЕТ (действие на них — no-op).
    assert.ok(ACTIONABLE_NODE_ID_RE.test(objectNode.id), `id объектного узла обязан соответствовать схеме actionable-узла, получено: ${objectNode.id}`);
    assert.ok(!ACTIONABLE_NODE_ID_RE.test(commonGroup.id), 'id group-узла «Общие» не должен совпадать со схемой actionable-узла');
    assert.ok(!ACTIONABLE_NODE_ID_RE.test(commonModulesGroup.id), 'id group-узла «Общие модули» не должен совпадать со схемой actionable-узла');
  });

  test('изменение справочника (модуль объекта + модуль команды) — «Справочники → ПричиныВозврата → 2 части»; stage объектного узла индексирует ОБА файла', async () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка модуля объекта');
    appendLine(fixture.commandModuleBsl, '// unstaged-правка модуля команды');

    resolve();

    const before = lastState(fakeWebview.postedMessages);
    const catalogsGroup = findNodeByLabel(before.unstaged.nodes, 'Справочники');
    assert.ok(catalogsGroup, `ожидался узел-коллекция «Справочники», получено: ${JSON.stringify(before.unstaged.nodes)}`);
    const objectNode = findDescendantByLabel(catalogsGroup, 'ПричиныВозврата');
    assert.ok(objectNode, 'ожидался объектный узел «ПричиныВозврата» под «Справочники»');
    assert.strictEqual(objectNode.children?.length, 2, 'у объекта должно быть ровно две изменённые части (модуль объекта + модуль команды)');

    await fakeWebview.receiveMessage({ type: 'command', command: 'stage', payload: { nodeId: objectNode.id } });

    const relModule = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    const relCommand = path.relative(fixture.gitRoot, fixture.commandModuleBsl);
    assert.strictEqual(statusOf(fixture.gitRoot, relModule), `M  ${relModule}`, 'модуль объекта должен реально проиндексироваться');
    assert.strictEqual(statusOf(fixture.gitRoot, relCommand), `M  ${relCommand}`, 'модуль команды должен реально проиндексироваться');

    const after = lastState(fakeWebview.postedMessages);
    const stagedCatalogs = findNodeByLabel(after.staged.nodes, 'Справочники');
    assert.ok(stagedCatalogs, 'после stage объект должен переместиться под «Справочники» в staged');
    const stagedObject = findDescendantByLabel(stagedCatalogs, 'ПричиныВозврата');
    assert.ok(stagedObject);
    assert.strictEqual(stagedObject.children?.length, 2, 'обе части должны переехать в staged вместе (stage объектного узла — по ВСЕМ его файлам)');
    assert.strictEqual(findNodeByLabel(after.unstaged.nodes, 'Справочники'), undefined, 'unstaged должен опустеть от «Справочники» — второго изменённого объекта не осталось');
  });

  test('изменение формы справочника — «Справочники → РолиКонтактныхЛиц → Форма.ФормаЭлемента»', () => {
    appendLine(fixture.formXml, '<!-- unstaged-правка формы -->');

    resolve();

    const state = lastState(fakeWebview.postedMessages);
    const catalogsGroup = findNodeByLabel(state.unstaged.nodes, 'Справочники');
    assert.ok(catalogsGroup);
    const objectNode = findDescendantByLabel(catalogsGroup, 'РолиКонтактныхЛиц');
    assert.ok(objectNode, 'ожидался объектный узел «РолиКонтактныхЛиц» под «Справочники»');
    const formPart = objectNode.children?.find((n) => n.label === 'Форма.ФормаЭлемента');
    assert.ok(formPart, `ожидалась часть «Форма.ФормаЭлемента», получено: ${JSON.stringify(objectNode.children)}`);
    assert.strictEqual(formPart.gitStatus, 'modified');
  });

  test('два изменённых справочника делят ОДИН узел-коллекцию «Справочники» (дедуп предков в реальном навигаторном дереве)', () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка первого справочника');
    fs.rmSync(fixture.formXml);

    resolve();

    const state = lastState(fakeWebview.postedMessages);
    const catalogsNodes = collectAllNodes(state.unstaged.nodes).filter((n) => n.label === 'Справочники');
    assert.strictEqual(catalogsNodes.length, 1, `ожидался ОДИН узел-коллекция «Справочники», получено: ${String(catalogsNodes.length)}`);
    const catalogsGroup = catalogsNodes[0];
    assert.ok(findDescendantByLabel(catalogsGroup, 'ПричиныВозврата'), 'первый справочник должен быть под общим узлом «Справочники»');
    assert.ok(findDescendantByLabel(catalogsGroup, 'РолиКонтактныхЛиц'), 'второй справочник должен быть под ТЕМ ЖЕ узлом «Справочники»');
  });

  test('удалённый объект (git rm xml + каталог) — синтезированная коллекция «Справочники», статус deleted (объекта нет в кэше навигатора)', () => {
    const relDir = path.relative(fixture.gitRoot, path.join(fixture.catalogsDir, 'РолиКонтактныхЛиц'));
    const relXml = path.relative(fixture.gitRoot, path.join(fixture.catalogsDir, 'РолиКонтактныхЛиц.xml'));
    git(fixture.gitRoot, ['rm', '-r', '-q', relDir]);
    git(fixture.gitRoot, ['rm', '-q', relXml]);

    // Реальный MetadataTreeProvider строится ПОСЛЕ удаления с диска — объект
    // физически отсутствует, поэтому кэш/навигаторное дерево заведомо его НЕ
    // содержит, и провайдер обязан синтезировать цепочку предков из META_TYPES,
    // а не найти её обходом реального дерева (как в остальных тестах этого файла).
    const built = createTreeProvider(fixture.configRoots);
    const localServices: MetadataChangesViewServices = {
      gitRoot: fixture.gitRoot,
      getConfigRoots: () => fixture.configRoots,
      treeProvider: built.treeProvider,
    };
    const localProvider = new MetadataChangesViewProvider(vscode.Uri.file(EXTENSION_ROOT), localServices);
    const localWebview = createFakeWebview();
    const fakeWebviewView = {
      webview: localWebview.webview,
      visible: true,
      onDidChangeVisibility: new vscode.EventEmitter<void>().event,
      onDidDispose: new vscode.EventEmitter<void>().event,
    } as unknown as vscode.WebviewView;

    try {
      localProvider.resolveWebviewView(fakeWebviewView);
      const state = lastState(localWebview.postedMessages);

      const catalogsGroup = findNodeByLabel(state.staged.nodes, 'Справочники');
      assert.ok(catalogsGroup, `ожидалась синтезированная коллекция «Справочники» (git rm стейджит удаление), получено: ${JSON.stringify(state.staged.nodes)}`);
      const objectNode = findDescendantByLabel(catalogsGroup, 'РолиКонтактныхЛиц');
      assert.ok(objectNode, 'удалённый объект должен присутствовать несмотря на отсутствие файлов на диске и узла в навигаторном дереве');
      assert.strictEqual(objectNode.gitStatus, 'deleted');
      assert.ok(objectNode.children && objectNode.children.length > 0, 'у удалённого объекта всё равно должны быть части');
      assert.ok(objectNode.children.every((c) => c.gitStatus === 'deleted'), 'все части полностью удалённого объекта — deleted');
    } finally {
      built.dispose();
    }
  });

  test('удалённый ОБЩИЙ модуль (git rm) — синтезированная обёртка «Общие» → «Общие модули» → объект (group===\'common\')', () => {
    const relDir = path.relative(fixture.gitRoot, path.join(fixture.cfRoot, 'CommonModules', 'GoogleПереводчик'));
    const relXml = path.relative(fixture.gitRoot, path.join(fixture.cfRoot, 'CommonModules', 'GoogleПереводчик.xml'));
    git(fixture.gitRoot, ['rm', '-r', '-q', relDir]);
    git(fixture.gitRoot, ['rm', '-q', relXml]);

    // Общий модуль (`META_TYPES['CommonModule'].group === 'common'`) — единственный
    // тип в фикстуре из группы «common»; для него synthesizeAncestors обязана
    // добавить промежуточную обёртку «Общие» ПЕРЕД коллекцией «Общие модули»
    // (в отличие от top-группы «Справочники», где обёртки нет — см. соседний тест).
    const built = createTreeProvider(fixture.configRoots);
    const localServices: MetadataChangesViewServices = {
      gitRoot: fixture.gitRoot,
      getConfigRoots: () => fixture.configRoots,
      treeProvider: built.treeProvider,
    };
    const localProvider = new MetadataChangesViewProvider(vscode.Uri.file(EXTENSION_ROOT), localServices);
    const localWebview = createFakeWebview();
    const fakeWebviewView = {
      webview: localWebview.webview,
      visible: true,
      onDidChangeVisibility: new vscode.EventEmitter<void>().event,
      onDidDispose: new vscode.EventEmitter<void>().event,
    } as unknown as vscode.WebviewView;

    try {
      localProvider.resolveWebviewView(fakeWebviewView);
      const state = lastState(localWebview.postedMessages);

      const commonGroup = findNodeByLabel(state.staged.nodes, 'Общие');
      assert.ok(commonGroup, `ожидалась синтезированная обёртка «Общие» (git rm стейджит удаление), получено: ${JSON.stringify(state.staged.nodes)}`);
      const commonModulesGroup = findDescendantByLabel(commonGroup, 'Общие модули');
      assert.ok(commonModulesGroup, 'ожидалась синтезированная коллекция «Общие модули» под обёрткой «Общие»');
      const objectNode = findDescendantByLabel(commonModulesGroup, 'GoogleПереводчик');
      assert.ok(objectNode, 'удалённый общий модуль должен присутствовать несмотря на отсутствие файлов на диске и узла в навигаторном дереве');
      assert.strictEqual(objectNode.gitStatus, 'deleted');
    } finally {
      built.dispose();
    }
  });

  test('действие по nodeId промежуточного group-узла навигаторной иерархии — тихий no-op, git-статус не меняется', async () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка, которая не должна быть тронута действием на group-узле');

    resolve();

    const state = lastState(fakeWebview.postedMessages);
    const groupNode = collectAllNodes(state.unstaged.nodes).find((n) => !ACTIONABLE_NODE_ID_RE.test(n.id));
    assert.ok(groupNode, 'ожидался хотя бы один промежуточный group-узел навигаторной иерархии (например, «Справочники»)');

    const relPath = path.relative(fixture.gitRoot, fixture.objectModuleBsl);
    const statusBefore = statusOf(fixture.gitRoot, relPath);
    const postedBefore = fakeWebview.postedMessages.length;

    await fakeWebview.receiveMessage({ type: 'command', command: 'stage', payload: { nodeId: groupNode.id } });
    await fakeWebview.receiveMessage({ type: 'command', command: 'unstage', payload: { nodeId: groupNode.id } });

    assert.strictEqual(statusOf(fixture.gitRoot, relPath), statusBefore, 'group-узел не адресует ни один файл — git-статус не должен измениться');
    assert.strictEqual(fakeWebview.postedMessages.length, postedBefore, 'при отсутствии адреса повторного postState быть не должно');
  });
});
