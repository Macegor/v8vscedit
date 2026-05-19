import * as fs from 'fs';
import * as path from 'path';
import {
  buildDumpConfigToFilesCommand,
  buildLoadConfigFromFilesCommand,
  buildUpdateDbCfgCommand,
  getAgentMessageText,
  type AgentMessage,
} from '../../domain/agent';
import {
  buildHashSnapshot,
  buildScopeKey,
  collectCurrentHashes,
  diffHashSnapshots,
  loadHashCache,
  patchHashSnapshot,
  saveHashCache,
} from '../cache/HashCache';
import { saveMetadataCacheForEntry } from '../cache/MetadataCache';
import { AgentWorkspaceService } from './AgentWorkspaceService';
import { collectConfigFilesForLoad, detectPotentialRename } from './ConfigLoadFileCollector';
import {
  collectSnapshotProjectFiles,
  mirrorDirectorySnapshot,
  syncDirectorySnapshot,
  syncSelectedSnapshotFiles,
} from './DirectorySnapshot';
import type { AgentCommandHooks, DesignerAgentTransport, DesignerAgentTransportFactory } from './AgentTransport';

export interface AgentConfigurationOperationTarget {
  readonly kind: 'cf' | 'cfe';
  readonly name: string;
  readonly rootPath: string;
  readonly extensionName?: string;
}

export interface AgentOperationHooks {
  readonly onMessage?: (message: string) => void;
  readonly onProjectFilesWillChange?: (filePaths: string[]) => void;
  readonly onQuestion?: (message: AgentMessage) => Promise<string | undefined>;
}

export interface AgentOperationResult {
  readonly changedProjectFiles: string[];
  readonly skipped?: boolean;
}

export interface DesignerAgentInfoBaseSession {
  isInfoBaseConnected(): boolean;
  disconnectInfoBase(hooks?: AgentOperationHooks, options?: { readonly force?: boolean }): Promise<boolean>;
  reconnectInfoBase(hooks?: AgentOperationHooks): Promise<void>;
}

export class AgentOperationService {
  private readonly workspaceService: AgentWorkspaceService;
  private connected = false;

  constructor(
    private readonly projectRoot: string,
    private readonly transportFactory: DesignerAgentTransportFactory
  ) {
    this.workspaceService = new AgentWorkspaceService(projectRoot);
  }

  isInfoBaseConnected(): boolean {
    return this.connected;
  }

  async disconnectInfoBase(hooks?: AgentOperationHooks, options?: { readonly force?: boolean }): Promise<boolean> {
    if (!this.connected && options?.force !== true) {
      return false;
    }

    const transport = await this.transportFactory.create('default');
    const commandHooks = this.createCommandHooks(hooks);
    hooks?.onMessage?.('Отключение информационной базы от агента конфигуратора.');
    try {
      await transport.execute('common disconnect-ib', commandHooks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isInfoBaseNotConnectedMessage(message)) {
        throw error;
      }
    }
    this.connected = false;
    return true;
  }

  async reconnectInfoBase(hooks?: AgentOperationHooks): Promise<void> {
    const transport = await this.transportFactory.create('default');
    await this.ensureConnected(transport, this.createCommandHooks(hooks));
  }

  async importFromDatabase(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    const workspace = this.workspaceService.ensureWorkspace(buildSessionKey(target), target);
    const command = buildDumpConfigToFilesCommand(workspace.targetAgentDir, {
      extensionName: target.kind === 'cfe' ? target.extensionName ?? target.name : undefined,
      format: 'hierarchical',
      update: fs.existsSync(path.join(workspace.targetDir, 'ConfigDumpInfo.xml')),
      force: true,
    });

    await this.executeAgentCommand(command, hooks);
    const changedProjectFiles = collectSnapshotProjectFiles(workspace.targetDir, target.rootPath);
    hooks?.onProjectFilesWillChange?.(changedProjectFiles);
    syncDirectorySnapshot(workspace.targetDir, target.rootPath);
    hooks?.onProjectFilesWillChange?.(changedProjectFiles);
    this.refreshCaches(target);
    return { changedProjectFiles };
  }

  async loadFullAndUpdate(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    await this.loadFull(target, hooks);
    return this.updateDatabaseConfiguration(target, hooks);
  }

  async loadChangedAndUpdate(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    const loaded = await this.loadChanged(target, hooks);
    if (loaded.skipped) {
      hooks?.onMessage?.('изменений для загрузки нет');
      return loaded;
    }
    await this.updateDatabaseConfiguration(target, hooks);
    return loaded;
  }

  async updateDatabaseConfiguration(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    hooks?.onMessage?.('Обновление конфигурации базы данных.');
    await this.executeAgentCommand(
      buildUpdateDbCfgCommand({ extensionName: target.kind === 'cfe' ? target.extensionName ?? target.name : undefined }),
      hooks
    );
    return { changedProjectFiles: [] };
  }

  private async loadFull(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    const workspace = this.workspaceService.ensureWorkspace(buildSessionKey(target), target);
    hooks?.onMessage?.('Подготовка файлов для полной загрузки.');
    mirrorDirectorySnapshot(target.rootPath, workspace.targetDir);
    hooks?.onMessage?.('Полная загрузка конфигурации из файлов.');
    await this.executeAgentCommand(
      buildLoadConfigFromFilesCommand(workspace.targetAgentDir, {
        extensionName: target.kind === 'cfe' ? target.extensionName ?? target.name : undefined,
        format: 'hierarchical',
        updateConfigDumpInfo: true,
      }),
      hooks
    );
    this.refreshCaches(target);
    return { changedProjectFiles: [] };
  }

