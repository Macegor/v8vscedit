import * as path from 'path';
import * as vscode from 'vscode';
import type { SupportInfoService } from '../../infra/support/SupportInfoService';

/**
 * Настраивает watcher за файлом `Ext/ParentConfigurations.bin`: при его
 * изменении сбрасывается кэш `SupportInfoService` и обновляется дерево
 * (режим поддержки узлов — суффикс contextValue, пересчитывается в getTreeItem).
 *
 * Вынос из `extension.ts` выполнен для того, чтобы активатор оставался тонкой
 * композицией, а инфраструктурная подписка жила в `ui/support/`.
 */
export function registerSupportWatcher(
  workspaceFolder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext,
  supportService: SupportInfoService,
  onTreeRefresh: () => void
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '**/Ext/ParentConfigurations.bin'),
    false,
    false,
    false
  );

  // И при удалении корень перезагружается, а не только сбрасывается: loadConfig
  // оставляет маркер «нет данных», без которого файлы вложенного корня (CFE внутри CF)
  // получили бы режим внешней конфигурации по более короткому префиксу.
  const onChange = (uri: vscode.Uri) => {
    const extDir = path.dirname(uri.fsPath);
    const configRoot = path.dirname(extDir);
    supportService.invalidate(configRoot);
    supportService.loadConfig(configRoot);
    onTreeRefresh();
  };

  watcher.onDidCreate(onChange, null, context.subscriptions);
  watcher.onDidChange(onChange, null, context.subscriptions);
  watcher.onDidDelete(onChange, null, context.subscriptions);
  context.subscriptions.push(watcher);
}
