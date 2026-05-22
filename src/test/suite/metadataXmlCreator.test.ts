import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationChangeDetector } from '../../infra/fs/ConfigurationChangeDetector';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { ensureTextTemplateContentPath, resolveTextTemplateContentPath } from '../../infra/xml/TemplateXml';
import {
  buildRootMetaObjectProperties,
  buildTypedFieldProperties,
} from '../../ui/views/properties/PropertyBuilder';

suite('metadataXmlCreator', () => {
  test('создаёт корневой объект и сохраняет изменённость после пересборки meta-кэша', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-project-'));
    const configRoot = path.join(projectRoot, 'src', 'cf');
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');

    const entry = { rootPath: configRoot, kind: 'cf' as const };
    const detector = new ConfigurationChangeDetector(projectRoot);
    detector.ensureCaches([entry]);

    const creator = new MetadataXmlCreator();
    const result = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(result.success, true);
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары.xml')));
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl')));

    fs.rmSync(path.join(projectRoot, '.v8vscedit', 'meta'), { recursive: true, force: true });
    detector.ensureCaches([entry]);
    const changed = detector.detect([entry]);
    assert.strictEqual(changed.length, 1);
    assert.ok(changed[0].changedFilesCount > 0);
  });

  test('наследует версию формата XML из текущей выгрузки', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-format-version-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');
    fs.writeFileSync(path.join(configRoot, 'ConfigDumpInfo.xml'), buildDumpInfoXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' }).success, true);
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'BusinessProcess', name: 'Процесс' }).success, true);
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'CommonForm', name: 'ФормаНастроек' }).success, true);
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'CommonTemplate', name: 'ОбщийМакет', templateType: 'TextDocument' }).success, true);

    const catalogXmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: catalogXmlPath, childTag: 'Form', name: 'ФормаЭлемента' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: catalogXmlPath, childTag: 'Template', name: 'Печать' }).success, true);

    const generatedXmlPaths = [
      catalogXmlPath,
      path.join(configRoot, 'BusinessProcesses', 'Процесс.xml'),
      path.join(configRoot, 'BusinessProcesses', 'Процесс', 'Ext', 'Flowchart.xml'),
      path.join(configRoot, 'CommonForms', 'ФормаНастроек.xml'),
      path.join(configRoot, 'CommonForms', 'ФормаНастроек', 'Ext', 'Form.xml'),
      path.join(configRoot, 'Catalogs', 'Товары', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml'),
      path.join(configRoot, 'Catalogs', 'Товары', 'Templates', 'Печать.xml'),
      path.join(configRoot, 'CommonTemplates', 'ОбщийМакет.xml'),
    ];

    for (const xmlPath of generatedXmlPaths) {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(xml.includes('version="2.21"'), `${xmlPath} не содержит version="2.21"`);
      assert.ok(!xml.includes('version="2.18"'), `${xmlPath} содержит устаревшую версию 2.18`);
    }
  });

  test('создаёт дочерний макет с выбранным типом и правильным файлом содержимого', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-template-types-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'DataProcessor', name: 'Обработка' }).success, true);
    const ownerXmlPath = path.join(configRoot, 'DataProcessors', 'Обработка.xml');

    const spreadsheet = creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'ПечатнаяФорма',
      templateType: 'SpreadsheetDocument',
    });
    const html = creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Описание',
      templateType: 'HTMLDocument',
    });
    const binary = creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Файл',
      templateType: 'BinaryData',
    });
    const text = creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Текст',
      templateType: 'TextDocument',
    });

    assert.strictEqual(spreadsheet.success, true);
    assert.strictEqual(html.success, true);
    assert.strictEqual(binary.success, true);
    assert.strictEqual(text.success, true);

    const templatesDir = path.join(configRoot, 'DataProcessors', 'Обработка', 'Templates');
    const ownerXml = fs.readFileSync(ownerXmlPath, 'utf-8');
    assert.ok(ownerXml.includes('<Template>ПечатнаяФорма</Template>'));
    assert.ok(!ownerXml.includes('<Template uuid='));
    assert.ok(fs.existsSync(path.join(templatesDir, 'ПечатнаяФорма.xml')));
    assert.ok(fs.existsSync(path.join(templatesDir, 'ПечатнаяФорма', 'Ext', 'Template.xml')));
    assert.ok(!fs.existsSync(path.join(templatesDir, 'ПечатнаяФорма', 'Ext', 'Template.bin')));
    assert.ok(fs.readFileSync(path.join(templatesDir, 'ПечатнаяФорма.xml'), 'utf-8').includes('<TemplateType>SpreadsheetDocument</TemplateType>'));
    assert.ok(fs.readFileSync(path.join(templatesDir, 'ПечатнаяФорма', 'Ext', 'Template.xml'), 'utf-8').includes('<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet"'));
    assert.ok(fs.existsSync(path.join(templatesDir, 'Описание', 'Ext', 'Template.xml')));
    assert.ok(fs.existsSync(path.join(templatesDir, 'Описание', 'Ext', 'Template', 'ru.html')));
    assert.ok(fs.existsSync(path.join(templatesDir, 'Файл', 'Ext', 'Template.bin')));
    assert.ok(fs.existsSync(path.join(templatesDir, 'Текст', 'Ext', 'Template.txt')));
    assert.ok(fs.readFileSync(path.join(templatesDir, 'Текст.xml'), 'utf-8').includes('<TemplateType>TextDocument</TemplateType>'));
  });

  test('создаёт общий макет с выбранным типом', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-common-template-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    const result = creator.addRootObject({
      configRoot,
      kind: 'CommonTemplate',
      name: 'ФорматОбмена',
      templateType: 'TextDocument',
    });

    assert.strictEqual(result.success, true);
    const xmlPath = path.join(configRoot, 'CommonTemplates', 'ФорматОбмена.xml');
    assert.ok(fs.readFileSync(xmlPath, 'utf-8').includes('<CommonTemplate'));
    assert.ok(fs.readFileSync(xmlPath, 'utf-8').includes('<TemplateType>TextDocument</TemplateType>'));
    assert.ok(fs.existsSync(path.join(configRoot, 'CommonTemplates', 'ФорматОбмена', 'Ext', 'Template.txt')));
  });

  test('создаёт файл текстового макета при ленивом открытии', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-open-text-template-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'DataProcessor', name: 'Обработка' }).success, true);
    const ownerXmlPath = path.join(configRoot, 'DataProcessors', 'Обработка.xml');
    assert.strictEqual(creator.addChildElement({
      ownerObjectXmlPath: ownerXmlPath,
      childTag: 'Template',
      name: 'Текст',
      templateType: 'TextDocument',
    }).success, true);

    const templateXmlPath = path.join(configRoot, 'DataProcessors', 'Обработка', 'Templates', 'Текст.xml');
    const templateDir = path.join(configRoot, 'DataProcessors', 'Обработка', 'Templates', 'Текст');
    fs.rmSync(templateDir, { recursive: true, force: true });

    assert.strictEqual(resolveTextTemplateContentPath(templateXmlPath, 'Текст'), null);
    const contentPath = ensureTextTemplateContentPath(templateXmlPath, 'Текст');

    assert.strictEqual(contentPath, path.join(templateDir, 'Ext', 'Template.txt'));
    assert.ok(fs.existsSync(contentPath));
  });

  test('заполняет основной макет СКД отчёта при создании схемы компоновки', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-report-dcs-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Report', name: 'Продажи' }).success, true);
    const reportXmlPath = path.join(configRoot, 'Reports', 'Продажи.xml');
    const reportXml = fs.readFileSync(reportXmlPath, 'utf-8')
      .replace('<Comment/>', '<Comment/>\n\t\t\t<MainDataCompositionSchema/>');
    fs.writeFileSync(reportXmlPath, reportXml, 'utf-8');

    const result = creator.addChildElement({
      ownerObjectXmlPath: reportXmlPath,
      childTag: 'Template',
      name: 'ОсновнаяСхемаКомпоновкиДанных',
      templateType: 'DataCompositionSchema',
    });

    assert.strictEqual(result.success, true);
    const updatedReportXml = fs.readFileSync(reportXmlPath, 'utf-8');
    assert.ok(updatedReportXml.includes('<MainDataCompositionSchema>Report.Продажи.Template.ОсновнаяСхемаКомпоновкиДанных</MainDataCompositionSchema>'));
    assert.ok(fs.existsSync(path.join(configRoot, 'Reports', 'Продажи', 'Templates', 'ОсновнаяСхемаКомпоновкиДанных', 'Ext', 'Template.xml')));
  });

  test('объявляет namespace xs для стандартных типов XDTO', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-xs-namespace-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Document', name: 'Заказ' }).success, true);
    const xmlPath = path.join(configRoot, 'Documents', 'Заказ.xml');
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Комментарий' }).success, true);

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('xmlns:xs="http://www.w3.org/2001/XMLSchema"'));
    assert.ok(xml.includes('<v8:Type>xs:string</v8:Type>'));
  });

  test('создаёт InternalInfo для объектов и табличных частей по правилам meta-compile', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-internal-info-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml('2.21'), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Document', name: 'Заказ' }).success, true);
    const xmlPath = path.join(configRoot, 'Documents', 'Заказ.xml');
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'TabularSection', name: 'Товары' }).success, true);

    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<InternalInfo>'));
    assert.ok(xml.includes('name="DocumentObject.Заказ" category="Object"'));
    assert.ok(xml.includes('name="DocumentRef.Заказ" category="Ref"'));
    assert.ok(xml.includes('name="DocumentManager.Заказ" category="Manager"'));
    assert.ok(xml.includes('name="DocumentTabularSection.Заказ.Товары" category="TabularSection"'));
    assert.ok(xml.includes('name="DocumentTabularSectionRow.Заказ.Товары" category="TabularSectionRow"'));
  });

  test('добавляет реквизит и колонку табличной части без внешних скриптов', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    const root = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(root.success, true);

    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    const attr = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Артикул' });
    const ts = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'TabularSection', name: 'Цены' });
    const column = creator.addChildElement({
      ownerObjectXmlPath: xmlPath,
      childTag: 'Column',
      tabularSectionName: 'Цены',
      name: 'Цена',
    });

    assert.strictEqual(attr.success, true);
    assert.strictEqual(ts.success, true);
    assert.strictEqual(column.success, true);
    const xml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(xml.includes('<Name>Артикул</Name>'));
    assert.ok(xml.includes('<Name>Цены</Name>'));
    assert.ok(xml.includes('<Name>Цена</Name>'));
    assert.ok(xml.includes('<PasswordMode>false</PasswordMode>'));
    assert.ok(xml.includes('<FillChecking>DontCheck</FillChecking>'));
    assert.ok(xml.includes('<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>'));
    assert.ok(xml.includes('<QuickChoice>Auto</QuickChoice>'));
    assert.ok(xml.includes('<CreateOnInput>Auto</CreateOnInput>'));
    assert.ok(xml.includes('<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>'));
    assert.ok(xml.includes('<Indexing>DontIndex</Indexing>'));
    assert.ok(xml.includes('<FullTextSearch>Use</FullTextSearch>'));
    assert.ok(xml.includes('<DataHistory>Use</DataHistory>'));
  });

  test('при смене типа реквизита перестраивает типозависимые свойства и сохраняет общие значения', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-cf-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildConfigXml(), 'utf-8');
    const creator = new MetadataXmlCreator();
    const root = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Товары' });
    assert.strictEqual(root.success, true);

    const xmlPath = path.join(configRoot, 'Catalogs', 'Товары.xml');
    const attr = creator.addChildElement({ ownerObjectXmlPath: xmlPath, childTag: 'Attribute', name: 'Комментарий' });
    assert.strictEqual(attr.success, true);

    let xml = fs.readFileSync(xmlPath, 'utf-8');
    xml = xml
      .replace('<MultiLine>false</MultiLine>', '<MultiLine>true</MultiLine>')
      .replace('<FillChecking>DontCheck</FillChecking>', '<FillChecking>ShowError</FillChecking>')
      .replace('<DataHistory>Use</DataHistory>', '<DataHistory>DontUse</DataHistory>')
      .replace('<FillChecking>ShowError</FillChecking>', '<LegacyProperty>old</LegacyProperty>\n\t\t\t<FillChecking>ShowError</FillChecking>');
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Комментарий',
      typeInnerXml: [
        '<v8:Type>xs:decimal</v8:Type>',
        '<v8:NumberQualifiers>',
        '\t<v8:Digits>15</v8:Digits>',
        '\t<v8:FractionDigits>2</v8:FractionDigits>',
        '\t<v8:AllowedSign>Any</v8:AllowedSign>',
        '</v8:NumberQualifiers>',
      ].join('\n'),
    });

    assert.strictEqual(changed, true);
    const nextXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(nextXml.includes('<v8:Type>xs:decimal</v8:Type>'));
    assert.ok(!nextXml.includes('<MultiLine>true</MultiLine>'));
    assert.ok(!nextXml.includes('<PasswordMode>false</PasswordMode>'));
    assert.ok(!nextXml.includes('<LegacyProperty>old</LegacyProperty>'));
    assert.ok(nextXml.includes('<MarkNegatives>false</MarkNegatives>'));
    assert.ok(nextXml.includes('<RoundingMode>Round15as20</RoundingMode>'));
    assert.ok(nextXml.includes('<FillChecking>ShowError</FillChecking>'));
    assert.ok(nextXml.includes('<DataHistory>DontUse</DataHistory>'));

    const refChanged = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Комментарий',
      typeInnerXml: '<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.ЗаказПокупателя</v8:Type>',
    });

    assert.strictEqual(refChanged, true);
    const refXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(refXml.includes('d5p1:DocumentRef.ЗаказПокупателя'));
    assert.ok(!refXml.includes('<RoundingMode>Round15as20</RoundingMode>'));
    assert.ok(refXml.includes('<ChoiceParameterLinks/>'));
    assert.ok(refXml.includes('<ChoiceParameters/>'));
    assert.ok(refXml.includes('<ChoiceForm/>'));
    assert.ok(refXml.includes('<LinkByType/>'));
    assert.ok(refXml.includes('<FillChecking>ShowError</FillChecking>'));
    assert.ok(refXml.includes('<DataHistory>DontUse</DataHistory>'));
  });

  test('панель свойств не показывает строковые свойства для ссылочного реквизита', () => {
    const props = buildTypedFieldProperties([
      '<Attribute uuid="00000000-0000-0000-0000-000000000000">',
      '\t<Properties>',
      '\t\t<Name>Действие</Name>',
      '\t\t<Synonym/>',
      '\t\t<Comment/>',
      '\t\t<Type>',
      '\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.ев_Действие</v8:Type>',
      '\t\t</Type>',
      '\t\t<PasswordMode>false</PasswordMode>',
      '\t\t<MultiLine>false</MultiLine>',
      '\t\t<ExtendedEdit>false</ExtendedEdit>',
      '\t\t<FillChecking>DontCheck</FillChecking>',
      '\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
      '\t\t<ChoiceParameterLinks/>',
      '\t\t<ChoiceParameters/>',
      '\t\t<ChoiceForm/>',
      '\t\t<LinkByType/>',
      '\t</Properties>',
      '</Attribute>',
    ].join('\n'));
    const keys = props.map((item) => item.key);
    assert.ok(!keys.includes('PasswordMode'));
    assert.ok(!keys.includes('MultiLine'));
    assert.ok(!keys.includes('ExtendedEdit'));
    assert.ok(keys.includes('ChoiceFoldersAndItems'));
    assert.ok(keys.includes('FillChecking'));
  });

  test('панель свойств объединяет свойства всех типов составного реквизита', () => {
    const props = buildTypedFieldProperties([
      '<Attribute uuid="00000000-0000-0000-0000-000000000000">',
      '\t<Properties>',
      '\t\t<Name>Действие</Name>',
      '\t\t<Synonym/>',
      '\t\t<Comment/>',
      '\t\t<Type>',
      '\t\t\t<v8:Type>xs:string</v8:Type>',
      '\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:DocumentRef.ев_Действие</v8:Type>',
      '\t\t\t<v8:StringQualifiers>',
      '\t\t\t\t<v8:Length>10</v8:Length>',
      '\t\t\t\t<v8:AllowedLength>Variable</v8:AllowedLength>',
      '\t\t\t</v8:StringQualifiers>',
      '\t\t</Type>',
      '\t\t<PasswordMode>false</PasswordMode>',
      '\t\t<MultiLine>false</MultiLine>',
      '\t\t<ExtendedEdit>false</ExtendedEdit>',
      '\t\t<FillChecking>DontCheck</FillChecking>',
      '\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
      '\t\t<ChoiceParameterLinks/>',
      '\t\t<ChoiceParameters/>',
      '\t\t<ChoiceForm/>',
      '\t\t<LinkByType/>',
      '\t</Properties>',
      '</Attribute>',
    ].join('\n'));
    const keys = props.map((item) => item.key);
    assert.ok(keys.includes('PasswordMode'));
    assert.ok(keys.includes('MultiLine'));
    assert.ok(keys.includes('ExtendedEdit'));
    assert.ok(keys.includes('ChoiceParameterLinks'));
    assert.ok(keys.includes('ChoiceParameters'));
    assert.ok(keys.includes('ChoiceForm'));
    assert.ok(keys.includes('LinkByType'));
  });

  test('панель свойств константы фильтрует типозависимые поля по составу типа', () => {
    const props = buildRootMetaObjectProperties([
      '<MetaDataObject>',
      '\t<Constant uuid="00000000-0000-0000-0000-000000000000">',
      '\t\t<Properties>',
      '\t\t\t<Name>Аудитор</Name>',
      '\t\t\t<Synonym/>',
      '\t\t\t<Comment/>',
      '\t\t\t<Type>',
      '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>',
      '\t\t\t</Type>',
      '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
      '\t\t\t<PasswordMode>false</PasswordMode>',
      '\t\t\t<MultiLine>false</MultiLine>',
      '\t\t\t<FillChecking>ShowError</FillChecking>',
      '\t\t\t<ChoiceFoldersAndItems>Items</ChoiceFoldersAndItems>',
      '\t\t\t<ChoiceParameterLinks/>',
      '\t\t\t<ChoiceParameters/>',
      '\t\t\t<ChoiceForm/>',
      '\t\t\t<LinkByType/>',
      '\t\t</Properties>',
      '\t</Constant>',
      '</MetaDataObject>',
    ].join('\n'), 'Constant');

    const keys = props.map((item) => item.key);
    assert.ok(keys.includes('UseStandardCommands'));
    assert.ok(keys.includes('ChoiceForm'));
    assert.ok(keys.includes('LinkByType'));
    assert.ok(!keys.includes('PasswordMode'));
    assert.ok(!keys.includes('MultiLine'));
  });

  test('при смене типа константы перестраивает типозависимые свойства и сохраняет поля константы', () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-constant-type-'));
    const xmlPath = path.join(configRoot, 'Аудитор.xml');
    fs.writeFileSync(xmlPath, [
      '<MetaDataObject>',
      '\t<Constant uuid="00000000-0000-0000-0000-000000000000">',
      '\t\t<Properties>',
      '\t\t\t<Name>Аудитор</Name>',
      '\t\t\t<Synonym/>',
      '\t\t\t<Comment/>',
      '\t\t\t<Type>',
      '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>',
      '\t\t\t</Type>',
      '\t\t\t<UseStandardCommands>true</UseStandardCommands>',
      '\t\t\t<DefaultForm/>',
      '\t\t\t<ExtendedPresentation/>',
      '\t\t\t<PasswordMode>false</PasswordMode>',
      '\t\t\t<FillChecking>ShowError</FillChecking>',
      '\t\t\t<ChoiceForm/>',
      '\t\t\t<LinkByType/>',
      '\t\t\t<DataHistory>DontUse</DataHistory>',
      '\t\t</Properties>',
      '\t</Constant>',
      '</MetaDataObject>',
    ].join('\n'), 'utf-8');

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Constant',
      targetName: 'Аудитор',
      typeInnerXml: [
        '<v8:Type>xs:decimal</v8:Type>',
        '<v8:NumberQualifiers>',
        '\t<v8:Digits>15</v8:Digits>',
        '\t<v8:FractionDigits>2</v8:FractionDigits>',
        '\t<v8:AllowedSign>Any</v8:AllowedSign>',
        '</v8:NumberQualifiers>',
      ].join('\n'),
    });

    assert.strictEqual(changed, true);
    const nextXml = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(nextXml.includes('<UseStandardCommands>true</UseStandardCommands>'));
    assert.ok(nextXml.includes('<DefaultForm/>'));
    assert.ok(nextXml.includes('<ExtendedPresentation/>'));
    assert.ok(nextXml.includes('<FillChecking>ShowError</FillChecking>'));
    assert.ok(nextXml.includes('<DataHistory>DontUse</DataHistory>'));
    assert.ok(nextXml.includes('<MarkNegatives>false</MarkNegatives>'));
    assert.ok(nextXml.includes('<RoundingMode>Round15as20</RoundingMode>'));
    assert.ok(!nextXml.includes('<ChoiceForm/>'));
    assert.ok(!nextXml.includes('<LinkByType/>'));
    assert.ok(!nextXml.includes('<PasswordMode>false</PasswordMode>'));
  });
});

function buildConfigXml(formatVersion?: string): string {
  const versionAttr = formatVersion ? ` version="${formatVersion}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject${versionAttr}>
  <Configuration>
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`;
}

function buildDumpInfoXml(formatVersion: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ConfigDumpInfo xmlns="http://v8.1c.ru/8.3/xcf/dumpinfo" format="Hierarchical" version="${formatVersion}">
  <ConfigVersions/>
</ConfigDumpInfo>`;
}