  private async loadChanged(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    if (!fs.existsSync(target.rootPath)) {
      throw new Error(`Каталог исходников не найден: ${target.rootPath}`);
    }

    const extensionName = target.kind === 'cfe' ? target.extensionName ?? target.name : '';
    const commandExtensionName = target.kind === 'cfe' ? extensionName : undefined;
    const scopeKey = buildScopeKey(target.kind, target.rootPath, extensionName);
    const previousSnapshot = loadHashCache(this.projectRoot, scopeKey);
    const currentSnapshot = buildHashSnapshot(scopeKey, target.rootPath);
    const diff = diffHashSnapshots(previousSnapshot, currentSnapshot);
    const changedFiles = [...diff.added, ...diff.modified];

    if (changedFiles.length === 0 && diff.deleted.length === 0) {
      return { changedProjectFiles: [], skipped: true };
    }

    if (Object.keys(previousSnapshot.files).length === 0) {
      hooks?.onMessage?.('Кэш изменений не найден, выполняется полная загрузка.');
      return this.loadFull(target, hooks);
    }

    if (diff.deleted.length > 0) {
      hooks?.onMessage?.('Обнаружено удаление файлов, выполняется полная загрузка.');
      return this.loadFull(target, hooks);
    }

    const forceFullLoad = detectPotentialRename(previousSnapshot.files, currentSnapshot.files, diff.added, diff.deleted);
    if (forceFullLoad) {
      hooks?.onMessage?.('Обнаружено переименование объектов, выполняется полная загрузка.');
      return this.loadFull(target, hooks);
    }

    const filesForLoad = collectConfigFilesForLoad(target.rootPath, changedFiles, false);
    if (filesForLoad.length === 0) {
      return { changedProjectFiles: [], skipped: true };
    }

    const workspace = this.workspaceService.ensureWorkspace(buildSessionKey(target), target);
    hooks?.onMessage?.(`Подготовка частичной загрузки: ${String(filesForLoad.length)} файл(ов).`);
    syncSelectedSnapshotFiles(target.rootPath, workspace.targetDir, filesForLoad);
    const operationId = `${buildSessionKey(target)}-${String(Date.now())}`;
    const listFile = this.workspaceService.writeListFile(operationId, filesForLoad);
    const agentListFile = this.workspaceService.toAgentPath(listFile);

    hooks?.onMessage?.('Частичная загрузка изменённых файлов.');
    await this.executeAgentCommand(
      buildLoadConfigFromFilesCommand(workspace.targetAgentDir, {
        extensionName: commandExtensionName,
        format: 'hierarchical',
        listFile: agentListFile,
        partial: true,
        updateConfigDumpInfo: true,
        noCheck: true,
      }),
      hooks
    );

    const changedHashes = collectCurrentHashes(target.rootPath, changedFiles);
    saveHashCache(this.projectRoot, patchHashSnapshot(previousSnapshot, changedHashes, diff.deleted));
    saveMetadataCacheForEntry(this.projectRoot, scopeKey, { kind: target.kind, rootPath: target.rootPath });
    return { changedProjectFiles: [] };
  }

  private refreshCaches(target: AgentConfigurationOperationTarget): void {
    const extensionName = target.kind === 'cfe' ? target.extensionName ?? target.name : '';
    const scopeKey = buildScopeKey(target.kind, target.rootPath, extensionName);
    saveHashCache(this.projectRoot, buildHashSnapshot(scopeKey, target.rootPath));
    saveMetadataCacheForEntry(this.projectRoot, scopeKey, { kind: target.kind, rootPath: target.rootPath });
  }

  private async executeAgentCommand(command: string, hooks?: AgentOperationHooks): Promise<void> {
    const transport = await this.transportFactory.create('default');
    const commandHooks = this.createCommandHooks(hooks);
    await this.ensureConnected(transport, commandHooks);
    await transport.execute(command, commandHooks);
  }

  private createCommandHooks(hooks?: AgentOperationHooks): AgentCommandHooks {
    return {
      onQuestion: hooks?.onQuestion,
      onMessage: (message) => {
        const text = getAgentMessageText(message);
        if (text) {
          hooks?.onMessage?.(text);
        }
      },
    };
  }

  private async ensureConnected(transport: DesignerAgentTransport, commandHooks: AgentCommandHooks): Promise<void> {
    if (!this.connected) {
      try {
        commandHooks.onMessage?.({ type: 'log', message: 'Подключение информационной базы к агенту конфигуратора.' });
        await transport.execute('common connect-ib', commandHooks);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isInfoBaseAlreadyConnectedMessage(message)) {
          throw error;
        }
      }
      this.connected = true;
    }
  }
}

function buildSessionKey(target: AgentConfigurationOperationTarget): string {
  return target.kind === 'cf' ? 'cf' : `cfe-${target.extensionName ?? target.name}`;
}

function normalizeAgentErrorMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isInfoBaseAlreadyConnectedMessage(message: string): boolean {
  const normalized = normalizeAgentErrorMessage(message);
  return /designeralreadyconnectedtoinfobase/i.test(message) ||
    normalized.includes('already connected') ||
    normalized.includes('уже установлено') ||
    /соединение.*информационн.*баз.*уже.*установлен/.test(normalized) ||
    /подключ.*уже.*установлен/.test(normalized);
}

function isInfoBaseNotConnectedMessage(message: string): boolean {
  const normalized = normalizeAgentErrorMessage(message);
  return normalized.includes('not connected') ||
    normalized.includes('не подключ') ||
    normalized.includes('не установлено') ||
    /соединение.*информационн.*баз.*не.*установлен/.test(normalized);
}
