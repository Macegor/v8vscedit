import * as vscode from 'vscode';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import { MetadataNode } from '../tree/TreeNode';
import { PropertiesViewProvider } from '../views/PropertiesViewProvider';
import { OnecFileSystemProvider } from '../vfs/OnecFileSystemProvider';

export type NodeArg = MetadataNode | { xmlPath?: string; nodeKind?: string; label?: string };

export interface CommandServices {
  treeProvider: MetadataTreeProvider;
  workspaceFolder: vscode.WorkspaceFolder;
  reloadEntries: () => void;
  propertiesViewProvider: PropertiesViewProvider;
  vfs: OnecFileSystemProvider;
  outputChannel: vscode.OutputChannel;
  supportService?: SupportInfoService;
}
