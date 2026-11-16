import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import type { MetadataNode } from '../../ui/tree/TreeNode';
import { MetadataTreeProvider } from '../../ui/tree/MetadataTreeProvider';
import { LineLogger, makeTempDir, removeTempDir } from './support/parentConfigurationsBin';
import { SUPPORT_CATALOGS, buildSupportConfig } from './support/supportConfigFixture';

const EXTENSION_ROOT = path.resolve(__dirname, '../../../../');

function findNode(provider: MetadataTreeProvider, name: string): MetadataNode {
  const visit = (nodes: readonly MetadataNode[], depth: number): MetadataNode | undefined => {
    for (const node of nodes) {
      if (node.textLabel === name && node.xmlPath?.endsWith(`${name}.xml`)) {
        return node;
      }
      if (depth < 4) {
        const found = visit(provider.getChildren(node), depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  const node = visit(provider.getChildren(), 0);
  assert.ok(node, `узел ${name} не найден в дереве`);
  return node;
}

function supportTokens(contextValue: string | undefined): string[] {
  return (contextValue ?? '').match(/-support(?:None|Locked|Editable|Removed)/g) ?? [];
}

suite('MetadataTreeProvider — суффикс режима поддержки в contextValue', () => {
  let tmp: string;
  let cf: string;
  let provider: MetadataTreeProvider | undefined;

  setup(() => {
    tmp = makeTempDir('v8vscedit-tree-support-');
    cf = path.join(tmp, 'cf');
  });

  teardown(() => {
    provider?.dispose();
    provider = undefined;
    removeTempDir(tmp);
  });

  function createProvider(): MetadataTreeProvider {
    const support = new SupportInfoService(new LineLogger());
    provider = new MetadataTreeProvider(
      [{ kind: 'cf', rootPath: cf }],
      vscode.Uri.file(EXTENSION_ROOT),
      tmp,
      undefined,
      support
    );
    return provider;
  }

  for (const catalog of SUPPORT_CATALOGS) {
    test(`${catalog.mode}: getTreeItem добавляет ${catalog.suffix}`, () => {
      buildSupportConfig(cf, true);
      const tree = createProvider();
      const node = findNode(tree, catalog.name);
      const item = tree.getTreeItem(node) as MetadataNode;
      assert.deepStrictEqual(supportTokens(item.contextValue), [catalog.suffix]);
    });
  }

  test('без ParentConfigurations.bin суффикса поддержки нет', () => {
    buildSupportConfig(cf, false);
    const tree = createProvider();
    for (const catalog of SUPPORT_CATALOGS) {
      const item = tree.getTreeItem(findNode(tree, catalog.name)) as MetadataNode;
      assert.deepStrictEqual(supportTokens(item.contextValue), [], catalog.name);
    }
  });

  test('повторный getTreeItem не множит суффикс', () => {
    buildSupportConfig(cf, true);
    const tree = createProvider();
    const node = findNode(tree, 'Запрещённый');
    tree.getTreeItem(node);
    tree.getTreeItem(node);
    const item = tree.getTreeItem(node) as MetadataNode;
    assert.deepStrictEqual(supportTokens(item.contextValue), ['-supportLocked']);
  });
});
