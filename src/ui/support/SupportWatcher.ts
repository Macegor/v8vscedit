import * as path from 'path';
import * as vscode from 'vscode';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import { SupportDecorationProvider } from '../tree/decorations/SupportDecorationProvider';

/**
 * Настраивает watcher за файлом `Ext/ParentConfigurations.bin`: при его
 * изменении сбрасывается кэш `SupportInfoService` и обновляется дерево и
 * декорации.
 *
 * Вынос из `extension.ts` выполнен для того, чтобы активатор оставался тонкой
 * композицией, а инфраструктурная подписка жила в `ui/support/`.
 */
export function registerSupportWatcher(
  workspaceFolder: vscode.WorkspaceFolder,
  context: vscode.ExtensionContext,
  supportService: SupportInfoService,
  decorationProvider: SupportDecorationProvider,
  onTreeRefresh: () => void
): void {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, '**/Ext/ParentConfigurations.bin'),
    false,
    false,
    false
  );

  const onChange = (uri: vscode.Uri) => {
    const extDir = path.dirname(uri.fsPath);
    const configRoot = path.dirname(extDir);
    supportService.invalidate(configRoot);
    supportService.loadConfig(configRoot);
    onTreeRefresh();
    decorationProvider.fireRefresh();
  };
  const onDelete = (uri: vscode.Uri) => {
    const extDir = path.dirname(uri.fsPath);
    const configRoot = path.dirname(extDir);
    supportService.invalidate(configRoot);
    onTreeRefresh();
    decorationProvider.fireRefresh();
  };

  watcher.onDidCreate(onChange, null, context.subscriptions);
  watcher.onDidChange(onChange, null, context.subscriptions);
  watcher.onDidDelete(onDelete, null, context.subscriptions);
  context.subscriptions.push(watcher);
}
