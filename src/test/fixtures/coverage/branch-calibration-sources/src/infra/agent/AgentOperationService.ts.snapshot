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
  syncSelectedSnapshotFiles,
} from './DirectorySnapshot';
import type {
  AgentCommandHooks,
  DesignerAgentTransport,
  DesignerAgentTransportFactory,
  ResettableDesignerAgentTransportFactory,
} from './AgentTransport';

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
    private readonly transportFactory: DesignerAgentTransportFactory | ResettableDesignerAgentTransportFactory
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
    return this.runInfoBaseOperation(hooks, async () => {
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
      // Раньше тут стоял `syncDirectorySnapshot`, который через `rename` переносил
      // workspace в проект и оставлял workspace.targetDir пустым. После этого
      // первая же `load-config-from-files --partial` валилась с пустым UnknownError,
      // потому что в `--dir=workspace/...` не было целостной структуры конфигурации
      // (Configuration.xml, родительских XML для модулей форм и т.п.).
      // Сейчас зеркалим в проект копированием — workspace остаётся полным
      // снимком текущего состояния БД и пригоден для последующих частичных загрузок.
      mirrorDirectorySnapshot(workspace.targetDir, target.rootPath);
      hooks?.onProjectFilesWillChange?.(changedProjectFiles);
      this.refreshCaches(target);
      return { changedProjectFiles };
    });
  }

  async loadFullAndUpdate(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    return this.runInfoBaseOperation(hooks, async () => {
      await this.loadFull(target, hooks);
      return this.updateDatabaseConfigurationConnected(target, hooks);
    });
  }

  async loadChangedAndUpdate(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    return this.runInfoBaseOperation(hooks, async () => {
      const loaded = await this.loadChanged(target, hooks);
      if (loaded.skipped) {
        hooks?.onMessage?.('изменений для загрузки нет');
        return loaded;
      }
      await this.updateDatabaseConfigurationConnected(target, hooks);
      return loaded;
    });
  }

  async updateDatabaseConfiguration(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
    return this.runInfoBaseOperation(hooks, () => this.updateDatabaseConfigurationConnected(target, hooks));
  }

  private async updateDatabaseConfigurationConnected(target: AgentConfigurationOperationTarget, hooks?: AgentOperationHooks): Promise<AgentOperationResult> {
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
    this.refreshHashCache(target);
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
    // Конфигуратору на `load-config-from-files --partial` нужен целостный каркас
    // выгрузки в `--dir`: Configuration.xml, родительские XML для модулей форм и т.д.
    // Если workspace пуст (например, проект только что заведён или каталог был очищен),
    // зеркалим проект целиком. Иначе агент валится в пустой UnknownError, не имея
    // контекста для частичной загрузки.
    this.ensureWorkspaceMirrored(target.rootPath, workspace.targetDir);
    syncSelectedSnapshotFiles(target.rootPath, workspace.targetDir, filesForLoad);
    const operationId = `${buildSessionKey(target)}-${String(Date.now())}`;
    const listFile = this.workspaceService.writeListFile(operationId, filesForLoad);
    const agentListFile = this.workspaceService.toAgentPath(listFile);

    hooks?.onMessage?.('Частичная загрузка изменённых файлов.');
    // ConfigDumpInfo.xml для расширения/конфигурации поддерживается на стороне `loadFull`.
    // На частичной загрузке передавать `--update-config-dump-info` нельзя:
    // конфигуратор перезаписывает файл «срезом» только из переданного списка и при
    // повторных частичных загрузках уходит во внутреннее `UnknownError` с пустым телом.
    await this.executeAgentCommand(
      buildLoadConfigFromFilesCommand(workspace.targetAgentDir, {
        extensionName: commandExtensionName,
        format: 'hierarchical',
        listFile: agentListFile,
        partial: true,
        noCheck: true,
      }),
      hooks
    );

    const changedHashes = collectCurrentHashes(target.rootPath, changedFiles);
    saveHashCache(this.projectRoot, patchHashSnapshot(previousSnapshot, changedHashes, diff.deleted));
    return { changedProjectFiles: [] };
  }

  private refreshCaches(target: AgentConfigurationOperationTarget): void {
    const extensionName = target.kind === 'cfe' ? target.extensionName ?? target.name : '';
    const scopeKey = buildScopeKey(target.kind, target.rootPath, extensionName);
    saveHashCache(this.projectRoot, buildHashSnapshot(scopeKey, target.rootPath));
    saveMetadataCacheForEntry(this.projectRoot, scopeKey, { kind: target.kind, rootPath: target.rootPath });
  }

  /**
   * Гарантирует, что в `workspace.targetDir` лежит полный снимок исходников проекта.
   * Используется перед частичной загрузкой: точечный sync только изменённых файлов
   * требует, чтобы остальной каркас выгрузки уже присутствовал в воркспейсе.
   */
  private ensureWorkspaceMirrored(sourceDir: string, workspaceDir: string): void {
    if (!fs.existsSync(workspaceDir)) {
      mirrorDirectorySnapshot(sourceDir, workspaceDir);
      return;
    }
    const entries = fs.readdirSync(workspaceDir);
    if (entries.length === 0) {
      mirrorDirectorySnapshot(sourceDir, workspaceDir);
      return;
    }
    if (!fs.existsSync(path.join(workspaceDir, 'Configuration.xml'))) {
      mirrorDirectorySnapshot(sourceDir, workspaceDir);
    }
  }

  private refreshHashCache(target: AgentConfigurationOperationTarget): void {
    const extensionName = target.kind === 'cfe' ? target.extensionName ?? target.name : '';
    const scopeKey = buildScopeKey(target.kind, target.rootPath, extensionName);
    saveHashCache(this.projectRoot, buildHashSnapshot(scopeKey, target.rootPath));
  }

  private async executeAgentCommand(command: string, hooks?: AgentOperationHooks): Promise<void> {
    const transport = await this.transportFactory.create('default');
    const commandHooks = this.createCommandHooks(hooks);
    await this.ensureConnected(transport, commandHooks);
    await transport.execute(command, commandHooks);
  }

  private async runInfoBaseOperation<T>(hooks: AgentOperationHooks | undefined, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      try {
        await this.disconnectInfoBase(hooks);
      } catch (disconnectError) {
        const message = disconnectError instanceof Error ? disconnectError.message : String(disconnectError);
        hooks?.onMessage?.(`Не удалось отключить информационную базу после ошибки операции: ${message}`);
      }
      throw error;
    } finally {
      if (this.connected) {
        await this.disconnectInfoBase(hooks);
      }
      await this.resetAgentSession(hooks);
    }
  }

  private async resetAgentSession(hooks?: AgentOperationHooks): Promise<void> {
    if (!isResettableTransportFactory(this.transportFactory)) {
      return;
    }
    try {
      await this.transportFactory.reset('default');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      hooks?.onMessage?.(`Не удалось сбросить SSH-сессию агента: ${message}`);
    }
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

function isResettableTransportFactory(
  factory: DesignerAgentTransportFactory | ResettableDesignerAgentTransportFactory
): factory is ResettableDesignerAgentTransportFactory {
  return typeof (factory as Partial<ResettableDesignerAgentTransportFactory>).reset === 'function';
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
