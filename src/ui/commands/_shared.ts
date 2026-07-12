import type * as vscode from 'vscode';
import type { ChangedConfiguration } from '../../infra/fs/ConfigurationChangeDetector';
import type { CfeBorrowService } from '../../infra/cfe/CfeBorrowService';
import type { CfeDiffService } from '../../infra/cfe/CfeDiffService';
import type { CfePatchMethodService } from '../../infra/cfe/CfePatchMethodService';
import type { RepositoryService } from '../../infra/repository/RepositoryService';
import type { ProjectSecretStorage } from '../../infra/environment';
import type { RoleRightsService } from '../../infra/role';
import type { AiSkillsInstaller } from '../../infra/skills/AiSkillsInstaller';
import type { StandaloneServerService } from '../../infra/standalone';
import type { SupportInfoService } from '../../infra/support/SupportInfoService';
import type {
  ConfigurationInfoService,
  ConfigurationScaffoldService,
  ConfigurationValidationService,
  CommandInterfaceService,
  DataCompositionSchemaService,
  ExternalObjectService,
  FormToolsService,
  MetadataInfoService,
  MetadataValidationService,
  MetadataXmlCreator,
  MetadataXmlRemover,
  MxlTemplateService,
  SubsystemToolsService,
  SubsystemXmlService,
} from '../../infra/xml';
import type { BslAnalyzerConfigService } from '../../infra/environment';
import type { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import type { MetadataNode } from '../tree/TreeNode';
import type { DynamicPanelController } from '../views/dynamic-panel/DynamicPanelController';
import type { RepositoryCommitViewProvider } from '../views/RepositoryCommitViewProvider';
import type { RepositoryConnectionViewProvider } from '../views/RepositoryConnectionViewProvider';
import type { ProjectEnvironmentViewProvider } from '../views/environment/ProjectEnvironmentViewProvider';
import type { AiMcpViewProvider } from '../views/ai/AiMcpViewProvider';
import type { StandaloneServerViewProvider } from '../views/standalone/StandaloneServerViewProvider';
import type { SubsystemEditorViewProvider } from '../views/subsystem/SubsystemEditorViewProvider';
import type { HistoryGraphViewProvider } from '../views/history/HistoryGraphViewProvider';
import type { UniversalPanelProcessingState } from '../views/universal/UniversalPanelViewProvider';

export type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

export interface CommandServices {
  treeProvider: MetadataTreeProvider;
  workspaceFolder: vscode.WorkspaceFolder;
  metadataXmlCreator: MetadataXmlCreator;
  metadataXmlRemover: MetadataXmlRemover;
  configurationInfoService: ConfigurationInfoService;
  configurationScaffoldService: ConfigurationScaffoldService;
  configurationValidationService: ConfigurationValidationService;
  metadataInfoService: MetadataInfoService;
  metadataValidationService: MetadataValidationService;
  subsystemToolsService: SubsystemToolsService;
  subsystemXmlService: SubsystemXmlService;
  commandInterfaceService: CommandInterfaceService;
  mxlTemplateService: MxlTemplateService;
  dataCompositionSchemaService: DataCompositionSchemaService;
  externalObjectService: ExternalObjectService;
  formToolsService: FormToolsService;
  cfeBorrowService: CfeBorrowService;
  cfeDiffService: CfeDiffService;
  cfePatchMethodService: CfePatchMethodService;
  roleRightsService: RoleRightsService;
  reloadEntries: () => void | Promise<void>;
  dynamicPanelController: DynamicPanelController;
  subsystemEditorViewProvider: SubsystemEditorViewProvider;
  historyGraphViewProvider: HistoryGraphViewProvider;
  outputChannel: vscode.OutputChannel;
  supportService?: SupportInfoService;
  repositoryService: RepositoryService;
  projectSecretStorage: ProjectSecretStorage;
  repositoryConnectionViewProvider: RepositoryConnectionViewProvider;
  repositoryCommitViewProvider: RepositoryCommitViewProvider;
  bslAnalyzerConfigService: BslAnalyzerConfigService;
  projectEnvironmentViewProvider: ProjectEnvironmentViewProvider;
  aiMcpViewProvider?: AiMcpViewProvider;
  standaloneServerService: StandaloneServerService;
  standaloneServerViewProvider: StandaloneServerViewProvider;
  aiSkillsInstaller: AiSkillsInstaller;
  refreshChangedConfigurationState: () => void;
  markChangedConfigurationByFiles: (filePaths: string[]) => void;
  getChangedConfigurations: () => ChangedConfiguration[];
  markConfigurationsClean: (rootPaths: string[]) => void;
  suppressConfigurationReloadForFiles: (filePaths: string[]) => void;
  revealTreeNode: (predicate: (node: MetadataNode) => boolean, rootPath?: string) => Promise<boolean>;
  setTreeMessage: (message: string | undefined) => void;
  setTreeProcessingState: (state: UniversalPanelProcessingState) => void;
  refreshActionsView: () => void;
}
