import * as vscode from 'vscode';
import { CommandServices, NodeArg } from '../_shared';
import {
  extractExtensionTarget,
  runCompileExtension,
  runDecompileExtension,
  runUpdateExtension,
} from './ExtensionCommandRunner';

interface ActionItem extends vscode.QuickPickItem {
  actionId: 'decompileext' | 'updateext' | 'compileAndUpdateExt';
}

/** Регистрирует команды управления расширением 1С. */
export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.showConfigActions', async (node: NodeArg) => {
      const nodeKind = node?.nodeKind;
      const xmlPath = node?.xmlPath;
      if (!nodeKind || !xmlPath) {
        return;
      }

      if (nodeKind !== 'extension') {
        vscode.window.showInformationMessage(`Для "${String(node.label ?? '')}" пока нет доступных команд.`);
        return;
      }

      const targetLabel = String(node.label ?? '');
      const picked = await vscode.window.showQuickPick<ActionItem>([
        { actionId: 'decompileext', label: '$(cloud-download) Импортировать' },
        { actionId: 'updateext', label: '$(sync) Обновить' },
        { actionId: 'compileAndUpdateExt', label: '$(run-all) Полное обновление' },
      ], {
        title: `Команды: ${targetLabel}`,
        placeHolder: 'Выберите действие',
      });

      if (!picked) {
        return;
      }

      if (picked.actionId === 'decompileext') {
        await vscode.commands.executeCommand('v8vscedit.decompileExtensionSources', node);
      } else if (picked.actionId === 'updateext') {
        await vscode.commands.executeCommand('v8vscedit.updateExtensionInDb', node);
      } else if (picked.actionId === 'compileAndUpdateExt') {
        await vscode.commands.executeCommand('v8vscedit.compileAndUpdateExtensionInDb', node);
      }
    }),

    vscode.commands.registerCommand('v8vscedit.decompileExtensionSources', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runDecompileExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
    }),

    vscode.commands.registerCommand('v8vscedit.compileExtensionToDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runCompileExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
    }),

    vscode.commands.registerCommand('v8vscedit.updateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      await runUpdateExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel
      );
    }),

    vscode.commands.registerCommand('v8vscedit.compileAndUpdateExtensionInDb', async (node: NodeArg) => {
      const target = extractExtensionTarget(node);
      if (!target) {
        vscode.window.showWarningMessage('Команда доступна только для корневого узла расширения.');
        return;
      }

      const compiled = await runCompileExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel,
        false
      );
      if (!compiled) {
        return;
      }

      const updated = await runUpdateExtension(
        target.extensionName,
        target.extensionRoot,
        services.workspaceFolder,
        services.outputChannel,
        false
      );
      if (!updated) {
        return;
      }

      await vscode.window.showInformationMessage(
        `Загрузка и обновление расширения "${target.extensionName}" в БД успешно завершены.`,
        { modal: true }
      );
    })
  );
}
