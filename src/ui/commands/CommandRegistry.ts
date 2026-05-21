import * as vscode from 'vscode';
import type { CommandServices } from './_shared';
import { registerAiMcpCommands } from './ai/AiMcpCommands';
import { registerConfigurationReportCommands } from './configuration/ConfigurationReportCommands';
import { registerDbCommands } from './db/DbCommands';
import { registerExternalObjectCommands } from './external/ExternalObjectCommands';
import { registerBorrowToExtensionCommand } from './ext/BorrowToExtensionCommand';
import { registerCfeToolsCommands } from './ext/CfeToolsCommands';
import { registerExtensionCommands } from './ext/ExtensionCommands';
import { registerFormToolsCommands } from './form/FormToolsCommands';
import { registerAddMetadataCommand } from './metadata/AddMetadataCommand';
import { registerMetadataReportCommands } from './metadata/MetadataReportCommands';
import { registerRemoveMetadataCommand } from './metadata/RemoveMetadataCommand';
import { registerOpenModuleCommands } from './open/OpenModuleCommand';
import { registerOpenTemplateContentCommand } from './open/OpenTemplateContentCommand';
import { registerOpenXmlCommand } from './open/OpenXmlCommand';
import { registerShowPropertiesCommand } from './properties/ShowPropertiesCommand';
import { registerInitializeProjectCommand } from './project/InitializeProjectCommand';
import { registerRepositoryCommands } from './repository/RepositoryCommands';
import { registerRoleRightsCommands } from './role/RoleRightsCommands';
import { registerTreeSearchCommands } from './search/TreeSearchCommands';
import { registerInstallAiSkillsCommand } from './skills/InstallAiSkillsCommand';
import { registerStandaloneServerCommands } from './standalone/StandaloneServerCommands';
import { registerSubsystemToolsCommands } from './subsystem/SubsystemToolsCommands';
import { registerTemplateToolsCommands } from './template/TemplateToolsCommands';

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
  registerConfigurationReportCommands(context, services);
  registerOpenTemplateContentCommand(context, services);
  registerBorrowToExtensionCommand(context, services);
  registerCfeToolsCommands(context, services);
  registerOpenModuleCommands(context, services);
  registerShowPropertiesCommand(context, services);
  registerMetadataReportCommands(context, services);
  registerAddMetadataCommand(context, services);
  registerRemoveMetadataCommand(context, services);
  registerRoleRightsCommands(context, services);
  registerSubsystemToolsCommands(context, services);
  registerTemplateToolsCommands(context, services);
  registerExternalObjectCommands(context, services);
  registerFormToolsCommands(context, services);
  registerTreeSearchCommands(context, services);
  registerInitializeProjectCommand(context, services);
  registerAiMcpCommands(context, services);
  registerDbCommands(context, services);
  registerStandaloneServerCommands(context, services);
  registerInstallAiSkillsCommand(context, services);
  registerExtensionCommands(context, services);
  registerRepositoryCommands(context, services);
}
