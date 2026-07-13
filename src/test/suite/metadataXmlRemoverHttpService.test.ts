import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlRemover } from '../../infra/xml/MetadataXmlRemover';

/**
 * Удаление Method/URLTemplate из HTTP-сервиса. Method — третий уровень
 * вложенности, поэтому удаление обязано быть nesting-aware по `urlTemplateName`
 * (аналог `tabularSectionName` у Column): `removeNamedChildFromObjectXml` сейчас
 * ищет блок ПО ИМЕНИ ТЕГА+<Name> ГДЕ УГОДНО в файле (без учёта владельца-контейнера),
 * поэтому одноимённые Method в разных URLTemplate различить не может — именно
 * это и должна закрыть новая ветка `removeMethodFromUrlTemplateXml`.
 */
const SERVICE_ENTRY_XML = path.resolve(__dirname, '../../../example/2.21/src/cf/HTTPServices/ServiceEntry.xml');

function copyDonor(): { root: string; xmlPath: string; original: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-http-remove-'));
  const xmlPath = path.join(root, 'ServiceEntry.xml');
  const original = fs.readFileSync(SERVICE_ENTRY_XML, 'utf-8');
  fs.writeFileSync(xmlPath, original, 'utf-8');
  return { root, xmlPath, original };
}

function removeMethod(remover: MetadataXmlRemover, xmlPath: string, name: string, urlTemplateName: string) {
  return remover.removeChildElement({
    ownerObjectXmlPath: xmlPath,
    childTag: 'Method',
    name,
    urlTemplateName,
  });
}

function removeUrlTemplate(remover: MetadataXmlRemover, xmlPath: string, name: string) {
  return remover.removeChildElement({
    ownerObjectXmlPath: xmlPath,
    childTag: 'URLTemplate',
    name,
  });
}

suite('MetadataXmlRemover — удаление Method/URLTemplate из HTTP-сервиса (донор ServiceEntry.xml)', () => {
  test('удаление Method "POST" из "PostEntries" — метод исчезает, "ping.GET" не тронут', () => {
    const { xmlPath } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = removeMethod(remover, xmlPath, 'POST', 'PostEntries');
    assert.strictEqual(result.success, true, result.errors.join('; '));

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(!xml.includes('PostEntriesPOST'), 'Handler удалённого метода не должен остаться');
    assert.ok(xml.includes('pingGET'), 'соседний метод "ping.GET" должен остаться');
    // URLTemplate "PostEntries" остаётся (удаляется только Method, не сам шаблон).
    assert.ok(xml.includes('<Name>PostEntries</Name>'));
  });

  test('РЕГРЕССИЯ M1-аналог: одноимённые Method("GET") в разных URLTemplate — удаляется только целевой', () => {
    // Переименовываем "POST"→"GET" в PostEntries, получая коллизию имён Method
    // в разных контейнерах: удаление "GET" из "ping" не должно тронуть "GET"
    // (бывший POST) в "PostEntries".
    const { xmlPath } = copyDonor();
    let xml = fs.readFileSync(xmlPath, 'utf-8');
    xml = xml
      .replace('<Name>POST</Name>', '<Name>GET</Name>')
      .replace('<HTTPMethod>POST</HTTPMethod>', '<HTTPMethod>GET</HTTPMethod>');
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    const remover = new MetadataXmlRemover();
    const result = removeMethod(remover, xmlPath, 'GET', 'ping');
    assert.strictEqual(result.success, true, result.errors.join('; '));

    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(!updated.includes('pingGET'), 'метод "GET" из "ping" должен быть удалён');
    assert.ok(updated.includes('PostEntriesPOST'), 'одноимённый метод "GET" в "PostEntries" должен остаться');
  });

  test('удаление Method с ЧУЖИМ urlTemplateName ("POST" ищется в "ping") — ошибка «не найден», файл не тронут', () => {
    const { xmlPath, original } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = removeMethod(remover, xmlPath, 'POST', 'ping');
    assert.strictEqual(result.success, false, 'метод "POST" не принадлежит "ping" — удаление должно провалиться');
    assert.ok(result.errors.length > 0);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original, 'файл не должен измениться при неуспешном удалении');
  });

  test('удаление несуществующего Method — ошибка «не найден», файл не тронут', () => {
    const { xmlPath, original } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = removeMethod(remover, xmlPath, 'DELETE', 'PostEntries');
    assert.strictEqual(result.success, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original);
  });

  test('РЕГРЕСС: удаление URLTemplate целиком удаляет и вложенный Method (уже штатный removeNamedChildFromObjectXml)', () => {
    const { xmlPath } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = removeUrlTemplate(remover, xmlPath, 'PostEntries');
    assert.strictEqual(result.success, true, result.errors.join('; '));

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(!xml.includes('<Name>PostEntries</Name>'), 'URLTemplate "PostEntries" должен быть удалён');
    assert.ok(!xml.includes('PostEntriesPOST'), 'вложенный Method должен быть удалён вместе с шаблоном');
    assert.ok(xml.includes('<Name>ping</Name>'), 'соседний URLTemplate "ping" должен остаться');
    assert.ok(xml.includes('pingGET'), 'Method соседнего "ping" должен остаться нетронутым');
  });

  test('удаление несуществующего URLTemplate — ошибка «не найден»', () => {
    const { xmlPath, original } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = removeUrlTemplate(remover, xmlPath, 'НетТакогоШаблона');
    assert.strictEqual(result.success, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original);
  });

  test('удаление Method БЕЗ urlTemplateName вовсе — ошибка «Не указан URL-шаблон», файл не тронут', () => {
    const { xmlPath, original } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = remover.removeChildElement({
      ownerObjectXmlPath: xmlPath,
      childTag: 'Method',
      name: 'POST',
    });

    assert.strictEqual(result.success, false, 'без urlTemplateName удаление Method должно провалиться');
    assert.ok(result.errors.length > 0);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original);
  });

  test('удаление Method из НЕСУЩЕСТВУЮЩЕГО URLTemplate (urlTemplateName задан, но такого шаблона нет) — ошибка «не найден», файл не тронут', () => {
    const { xmlPath, original } = copyDonor();
    const remover = new MetadataXmlRemover();
    const result = removeMethod(remover, xmlPath, 'POST', 'НетТакогоШаблона');

    assert.strictEqual(result.success, false, 'URL-шаблон "НетТакогоШаблона" не существует — удаление должно провалиться');
    assert.ok(result.errors.length > 0);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), original);
  });
});
