import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationXmlEditor } from '../../infra/xml';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { McpPropertyService } from '../../ui/mcp/McpPropertyService';

suite('McpPropertyService', () => {
  test('возвращает enum-контракт конкретного свойства конкретного реквизита', () => {
    const xmlPath = path.resolve('example/src/cf/Catalogs/Банки.xml');
    const node = createAttributeNode(xmlPath);
    const service = new McpPropertyService(new ConfigurationXmlEditor());

    const contract = service.getPropertyContract(node, 'FillChecking');

    assert.strictEqual(contract.propertyKey, 'FillChecking');
    assert.strictEqual(contract.kind, 'enum');
    assert.strictEqual(contract.supportedBySetProperty, true);
    assert.deepStrictEqual(
      contract.allowedValues?.map((item) => item.value),
      ['DontCheck', 'ShowError', 'ShowWarning']
    );
  });

  test('запрещает недопустимое enum-значение до записи XML', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-prop-'));
    try {
      const catalogDir = path.join(root, 'Catalogs');
      fs.mkdirSync(catalogDir, { recursive: true });
      const xmlPath = path.join(catalogDir, 'Банки.xml');
      fs.copyFileSync(path.resolve('example/src/cf/Catalogs/Банки.xml'), xmlPath);
      const before = fs.readFileSync(xmlPath, 'utf-8');
      const node = createAttributeNode(xmlPath);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      assert.throws(
        () => service.setProperty(node, 'FillChecking', 'BadValue'),
        /Недопустимое значение/
      );
      assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createAttributeNode(ownerXmlPath: string): MetadataNode {
  return new MetadataNode({
    label: 'КоррСчет',
    nodeKind: 'Attribute',
    xmlPath: ownerXmlPath,
    metaContext: {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: ownerXmlPath,
    },
  }, vscode.TreeItemCollapsibleState.None);
}
