import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { needsChildObjects } from '../../infra/xml/creator/creatorShared';

/**
 * Байт-golden характеризация генерации HTTP-сервиса: добавление URLTemplate
 * в HTTPService и Method в URLTemplate (третий уровень вложенности,
 * контейнерный паттерн ТЧ→Колонка). Точный формат — из решения архитектора
 * (см. план): пустые строковые свойства сериализуются самозакрытым тегом,
 * свежий URLTemplate получает пустой `<Template/>` + `<ChildObjects/>`,
 * свежий Method — `<HTTPMethod>GET</HTTPMethod>` + `<Handler/>` БЕЗ ChildObjects.
 *
 * uuid — единственный источник недетерминизма (crypto.randomUUID() внутри
 * newUuid()), нормализуется в плейсхолдер "<UUID>" перед сравнением — тот же
 * приём, что и в metadataXmlCreatorGolden.test.ts.
 */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function normalizeUuid(xml: string): string {
  return xml.replace(UUID_RE, '<UUID>');
}

function configXml21(): string {
  return [
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
  ].join('\n');
}

function newConfigRoot(): string {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-http-'));
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), configXml21(), 'utf-8');
  return configRoot;
}

function addUrlTemplate(creator: MetadataXmlCreator, ownerObjectXmlPath: string, name: string) {
  return creator.addChildElement({
    ownerObjectXmlPath,
    childTag: 'URLTemplate',
    name,
  });
}

function addMethodToUrlTemplate(creator: MetadataXmlCreator, ownerObjectXmlPath: string, name: string, urlTemplateName: string) {
  return creator.addChildElement({
    ownerObjectXmlPath,
    childTag: 'Method',
    name,
    urlTemplateName,
  });
}

