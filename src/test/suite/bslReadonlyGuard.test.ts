import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BslReadonlyGuard } from '../../ui/readonly/BslReadonlyGuard';
import type { RepositoryService } from '../../infra/repository/RepositoryService';
import type { SupportInfoService } from '../../infra/support/SupportInfoService';

/**
 * Issue #4: контекстное меню webview-навигатора закрывалось само собой, потому что
 * `BslReadonlyGuard.applyReadonly` вызывал `showTextDocument(..., { preserveFocus: false })`
 * при каждом (пере)применении readonly-статуса, в том числе в фоне (через
 * `onDidChangeVisibleTextEditors`), безусловно отбирая фокус клавиатуры у webview.
 *
 * Проверить сам факт «фокус не украден» из Extension Host нельзя — фокус webview
 * живёт в изолированном iframe вне API, доступного тестам. Наблюдаемый и значимый
 * инвариант: код действительно передаёт `preserveFocus: true` в реальный
 * `vscode.window.showTextDocument`, и это не ломает применение readonly-статуса
 * (документ всё равно становится активным редактором — ровно то, что нужно
 * команде `setActiveEditorReadonlyInSession`, которая работает с
 * `window.activeTextEditor`).
 */
suite('BslReadonlyGuard — issue #4: фокус не отбирается при применении readonly', () => {
  let tmpFile: string;

  setup(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-readonly-guard-'));
    tmpFile = path.join(dir, 'Module.bsl');
    fs.writeFileSync(tmpFile, 'Процедура Тест()\nКонецПроцедуры\n', 'utf-8');
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // maxRetries/retryDelay: на Windows файл может оставаться заблокированным
    // ещё пару тиков после закрытия редактора (EPERM) — это не сбой продакшен-кода.
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('showTextDocument вызывается с preserveFocus: true, документ становится активным редактором', async function () {
    this.timeout(10_000);
    const uri = vscode.Uri.file(tmpFile);

    const supportService = { isLocked: () => true } as unknown as SupportInfoService;
    const repositoryService = { isEditRestricted: () => false } as unknown as RepositoryService;
    const log = { appendLine: () => undefined } as unknown as vscode.OutputChannel;

    const originalShowTextDocument = vscode.window.showTextDocument;
    const observedOptions: vscode.TextDocumentShowOptions[] = [];
    // Реальный API оборачиваем шпионом, а не подменяем поведение: вызов
    // делегируется оригиналу, фиксируются только фактические аргументы —
    // это проверяет собственный код расширения, а не переопределяет семантику VS Code.
    (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument = ((
      document: vscode.TextDocument,
      options?: vscode.TextDocumentShowOptions
    ) => {
      if (options) {
        observedOptions.push(options);
      }
      return originalShowTextDocument(document, options);
    }) as typeof vscode.window.showTextDocument;

    try {
      // Guard регистрируется ДО открытия файла: `onDidOpenTextDocument` должен
      // застать документ ещё невидимым, чтобы guard пошёл по fallback-пути
      // (`onDidChangeVisibleTextEditors`) — именно тот путь, что фигурирует в issue #4
      // как фоновый источник перехвата фокуса.
      const guard = new BslReadonlyGuard(supportService, repositoryService, log);
      const disposable = guard.register();
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        await waitUntil(() => observedOptions.some((options) => 'viewColumn' in options), 3000);
      } finally {
        disposable.dispose();
      }
    } finally {
      (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument =
        originalShowTextDocument;
    }

    // Помимо вызова guard'а, spy ловит и наш собственный `showTextDocument(doc, …)`
    // выше (нужен, чтобы редактор стал видимым и разбудил fallback-watcher guard'а).
    // Различаем их по `viewColumn` — этот параметр передаёт только сам guard.
    const guardCall = observedOptions.find((options) => 'viewColumn' in options);
    assert.ok(guardCall, 'showTextDocument должен быть вызван guard-ом (BslReadonlyGuard.applyReadonly)');
    assert.strictEqual(
      guardCall.preserveFocus,
      true,
      'guard не должен безусловно отбирать фокус у текущего фокуса (issue #4)'
    );
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      uri.toString(),
      'документ всё равно должен стать активным редактором — иначе readonly-команда применится не туда'
    );
  });

  test('повторный applyReadonly для того же документа не переприменяет readonly-статус', async function () {
    this.timeout(10_000);
    const uri = vscode.Uri.file(tmpFile);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    const supportService = { isLocked: () => true } as unknown as SupportInfoService;
    const repositoryService = { isEditRestricted: () => false } as unknown as RepositoryService;
    const log = { appendLine: () => undefined } as unknown as vscode.OutputChannel;

    let executeCommandCalls = 0;
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = ((
      command: string,
      ...rest: unknown[]
    ) => {
      if (command === 'workbench.action.files.setActiveEditorReadonlyInSession') {
        executeCommandCalls += 1;
      }
      return (originalExecuteCommand as (c: string, ...r: unknown[]) => Thenable<unknown>)(command, ...rest);
    }) as typeof vscode.commands.executeCommand;

    try {
      const guard = new BslReadonlyGuard(supportService, repositoryService, log);
      const applyReadonly = (
        guard as unknown as { applyReadonly: (editor: vscode.TextEditor) => Promise<void> }
      ).applyReadonly.bind(guard);

      await applyReadonly(editor);
      await applyReadonly(editor);
    } finally {
      (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
        originalExecuteCommand;
    }

    assert.strictEqual(
      executeCommandCalls,
      1,
      'readonly-команда для одного и того же документа не должна выполняться повторно'
    );
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Условие не выполнено за отведённое время ожидания');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
