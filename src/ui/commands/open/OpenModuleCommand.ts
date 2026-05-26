import * as vscode from 'vscode';
import {
  ensureCommandModulePathForChild,
  ensureCommonCommandModulePath,
  ensureCommonFormModulePath,
  ensureCommonModuleFile,
  ensureConstantModulePath,
  ensureFormModulePathForChild,
  ensureManagerModulePath,
  ensureObjectModulePath,
  ensureRecordSetModulePath,
  ensureServiceModulePath,
  getCommonCommandModulePath,
  getCommonFormModulePath,
  getCommandModulePathForChild,
  getCommonModuleCodePath,
  getConstantModulePath,
  getFormModulePathForChild,
  getManagerModulePath,
  getObjectModulePath,
  getRecordSetModulePath,
  getServiceModulePath,
} from '../../../infra/fs/MetaPathResolver';
import { MetadataNode } from '../../tree/TreeNode';
import type { CommandServices, NodeArg } from '../_shared';
import { setEditorReadonly } from './OpenXmlCommand';

/** Регистрирует команды открытия BSL-модулей для всех слотов. */
export function registerOpenModuleCommands(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.openCommonModuleCode', async (node: NodeArg, options?: OpenModuleOptions) => {
      const info = toNodePathInfo(node);
      const modulePath = await resolveModuleForOpen(
        services,
        info,
        node.xmlPath,
        getCommonModuleCodePath,
        ensureCommonModuleFile,
        'общего модуля'
      );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openObjectModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const info = toNodePathInfo(node);
      const modulePath = await resolveModuleForOpen(
        services,
        info,
        node.xmlPath,
        getObjectModulePath,
        ensureObjectModulePath,
        'модуля объекта'
      );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openManagerModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const info = toNodePathInfo(node);
      const modulePath = await resolveModuleForOpen(
        services,
        info,
        node.xmlPath,
        getManagerModulePath,
        ensureManagerModulePath,
        'модуля менеджера'
      );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openRecordSetModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const info = toNodePathInfo(node);
      const modulePath = await resolveModuleForOpen(
        services,
        info,
        node.xmlPath,
        getRecordSetModulePath,
        ensureRecordSetModulePath,
        'модуля записи'
      );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openConstantModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const info = toNodePathInfo(node);
      const modulePath = await resolveModuleForOpen(
        services,
        info,
        node.xmlPath,
        getConstantModulePath,
        ensureConstantModulePath,
        'модуля менеджера значения'
      );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openServiceModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const info = toNodePathInfo(node);
      const modulePath = await resolveModuleForOpen(
        services,
        info,
        node.xmlPath,
        getServiceModulePath,
        ensureServiceModulePath,
        'модуля сервиса'
      );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openFormModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const isCommonForm = node.nodeKind === 'CommonForm';
      const info = toNodePathInfo(node);
      const modulePath = isCommonForm
        ? await resolveModuleForOpen(
          services,
          info,
          node.xmlPath,
          getCommonFormModulePath,
          ensureCommonFormModulePath,
          'модуля общей формы'
        )
        : await resolveModuleForOpen(
          services,
          info,
          node.xmlPath,
          getFormModulePathForChild,
          ensureFormModulePathForChild,
          'модуля формы'
        );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    }),

    vscode.commands.registerCommand('v8vscedit.openCommandModule', async (node: NodeArg, options?: OpenModuleOptions) => {
      const isCommonCommand = node.nodeKind === 'CommonCommand';
      const info = toNodePathInfo(node);
      const modulePath = isCommonCommand
        ? await resolveModuleForOpen(
          services,
          info,
          node.xmlPath,
          getCommonCommandModulePath,
          ensureCommonCommandModulePath,
          'модуля общей команды'
        )
        : await resolveModuleForOpen(
          services,
          info,
          node.xmlPath,
          getCommandModulePathForChild,
          ensureCommandModulePathForChild,
          'модуля команды'
        );
      if (!modulePath) {
        return;
      }

      const xmlPath = node.xmlPath;
      await openModule(services, modulePath, xmlPath, options);
    })
  );
}

interface OpenModuleOptions {
  readonly preview?: boolean;
  readonly preserveFocus?: boolean;
}

type ModulePathResolver = (node: { xmlPath?: string; kind?: string; label?: string }) => string | null;

async function resolveModuleForOpen(
  services: CommandServices,
  node: { xmlPath?: string; kind?: string; label?: string },
  ownerXmlPath: string | undefined,
  resolveExisting: ModulePathResolver,
  ensureMissing: ModulePathResolver,
  moduleLabel: string
): Promise<string | null> {
  const existing = resolveExisting(node);
  if (existing) {
    return existing;
  }

  if (isReadonlyModuleOwner(services, ownerXmlPath)) {
    await vscode.window.showWarningMessage(`Нельзя создать файл ${moduleLabel}: объект заблокирован для редактирования.`);
    return null;
  }

  try {
    const created = ensureMissing(node);
    if (!created) {
      await vscode.window.showWarningMessage(`Не удалось определить путь ${moduleLabel}.`);
      return null;
    }
    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`Не удалось создать файл ${moduleLabel}: ${message}`);
    return null;
  }
}

function isReadonlyModuleOwner(services: CommandServices, ownerXmlPath: string | undefined): boolean {
  const supportLocked = ownerXmlPath ? services.supportService?.isLocked(ownerXmlPath) ?? false : false;
  const repositoryLocked = ownerXmlPath ? services.repositoryService.isEditRestricted(ownerXmlPath) : false;
  return supportLocked || repositoryLocked;
}

async function openModule(
  services: CommandServices,
  modulePath: string,
  ownerXmlPath: string | undefined,
  options?: { preview?: boolean; preserveFocus?: boolean }
): Promise<void> {
  const supportLocked = ownerXmlPath ? services.supportService?.isLocked(ownerXmlPath) ?? false : false;
  const repositoryLocked = services.repositoryService.isEditRestricted(ownerXmlPath ?? modulePath);
  const locked = supportLocked || repositoryLocked;
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(modulePath), {
    preview: options?.preview ?? true,
    preserveFocus: options?.preserveFocus ?? false,
  });

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
