import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataXmlRemover } from '../../infra/xml/MetadataXmlRemover';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

/**
 * Полный E2E жизненный цикл HTTP-сервиса на реальных XML-мутациях (без БД 1С,
 * недоступной в этом окружении — платформенная приёмка через реальный
 * /LoadConfigFromFiles покрывается отдельно в `src/test/e2e/generatorLifecycle.e2e.ts`,
 * см. TODO там для HTTPService):
 *
 *   создать HTTPService → добавить 2 URLTemplate → в каждый добавить Method
 *   (GET/POST) → отредактировать HTTPMethod и Handler → удалить один Method →
 *   удалить один URLTemplate.
 *
 * На каждом шаге проверяется: успешность операции, набор изменённых файлов
 * (для HTTPService — всегда ровно один файл объекта, дочерние уровни не имеют
 * отдельных файлов), well-formedness через ObjectXmlReader.read, и сохранение
 * BOM/EOL исходного файла (инвариант №12).
 */

function addUrlTemplate(creator: MetadataXmlCreator, ownerObjectXmlPath: string, name: string) {
  return creator.addChildElement({ ownerObjectXmlPath, childTag: 'URLTemplate', name });
}

function addMethod(creator: MetadataXmlCreator, ownerObjectXmlPath: string, name: string, urlTemplateName: string) {
  return creator.addChildElement({
    ownerObjectXmlPath,
    childTag: 'Method',
    name,
    urlTemplateName,
  });
}

function removeMethod(remover: MetadataXmlRemover, ownerObjectXmlPath: string, name: string, urlTemplateName: string) {
  return remover.removeChildElement({
    ownerObjectXmlPath,
    childTag: 'Method',
    name,
    urlTemplateName,
  });
}

function removeUrlTemplate(remover: MetadataXmlRemover, ownerObjectXmlPath: string, name: string) {
  return remover.removeChildElement({ ownerObjectXmlPath, childTag: 'URLTemplate', name });
}

