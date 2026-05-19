import * as vscode from 'vscode';
import type { CommandServices } from './_shared';
import { registerAiMcpCommands } from './ai/AiMcpCommands';
import { registerDbCommands } from './db/DbCommands';
import { registerBorrowToExtensionCommand } from './ext/BorrowToExtensionCommand';
import { registerExtensionCommands } from './ext/ExtensionCommands';
import { registerAddMetadataCommand } from './metadata/AddMetadataCommand';
import { registerRemoveMetadataCommand } from './metadata/RemoveMetadataCommand';
import { registerOpenModuleCommands } from './open/OpenModuleCommand';
import { registerOpenTemplateContentCommand } from './open/OpenTemplateContentCommand';
import { registerOpenXmlCommand } from './open/OpenXmlCommand';
import { registerShowPropertiesCommand } from './properties/ShowPropertiesCommand';
import { registerInitializeProjectCommand } from './project/InitializeProjectCommand';
import { registerRepositoryCommands } from './repository/RepositoryCommands';
import { registerTreeSearchCommands } from './search/TreeSearchCommands';
import { registerInstallAiSkillsCommand } from './skills/InstallAiSkillsCommand';
import { registerStandaloneServerCommands } from './standalone/StandaloneServerCommands';

/**
 * Тонкий реестр команд: только связывает команды с конкретными регистраторами.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.refresh', () => {
      void services.reloadEntries();
    })
  );

  registerOpenXmlCommand(context, services);
  registerOpenTemplateContentCommand(context, services);
  registerBorrowToExtensionCommand(context, services);
  registerOpenModuleCommands(context, services);
  registerShowPropertiesCommand(context, services);
  registerAddMetadataCommand(context, services);
  registerRemoveMetadataCommand(context, services);
  registerTreeSearchCommands(context, services);
  registerInitializeProjectCommand(context, services);
  registerAiMcpCommands(context, services);
  registerDbCommands(context, services);
  registerStandaloneServerCommands(context, services);
  registerInstallAiSkillsCommand(context, services);
  registerExtensionCommands(context, services);
  registerRepositoryCommands(context, services);
}