suite('MetadataXmlCreator — байт-golden: HTTPService → URLTemplate → Method', () => {
  test('needsChildObjects: URLTemplate=true (имеет childTags=[Method]), Method=false (лист без детей)', () => {
    assert.strictEqual(needsChildObjects('URLTemplate'), true);
    assert.strictEqual(needsChildObjects('Method'), false);
  });

  test('РЕГРЕСС: addRootObject(HTTPService, 2.21) не изменился после декомпозиции/расширения генератора', () => {
    const configRoot = newConfigRoot();
    const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'HTTPService', name: 'Тест' });
    assert.strictEqual(result.success, true, result.errors.join('; '));

    const xmlPath = path.join(configRoot, 'HTTPServices', 'Тест.xml');
    const actual = normalizeUuid(fs.readFileSync(xmlPath, 'utf-8'));
    const expected = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">',
      '\t<HTTPService uuid="<UUID>">',
      '\t\t<Properties>',
      '\t\t\t<Name>Тест</Name>',
      '\t\t\t<Synonym>',
      '\t\t\t\t<v8:item>',
      '\t\t\t\t\t<v8:lang>ru</v8:lang>',
      '\t\t\t\t\t<v8:content>Тест</v8:content>',
      '\t\t\t\t</v8:item>',
      '\t\t\t</Synonym>',
      '\t\t\t<Comment/>',
      '\t\t\t<RootURL/>',
      '\t\t\t<ReuseSessions>AutoUse</ReuseSessions>',
      '\t\t\t<SessionMaxAge>20</SessionMaxAge>',
      '\t\t</Properties>',
      '\t\t<ChildObjects/>',
      '\t</HTTPService>',
      '</MetaDataObject>',
    ].join('\n');
    assert.strictEqual(actual, expected, 'корень HTTPService не должен был измениться при добавлении дочерней вложенности');
  });

  test('addChildElement(URLTemplate) в HTTPService: Name/Synonym/Comment/пустой <Template/> + <ChildObjects/>', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'Тест' }).success, true);
    const ownerXml = path.join(configRoot, 'HTTPServices', 'Тест.xml');

    const result = addUrlTemplate(creator, ownerXml, 'PostEntries');
    assert.strictEqual(result.success, true, result.errors.join('; '));

    const xml = normalizeUuid(fs.readFileSync(ownerXml, 'utf-8'));
    const block = /<URLTemplate uuid="<UUID>">[\s\S]*?<\/URLTemplate>/.exec(xml)?.[0];
    assert.ok(block, 'блок URLTemplate должен быть найден в XML владельца');

    const expectedBlock = [
      '<URLTemplate uuid="<UUID>">',
      '\t\t\t\t<Properties>',
      '\t\t\t\t\t<Name>PostEntries</Name>',
      '\t\t\t\t\t<Synonym>',
      '\t\t\t\t\t\t<v8:item>',
      '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
      '\t\t\t\t\t\t\t<v8:content>Post entries</v8:content>',
      '\t\t\t\t\t\t</v8:item>',
      '\t\t\t\t\t</Synonym>',
      '\t\t\t\t\t<Comment/>',
      '\t\t\t\t\t<Template/>',
      '\t\t\t\t</Properties>',
      '\t\t\t\t<ChildObjects/>',
      '\t\t\t</URLTemplate>',
    ].join('\n');
    assert.strictEqual(block, expectedBlock);
  });

  test('addChildElement(Method) внутри URLTemplate: HTTPMethod=GET/Handler пустой, БЕЗ <ChildObjects>, вложен в ChildObjects шаблона', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'Тест' }).success, true);
    const ownerXml = path.join(configRoot, 'HTTPServices', 'Тест.xml');
    assert.strictEqual(addUrlTemplate(creator, ownerXml, 'PostEntries').success, true);

    const result = addMethodToUrlTemplate(creator, ownerXml, 'POST', 'PostEntries');
    assert.strictEqual(result.success, true, result.errors.join('; '));

    const xml = normalizeUuid(fs.readFileSync(ownerXml, 'utf-8'));
    const urlTemplateBlock = /<URLTemplate uuid="<UUID>">[\s\S]*?<\/URLTemplate>/.exec(xml)?.[0] ?? '';
    assert.ok(urlTemplateBlock.includes('<Method uuid="<UUID>">'), 'Method должен быть вложен ВНУТРИ блока URLTemplate');

    const methodBlock = /<Method uuid="<UUID>">[\s\S]*?<\/Method>/.exec(urlTemplateBlock)?.[0];
    assert.ok(methodBlock, 'блок Method должен быть найден внутри URLTemplate');

    const expectedMethodBlock = [
      '<Method uuid="<UUID>">',
      '\t\t\t\t\t\t<Properties>',
      '\t\t\t\t\t\t\t<Name>POST</Name>',
      '\t\t\t\t\t\t\t<Synonym>',
      '\t\t\t\t\t\t\t\t<v8:item>',
      '\t\t\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
      '\t\t\t\t\t\t\t\t\t<v8:content>Post</v8:content>',
      '\t\t\t\t\t\t\t\t</v8:item>',
      '\t\t\t\t\t\t\t</Synonym>',
      '\t\t\t\t\t\t\t<Comment/>',
      '\t\t\t\t\t\t\t<HTTPMethod>GET</HTTPMethod>',
      '\t\t\t\t\t\t\t<Handler/>',
      '\t\t\t\t\t\t</Properties>',
      '\t\t\t\t\t</Method>',
    ].join('\n');
    assert.strictEqual(methodBlock, expectedMethodBlock);
    assert.ok(!methodBlock.includes('ChildObjects'), 'Method не должен содержать <ChildObjects> в любом виде');

    // ChildObjects шаблона больше не самозакрыт — внутри лежит Method.
    assert.ok(!urlTemplateBlock.includes('<ChildObjects/>'), 'ChildObjects шаблона должен раскрыться под вложенный Method');
  });

  test('второй Method с ДРУГИМ именем в ТОЙ ЖЕ URLTemplate добавляется независимо, не подменяя первый', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'Тест' });
    const ownerXml = path.join(configRoot, 'HTTPServices', 'Тест.xml');
    addUrlTemplate(creator, ownerXml, 'Entries');

    assert.strictEqual(addMethodToUrlTemplate(creator, ownerXml, 'GET', 'Entries').success, true);
    assert.strictEqual(addMethodToUrlTemplate(creator, ownerXml, 'POST', 'Entries').success, true);

    const xml = fs.readFileSync(ownerXml, 'utf-8');
    const urlTemplateBlock = /<URLTemplate uuid="[^"]*">[\s\S]*?<\/URLTemplate>/.exec(xml)?.[0] ?? '';
    const methodNames = [...urlTemplateBlock.matchAll(/<Method uuid="[^"]*">[\s\S]*?<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    assert.deepStrictEqual(methodNames, ['GET', 'POST'], 'оба метода должны присутствовать внутри одной URLTemplate, в порядке добавления');
  });

  test('второй URLTemplate добавляется независимо от первого; попытка добавить Method с несуществующим urlTemplateName — ошибка', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'Тест' });
    const ownerXml = path.join(configRoot, 'HTTPServices', 'Тест.xml');
    assert.strictEqual(addUrlTemplate(creator, ownerXml, 'PostEntries').success, true);
    assert.strictEqual(addUrlTemplate(creator, ownerXml, 'ping').success, true);

    const result = addMethodToUrlTemplate(creator, ownerXml, 'GET', 'НетТакогоШаблона');
    assert.strictEqual(result.success, false, 'добавление Method в несуществующий URLTemplate должно провалиться');
    assert.ok(result.errors.length > 0);
  });

  test('addChildElement(Method) БЕЗ urlTemplateName вовсе — ошибка «Не указан URL-шаблон», файл не тронут', () => {
    const configRoot = newConfigRoot();
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'Тест' }).success, true);
    const ownerXml = path.join(configRoot, 'HTTPServices', 'Тест.xml');
    assert.strictEqual(addUrlTemplate(creator, ownerXml, 'PostEntries').success, true);
    const beforeXml = fs.readFileSync(ownerXml, 'utf-8');

    // urlTemplateName опущен намеренно — контейнер-родитель не задан, add должен провалиться.
    const result = creator.addChildElement({
      ownerObjectXmlPath: ownerXml,
      childTag: 'Method',
      name: 'GET',
    });

    assert.strictEqual(result.success, false, 'без urlTemplateName добавление Method должно провалиться');
    assert.ok(result.errors.length > 0);
    assert.strictEqual(fs.readFileSync(ownerXml, 'utf-8'), beforeXml, 'файл не должен измениться при неуспешном добавлении');
  });
});