suite('E2E: полный жизненный цикл HTTP-сервиса (создать → URLTemplate → Method → правка → удаление)', () => {
  test('create → 2×addUrlTemplate → 2×addMethod → editHTTPMethod/Handler → removeMethod → removeUrlTemplate', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-http-e2e-'));
    fs.writeFileSync(
      path.join(configRoot, 'Configuration.xml'),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject version="2.21">',
        '\t<Configuration>',
        '\t\t<Properties>',
        '\t\t\t<Name>Тест</Name>',
        '\t\t\t<Synonym/>',
        '\t\t</Properties>',
        '\t\t<ChildObjects/>',
        '\t</Configuration>',
        '</MetaDataObject>',
      ].join('\n'),
      'utf-8'
    );

    const creator = new MetadataXmlCreator();
    const remover = new MetadataXmlRemover();
    const reader = new ObjectXmlReader();
    // Изменения дочернего уровня (URLTemplate/Method) отслеживаются ОТДЕЛЬНО от
    // создания корневого объекта: addRootObject закономерно трогает ещё
    // Configuration.xml (регистрация в ChildObjects) и Ext/Module.bsl (модуль
    // менеджера) — это не относится к инварианту «URLTemplate/Method без своих файлов».
    const allChangedFiles = new Set<string>();

    // Шаг 1: создать HTTPService.
    const created = creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'E2EService' });
    assert.strictEqual(created.success, true, `создание HTTPService: ${created.errors.join('; ')}`);

    const ownerXml = path.join(configRoot, 'HTTPServices', 'E2EService.xml');
    assert.ok(fs.existsSync(ownerXml), 'файл объекта HTTPService должен быть создан');

    let parsed = reader.read(ownerXml);
    assert.ok(parsed, 'HTTPService должен читаться сразу после создания');
    assert.strictEqual(parsed.children.length, 0, 'свежий HTTPService не имеет URLTemplate');

    // Шаг 2: добавить 2 URLTemplate.
    const addAlpha = addUrlTemplate(creator, ownerXml, 'Alpha');
    assert.strictEqual(addAlpha.success, true, `addUrlTemplate(Alpha): ${addAlpha.errors.join('; ')}`);
    addAlpha.changedFiles.forEach((f) => allChangedFiles.add(f));

    const addBeta = addUrlTemplate(creator, ownerXml, 'Beta');
    assert.strictEqual(addBeta.success, true, `addUrlTemplate(Beta): ${addBeta.errors.join('; ')}`);
    addBeta.changedFiles.forEach((f) => allChangedFiles.add(f));

    parsed = reader.read(ownerXml);
    assert.ok(parsed, 'HTTPService должен читаться после добавления URLTemplate');
    assert.strictEqual(parsed.children.length, 2, 'ожидались 2 URLTemplate');
    assert.deepStrictEqual(parsed.children.map((c) => c.name).sort(), ['Alpha', 'Beta']);

    // Шаг 3: в каждый URLTemplate — по одному Method (GET/POST).
    const addAlphaGet = addMethod(creator, ownerXml, 'GET', 'Alpha');
    assert.strictEqual(addAlphaGet.success, true, `addMethod(Alpha.GET): ${addAlphaGet.errors.join('; ')}`);
    addAlphaGet.changedFiles.forEach((f) => allChangedFiles.add(f));

    const addBetaPost = addMethod(creator, ownerXml, 'POST', 'Beta');
    assert.strictEqual(addBetaPost.success, true, `addMethod(Beta.POST): ${addBetaPost.errors.join('; ')}`);
    addBetaPost.changedFiles.forEach((f) => allChangedFiles.add(f));

    parsed = reader.read(ownerXml);
    assert.ok(parsed, 'HTTPService должен читаться после добавления Method');
    const alphaAfterAdd = parsed.children.find((c) => c.name === 'Alpha');
    const betaAfterAdd = parsed.children.find((c) => c.name === 'Beta');
    assert.ok(alphaAfterAdd, 'URLTemplate "Alpha" должен существовать');
    assert.ok(betaAfterAdd, 'URLTemplate "Beta" должен существовать');
    assert.strictEqual(alphaAfterAdd.columns?.length, 1, 'у Alpha ровно один Method');
    assert.strictEqual(alphaAfterAdd.columns[0].name, 'GET');
    assert.strictEqual(betaAfterAdd.columns?.length, 1, 'у Beta ровно один Method');
    assert.strictEqual(betaAfterAdd.columns[0].name, 'POST');

    let xml = fs.readFileSync(ownerXml, 'utf-8');
    assert.ok(xml.includes('<HTTPMethod>GET</HTTPMethod>'), 'свежий Method Alpha.GET получает HTTPMethod=GET по умолчанию');

    // Шаг 4: отредактировать HTTPMethod и Handler у Alpha.GET.
    const editHttpMethod = reader.updatePropertyInObject(ownerXml, {
      targetKind: 'Method',
      targetName: 'GET',
      urlTemplateName: 'Alpha',
      propertyKey: 'HTTPMethod',
      valueKind: 'string',
      value: 'PUT',
    });
    assert.strictEqual(editHttpMethod, true, 'HTTPMethod у Alpha.GET должен измениться');

    const editHandler = reader.updatePropertyInObject(ownerXml, {
      targetKind: 'Method',
      targetName: 'GET',
      urlTemplateName: 'Alpha',
      propertyKey: 'Handler',
      valueKind: 'string',
      value: 'AlphaHandler',
    });
    assert.strictEqual(editHandler, true, 'Handler у Alpha.GET должен измениться');
    allChangedFiles.add(ownerXml);

    xml = fs.readFileSync(ownerXml, 'utf-8');
    assert.ok(xml.includes('<HTTPMethod>PUT</HTTPMethod>'), 'HTTPMethod должен обновиться на PUT');
    assert.ok(xml.includes('<Handler>AlphaHandler</Handler>'), 'Handler должен обновиться');
    // Соседний Beta.POST не задет правкой Alpha.GET.
    assert.ok(xml.includes('<Name>POST</Name>'), 'Method "POST" у Beta должен остаться');

    // Шаг 5: удалить один Method (Beta.POST).
    const removedMethod = removeMethod(remover, ownerXml, 'POST', 'Beta');
    assert.strictEqual(removedMethod.success, true, `removeMethod(Beta.POST): ${removedMethod.errors.join('; ')}`);
    removedMethod.changedFiles.forEach((f) => allChangedFiles.add(f));

    parsed = reader.read(ownerXml);
    assert.ok(parsed, 'HTTPService должен читаться после удаления Method');
    const betaAfterRemoveMethod = parsed.children.find((c) => c.name === 'Beta');
    assert.ok(betaAfterRemoveMethod, 'URLTemplate "Beta" остаётся после удаления своего Method');
    assert.strictEqual(betaAfterRemoveMethod.columns?.length ?? 0, 0, 'у Beta не осталось Method');
    const alphaAfterRemoveMethod = parsed.children.find((c) => c.name === 'Alpha');
    assert.strictEqual(alphaAfterRemoveMethod?.columns?.length, 1, 'Alpha.GET не задет удалением Beta.POST');

    // Шаг 6: удалить один URLTemplate целиком (Beta).
    const removedTemplate = removeUrlTemplate(remover, ownerXml, 'Beta');
    assert.strictEqual(removedTemplate.success, true, `removeUrlTemplate(Beta): ${removedTemplate.errors.join('; ')}`);
    removedTemplate.changedFiles.forEach((f) => allChangedFiles.add(f));

    parsed = reader.read(ownerXml);
    assert.ok(parsed, 'HTTPService должен читаться после удаления URLTemplate');
    assert.strictEqual(parsed.children.length, 1, 'остался ровно один URLTemplate');
    assert.strictEqual(parsed.children[0]?.name, 'Alpha', 'остался именно "Alpha"');
    assert.strictEqual(parsed.children[0]?.columns?.[0]?.name, 'GET', 'Method Alpha.GET не задет удалением Beta');

    // На протяжении добавления/правки/удаления URLTemplate и Method меняется только
    // файл объекта: ни URLTemplate, ни Method не имеют отдельных файлов (в отличие
    // от Form/Template).
    assert.deepStrictEqual([...allChangedFiles], [ownerXml], 'изменения дочернего уровня затрагивают только один файл объекта HTTPService');

    // Итоговая well-formedness уже подтверждена промежуточными вызовами
    // `reader.read(ownerXml)` на каждом шаге (см. выше): ObjectXmlReader падает
    // на некорректном XML, а не молча возвращает частичный результат.
    assert.ok(reader.read(ownerXml), 'финальный XML должен читаться ObjectXmlReader без ошибок');
  });
});

