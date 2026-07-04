import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  extractChildMetaElementXml,
  extractMethodXmlFromUrlTemplate,
  findMethodRangeInUrlTemplate,
} from '../../infra/xml/XmlUtils';

const SERVICE_ENTRY_XML = path.resolve(__dirname, '../../../example/2.21/src/cf/HTTPServices/ServiceEntry.xml');

/**
 * `extractMethodXmlFromUrlTemplate` — симметричный двойник
 * `extractColumnXmlFromTabularSection`: должен различать одноимённые Method
 * из РАЗНЫХ URLTemplate (аналог: одноимённая колонка в разных ТЧ, M1).
 * `extractChildMetaElementXml('URLTemplate', name)` работает как есть
 * (родовой локатор, не завязан на конкретные теги) — тест фиксирует это как
 * характеризацию/регресс.
 */
suite('XmlUtils — извлечение Method из URLTemplate (донор ServiceEntry.xml)', () => {
  test('extractChildMetaElementXml("URLTemplate", "PostEntries") отдаёт блок с <Template>/post/entries</Template>', () => {
    const xml = fs.readFileSync(SERVICE_ENTRY_XML, 'utf-8');
    const block = extractChildMetaElementXml(xml, 'URLTemplate', 'PostEntries');
    assert.ok(block, 'блок URLTemplate "PostEntries" должен быть найден');
    assert.ok(block.includes('<Template>/post/entries</Template>'));
    assert.ok(block.includes('<Name>PostEntries</Name>'));
  });

  test('extractMethodXmlFromUrlTemplate("PostEntries", "POST") отдаёт блок Method с HTTPMethod=POST, Handler=PostEntriesPOST', () => {
    const xml = fs.readFileSync(SERVICE_ENTRY_XML, 'utf-8');
    const block = extractMethodXmlFromUrlTemplate(xml, 'PostEntries', 'POST');
    assert.ok(block, 'блок Method "POST" внутри "PostEntries" должен быть найден');
    assert.ok(block.includes('<HTTPMethod>POST</HTTPMethod>'));
    assert.ok(block.includes('<Handler>PostEntriesPOST</Handler>'));
  });

  test('extractMethodXmlFromUrlTemplate различает ОДНОИМЁННЫЕ Method в разных URLTemplate (M1-аналог)', () => {
    // Донор содержит разные имена методов (POST/GET) в разных шаблонах — для
    // проверки депт-аварности переименовываем метод "POST" в "GET" внутри
    // "PostEntries", получая два разных URLTemplate с ОДНОИМЁННЫМ методом "GET"
    // и разными Handler — ключевой сценарий, который ломает non-nesting-aware поиск.
    const original = fs.readFileSync(SERVICE_ENTRY_XML, 'utf-8');
    const withDuplicateMethodNames = original
      .replace('<Name>POST</Name>', '<Name>GET</Name>')
      .replace('<HTTPMethod>POST</HTTPMethod>', '<HTTPMethod>GET</HTTPMethod>');
    assert.notStrictEqual(withDuplicateMethodNames, original, 'фикстура должна была измениться');

    const inPostEntries = extractMethodXmlFromUrlTemplate(withDuplicateMethodNames, 'PostEntries', 'GET');
    const inPing = extractMethodXmlFromUrlTemplate(withDuplicateMethodNames, 'ping', 'GET');
    assert.ok(inPostEntries, 'метод "GET" в "PostEntries" должен быть найден');
    assert.ok(inPing, 'метод "GET" в "ping" должен быть найден');
    assert.ok(inPostEntries.includes('PostEntriesPOST'), 'должен быть найден именно Handler из PostEntries');
    assert.ok(inPing.includes('pingGET'), 'должен быть найден именно Handler из ping');
    assert.notStrictEqual(inPostEntries, inPing, 'блоки одноимённых методов в разных URLTemplate не должны совпасть');
  });

  test('findMethodRangeInUrlTemplate возвращает диапазон, соответствующий срезу через extractMethodXmlFromUrlTemplate', () => {
    const xml = fs.readFileSync(SERVICE_ENTRY_XML, 'utf-8');
    const range = findMethodRangeInUrlTemplate(xml, 'ping', 'GET');
    assert.ok(range, 'диапазон метода "GET" в "ping" должен быть найден');
    const sliced = xml.slice(range.start, range.end);
    const extracted = extractMethodXmlFromUrlTemplate(xml, 'ping', 'GET');
    assert.strictEqual(sliced, extracted, 'диапазон должен указывать ровно на блок, который отдаёт extractMethodXmlFromUrlTemplate');
  });

  test('extractMethodXmlFromUrlTemplate возвращает null для несуществующего метода/шаблона', () => {
    const xml = fs.readFileSync(SERVICE_ENTRY_XML, 'utf-8');
    assert.strictEqual(extractMethodXmlFromUrlTemplate(xml, 'PostEntries', 'DELETE'), null);
    assert.strictEqual(extractMethodXmlFromUrlTemplate(xml, 'НетТакогоШаблона', 'POST'), null);
  });
});
