import * as path from 'path';
import type { ChildTag } from '../../../domain/ChildTag';
import { getMetaLabel } from '../../../domain/MetaTypes';
import { updateMetadataCacheAfterAdd } from '../../../infra/cache/MetadataCache';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import type { TemplateType } from '../../../infra/xml';
import type { AddMetadataTarget, MetadataNode } from '../../tree/TreeNode';
import type { CommandServices } from '../_shared';

export interface AddMetadataMutationInput {
  readonly target: AddMetadataTarget;
  readonly name: string;
  readonly templateType?: TemplateType;
  readonly sourceNode?: MetadataNode;
}

export interface AddMetadataMutationResult {
  readonly success: boolean;
  readonly message: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Единая точка добавления объектов метаданных.
 * UI-команда и MCP-инструмент используют этот сервис, чтобы не расходиться
 * в проверках хранилища, обновлении кэша и маркировке изменённых конфигураций.
 */
export class MetadataMutationService {
  constructor(private readonly services: CommandServices) {}

  async addMetadata(input: AddMetadataMutationInput): Promise<AddMetadataMutationResult> {
    const nameValidationError = validateMetadataName(input.name);
    if (nameValidationError) {
      return this.fail(nameValidationError);
    }

    const restricted = this.validateRepositoryAccess(input.target);
    if (restricted) {
      return this.fail(restricted);
    }

    const result = input.target.kind === 'root'
      ? this.services.metadataXmlCreator.addRootObject({
          configRoot: input.target.configRoot,
          kind: input.target.targetKind,
          name: input.name,
          templateType: input.templateType,
        })
      : this.services.metadataXmlCreator.addChildElement({
          ownerObjectXmlPath: input.target.ownerObjectXmlPath,
          childTag: input.target.childTag,
          name: input.name,
          tabularSectionName: input.target.tabularSectionName,
          templateType: input.templateType,
        });

    if (!result.success) {
      return {
        success: false,
        message: `Не удалось добавить метаданные: ${result.errors.join('\n')}`,
        changedFiles: [],
        warnings: result.warnings,
        errors: result.errors,
      };
    }

    for (const warning of result.warnings) {
      this.services.outputChannel.appendLine(`[add-metadata][warn] ${warning}`);
    }
    for (const changedFile of result.changedFiles) {
      this.services.outputChannel.appendLine(`[add-metadata] ${changedFile}`);
    }

    this.services.suppressConfigurationReloadForFiles(result.changedFiles);
    await this.refreshTreeAfterAdd(input.target, input.name, input.sourceNode);
    this.services.markChangedConfigurationByFiles(result.changedFiles);
    this.services.refreshActionsView();

    return {
      success: true,
      message: `Метаданные "${input.name}" добавлены.`,
      changedFiles: result.changedFiles,
      warnings: result.warnings,
      errors: [],
    };
  }

  private validateRepositoryAccess(target: AddMetadataTarget): string | null {
    const repositoryTarget = target.kind === 'root'
      ? this.services.repositoryService.resolveTargetByConfigRoot(target.configRoot)
      : this.services.repositoryService.resolveTargetByXmlPath(target.ownerObjectXmlPath);
    const ownerObjectXmlPath = target.kind === 'child' ? target.ownerObjectXmlPath : undefined;
    if (!repositoryTarget || !this.services.repositoryService.isMetadataEditRestricted(repositoryTarget, ownerObjectXmlPath)) {
      return null;
    }

    return target.kind === 'root'
      ? 'Добавление запрещено: корень конфигурации или расширения не захвачен в хранилище.'
      : 'Добавление запрещено: объект не захвачен в хранилище.';
  }

  private async refreshTreeAfterAdd(
    target: AddMetadataTarget,
    name: string,
    sourceNode: MetadataNode | undefined
  ): Promise<void> {
    const entry = this.findTargetEntry(target);
    if (entry) {
      const cacheUpdate = updateMetadataCacheAfterAdd(
        this.services.workspaceFolder.uri.fsPath,
        entry,
        target,
        name
      );
      if (!cacheUpdate.updatedPartially) {
        this.services.outputChannel.appendLine('[add-metadata][warn] Частичное обновление кэша не удалось, кэш конфигурации пересобран.');
      }
      if (sourceNode && this.services.treeProvider.refreshNodeFromCache(sourceNode, cacheUpdate.snapshot)) {
        return;
      }
      this.services.treeProvider.refresh();
      return;
    }

    this.services.outputChannel.appendLine('[add-metadata][warn] Не удалось найти конфигурацию для частичного обновления кэша.');
    await this.services.reloadEntries();
  }

  private findTargetEntry(target: AddMetadataTarget) {
    const configRoot = target.kind === 'root'
      ? target.configRoot
      : getObjectLocationFromXml(target.ownerObjectXmlPath).configRoot;
    const normalizedConfigRoot = path.resolve(configRoot).toLowerCase();
    return this.services.treeProvider
      .getEntries()
      .find((entry) => path.resolve(entry.rootPath).toLowerCase() === normalizedConfigRoot);
  }

  private fail(message: string): AddMetadataMutationResult {
    return {
      success: false,
      message,
      changedFiles: [],
      warnings: [],
      errors: [message],
    };
  }
}

export function validateMetadataName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Введите имя.';
  }
  if (!/^[\p{L}][\p{L}\p{Nd}_]*$/u.test(trimmed)) {
    return 'Имя должно начинаться с буквы и содержать только буквы, цифры и подчёркивание.';
  }
  return undefined;
}

export function getChildLabel(childTag: ChildTag | 'Column'): string {
  switch (childTag) {
    case 'Attribute':
      return 'Реквизит';
    case 'AddressingAttribute':
      return 'Реквизит адресации';
    case 'TabularSection':
      return 'Табличная часть';
    case 'Form':
      return 'Форма';
    case 'Command':
      return 'Команда';
    case 'Template':
      return 'Макет';
    case 'Dimension':
      return 'Измерение';
    case 'Resource':
      return 'Ресурс';
    case 'EnumValue':
      return 'Значение перечисления';
    case 'Column':
      return 'Колонка';
    default:
      return 'Элемент';
  }
}

export function getAddMetadataLabel(target: AddMetadataTarget): string {
  return target.kind === 'root'
    ? getMetaLabel(target.targetKind)
    : getChildLabel(target.childTag);
}
