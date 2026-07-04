import type { MetadataNode } from '../../tree/TreeNode';
import type { BasedOnMetaKind } from '../../../infra/xml';
import { getObjectLocationFromXml } from '../../../infra/fs';
import { META_TYPES } from '../../../domain/MetaTypes';
import type {
  SubsystemMembershipSnapshot,
  SubsystemMembershipTreeNode,
  SubsystemXmlService,
} from '../../../infra/xml/SubsystemXmlService';
import type {
  ExchangePlanContentSnapshot,
  ExchangePlanContentService,
} from '../../../infra/xml/ExchangePlanContentService';
import { isRootObjectNode, resolvePropertyTarget } from './PropertiesTargetResolver';

/** Корень конфигурации/расширения — верхнеуровневый узел без объектного XML-таргета. */
export function isConfigurationRootNode(node: MetadataNode): boolean {
  return node.nodeKind === 'configuration' || node.nodeKind === 'extension';
}

/**
 * Узел, для которого поддерживается связь с подсистемами: корневой объект
 * метаданных с папкой выгрузки в META_TYPES; сама подсистема исключена.
 */
export function isSubsystemMembershipNode(node: MetadataNode): boolean {
  const target = resolvePropertyTarget(node);
  if (!target || !isRootObjectNode(node, target)) {
    return false;
  }
  if (node.nodeKind === 'Subsystem') {
    return false;
  }
  return Boolean(META_TYPES[node.nodeKind].folder);
}

/** Вид объекта для ввода на основании: только корневые Catalog/Document. */
export function resolveBasedOnKind(node: MetadataNode): BasedOnMetaKind | null {
  const target = resolvePropertyTarget(node);
  if (!target || !isRootObjectNode(node, target)) {
    return null;
  }
  return node.nodeKind === 'Catalog' || node.nodeKind === 'Document' ? node.nodeKind : null;
}

export function flattenSubsystemMembershipTree(
  tree: SubsystemMembershipTreeNode[]
): SubsystemMembershipTreeNode[] {
  const result: SubsystemMembershipTreeNode[] = [];
  const walk = (nodes: SubsystemMembershipTreeNode[]): void => {
    for (const node of nodes) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return result;
}

export function resolveSubsystemMembershipSnapshot(
  node: MetadataNode,
  subsystemXmlService: SubsystemXmlService
): SubsystemMembershipSnapshot | null {
  if (!isSubsystemMembershipNode(node) || !node.xmlPath) {
    return null;
  }
  try {
    const location = getObjectLocationFromXml(node.xmlPath);
    return subsystemXmlService.readMembershipSnapshot(
      location.configRoot,
      `${node.nodeKind}.${node.textLabel}`
    );
  } catch {
    return null;
  }
}

export function resolveExchangePlanContentSnapshot(
  node: MetadataNode,
  exchangePlanContentService: ExchangePlanContentService
): ExchangePlanContentSnapshot | null {
  if (node.nodeKind !== 'Catalog' || !isSubsystemMembershipNode(node) || !node.xmlPath) {
    return null;
  }
  try {
    const location = getObjectLocationFromXml(node.xmlPath);
    return exchangePlanContentService.readObjectContentSnapshot(
      location.configRoot,
      `${node.nodeKind}.${node.textLabel}`
    );
  } catch {
    return null;
  }
}
