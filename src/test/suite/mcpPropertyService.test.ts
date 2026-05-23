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

  test('принимает русские имена свойств и типов при смене типа', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-type-'));
    try {
      const xmlPath = path.join(root, 'Параметр.xml');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setType(node, 'Тип', {
        items: ['Число'],
        numberQualifiers: { digits: 15, fractionDigits: 2 },
      });

      assert.strictEqual(result.success, true);
      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<v8:Type>xs:decimal</v8:Type>'));
      assert.ok(saved.includes('<v8:Digits>15</v8:Digits>'));
      assert.ok(saved.includes('<v8:FractionDigits>2</v8:FractionDigits>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('принимает длину и точность прямо в изменении типа', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-type-flat-'));
    try {
      const xmlPath = path.join(root, 'Параметр.xml');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setType(node, 'Тип', {
        value: 'Число',
        length: 15,
        precision: 2,
      });

      assert.strictEqual(result.success, true);
      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<v8:Type>xs:decimal</v8:Type>'));
      assert.ok(saved.includes('<v8:Digits>15</v8:Digits>'));
      assert.ok(saved.includes('<v8:FractionDigits>2</v8:FractionDigits>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('запрещает ссылочный тип CFE, если объект не заимствован в расширение', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-cfe-type-'));
    try {
      fs.mkdirSync(path.join(root, 'SessionParameters'), { recursive: true });
      const configPath = path.join(root, 'Configuration.xml');
      const xmlPath = path.join(root, 'SessionParameters', 'Параметр.xml');
      fs.writeFileSync(configPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <Configuration>',
        '    <Properties>',
        '      <Name>Расширение</Name>',
        '      <NamePrefix>ев_</NamePrefix>',
        '      <ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>',
        '    </Properties>',
        '    <ChildObjects>',
        '      <Catalog>ев_Пользователи</Catalog>',
        '      <SessionParameter>Параметр</SessionParameter>',
        '    </ChildObjects>',
        '  </Configuration>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const available = service.getAvailableTypes(node, 'Тип').flatMap((group) => group.items.map((item) => item.value));
      assert.ok(available.includes('СправочникСсылка.ев_Пользователи'));
      assert.ok(!available.includes('СправочникСсылка.Пользователи'));

      assert.throws(
        () => service.setType(node, 'Тип', 'СправочникСсылка.Пользователи'),
        /Недопустимые типы/
      );
      const result = service.setType(node, 'Тип', 'СправочникСсылка.ев_Пользователи');
      assert.strictEqual(result.success, true);
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
