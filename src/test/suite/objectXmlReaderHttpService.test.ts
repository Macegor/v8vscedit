import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

/**
 * Донор: `example/2.21/src/cf/HTTPServices/ServiceEntry.xml` — HTTPService
 * «ServiceEntry» с двумя URLTemplate (PostEntries → Method POST/PostEntriesPOST;
 * ping → Method GET/pingGET). `ObjectXmlReader.parseChildren` разбирает ветку
 * 'URLTemplate' через `toUrlTemplateChild` (по образцу `toTabularSectionChild`),
 * где `columns` переиспользуется под вложенные Method.
 */
const SERVICE_ENTRY_XML = path.resolve(__dirname, '../../../example/2.21/src/cf/HTTPServices/ServiceEntry.xml');

suite('ObjectXmlReader.parse — HTTPService → URLTemplate → Method (донор ServiceEntry.xml)', () => {
  test('читает ровно 2 URLTemplate верхнего уровня с именами/синонимами из донора', () => {
    const reader = new ObjectXmlReader();
    const result = reader.read(SERVICE_ENTRY_XML);
    assert.ok(result, 'донор должен парситься');
    assert.strictEqual(result.tag, 'HTTPService');
    assert.strictEqual(result.name, 'ServiceEntry');
    assert.strictEqual(result.synonym, 'Service entry');

    const urlTemplates = result.children.filter((child) => child.tag === 'URLTemplate');
    assert.strictEqual(urlTemplates.length, 2, `ожидались 2 URLTemplate, получено ${String(urlTemplates.length)}`);

    const postEntries = urlTemplates.find((child) => child.name === 'PostEntries');
    const ping = urlTemplates.find((child) => child.name === 'ping');
    assert.ok(postEntries, 'должен быть найден URLTemplate "PostEntries"');
    assert.ok(ping, 'должен быть найден URLTemplate "ping"');
    assert.strictEqual(postEntries.synonym, 'Post entries');
    assert.strictEqual(ping.synonym, 'Ping');
  });

  test('у каждого URLTemplate — ровно один вложенный Method в columns (переиспользование слота ТЧ/Колонка)', () => {
    const reader = new ObjectXmlReader();
    const result = reader.read(SERVICE_ENTRY_XML);
    assert.ok(result, 'донор должен парситься');
    const urlTemplates = result.children.filter((child) => child.tag === 'URLTemplate');
    const postEntries = urlTemplates.find((child) => child.name === 'PostEntries');
    const ping = urlTemplates.find((child) => child.name === 'ping');
    assert.ok(postEntries, 'должен быть найден URLTemplate "PostEntries"');
    assert.ok(ping, 'должен быть найден URLTemplate "ping"');

    assert.strictEqual(postEntries.columns?.length, 1, 'PostEntries должен содержать 1 Method');
    const postEntriesMethod = postEntries.columns[0];
    assert.ok(postEntriesMethod);
    assert.strictEqual(postEntriesMethod.tag, 'Method');
    assert.strictEqual(postEntriesMethod.name, 'POST');
    assert.strictEqual(postEntriesMethod.synonym, 'POST');

    assert.strictEqual(ping.columns?.length, 1, 'ping должен содержать 1 Method');
    const pingMethod = ping.columns[0];
    assert.ok(pingMethod);
    assert.strictEqual(pingMethod.tag, 'Method');
    assert.strictEqual(pingMethod.name, 'GET');
    assert.strictEqual(pingMethod.synonym, 'GET');
  });

  test('HTTPService без URLTemplate (пустой ChildObjects) — пустой список детей', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-http-empty-'));
    const xmlPath = path.join(root, 'Пустой.xml');
    fs.writeFileSync(
      xmlPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
        '\t<HTTPService uuid="00000000-0000-0000-0000-000000000000">',
        '\t\t<Properties>',
        '\t\t\t<Name>Пустой</Name>',
        '\t\t\t<Comment/>',
        '\t\t\t<RootURL/>',
        '\t\t\t<ReuseSessions>AutoUse</ReuseSessions>',
        '\t\t\t<SessionMaxAge>20</SessionMaxAge>',
        '\t\t</Properties>',
        '\t\t<ChildObjects/>',
        '\t</HTTPService>',
        '</MetaDataObject>',
        '',
      ].join('\n'),
      'utf-8'
    );

    const reader = new ObjectXmlReader();
    const result = reader.read(xmlPath);
    assert.ok(result);
    assert.strictEqual(result.children.length, 0, 'без URLTemplate список детей должен быть пуст');
  });
});
