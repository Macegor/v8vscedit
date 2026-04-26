import * as vscode from 'vscode';
import {
  getCommonCommandModulePath,
  getCommonFormModulePath,
  getCommandModulePathForChild,
  ensureCommonModuleCodePath,
  getCommonModuleCodePath,
  getConstantModulePath,
  getFormModulePathForChild,
  getManagerModulePath,
  getObjectModulePath,
  getServiceModulePath,
} from '../../../infra/fs/MetaPathResolver';
import { buildFormModuleVirtualUri, buildVirtualUri } from '../../vfs/OnecUriBuilder';
import { MetadataNode } from '../../tree/TreeNode';
import { CommandServices, NodeArg } from '../_shared';
import { setEditorReadonly } from './OpenXmlCommand';

/** Регистрирует команды открытия BSL-модулей для всех слотов. */
export function registerOpenModuleCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openCommonModuleCode', async (node: NodeArg) => {
      const modulePath = getCommonModuleCodePath(toNodePathInfo(node)) ?? ensureCommonModuleCodePath(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath ? buildVirtualUri(xmlPath, 'module') : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    }),

    vscode.commands.registerCommand('v8vscedit.openObjectModule', async (node: NodeArg) => {
      const modulePath = getObjectModulePath(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath ? buildVirtualUri(xmlPath, 'objectModule') : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    }),

    vscode.commands.registerCommand('v8vscedit.openManagerModule', async (node: NodeArg) => {
      const modulePath = getManagerModulePath(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath ? buildVirtualUri(xmlPath, 'managerModule') : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    }),

    vscode.commands.registerCommand('v8vscedit.openConstantModule', async (node: NodeArg) => {
      const modulePath = getConstantModulePath(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath ? buildVirtualUri(xmlPath, 'valueManagerModule') : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    }),

    vscode.commands.registerCommand('v8vscedit.openServiceModule', async (node: NodeArg) => {
      const modulePath = getServiceModulePath(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath ? buildVirtualUri(xmlPath, 'module') : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    }),

    vscode.commands.registerCommand('v8vscedit.openFormModule', async (node: NodeArg) => {
      const isCommonForm = node.nodeKind === 'CommonForm';
      const modulePath = isCommonForm
        ? getCommonFormModulePath(toNodePathInfo(node))
        : getFormModulePathForChild(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath
        ? isCommonForm
          ? buildVirtualUri(xmlPath, 'module')
          : buildFormModuleVirtualUri(xmlPath, String(node.label ?? ''))
        : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    }),

    vscode.commands.registerCommand('v8vscedit.openCommandModule', async (node: NodeArg) => {
      const isCommonCommand = node.nodeKind === 'CommonCommand';
      const modulePath = isCommonCommand
        ? getCommonCommandModulePath(toNodePathInfo(node))
        : getCommandModulePathForChild(toNodePathInfo(node));
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      const virtualUri = xmlPath ? buildVirtualUri(xmlPath, 'commandModule') : null;
      await openModule(services, modulePath, virtualUri, xmlPath);
    })
  );
}

async function openModule(
  services: CommandServices,
  modulePath: string,
  virtualUri: vscode.Uri | null,
  ownerXmlPath: string | undefined,
  preview = true
): Promise<void> {
  const supportLocked = ownerXmlPath ? services.supportService?.isLocked(ownerXmlPath) ?? false : false;
  const repositoryLocked = services.repositoryService.isEditRestricted(ownerXmlPath ?? modulePath);
  const locked = supportLocked || repositoryLocked;
  let editor: vscode.TextEditor;

  const lspMode = vscode.workspace.getConfiguration('v8vscedit.lsp').get<string>('mode', 'bsl-analyzer');
  const useVfs = lspMode === 'built-in';

  if (useVfs && virtualUri) {
    services.vfs.register(virtualUri, modulePath);
    if (ownerXmlPath) {
      services.vfs.registerOwnerXml(virtualUri, ownerXmlPath);
    }
    const document = await vscode.workspace.openTextDocument(virtualUri);
    await vscode.languages.setTextDocumentLanguage(document, 'bsl');
    editor = await vscode.window.showTextDocument(document, { preview });
  } else {
    editor = await vscode.window.showTextDocument(vscode.Uri.file(modulePath), { preview });
  }

  if (locked) {
    await setEditorReadonly(editor);
  }
}

function toNodePathInfo(node: NodeArg): { xmlPath?: string; kind?: string; label?: string } {
  if (node instanceof MetadataNode) {
    return {
      xmlPath: node.xmlPath,
      kind: node.nodeKind,
      label: node.textLabel,
    };
  }

  return {
    xmlPath: node.xmlPath,
    kind: node.nodeKind,
    label: typeof node.label === 'string' ? node.label : undefined,
  };
}
