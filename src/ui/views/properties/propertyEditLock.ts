import * as fs from 'fs';
import type { MetadataNode } from '../../tree/TreeNode';
import { extractChildMetaElementXml, extractColumnXmlFromTabularSection } from '../../../infra/xml';
import type { RepositoryService } from '../../../infra/repository/RepositoryService';
import { type SupportInfoService, SupportMode } from '../../../infra/support/SupportInfoService';
import { extractUuidFromXml } from './PropertiesTargetResolver';

/**
 * Зависимости edit-lock резолвера. Сервисы прокидываются из уже
 * инжектированных полей контроллера — модуль не создаёт их сам (запрет №7).
 */
export interface PropertyEditLockDeps {
  readonly supportService?: SupportInfoService;
  readonly repositoryService?: RepositoryService;
}

/**
 * Определяет режим поддержки узла, разветвляясь по `node.nodeKind`: для
 * дочерних тегов (Attribute/AddressingAttribute/Dimension/Resource) и Column
 * uuid извлекается из вложенного XML владельца, для SessionParameter/
 * CommonAttribute — с корня файла, иначе поддержка берётся по всему файлу.
 */
export function resolveNodeSupportMode(node: MetadataNode, deps: PropertyEditLockDeps): SupportMode {
  const supportService = deps.supportService;
  if (!supportService) {
    return SupportMode.None;
  }
  const xmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
  if (!xmlPath || !fs.existsSync(xmlPath)) {
    return SupportMode.None;
  }

  const childTagMap: Partial<Record<string, 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource'>> = {
    Attribute: 'Attribute',
    AddressingAttribute: 'AddressingAttribute',
    Dimension: 'Dimension',
    Resource: 'Resource',
  };
  const childTag = childTagMap[node.nodeKind];
  if (childTag) {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const childXml = extractChildMetaElementXml(xml, childTag, node.textLabel);
    const uuid = extractUuidFromXml(childXml);
    return uuid ? supportService.getSupportModeByUuid(xmlPath, uuid) : supportService.getSupportMode(xmlPath);
  }

  if (node.nodeKind === 'Column') {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const columnXml = extractColumnXmlFromTabularSection(xml, node.metaContext?.tabularSectionName ?? '', node.textLabel);
    const uuid = extractUuidFromXml(columnXml);
    return uuid ? supportService.getSupportModeByUuid(xmlPath, uuid) : supportService.getSupportMode(xmlPath);
  }

  if (node.nodeKind === 'SessionParameter' || node.nodeKind === 'CommonAttribute') {
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    const uuid = extractUuidFromXml(xml);
    return uuid ? supportService.getSupportModeByUuid(xmlPath, uuid) : supportService.getSupportMode(xmlPath);
  }

  if (!xmlPath) {
    return SupportMode.None;
  }
  return supportService.getSupportMode(xmlPath);
}

export function isEditLockedBySupport(node: MetadataNode, deps: PropertyEditLockDeps): boolean {
  if (!deps.supportService) {
    return false;
  }
  const lockMode = resolveNodeSupportMode(node, deps);
  return lockMode === SupportMode.Locked;
}

export function isEditLockedByRepository(node: MetadataNode, deps: PropertyEditLockDeps): boolean {
  const repositoryService = deps.repositoryService;
  if (!repositoryService) {
    return false;
  }

  const xmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
  if (!xmlPath || !fs.existsSync(xmlPath)) {
    return false;
  }

  return repositoryService.isEditRestricted(xmlPath);
}

/**
 * Приоритет support над repository: repository не опрашивается, если объект
 * уже заблокирован поддержкой.
 */
export function resolveEditLockReason(
  node: MetadataNode,
  deps: PropertyEditLockDeps
): 'support' | 'repository' | undefined {
  if (isEditLockedBySupport(node, deps)) {
    return 'support';
  }
  if (isEditLockedByRepository(node, deps)) {
    return 'repository';
  }
  return undefined;
}
