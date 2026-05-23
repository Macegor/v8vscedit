import * as path from 'path';
import type { MetadataTreeProvider } from '../tree/MetadataTreeProvider';
import type { MetadataNode } from '../tree/TreeNode';
import type { AddMetadataTarget } from '../tree/TreeNodeModel';

interface EncodedNodeRef {
  readonly label: string;
  readonly nodeKind: string;
  readonly xmlPath?: string;
  readonly ownerObjectXmlPath?: string;
  readonly tabularSectionName?: string;
  readonly standardAttributeName?: string;
  readonly addMetadataTarget?: AddMetadataTarget;
}

export interface McpNodeSummary {
  readonly nodeId: string;
  readonly label: string;
  readonly nodeKind: string;
  readonly xmlPath?: string;
  readonly addMetadataTarget?: AddMetadataTarget;
  readonly canAddMetadata: boolean;
  readonly canRemoveMetadata: boolean;
}

export class McpNodeRegistry {
  constructor(private readonly treeProvider: MetadataTreeProvider) {}

  listNodes(options: { readonly query?: string; readonly rootPath?: string; readonly limit?: number } = {}): McpNodeSummary[] {
    const normalizedQuery = options.query?.trim().toLocaleLowerCase('ru-RU') ?? '';
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1_000));
    const roots = options.rootPath
      ? this.treeProvider.getAutomationRoots().filter((node) => this.isInsideRoot(node, options.rootPath ?? ''))
      : this.treeProvider.getAutomationRoots();
    const result: McpNodeSummary[] = [];
    const visit = (node: MetadataNode): void => {
      if (result.length >= limit) {
        return;
      }
      const matches = !normalizedQuery ||
        node.textLabel.toLocaleLowerCase('ru-RU').includes(normalizedQuery) ||
        node.nodeKind.toLocaleLowerCase('ru-RU').includes(normalizedQuery);
      if (matches) {
        result.push(this.summarize(node));
      }
      for (const child of node.childrenLoader?.() ?? []) {
        visit(child);
      }
    };
    for (const root of roots) {
      visit(root);
    }
    return result;
  }

  resolveNode(nodeId: string): MetadataNode {
    const ref = this.decode(nodeId);
    const found = this.treeProvider.findNode((node) => {
      if (node.nodeKind !== ref.nodeKind || node.textLabel !== ref.label) {
        return false;
      }
      if ((node.xmlPath ?? '') !== (ref.xmlPath ?? '')) {
        return false;
      }
      return (
        (node.metaContext?.ownerObjectXmlPath ?? '') === (ref.ownerObjectXmlPath ?? '') &&
        (node.metaContext?.tabularSectionName ?? '') === (ref.tabularSectionName ?? '') &&
        (node.metaContext?.standardAttributeName ?? '') === (ref.standardAttributeName ?? '') &&
        sameAddMetadataTarget(node.addMetadataTarget, ref.addMetadataTarget)
      );
    });
    if (!found) {
      throw new Error('Узел не найден. Обновите список узлов MCP-инструментом list_metadata_nodes.');
    }
    return found;
  }

  summarize(node: MetadataNode): McpNodeSummary {
    return {
      nodeId: this.encode(node),
      label: node.textLabel,
      nodeKind: node.nodeKind,
      xmlPath: node.xmlPath,
      addMetadataTarget: node.addMetadataTarget,
      canAddMetadata: Boolean(node.addMetadataTarget),
      canRemoveMetadata: Boolean(node.canRemoveMetadata),
    };
  }

  private encode(node: MetadataNode): string {
    const ref: EncodedNodeRef = {
      label: node.textLabel,
      nodeKind: node.nodeKind,
      xmlPath: node.xmlPath,
      ownerObjectXmlPath: node.metaContext?.ownerObjectXmlPath,
      tabularSectionName: node.metaContext?.tabularSectionName,
      standardAttributeName: node.metaContext?.standardAttributeName,
      addMetadataTarget: node.addMetadataTarget,
    };
    return Buffer.from(JSON.stringify(ref), 'utf-8').toString('base64url');
  }

  private decode(nodeId: string): EncodedNodeRef {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(nodeId, 'base64url').toString('utf-8'));
      if (!isEncodedNodeRef(parsed)) {
        throw new Error('Некорректный формат nodeId.');
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(`Не удалось прочитать nodeId: ${message}`);
      (wrapped as Error & { cause?: unknown }).cause = error;
      throw wrapped;
    }
  }

  private isInsideRoot(node: MetadataNode, rootPath: string): boolean {
    const anchor = node.xmlPath ?? node.model.decorationPath;
    if (!anchor) {
      return node.childrenLoader?.().some((child) => this.isInsideRoot(child, rootPath)) ?? false;
    }
    const relative = path.relative(path.resolve(rootPath), path.resolve(anchor));
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  }
}

function isEncodedNodeRef(value: unknown): value is EncodedNodeRef {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.label === 'string' &&
    typeof ref.nodeKind === 'string' &&
    isOptionalString(ref.xmlPath) &&
    isOptionalString(ref.ownerObjectXmlPath) &&
    isOptionalString(ref.tabularSectionName) &&
    isOptionalString(ref.standardAttributeName) &&
    isAddMetadataTarget(ref.addMetadataTarget)
  );
}

function isAddMetadataTarget(value: unknown): value is AddMetadataTarget | undefined {
  if (value === undefined) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const target = value as Record<string, unknown>;
  if (target.kind === 'root') {
    return (
      typeof target.configRoot === 'string' &&
      (target.configKind === 'cf' || target.configKind === 'cfe') &&
      typeof target.targetKind === 'string' &&
      isOptionalString(target.namePrefix)
    );
  }
  if (target.kind === 'child') {
    return (
      typeof target.ownerObjectXmlPath === 'string' &&
      typeof target.childTag === 'string' &&
      isOptionalString(target.tabularSectionName)
    );
  }
  return false;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function sameAddMetadataTarget(left: AddMetadataTarget | undefined, right: AddMetadataTarget | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'root' && right.kind === 'root') {
    return (
      samePath(left.configRoot, right.configRoot) &&
      left.configKind === right.configKind &&
      left.targetKind === right.targetKind &&
      (left.namePrefix ?? '') === (right.namePrefix ?? '')
    );
  }
  if (left.kind === 'child' && right.kind === 'child') {
    return (
      samePath(left.ownerObjectXmlPath, right.ownerObjectXmlPath) &&
      left.childTag === right.childTag &&
      (left.tabularSectionName ?? '') === (right.tabularSectionName ?? '')
    );
  }
  return false;
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}
