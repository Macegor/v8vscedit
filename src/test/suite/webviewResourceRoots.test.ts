/**
 * S3: `localResourceRoots` webview-панели не должен включать весь корень
 * расширения (`extensionUri`) — это открывает webview доступ ко всей
 * файловой структуре расширения (исходники, конфиги, .git-артефакты сборки
 * и т.п.), а не только к реально нужным для рендера ассетам.
 *
 * Единственные каталоги, которые webview-панели реально используют:
 *  - `dist/ui`  — собранные JS/CSS вебвью (все панели);
 *  - `src/icons` — светлая/тёмная SVG-иконки узлов дерева метаданных,
 *    которые строит `getIconUris()` (ui/tree/presentation/icon.ts) и
 *    которые нужны только панели universal (единственная панель, рисующая
 *    дерево с иконками метаданных).
 *
 * Проверяем через чистую функцию, вычисляющую набор корней по паре
 * (extensionUri, нужны ли иконки) — так тест не зависит от полного
 * разворачивания WebviewView и не дублирует логику вычисления как строковый
 * grep-инвариант. Модуль `webviewResourceRoots.ts` ещё не существует — тест
 * обязан упасть на импорте до реализации.
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import { resolveWebviewLocalResourceRoots } from '../../ui/views/webview/webviewResourceRoots';

suite('webviewResourceRoots', () => {
  const extensionUri = vscode.Uri.file('/fake/extension/root');

  test('панель с иконками (universal) получает ровно [dist/ui, src/icons], без корня расширения целиком', () => {
    const roots = resolveWebviewLocalResourceRoots(extensionUri, { includeIcons: true });
    const paths = roots.map((uri: vscode.Uri) => uri.fsPath).sort();

    const expected = [
      vscode.Uri.joinPath(extensionUri, 'dist', 'ui').fsPath,
      vscode.Uri.joinPath(extensionUri, 'src', 'icons').fsPath,
    ].sort();

    assert.deepStrictEqual(paths, expected);
    // Явно фиксируем отсутствие "широкого" корня расширения в наборе —
    // именно это и есть уязвимость S3, которую должен закрыть хелпер.
    assert.ok(!paths.includes(extensionUri.fsPath));
  });

  test('панель без иконок (dynamic-panel) получает только [dist/ui], без корня расширения целиком', () => {
    const roots = resolveWebviewLocalResourceRoots(extensionUri, { includeIcons: false });
    const paths = roots.map((uri: vscode.Uri) => uri.fsPath);

    assert.deepStrictEqual(paths, [vscode.Uri.joinPath(extensionUri, 'dist', 'ui').fsPath]);
    assert.ok(!paths.includes(extensionUri.fsPath));
  });
});
