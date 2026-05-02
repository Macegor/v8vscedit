import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SubsystemXmlService } from '../../infra/xml';

suite('SubsystemXmlService', () => {
  test('читает и сохраняет принадлежность объекта к подсистемам', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-subsystems-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    fs.mkdirSync(path.join(configRoot, 'Subsystems', 'Продажи', 'Subsystems', 'Розница'), { recursive: true });
    fs.writeFileSync(
      path.join(configRoot, 'Subsystems', 'Продажи.xml'),
      buildSubsystemXml('Продажи', ['Catalog.Товары'], ['Розница']),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(configRoot, 'Subsystems', 'Закупки.xml'),
      buildSubsystemXml('Закупки', [], []),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(configRoot, 'Subsystems', 'Продажи', 'Subsystems', 'Розница', 'Розница.xml'),
      buildSubsystemXml('Розница', [], []),
      'utf-8'
    );

    const service = new SubsystemXmlService();
    const initial = service.readMembershipSnapshot(configRoot, 'Catalog.Товары');

    assert.strictEqual(initial.tree.length, 2);
    assert.strictEqual(initial.selectedXmlPaths.length, 1);
    assert.strictEqual(initial.tree[0].children.length, 1);

    const purchasesPath = path.join(configRoot, 'Subsystems', 'Закупки.xml');
    const retailPath = path.join(configRoot, 'Subsystems', 'Продажи', 'Subsystems', 'Розница', 'Розница.xml');
    assert.strictEqual(service.setObjectSubsystemMembership(configRoot, 'Catalog.Товары', [purchasesPath, retailPath]), true);

    assert.ok(!fs.readFileSync(path.join(configRoot, 'Subsystems', 'Продажи.xml'), 'utf-8').includes('Catalog.Товары'));
    assert.ok(fs.readFileSync(purchasesPath, 'utf-8').includes('Catalog.Товары'));
    assert.ok(fs.readFileSync(retailPath, 'utf-8').includes('Catalog.Товары'));
  });
});

function buildConfigXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects>
      <Subsystem>Продажи</Subsystem>
      <Subsystem>Закупки</Subsystem>
    </ChildObjects>
  </Configuration>
</MetaDataObject>`;
}

function buildSubsystemXml(name: string, refs: string[], childSubsystems: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Subsystem>
    <Properties>
      <Name>${name}</Name>
      <Synonym/>
      ${refs.length > 0
        ? `<Content>${refs.map((ref) => `<xr:Item xsi:type="xr:MDObjectRef">${ref}</xr:Item>`).join('')}</Content>`
        : '<Content/>'}
    </Properties>
    ${childSubsystems.length > 0
      ? `<ChildObjects>${childSubsystems.map((child) => `<Subsystem>${child}</Subsystem>`).join('')}</ChildObjects>`
      : '<ChildObjects/>'}
  </Subsystem>
</MetaDataObject>`;
}
