import * as vscode from 'vscode';
import { CommandServices } from './_shared';
import { registerDbCommands } from './db/DbCommands';
import { registerExtensionCommands } from './ext/ExtensionCommands';
import { registerAddMetadataCommand } from './metadata/AddMetadataCommand';
import { registerOpenModuleCommands } from './open/OpenModuleCommand';
import { registerOpenXmlCommand } from './open/OpenXmlCommand';
import { registerShowPropertiesCommand } from './properties/ShowPropertiesCommand';
import { registerInitializeProjectCommand } from './project/InitializeProjectCommand';
import { registerTreeSearchCommands } from './search/TreeSearchCommands';

/**
 * Тонкий реестр команд: только связывает команды с конкретными регистраторами.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.refresh', () => {
      services.reloadEntries();
    })
  );

  registerOpenXmlCommand(context, services);
  registerOpenModuleCommands(context, services);
  registerShowPropertiesCommand(context, services);
  registerAddMetadataCommand(context, services);
  registerTreeSearchCommands(context, services);
  registerInitializeProjectCommand(context, services);
  registerDbCommands(context, services);
  registerExtensionCommands(context, services);
}
