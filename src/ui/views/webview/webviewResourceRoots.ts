import * as vscode from 'vscode';

/**
 * Вычисляет минимальный набор `localResourceRoots` для webview-панели.
 *
 * Корень расширения целиком (`extensionUri`) отдавать webview нельзя — это
 * открывает доступ ко всем исходникам, конфигам и артефактам сборки (S3).
 * Реально панелям нужны только:
 *  - `dist/ui`  — собранные JS/CSS вебвью (все панели);
 *  - `src/icons` — светлые/тёмные SVG-иконки узлов дерева метаданных
 *    (`ui/tree/presentation/icon.ts`), нужны только панели с деревом.
 */
export function resolveWebviewLocalResourceRoots(
  extensionUri: vscode.Uri,
  options: { readonly includeIcons: boolean }
): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, 'dist', 'ui')];
  if (options.includeIcons) {
    roots.push(vscode.Uri.joinPath(extensionUri, 'src', 'icons'));
  }
  return roots;
}
