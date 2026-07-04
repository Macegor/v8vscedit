import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SubsystemXmlService } from '../../infra/xml/SubsystemXmlService';

suite('SubsystemXmlService — unescape синонима с &apos;/&quot; (X2)', () => {
  test('синоним с &apos; в исходном XML декодируется в апостроф, а не остаётся как есть', () => {
    // SubsystemXmlService.unescapeXmlText декодирует только &lt;/&gt;/&amp; — &apos; и &quot;
    // остаются нетронутыми. 1С экранирует апостроф в LocalStringType как &apos;
    // ("Товары &apos;Люкс&apos;"), поэтому синоним с апострофом читается расширением "сырым".
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-subsystem-apos-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    fs.mkdirSync(path.join(configRoot, 'Subsystems'), { recursive: true });
    fs.writeFileSync(
      path.join(configRoot, 'Subsystems', 'Продажи.xml'),
      buildSubsystemXml('Продажи', 'Товары &apos;Люкс&apos;'),
      'utf-8'
    );

    const service = new SubsystemXmlService();
    const info = service.readSubsystem(path.join(configRoot, 'Subsystems', 'Продажи.xml'));

    assert.strictEqual(info.synonym, `Товары 'Люкс'`, `синоним должен декодировать &apos; в апостроф, получено: "${info.synonym}"`);
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
    </ChildObjects>
  </Configuration>
</MetaDataObject>`;
}

function buildSubsystemXml(name: string, synonymContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Subsystem>
    <Properties>
      <Name>${name}</Name>
      <Synonym>
        <v8:item>
          <v8:lang>ru</v8:lang>
          <v8:content>${synonymContent}</v8:content>
        </v8:item>
      </Synonym>
      <Content/>
    </Properties>
    <ChildObjects/>
  </Subsystem>
</MetaDataObject>`;
}
