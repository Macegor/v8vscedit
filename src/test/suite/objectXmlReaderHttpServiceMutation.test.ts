import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

/**
 * Обновление свойств Method/URLTemplate (HTTPMethod/Handler/Template) через
 * `ObjectXmlReader.updatePropertyInObject`. Метод — третий уровень вложенности,
 * поэтому локатор обязан быть nesting-aware по `urlTemplateName` (аналог
 * `tabularSectionName` у Column): соседний ОДНОИМЁННЫЙ Method в другом
 * URLTemplate не должен быть задет.
 *
 * До реализации (targetKind не принимает 'Method'/'URLTemplate', нет ветки
 * с `urlTemplateName` в локаторе диапазона) все вызовы с `targetKind: 'Method'`
 * возвращают `false` и не меняют файл — родовой `findChildMetaElementRange`
 * ищет только в ВЕРХНЕУРОВНЕВОМ `<ChildObjects>` объекта, а `Method` лежит
 * глубже, во вложенном `<ChildObjects>` шаблона.
 */
const SERVICE_ENTRY_XML = path.resolve(__dirname, '../../../example/2.21/src/cf/HTTPServices/ServiceEntry.xml');

function copyDonor(): { root: string; xmlPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-http-mutation-'));
  const xmlPath = path.join(root, 'ServiceEntry.xml');
  fs.copyFileSync(SERVICE_ENTRY_XML, xmlPath);
  return { root, xmlPath };
}

function updateMethodProperty(
  reader: ObjectXmlReader,
  xmlPath: string,
  options: { targetName: string; urlTemplateName: string; propertyKey: string; value: string }
): boolean {
  return reader.updatePropertyInObject(xmlPath, {
    targetKind: 'Method',
    targetName: options.targetName,
    urlTemplateName: options.urlTemplateName,
    propertyKey: options.propertyKey,
    valueKind: 'string',
    value: options.value,
  });
}

suite('ObjectXmlReader — обновление свойств HTTP-сервиса (Method/URLTemplate)', () => {
  test('updatePropertyInObject(Handler) меняет Handler ровно у нужного Method (PostEntries.POST)', () => {
    const { xmlPath } = copyDonor();
    const reader = new ObjectXmlReader();
    const ok = updateMethodProperty(reader, xmlPath, {
      targetName: 'POST',
      urlTemplateName: 'PostEntries',
      propertyKey: 'Handler',
      value: 'NewPostHandler',
    });
    assert.strictEqual(ok, true, 'реальное изменение Handler должно считаться изменением');

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<Handler>NewPostHandler</Handler>'), 'Handler должен обновиться');
    assert.ok(!xml.includes('<Handler>PostEntriesPOST</Handler>'), 'старое значение Handler не должно остаться');
    // Соседний Method (ping.GET) не должен быть затронут.
    assert.ok(xml.includes('<Handler>pingGET</Handler>'), 'Handler соседнего метода "ping.GET" должен остаться нетронутым');
  });

  test('updatePropertyInObject(HTTPMethod) меняет метод ping.GET на PUT, не затрагивая PostEntries.POST', () => {
    const { xmlPath } = copyDonor();
    const reader = new ObjectXmlReader();
    const ok = updateMethodProperty(reader, xmlPath, {
      targetName: 'GET',
      urlTemplateName: 'ping',
      propertyKey: 'HTTPMethod',
      value: 'PUT',
    });
    assert.strictEqual(ok, true);

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<HTTPMethod>PUT</HTTPMethod>'));
    assert.ok(xml.includes('<HTTPMethod>POST</HTTPMethod>'), 'HTTPMethod соседнего PostEntries.POST должен остаться "POST"');
  });

  test('updatePropertyInObject(Template) меняет Template ИМЕННО у URLTemplate "PostEntries", "ping" не тронут', () => {
    const { xmlPath } = copyDonor();
    const reader = new ObjectXmlReader();
    const ok = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'URLTemplate',
      targetName: 'PostEntries',
      propertyKey: 'Template',
      valueKind: 'string',
      value: '/v2/post/entries',
    });
    assert.strictEqual(ok, true);

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<Template>/v2/post/entries</Template>'));
    assert.ok(xml.includes('<Template>/ping</Template>'), 'Template соседнего "ping" должен остаться прежним');
  });

  test('РЕГРЕССИЯ M1-аналог: одноимённые Method("GET") в РАЗНЫХ URLTemplate — правится только целевой', () => {
    // Донор содержит разные имена (POST/GET) — переименовываем метод "POST" в
    // "PostEntries" на "GET", получая коллизию имён в разных контейнерах.
    const { xmlPath } = copyDonor();
    let xml = fs.readFileSync(xmlPath, 'utf-8');
    xml = xml
      .replace('<Name>POST</Name>', '<Name>GET</Name>')
      .replace('<HTTPMethod>POST</HTTPMethod>', '<HTTPMethod>GET</HTTPMethod>');
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    const reader = new ObjectXmlReader();
    const ok = updateMethodProperty(reader, xmlPath, {
      targetName: 'GET',
      urlTemplateName: 'ping',
      propertyKey: 'Handler',
      value: 'NewPingHandler',
    });
    assert.strictEqual(ok, true);

    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<Handler>NewPingHandler</Handler>'), 'Handler у ping.GET должен обновиться');
    assert.ok(updated.includes('<Handler>PostEntriesPOST</Handler>'), 'Handler у PostEntries.GET (тот же техимя "GET") должен остаться нетронутым');
  });

  test('идемпотентность: повторное применение того же значения не считается изменением и не трогает файл', () => {
    const { xmlPath } = copyDonor();
    const reader = new ObjectXmlReader();
    const first = updateMethodProperty(reader, xmlPath, {
      targetName: 'GET',
      urlTemplateName: 'ping',
      propertyKey: 'Handler',
      value: 'pingGETv2',
    });
    assert.strictEqual(first, true);
    const afterFirst = fs.readFileSync(xmlPath, 'utf-8');

    const second = updateMethodProperty(reader, xmlPath, {
      targetName: 'GET',
      urlTemplateName: 'ping',
      propertyKey: 'Handler',
      value: 'pingGETv2',
    });
    assert.strictEqual(second, false, 'повторное применение того же значения не должно считаться изменением');
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), afterFirst, 'файл не должен измениться при идемпотентном вызове');
  });

  test('Method с несуществующим urlTemplateName — targetRange не найден, false, файл не тронут', () => {
    const { xmlPath } = copyDonor();
    const original = fs.readFileSync(xmlPath, 'utf-8');
    const reader = new ObjectXmlReader();
    const ok = updateMethodProperty(reader, xmlPath, {
      targetName: 'POST',
      urlTemplateName: 'НетТакогоШаблона',
      propertyKey: 'Handler',
      value: 'Х',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original);
  });

  test('Method без urlTemplateName — targetRange не строится (по аналогии с Column без tabularSectionName)', () => {
    const { xmlPath } = copyDonor();
    const original = fs.readFileSync(xmlPath, 'utf-8');
    const reader = new ObjectXmlReader();
    const ok = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'Method',
      targetName: 'POST',
      propertyKey: 'Handler',
      valueKind: 'string',
      value: 'Х',
    });
    assert.strictEqual(ok, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original);
  });
});
