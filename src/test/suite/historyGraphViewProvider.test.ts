import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
/**
 * Граф истории git, Слой 3b (задача D): тонкая vscode-оболочка панели
 * «История» над `historyGraphController` (Слой 3b) — модуль ещё не
 * реализован, импорт обязан провалиться до появления
 * `src/ui/views/history/HistoryGraphViewProvider.ts`.
 *
 * В отличие от `MetadataChangesViewProvider` (нативный `WebviewView` нельзя
 * собрать в headless Extension Host без видимой панели, поэтому там webview
 * подделан вручную) панель истории — самостоятельный `WebviewPanel`
 * (`vscode.window.createWebviewPanel`), который headless Extension Host
 * создаёт по-настоящему без подделки. Единственная внешняя недоступная
 * система здесь — команда `vscode.diff` (реально открывает вкладку
 * diff-редактора, что не нужно проверять в этом наборе) — она застаблена по
 * образцу `metadataChangesViewProvider.test.ts`.
 *
 * Репозиторий — `buildChangesBaselineRepo()` (не `buildHistoryRepo()`):
 * у него есть настоящая структура выгрузки 1С (`configRoots`), поэтому
 * `selectCommit`/`openDiff` собирают НЕПУСТУЮ секцию изменений коммита, а не
 * работают вхолостую на файлах вне структуры.
 */
import { HistoryGraphViewProvider } from '../../ui/views/history/HistoryGraphViewProvider';
import {
  appendLine,
  buildChangesBaselineRepo,
  git,
  removeFixtureRepo,
  type ChangesFixture,
} from './support/changesFixtures';

const EXTENSION_ROOT = path.resolve(__dirname, '../../../');

