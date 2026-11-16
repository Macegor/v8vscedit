import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { isEditLockedBySupport, resolveNodeSupportMode } from '../../ui/views/properties/propertyEditLock';
import {
  LineLogger,
  makeTempDir,
  removeTempDir,
  testUuid,
  writeBin,
  writeFileIn,
} from './support/parentConfigurationsBin';

const OWNER = testUuid(201);
const ATTR_LOCKED = testUuid(202);
const ATTR_REMOVED = testUuid(203);
const ATTR_PLAIN = testUuid(204);

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject>
	<Catalog uuid="${OWNER}">
		<Properties><Name>Спр</Name></Properties>
		<ChildObjects>
			<Attribute uuid="${ATTR_LOCKED}"><Properties><Name>Запрещённый</Name></Properties></Attribute>
			<Attribute uuid="${ATTR_REMOVED}"><Properties><Name>СнятыйСПоддержки</Name></Properties></Attribute>
			<Attribute uuid="${ATTR_PLAIN}"><Properties><Name>Собственный</Name></Properties></Attribute>
		</ChildObjects>
	</Catalog>
</MetaDataObject>`;

/**
 * Edit-lock реквизита считается по uuid самого реквизита, а не по режиму
 * владельца: объект может быть «разрешён», а отдельный реквизит — «запрещён».
 * Реальный `SupportInfoService` и синтетический bin (плоская раскладка).
 */
suite('propertyEditLock — режим поддержки реквизита (реальный SupportInfoService)', () => {
  let tmp: string;
  let xmlPath: string;
  let supportService: SupportInfoService;

  setup(() => {
    tmp = makeTempDir('v8vscedit-edit-lock-');
    const cf = path.join(tmp, 'cf');
    xmlPath = writeFileIn(cf, 'Catalogs/Спр.xml', CATALOG_XML);
    writeBin(cf, [{
      name: 'П',
      records: [
        { code: 1, uuid: OWNER },
        { code: 0, uuid: ATTR_LOCKED },
        { code: 2, uuid: ATTR_REMOVED },
      ],
    }]);
    supportService = new SupportInfoService(new LineLogger());
    supportService.loadConfig(cf);
  });

  teardown(() => {
    removeTempDir(tmp);
  });

  function attributeNode(label: string): MetadataNode {
    return new MetadataNode(
      {
        label,
        nodeKind: 'Attribute',
        xmlPath,
        metaContext: { rootMetaKind: 'Catalog', ownerObjectXmlPath: xmlPath },
      },
      vscode.TreeItemCollapsibleState.None
    );
  }

  test('объект с кодом 1, реквизит с кодом 0 → реквизит заблокирован поддержкой', () => {
    const node = attributeNode('Запрещённый');
    assert.strictEqual(resolveNodeSupportMode(node, { supportService }), SupportMode.Locked);
    assert.strictEqual(isEditLockedBySupport(node, { supportService }), true);
  });

  test('реквизит с кодом 2 (снят с поддержки) — не блокируется', () => {
    const node = attributeNode('СнятыйСПоддержки');
    assert.strictEqual(resolveNodeSupportMode(node, { supportService }), SupportMode.Removed);
    assert.strictEqual(isEditLockedBySupport(node, { supportService }), false);
  });

  test('реквизит без записи — None, не блокируется; владелец с кодом 1 — Editable', () => {
    const node = attributeNode('Собственный');
    assert.strictEqual(resolveNodeSupportMode(node, { supportService }), SupportMode.None);
    assert.strictEqual(isEditLockedBySupport(node, { supportService }), false);
    assert.strictEqual(supportService.getSupportMode(xmlPath), SupportMode.Editable);
  });
});
