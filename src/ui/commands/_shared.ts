import * as vscode from 'vscode';
import { ChangedConfiguration } from '../../infra/fs/ConfigurationChangeDetector';
import { RepositoryService } from '../../infra/repository/RepositoryService';
import { AiSkillsInstaller } from '../../infra/skills/AiSkillsInstaller';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import { MetadataXmlCreator, MetadataXmlRemover } from '../../infra/xml';
import { BslAnalyzerConfigService } from '../../infra/environment';
import { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import { MetadataNode } from '../tree/TreeNode';
import { PropertiesViewProvider } from '../views/PropertiesViewProvider';
import { RepositoryCommitViewProvider } from '../views/RepositoryCommitViewProvider';
import { RepositoryConnectionViewProvider } from '../views/RepositoryConnectionViewProvider';
import { ProjectEnvironmentViewProvider } from '../views/environment/ProjectEnvironmentViewProvider';
import { SubsystemEditorViewProvider } from '../views/subsystem/SubsystemEditorViewProvider';
import { OnecFileSystemProvider } from '../vfs/OnecFileSystemProvider';

export type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

export interface CommandServices {
  treeProvider: MetadataTreeProvider;
  workspaceFolder: vscode.WorkspaceFolder;
  metadataXmlCreator: MetadataXmlCreator;
  metadataXmlRemover: MetadataXmlRemover;
  reloadEntries: () => void | Promise<void>;
  propertiesViewProvider: PropertiesViewProvider;
  subsystemEditorViewProvider: SubsystemEditorViewProvider;
  vfs: OnecFileSystemProvider;
  outputChannel: vscode.OutputChannel;
  supportService?: SupportInfoService;
  repositoryService: RepositoryService;
  repositoryConnectionViewProvider: RepositoryConnectionViewProvider;
  repositoryCommitViewProvider: RepositoryCommitViewProvider;
  bslAnalyzerConfigService: BslAnalyzerConfigService;
  projectEnvironmentViewProvider: ProjectEnvironmentViewProvider;
  aiSkillsInstaller: AiSkillsInstaller;
  refreshChangedConfigurationState: () => void;
  markChangedConfigurationByFiles: (filePaths: string[]) => void;
  getChangedConfigurations: () => ChangedConfiguration[];
  markConfigurationsClean: (rootPaths: string[]) => void;
  suppressConfigurationReloadForFiles: (filePaths: string[]) => void;
  revealTreeNode: (predicate: (node: MetadataNode) => boolean, rootPath?: string) => Promise<boolean>;
  setTreeMessage: (message: string | undefined) => void;
  refreshActionsView: () => void;
}
