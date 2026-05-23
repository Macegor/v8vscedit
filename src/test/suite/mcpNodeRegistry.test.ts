import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { McpNodeRegistry } from '../../ui/mcp/McpNodeRegistry';
import type { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { MetadataNode } from '../../ui/tree/TreeNode';

suite('McpNodeRegistry', () => {
  test('различает одноимённые группы добавления по объекту-владельцу', () => {
    const dataProcessorTemplates = createTemplatesGroup(
      '/tmp/cf/DataProcessors/Редактор/Редактор.xml'
    );
    const exchangePlanTemplates = createTemplatesGroup(
      '/tmp/cf/ExchangePlans/АвтономнаяРабота/АвтономнаяРабота.xml'
    );
    const root = new MetadataNode({
      label: 'Конфигурация',
      nodeKind: 'configuration',
      childrenLoader: () => [dataProcessorTemplates, exchangePlanTemplates],
    }, vscode.TreeItemCollapsibleState.Expanded);
    const registry = new McpNodeRegistry(createProvider(root));

    const nodes = registry.listNodes({ query: 'Макеты' });

    assert.strictEqual(nodes.length, 2);
    assert.notStrictEqual(nodes[0].nodeId, nodes[1].nodeId);
    assert.strictEqual(
      nodes[0].addMetadataTarget?.kind === 'child' ? nodes[0].addMetadataTarget.ownerObjectXmlPath : undefined,
      dataProcessorTemplates.addMetadataTarget?.kind === 'child'
        ? dataProcessorTemplates.addMetadataTarget.ownerObjectXmlPath
        : undefined
    );
    assert.strictEqual(
      nodes[1].addMetadataTarget?.kind === 'child' ? nodes[1].addMetadataTarget.ownerObjectXmlPath : undefined,
      exchangePlanTemplates.addMetadataTarget?.kind === 'child'
        ? exchangePlanTemplates.addMetadataTarget.ownerObjectXmlPath
        : undefined
    );
    assert.strictEqual(registry.resolveNode(nodes[0].nodeId), dataProcessorTemplates);
    assert.strictEqual(registry.resolveNode(nodes[1].nodeId), exchangePlanTemplates);
  });
});

function createTemplatesGroup(ownerObjectXmlPath: string): MetadataNode {
  return new MetadataNode({
    label: 'Макеты',
    nodeKind: 'group-type',
    addMetadataTarget: {
      kind: 'child',
      ownerObjectXmlPath: path.resolve(ownerObjectXmlPath),
      childTag: 'Template',
    },
  }, vscode.TreeItemCollapsibleState.Collapsed);
}

function createProvider(root: MetadataNode): MetadataTreeProvider {
  const findNode = (predicate: (node: MetadataNode) => boolean): MetadataNode | undefined => {
    const visit = (node: MetadataNode): MetadataNode | undefined => {
      if (predicate(node)) {
        return node;
      }
      for (const child of node.childrenLoader?.() ?? []) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };
    return visit(root);
  };

  return {
    getAutomationRoots: () => [root],
    findNode,
  } as unknown as MetadataTreeProvider;
}
