import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildHashSnapshot } from '../../infra/cache/HashCache';
import { buildMetadataCacheSnapshot, type MetadataCacheNode } from '../../infra/cache/MetadataCache';
import { ConfigurationChangeDetector } from '../../infra/fs/ConfigurationChangeDetector';
import { parseV8iContent } from '../../infra/environment/InfoBaseRegistryService';
import { resolveV8ExecutablePath } from '../../infra/process/OnecPlatform';
import { runProcess } from '../../infra/process/ProcessRunner';
import { extractMobileFunctionalityUseItems } from '../../infra/xml/MetadataPropertiesXml';
import { buildEventSourceInnerXml } from '../../ui/views/properties/EventSubscriptionPropertyService';
import {
  buildMetadataTypeInnerXml,
  buildMetadataTypeItem,
} from '../../ui/views/properties/MetadataTypeService';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');
const EXAMPLE_CFE = path.resolve(__dirname, '../../../example/src/cfe/EVOLC');

suite('coverage edge-сценарии на реальных данных', () => {
  test('обходит оставшиеся ветки хеш-кэша, детектора изменений и кэша подсистем', function () {
    this.timeout(60000);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-coverage-'));
    const dataDir = path.join(tempRoot, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'Object.xml'), '<MetaDataObject/>', 'utf-8');

    const hash = buildHashSnapshot('scope', dataDir);
    assert.ok(hash.files['Object.xml']);

    const detector = new ConfigurationChangeDetector(tempRoot);
    const changes = detector.detect([
      { rootPath: EXAMPLE_CFE, kind: 'cfe' },
      { rootPath: EXAMPLE_CF, kind: 'cf' },
    ]);
    assert.ok(changes.length >= 2);
    assert.strictEqual(changes[0]?.kind, 'cf');

    const snapshot = buildMetadataCacheSnapshot('subsystems', { rootPath: EXAMPLE_CF, kind: 'cf' });
    const subsystem = findCacheNode(snapshot.root, (node) => node.type === 'Subsystem' && node.children.length > 0);
    assert.ok(subsystem, 'Ожидалась подсистема с дочерними подсистемами в example/src/cf');
  });

  test('проверяет дополнительные форматы v8i, платформу и ошибку запуска процесса', async () => {
    const bases = parseV8iContent(`
; комментарий до секций
[БезСоединения]
Connect=

[Файловая]
Connect=File="/tmp/base;with-semicolon";
OrderInList=not-a-number
`, '/tmp/list.v8i');
    assert.strictEqual(bases.length, 1);
    assert.strictEqual(bases[0]?.connection, '/F/tmp/base;with-semicolon');
    assert.strictEqual(bases[0]?.order, undefined);

    const platformDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-platform-'));
    const binDir = path.join(platformDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const exePath = path.join(binDir, process.platform === 'win32' ? '1cv8.exe' : '1cv8');
    fs.writeFileSync(exePath, '', 'utf-8');
    fs.chmodSync(exePath, 0o755);
    assert.strictEqual(resolveV8ExecutablePath(platformDir), exePath);

    await assert.rejects(
      () => runProcess({ command: path.join(platformDir, 'missing-1cv8'), args: [] }),
      /ENOENT/
    );
  });

  test('проверяет форматирование типов, источников событий и мобильных возможностей', () => {
    const typeXml = buildMetadataTypeInnerXml({
      items: [
        buildMetadataTypeItem('Number'),
        buildMetadataTypeItem('String'),
        buildMetadataTypeItem('Date'),
      ],
      numberQualifiers: { digits: 15, fractionDigits: 2, allowedSign: 'Nonnegative' },
      stringQualifiers: { length: 25, allowedLength: 'Fixed' },
      dateQualifiers: { dateFractions: 'Date' },
      presentation: '',
      rawInnerXml: '',
    });
    assert.ok(typeXml.includes('\t<v8:Digits>15</v8:Digits>'));
    assert.ok(typeXml.includes('\t<v8:Length>25</v8:Length>'));
    assert.ok(typeXml.includes('\t<v8:DateFractions>Date</v8:DateFractions>'));

    const eventSourceXml = buildEventSourceInnerXml({
      items: [
        buildMetadataTypeItem('DefinedType.Владелец'),
        buildMetadataTypeItem('DocumentObject.Заказ'),
      ],
      presentation: '',
      rawInnerXml: '',
    });
    assert.ok(eventSourceXml.includes('<v8:TypeSet>cfg:DefinedType.Владелец</v8:TypeSet>'));
    assert.ok(eventSourceXml.includes('<v8:Type>cfg:DocumentObject.Заказ</v8:Type>'));

    const mobile = extractMobileFunctionalityUseItems(`
      <app:functionality>
        <app:functionality>Location</app:functionality>
        <app:use>false</app:use>
      </app:functionality>
    `);
    assert.deepStrictEqual(mobile, [{ functionality: 'Location', use: false }]);
  });
});

function findCacheNode(
  node: MetadataCacheNode,
  predicate: (node: MetadataCacheNode) => boolean
): MetadataCacheNode | undefined {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children) {
    const found = findCacheNode(child, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}