suite('E2E: roundtrip донора ServiceEntry.xml', () => {
  const SERVICE_ENTRY_XML = path.resolve(__dirname, '../../../example/2.21/src/cf/HTTPServices/ServiceEntry.xml');

  function copyDonor(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-http-roundtrip-'));
    const xmlPath = path.join(root, 'ServiceEntry.xml');
    fs.copyFileSync(SERVICE_ENTRY_XML, xmlPath);
    return xmlPath;
  }

  test('идемпотентная перезапись: то же значение свойства не меняет файл БАЙТ-В-БАЙТ (BOM+CRLF сохранены)', () => {
    const xmlPath = copyDonor();
    const original = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(original.charCodeAt(0), 0xfeff, 'донор должен начинаться с BOM');
    assert.ok(original.includes('\r\n'), 'донор должен использовать CRLF');

    const reader = new ObjectXmlReader();
    const changed = reader.updatePropertyInObject(xmlPath, {
      targetKind: 'Method',
      targetName: 'POST',
      urlTemplateName: 'PostEntries',
      propertyKey: 'Handler',
      valueKind: 'string',
      value: 'PostEntriesPOST',
    });

    assert.strictEqual(changed, false, 'применение уже установленного значения не считается изменением');
    const after = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(after, original, 'файл должен остаться байт-в-байт идентичным донору');
  });

  test('add(URLTemplate) + remove(того же URLTemplate) на реальном доноре возвращает файл к исходным байтам', () => {
    const xmlPath = copyDonor();
    const original = fs.readFileSync(xmlPath, 'utf-8');

    const creator = new MetadataXmlCreator();
    const remover = new MetadataXmlRemover();

    const added = addUrlTemplate(creator, xmlPath, 'RoundtripTemp');
    assert.strictEqual(added.success, true, `добавление временного URLTemplate: ${added.errors.join('; ')}`);
    assert.notStrictEqual(fs.readFileSync(xmlPath, 'utf-8'), original, 'после добавления файл должен измениться');

    const removed = removeUrlTemplate(remover, xmlPath, 'RoundtripTemp');
    assert.strictEqual(removed.success, true, `удаление временного URLTemplate: ${removed.errors.join('; ')}`);

    const restored = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(restored, original, 'после add+remove того же URLTemplate файл должен вернуться к исходным байтам донора (BOM/CRLF включительно)');
  });
});
