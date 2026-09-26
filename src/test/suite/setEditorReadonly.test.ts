import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { setEditorReadonly } from '../../ui/commands/open/OpenXmlCommand';

/**
 * Issue #4 (реальная причина): `setEditorReadonly` — общая функция, используемая
 * `openModule`/`openXmlFile`/`OpenTemplateContentCommand` сразу после того, как
 * вызывающий код уже открыл документ со своим `preserveFocus` (например, `true`
 * из `UniversalPanelViewProvider.selectNode` — открытие модуля по выбору узла
 * дерева не должно отбирать фокус у навигатора). До фикса `setEditorReadonly`
 * вызывал `showTextDocument` БЕЗ `preserveFocus` (значит, с `false` по умолчанию),
 * повторно и безусловно перехватывая фокус клавиатуры сразу после корректного
 * первого открытия — именно это, а не `BslReadonlyGuard`, было настоящим
 * источником закрытия контекстного меню навигатора при постановке readonly.
 */
suite('setEditorReadonly — issue #4 (реальная причина): не отбирать фокус повторно', () => {
  let tmpFile: string;

  setup(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-set-editor-readonly-'));
    tmpFile = path.join(dir, 'Module.bsl');
    fs.writeFileSync(tmpFile, 'Процедура Тест()\nКонецПроцедуры\n', 'utf-8');
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // maxRetries/retryDelay: на Windows файл может оставаться заблокированным
    // ещё пару тиков после закрытия редактора (EPERM) — это не сбой продакшен-кода.
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('showTextDocument вызывается с preserveFocus: true', async function () {
    this.timeout(10_000);
    const uri = vscode.Uri.file(tmpFile);
    const doc = await vscode.workspace.openTextDocument(uri);
    // Имитируем корректное первое открытие с preserveFocus: true (как делает
    // openModule/openXmlFile при вызове из selectNode).
    const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

    const originalShowTextDocument = vscode.window.showTextDocument;
    const observedOptions: vscode.TextDocumentShowOptions[] = [];
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
      await setEditorReadonly(editor);
    } finally {
      (vscode.window as { showTextDocument: typeof vscode.window.showTextDocument }).showTextDocument =
        originalShowTextDocument;
    }

    assert.strictEqual(observedOptions.length, 1, 'setEditorReadonly должен вызвать showTextDocument ровно один раз');
    assert.strictEqual(
      observedOptions[0].preserveFocus,
      true,
      'setEditorReadonly не должен безусловно отбирать фокус, уже корректно установленный вызывающим кодом (issue #4)'
    );
  });
});