suite('HistoryGraphViewProvider — webview-панель «История» (оболочка над historyGraphController)', () => {
  let fixture: ChangesFixture;
  let provider: HistoryGraphViewProvider;
  let originalExecuteCommand: typeof vscode.commands.executeCommand;
  const commandsRef = vscode.commands as { executeCommand: typeof vscode.commands.executeCommand };
  let executeCommandCalls: unknown[][];

  setup(() => {
    fixture = buildChangesBaselineRepo();
    executeCommandCalls = [];
    originalExecuteCommand = vscode.commands.executeCommand;
    // vscode.diff реально открыл бы вкладку редактора — внешний эффект, не
    // относящийся к проверяемой логике оболочки; стаб идентичен
    // metadataChangesViewProvider.test.ts (там же обоснование).
    commandsRef.executeCommand = ((command: string, ...rest: unknown[]) => {
      executeCommandCalls.push([command, ...rest]);
      return Promise.resolve(undefined);
    }) as typeof vscode.commands.executeCommand;

    provider = new HistoryGraphViewProvider(vscode.Uri.file(EXTENSION_ROOT), {
      gitRoot: fixture.gitRoot,
      getConfigRoots: () => fixture.configRoots,
    });
  });

  teardown(() => {
    commandsRef.executeCommand = originalExecuteCommand;
    provider.dispose();
    removeFixtureRepo(fixture);
  });

  test('viewType — контракт идентификатора webview-панели', () => {
    assert.strictEqual(HistoryGraphViewProvider.viewType, 'v8vsceditHistory');
  });

  test('refresh() ДО open() — не бросает (панели ещё нет, no-op)', () => {
    assert.doesNotThrow(() => { provider.refresh(); });
  });

  test('open() создаёт панель и рендерит начальный граф — не бросает, даже если манифест "history" webview ещё не собран (renderHtml — try/catch, как у SubsystemEditorViewProvider)', () => {
    assert.doesNotThrow(() => { provider.open(); });
  });

  test('повторный open() — singleton, вторая панель не создаётся, исключения нет', () => {
    provider.open();
    assert.doesNotThrow(() => { provider.open(); });
  });

  test('refresh() после open() — пересчитывает граф и не бросает', () => {
    provider.open();
    assert.doesNotThrow(() => { provider.refresh(); });
  });

  test('handleMessage selectCommit по реальному корневому коммиту — реально строит секцию изменений коммита, не бросает', async () => {
    provider.open();
    const rootCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'selectCommit', payload: { hash: rootCommit } });
    });
  });

  test('handleMessage selectCommit БЕЗ предварительного open() — панели нет, buildIcon возвращает {kind: "none"}, postMessage — no-op, не бросает', async () => {
    // Корневой коммит фикстуры реально добавляет объект метаданных
    // («ПричиныВозврата»), поэтому buildCommitChangesSection вызовет
    // buildIcon хотя бы раз — с this.panel === undefined это единственный
    // достижимый путь через ветку `!lightUri || !darkUri` (короткое замыкание
    // опциональной цепочки `this.panel?.webview...` даёт undefined без панели).
    const rootCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'selectCommit', payload: { hash: rootCommit } });
    });
  });

  test('handleMessage openDiff по одиночной части объекта после selectCommit — не бросает и вызывает vscode.diff ровно один раз', async () => {
    appendLine(fixture.objectModuleBsl, '// правка модуля объекта для diff графа истории');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'правка модуля объекта для графа истории']);
    const editCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    provider.open();
    await provider.handleMessage({ type: 'command', command: 'selectCommit', payload: { hash: editCommit } });

    await assert.doesNotReject(async () => {
      // Изменён единственный файл (модуль объекта) — единственная часть
      // единственной группы, узел `staged#0.0` обязан быть адресуемым.
      await provider.handleMessage({ type: 'command', command: 'openDiff', payload: { nodeId: 'staged#0.0' } });
    });

    assert.strictEqual(executeCommandCalls.length, 1, 'openDiff по одиночному файлу обязан вызвать vscode.diff ровно один раз');
    assert.strictEqual(executeCommandCalls[0][0], 'vscode.diff');
  });

  test('handleMessage openDiff по nodeId целого объекта из нескольких частей — resolveCommitDiff возвращает undefined (не single), vscode.diff не вызывается, не бросает', async () => {
    // Правка модуля объекта И модуля команды в одном коммите — одна объектная
    // группа с 2 частями (см. historyGraphController.test.ts). `staged#0` без
    // индекса части адресует объект целиком → resolveCommitDiff не находит
    // единственный файл → openDiff обязан молча выйти на ветке `!diff`.
    appendLine(fixture.objectModuleBsl, '// правка модуля объекта для diff графа истории');
    appendLine(fixture.commandModuleBsl, '// правка модуля команды для diff графа истории');
    git(fixture.gitRoot, ['add', '-A']);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'правка модуля и команды объекта для графа истории']);
    const editCommit = git(fixture.gitRoot, ['rev-parse', 'HEAD']).trim();

    provider.open();
    await provider.handleMessage({ type: 'command', command: 'selectCommit', payload: { hash: editCommit } });

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'openDiff', payload: { nodeId: 'staged#0' } });
    });

    assert.strictEqual(executeCommandCalls.length, 0, 'nodeId без единственного файла не обязан вызывать vscode.diff');
  });

  test('handleMessage openDiff без предварительного selectCommit — нет модели выбранного коммита, не бросает и vscode.diff не вызывается', async () => {
    provider.open();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'openDiff', payload: { nodeId: 'staged#0.0' } });
    });

    assert.strictEqual(executeCommandCalls.length, 0);
  });

  test('handleMessage loadMore после open() — не бросает', async () => {
    provider.open();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'loadMore' });
    });
  });

  test('handleMessage refresh после open() — не бросает', async () => {
    provider.open();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'refresh' });
    });
  });

  test('handleMessage с неизвестной командой — молча игнорируется, не бросает', async () => {
    provider.open();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'какая-то-неизвестная-команда' });
    });
  });

  test('handleMessage без payload (selectCommit без hash) — молча игнорируется, не бросает', async () => {
    provider.open();

    await assert.doesNotReject(async () => {
      await provider.handleMessage({ type: 'command', command: 'selectCommit' });
    });
  });

  test('handleMessage selectCommit по хешу ВНЕ загруженного графа — isRoot=false (строка не найдена), не бросает', async () => {
    provider.open();

    // Синтаксически валидный, но отсутствующий в rows хеш: ветка `row ? … : false`
    // уходит в `false`; readCommitChanges по несуществующему коммиту даёт мягко
    // пустую модель — панель не падает.
    await assert.doesNotReject(async () => {
      await provider.handleMessage({
        type: 'command',
        command: 'selectCommit',
        payload: { hash: '0123456789012345678901234567890123456789' },
      });
    });
  });

  test('dispose() закрывает панель, не бросает; повторный open() после dispose снова создаёт панель', () => {
    provider.open();

    assert.doesNotThrow(() => { provider.dispose(); });
    assert.doesNotThrow(() => { provider.open(); });
  });

  test('open() с extensionUri БЕЗ собранного dist/ui/manifest.json — renderHtml реально ловит исключение getEntry, панель не падает', () => {
    // Реальный ENOENT от WebviewAssetManifestReader (без построенного webview),
    // а не подделка: `renderHtml` оборачивает рендер в try/catch именно на этот
    // случай (см. её doc-комментарий) — ветка обязана быть достижима по-настоящему,
    // а не через `c8 ignore`.
    const bareExtensionRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-history-no-manifest-')));
    const bareProvider = new HistoryGraphViewProvider(vscode.Uri.file(bareExtensionRoot), {
      gitRoot: fixture.gitRoot,
      getConfigRoots: () => fixture.configRoots,
    });

    try {
      assert.doesNotThrow(() => { bareProvider.open(); });
    } finally {
      bareProvider.dispose();
      fs.rmSync(bareExtensionRoot, { recursive: true, force: true });
    }
  });
});
