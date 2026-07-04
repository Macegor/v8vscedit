import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataCompositionSchemaService } from '../../infra/xml/DataCompositionSchemaService';
import type { SkdDefinition } from '../../infra/xml/DataCompositionSchemaService';

/**
 * Байт-в-байт характеризация DataCompositionSchemaService ДО дробления на подфайлы
 * (src/infra/xml/dcs/*). Инвариант проекта (CLAUDE.md, п. 17 «Известные технические
 * долги»/анти-паттерны): любой рефактор генератора XML обязан предваряться golden-
 * тестом, фиксирующим ПОЛНЫЙ текст результата, а не подстроки (в отличие от
 * dataCompositionSchemaMutationCorrectness.test.ts, который проверяет только
 * .includes на конкретные фрагменты). Эти тесты — страховочная сеть: они обязаны
 * остаться зелёными после дробления на dcs/*, иначе рефактор изменил поведение,
 * а не только структуру кода.
 *
 * Недетерминизма в буквенных данных нет: compile() пишет новый файл без BOM/CRLF
 * (fs.writeFileSync), а edit() на реальной выгрузке 1С сохраняет её BOM/CRLF через
 * writeTextFilePreservingBomAndEol — оба пути детерминированы, поэтому весь текст
 * (включая переводы строк, отступы, самозакрытие тегов, BOM) сравнивается буквально
 * без нормализации и без плейсхолдеров: во всех сценариях ниже нет uuid/даты,
 * генерируемых сервисом заново при каждом прогоне.
 */
suite('DataCompositionSchemaService — байт-golden характеризация (предусловие дробления на infra/xml/dcs/*)', () => {
  test('compile: полный байтовый эталон XML схемы из репрезентативного SkdDefinition (dataSource/dataSet+calc+total/parameters c @autoDates/variant c selection+filter+order+structure)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-skd-compile-'));
    const templatePath = path.join(root, 'Схема', 'Ext', 'Template.xml');
    const service = new DataCompositionSchemaService();

    // Определение специально задействует максимум билдеров: dataSource, dataSet
    // с обычным и shorthand-полем (включая @dimension-роль и #noFilter-ограничение),
    // calculatedField с #noOrder-ограничением, totalField, параметр с @autoDates
    // (разворачивается в три <parameter>: сам + НачалоПериода/КонецПериода) и объектный
    // параметр, а также settingsVariant с selection/filter/order/dataParameters:'auto'
    // и явной структурой (не shorthand-строкой, а SkdStructureItemDefinition[]).
    const definition: SkdDefinition = {
      dataSources: [{ name: 'ИсточникДанных1', type: 'Local' }],
      dataSets: [
        {
          name: 'Продажи',
          query:
            'ВЫБРАТЬ Товары.Ссылка КАК Номенклатура, Продажи.Количество КАК Количество ИЗ РегистрНакопления.Продажи КАК Продажи',
          fields: [
            'Номенклатура [Номенклатура]: CatalogRef.Товары @dimension',
            {
              field: 'Количество',
              dataPath: 'Количество',
              title: 'Количество',
              type: 'decimal(15,3)',
              restrict: ['noFilter'],
            },
          ],
        },
      ],
      calculatedFields: ['Сумма: decimal(15,2) = Количество * Цена #noOrder'],
      totalFields: ['Количество: Сумма'],
      parameters: [
        'Период [Период]: StandardPeriod @autoDates',
        { name: 'Организация', title: 'Организация', type: 'CatalogRef.Организации', valueListAllowed: true, use: 'Always' },
      ],
      settingsVariants: [
        {
          name: 'Основной',
          title: 'Основной вариант',
          selection: ['Номенклатура', 'Количество'],
          filter: ['Количество > 0'],
          order: ['Номенклатура'],
          dataParameters: 'auto',
          structure: [{ name: 'Группировка', groupFields: ['Номенклатура'], selection: ['Auto'] }],
        },
      ],
    };

    const result = service.compile({ outputPath: templatePath, definition });

    assert.strictEqual(result.dataSets.length, 1);
    assert.strictEqual(result.dataSets[0], 'Продажи');
    // @autoDates разворачивает "Период" в три параметра (Период, НачалоПериода,
    // КонецПериода) + объектный параметр "Организация". compile.parameters читает
    // их через info().parameters, а parseSchema матчит ЛЮБОЙ тег <parameter> в
    // документе нерекурсивным regex'ом matchBlocks — в т.ч. вложенные
    // <item><parameter>Период</parameter></item> внутри <dataParameters> варианта
    // настроек (dataParameters:'auto' генерирует такие ссылки на Период/Организацию).
    // У этих вложенных совпадений нет дочернего <name>, поэтому readText возвращает
    // '' — отсюда два пустых имени в хвосте. Это задокументированное реальное
    // поведение сервиса ДО дробления, а не то, что "должно" быть.
    assert.deepStrictEqual(result.parameters, ['Период', 'НачалоПериода', 'КонецПериода', 'Организация', '', '']);

    const xml = fs.readFileSync(templatePath, 'utf-8');
    const expectedXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"\n'
      + '\txmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common"\n'
      + '\txmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core"\n'
      + '\txmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"\n'
      + '\txmlns:v8="http://v8.1c.ru/8.1/data/core"\n'
      + '\txmlns:v8ui="http://v8.1c.ru/8.1/data/ui"\n'
      + '\txmlns:xs="http://www.w3.org/2001/XMLSchema"\n'
      + '\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
      + '\t<dataSource>\n'
      + '\t\t<name>ИсточникДанных1</name>\n'
      + '\t\t<dataSourceType>Local</dataSourceType>\n'
      + '\t</dataSource>\n'
      + '\t<dataSet xsi:type="DataSetQuery">\n'
      + '\t\t<name>Продажи</name>\n'
      + '\t\t<field xsi:type="DataSetFieldField">\n'
      + '\t\t\t<dataPath>Номенклатура</dataPath>\n'
      + '\t\t\t<field>Номенклатура</field>\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Номенклатура</v8:content></v8:item>\n'
      + '\t\t\t</title>\n'
      + '\t\t\t<role><dcscom:dimension>true</dcscom:dimension></role>\n'
      + '\t\t\t<valueType>\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Товары</v8:Type>\n'
      + '\t\t\t</valueType>\n'
      + '\t\t</field>\n'
      + '\t\t<field xsi:type="DataSetFieldField">\n'
      + '\t\t\t<dataPath>Количество</dataPath>\n'
      + '\t\t\t<field>Количество</field>\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Количество</v8:content></v8:item>\n'
      + '\t\t\t</title>\n'
      + '\t\t\t<useRestriction>\n'
      + '\t\t\t\t<condition>true</condition>\n'
      + '\t\t\t</useRestriction>\n'
      + '\t\t\t<valueType>\n'
      + '\t\t\t\t<v8:Type>xs:decimal</v8:Type>\n'
      + '\t\t\t\t<v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>3</v8:FractionDigits><v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers>\n'
      + '\t\t\t</valueType>\n'
      + '\t\t</field>\n'
      + '\t\t<dataSource>ИсточникДанных1</dataSource>\n'
      + '\t\t<query>ВЫБРАТЬ Товары.Ссылка КАК Номенклатура, Продажи.Количество КАК Количество ИЗ РегистрНакопления.Продажи КАК Продажи</query>\n'
      + '\t</dataSet>\n'
      + '\t<calculatedField>\n'
      + '\t\t<dataPath>Сумма</dataPath>\n'
      + '\t\t<expression>Количество * Цена</expression>\n'
      + '\t\t<useRestriction>\n'
      + '\t\t\t<order>true</order>\n'
      + '\t\t</useRestriction>\n'
      + '\t\t<valueType>\n'
      + '\t\t\t<v8:Type>xs:decimal</v8:Type>\n'
      + '\t\t\t<v8:NumberQualifiers><v8:Digits>15</v8:Digits><v8:FractionDigits>2</v8:FractionDigits><v8:AllowedSign>Any</v8:AllowedSign></v8:NumberQualifiers>\n'
      + '\t\t</valueType>\n'
      + '\t</calculatedField>\n'
      + '\t<totalField>\n'
      + '\t\t<dataPath>Количество</dataPath>\n'
      + '\t\t<expression>Сумма(Количество)</expression>\n'
      + '\t</totalField>\n'
      + '\t<parameter>\n'
      + '\t\t<name>Период</name>\n'
      + '\t\t<title xsi:type="v8:LocalStringType">\n'
      + '\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Период</v8:content></v8:item>\n'
      + '\t\t</title>\n'
      + '\t\t<valueType>\n'
      + '\t\t\t<v8:Type>v8:StandardPeriod</v8:Type>\n'
      + '\t\t</valueType>\n'
      + '\t</parameter>\n'
      + '\t<parameter>\n'
      + '\t\t<name>НачалоПериода</name>\n'
      + '\t\t<valueType>\n'
      + '\t\t\t<v8:Type>xs:dateTime</v8:Type>\n'
      + '\t\t</valueType>\n'
      + '\t\t<availableAsField>false</availableAsField>\n'
      + '\t</parameter>\n'
      + '\t<parameter>\n'
      + '\t\t<name>КонецПериода</name>\n'
      + '\t\t<valueType>\n'
      + '\t\t\t<v8:Type>xs:dateTime</v8:Type>\n'
      + '\t\t</valueType>\n'
      + '\t\t<availableAsField>false</availableAsField>\n'
      + '\t</parameter>\n'
      + '\t<parameter>\n'
      + '\t\t<name>Организация</name>\n'
      + '\t\t<title xsi:type="v8:LocalStringType">\n'
      + '\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Организация</v8:content></v8:item>\n'
      + '\t\t</title>\n'
      + '\t\t<valueType>\n'
      + '\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Организации</v8:Type>\n'
      + '\t\t</valueType>\n'
      + '\t\t<valueListAllowed>true</valueListAllowed>\n'
      + '\t\t<use>Always</use>\n'
      + '\t</parameter>\n'
      + '\t<settingsVariant>\n'
      + '\t\t<name>Основной</name>\n'
      + '\t\t<title xsi:type="v8:LocalStringType">\n'
      + '\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Основной вариант</v8:content></v8:item>\n'
      + '\t\t</title>\n'
      + '\t\t<settings>\n'
      + '\t\t\t<selection>\n'
      + '\t\t\t\t<item xsi:type="dcsset:SelectedItemField"><field>Номенклатура</field></item>\n'
      + '\t\t\t\t<item xsi:type="dcsset:SelectedItemField"><field>Количество</field></item>\n'
      + '\t\t\t</selection>\n'
      + '\t\t\t<filter>\n'
      + '\t\t\t\t<item xsi:type="dcsset:FilterItemComparison">\n'
      + '\t\t\t\t\t<left>Количество</left>\n'
      + '\t\t\t\t\t<comparisonType>Greater</comparisonType>\n'
      + '\t\t\t\t\t<right>0</right>\n'
      + '\t\t\t\t</item>\n'
      + '\t\t\t</filter>\n'
      + '\t\t\t<order><item><field>Номенклатура</field><orderType>Asc</orderType></item></order>\n'
      + '\t\t\t<dataParameters>\n'
      + '\t\t\t\t<item><parameter>Период</parameter><userSettingID>Период</userSettingID></item>\n'
      + '\t\t\t\t<item><parameter>Организация</parameter><userSettingID>Организация</userSettingID></item>\n'
      + '\t\t\t</dataParameters>\n'
      + '\t\t\t<structure>\n'
      + '\t\t\t\t<item xsi:type="dcsset:StructureItemGroup">\n'
      + '\t\t\t\t\t<name>Группировка</name>\n'
      + '\t\t\t\t\t<groupItems><item><field>Номенклатура</field><groupType>Items</groupType></item></groupItems>\n'
      + '\t\t\t\t\t<selection>\n'
      + '\t\t\t\t\t\t<item xsi:type="dcsset:SelectedItemAuto"/>\n'
      + '\t\t\t\t\t</selection>\n'
      + '\t\t\t\t</item>\n'
      + '\t\t\t</structure>\n'
      + '\t\t</settings>\n'
      + '\t</settingsVariant>\n'
      + '</DataCompositionSchema>\n';
    assert.strictEqual(xml, expectedXml);
  });

  test('info: полный эталон buildInfoLines (mode=full) на том же сгенерированном определении', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-skd-info-'));
    const templatePath = path.join(root, 'Схема', 'Ext', 'Template.xml');
    const service = new DataCompositionSchemaService();

    const definition: SkdDefinition = {
      dataSources: [{ name: 'ИсточникДанных1', type: 'Local' }],
      dataSets: [
        {
          name: 'Продажи',
          query:
            'ВЫБРАТЬ Товары.Ссылка КАК Номенклатура, Продажи.Количество КАК Количество ИЗ РегистрНакопления.Продажи КАК Продажи',
          fields: [
            'Номенклатура [Номенклатура]: CatalogRef.Товары @dimension',
            {
              field: 'Количество',
              dataPath: 'Количество',
              title: 'Количество',
              type: 'decimal(15,3)',
              restrict: ['noFilter'],
            },
          ],
        },
      ],
      calculatedFields: ['Сумма: decimal(15,2) = Количество * Цена #noOrder'],
      totalFields: ['Количество: Сумма'],
      parameters: [
        'Период [Период]: StandardPeriod @autoDates',
        { name: 'Организация', title: 'Организация', type: 'CatalogRef.Организации', valueListAllowed: true, use: 'Always' },
      ],
      settingsVariants: [
        {
          name: 'Основной',
          title: 'Основной вариант',
          selection: ['Номенклатура', 'Количество'],
          filter: ['Количество > 0'],
          order: ['Номенклатура'],
          dataParameters: 'auto',
          structure: [{ name: 'Группировка', groupFields: ['Номенклатура'], selection: ['Auto'] }],
        },
      ],
    };
    service.compile({ outputPath: templatePath, definition });

    const info = service.info({ templatePath, mode: 'full' });
    const expectedLines = [
      '=== DataCompositionSchema ===',
      'Наборы данных: 1',
      'Поля: 2',
      'Вычисляемые поля: 1',
      'Итоги: 1',
      'Параметры: 6',
      'Варианты: 1',
      '',
      '--- Query: Продажи ---',
      'ВЫБРАТЬ Товары.Ссылка КАК Номенклатура, Продажи.Количество КАК Количество ИЗ РегистрНакопления.Продажи КАК Продажи',
      '',
      '--- Fields ---',
      '  Продажи: Номенклатура, Количество',
      '',
      '--- Calculated ---',
      '  Сумма = Количество * Цена',
      '',
      '--- Resources ---',
      '  Количество: Сумма(Количество)',
      '',
      '--- Parameters ---',
      '  Период: StandardPeriod',
      '  НачалоПериода: dateTime [hidden]',
      '  КонецПериода: dateTime [hidden]',
      '  Организация: CatalogRef.Организации',
      // Те же два "пустых" параметра, что и в компилируемом result.parameters
      // (см. предыдущий тест): matchBlocks(xml, 'parameter') матчит и вложенные
      // <item><parameter>Период</parameter></item> внутри <dataParameters>
      // варианта настроек (сгенерированы dataParameters:'auto'), у которых нет
      // дочернего <name>/<valueType> — отсюда пустое имя и "<тип не задан>".
      '  : <тип не задан>',
      '  : <тип не задан>',
      '',
      '--- Variants ---',
      '  Основной: selection=Номенклатура, Количество',
    ];
    assert.deepStrictEqual(info.lines, expectedLines);
  });

  test('edit — цепочка add-field/modify-field/add-parameter/rename-parameter/reorder-parameters на реальной выгрузке example/2.21 (Reports/ПраваДоступа): полный байтовый эталон после каждого шага', () => {
    // Реальная выгрузка 1С с BOM + CRLF: сохранение обоих через
    // writeTextFilePreservingBomAndEol — часть контракта, который обязан пережить
    // дробление сервиса. Фикстура компактна (68 строк), но содержит multi-valueType
    // поле "Пользователь" (4 альтернативных <v8:Type>), namespace-префиксованный
        // settingsVariant (dcsset:) и <parameter> с value/useRestriction/use — то есть
    // задевает основные ветки replaceFieldBlock/replaceParameterBlock/renameParameter.
    const fixture = path.resolve(
      __dirname,
      '../../../example/2.21/src/cf/Reports/ПраваДоступа/Templates/МакетПараметров/Ext/Template.xml'
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-skd-edit-'));
    const destDir = path.join(root, 'МакетПараметров', 'Ext');
    fs.mkdirSync(destDir, { recursive: true });
    const templatePath = path.join(destDir, 'Template.xml');
    fs.copyFileSync(fixture, templatePath);

    const service = new DataCompositionSchemaService();

    // Шаг 0: убеждаемся, что фикстура скопирована как есть (BOM + CRLF, без изменений).
    const original = fs.readFileSync(templatePath, 'utf-8');
    const expectedOriginal =
      '﻿<?xml version="1.0" encoding="UTF-8"?>' + '\r\n'
      + '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + '\r\n'
      + '\t<dataSource>' + '\r\n'
      + '\t\t<name>ИсточникДанных1</name>' + '\r\n'
      + '\t\t<dataSourceType>Local</dataSourceType>' + '\r\n'
      + '\t</dataSource>' + '\r\n'
      + '\t<dataSet xsi:type="DataSetQuery">' + '\r\n'
      + '\t\t<name>НаборДанных1</name>' + '\r\n'
      + '\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Пользователь</dataPath>' + '\r\n'
      + '\t\t\t<field>Пользователь</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t\t<v8:content>Пользователь</v8:content>' + '\r\n'
      + '\t\t\t\t</v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ВнешниеПользователи</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыВнешнихПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '\t\t<dataSource>ИсточникДанных1</dataSource>' + '\r\n'
      + '\t\t<query>ВЫБРАТЬ НЕОПРЕДЕЛЕНО КАК Пользователь</query>' + '\r\n'
      + '\t</dataSet>' + '\r\n'
      + '\t<parameter>' + '\r\n'
      + '\t\t<name>ПодробныеСведенияОПравахДоступа</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Подробные сведения о правах доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>xs:boolean</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t\t<value xsi:type="xs:boolean">false</value>' + '\r\n'
      + '\t\t<useRestriction>false</useRestriction>' + '\r\n'
      + '\t\t<use>Always</use>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '\t<settingsVariant>' + '\r\n'
      + '\t\t<dcsset:name>ПраваДоступа</dcsset:name>' + '\r\n'
      + '\t\t<dcsset:presentation xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Права доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</dcsset:presentation>' + '\r\n'
      + '\t\t<dcsset:settings xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows">' + '\r\n'
      + '\t\t\t<dcsset:filter>' + '\r\n'
      + '\t\t\t\t<dcsset:item xsi:type="dcsset:FilterItemComparison">' + '\r\n'
      + '\t\t\t\t\t<dcsset:left xsi:type="dcscor:Field">Пользователь</dcsset:left>' + '\r\n'
      + '\t\t\t\t\t<dcsset:comparisonType>Equal</dcsset:comparisonType>' + '\r\n'
      + '\t\t\t\t\t<dcsset:viewMode>Inaccessible</dcsset:viewMode>' + '\r\n'
      + '\t\t\t\t</dcsset:item>' + '\r\n'
      + '\t\t\t</dcsset:filter>' + '\r\n'
      + '\t\t\t<dcsset:dataParameters>' + '\r\n'
      + '\t\t\t\t<dcscor:item xsi:type="dcsset:SettingsParameterValue">' + '\r\n'
      + '\t\t\t\t\t<dcscor:use>false</dcscor:use>' + '\r\n'
      + '\t\t\t\t\t<dcscor:parameter>ПодробныеСведенияОПравахДоступа</dcscor:parameter>' + '\r\n'
      + '\t\t\t\t\t<dcscor:value xsi:type="xs:boolean">false</dcscor:value>' + '\r\n'
      + '\t\t\t\t\t<dcsset:userSettingID>b61802a2-20e1-457e-ad65-c61886a04ff8</dcsset:userSettingID>' + '\r\n'
      + '\t\t\t\t</dcscor:item>' + '\r\n'
      + '\t\t\t</dcsset:dataParameters>' + '\r\n'
      + '\t\t</dcsset:settings>' + '\r\n'
      + '\t</settingsVariant>' + '\r\n'
      + '</DataCompositionSchema>';
    assert.strictEqual(original, expectedOriginal);

    // Шаг 1: add-field — insertBeforeClose вставляет новое поле прямо перед
    // </dataSet>, поэтому закрывающий тег теряет исходный отступ (задокументированное
    // поведение insertBeforeClose, а не баг: golden обязан зафиксировать именно это).
    const editAddField = service.edit({
      templatePath,
      operation: 'add-field',
      value: 'Роль [Роль]: CatalogRef.Роли',
      dataSet: 'НаборДанных1',
    });
    assert.strictEqual(editAddField.changedFiles.length, 1);
    assert.strictEqual(editAddField.warnings.length, 0);

    const afterAddField = fs.readFileSync(templatePath, 'utf-8');
    const expectedAfterAddField =
      '﻿<?xml version="1.0" encoding="UTF-8"?>' + '\r\n'
      + '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + '\r\n'
      + '\t<dataSource>' + '\r\n'
      + '\t\t<name>ИсточникДанных1</name>' + '\r\n'
      + '\t\t<dataSourceType>Local</dataSourceType>' + '\r\n'
      + '\t</dataSource>' + '\r\n'
      + '\t<dataSet xsi:type="DataSetQuery">' + '\r\n'
      + '\t\t<name>НаборДанных1</name>' + '\r\n'
      + '\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Пользователь</dataPath>' + '\r\n'
      + '\t\t\t<field>Пользователь</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t\t<v8:content>Пользователь</v8:content>' + '\r\n'
      + '\t\t\t\t</v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ВнешниеПользователи</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыВнешнихПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '\t\t<dataSource>ИсточникДанных1</dataSource>' + '\r\n'
      + '\t\t<query>ВЫБРАТЬ НЕОПРЕДЕЛЕНО КАК Пользователь</query>' + '\r\n'
      + '\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Роль</dataPath>' + '\r\n'
      + '\t\t\t<field>Роль</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Роль</v8:content></v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Роли</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '</dataSet>' + '\r\n'
      + '\t<parameter>' + '\r\n'
      + '\t\t<name>ПодробныеСведенияОПравахДоступа</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Подробные сведения о правах доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>xs:boolean</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t\t<value xsi:type="xs:boolean">false</value>' + '\r\n'
      + '\t\t<useRestriction>false</useRestriction>' + '\r\n'
      + '\t\t<use>Always</use>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '\t<settingsVariant>' + '\r\n'
      + '\t\t<dcsset:name>ПраваДоступа</dcsset:name>' + '\r\n'
      + '\t\t<dcsset:presentation xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Права доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</dcsset:presentation>' + '\r\n'
      + '\t\t<dcsset:settings xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows">' + '\r\n'
      + '\t\t\t<dcsset:filter>' + '\r\n'
      + '\t\t\t\t<dcsset:item xsi:type="dcsset:FilterItemComparison">' + '\r\n'
      + '\t\t\t\t\t<dcsset:left xsi:type="dcscor:Field">Пользователь</dcsset:left>' + '\r\n'
      + '\t\t\t\t\t<dcsset:comparisonType>Equal</dcsset:comparisonType>' + '\r\n'
      + '\t\t\t\t\t<dcsset:viewMode>Inaccessible</dcsset:viewMode>' + '\r\n'
      + '\t\t\t\t</dcsset:item>' + '\r\n'
      + '\t\t\t</dcsset:filter>' + '\r\n'
      + '\t\t\t<dcsset:dataParameters>' + '\r\n'
      + '\t\t\t\t<dcscor:item xsi:type="dcsset:SettingsParameterValue">' + '\r\n'
      + '\t\t\t\t\t<dcscor:use>false</dcscor:use>' + '\r\n'
      + '\t\t\t\t\t<dcscor:parameter>ПодробныеСведенияОПравахДоступа</dcscor:parameter>' + '\r\n'
      + '\t\t\t\t\t<dcscor:value xsi:type="xs:boolean">false</dcscor:value>' + '\r\n'
      + '\t\t\t\t\t<dcsset:userSettingID>b61802a2-20e1-457e-ad65-c61886a04ff8</dcsset:userSettingID>' + '\r\n'
      + '\t\t\t\t</dcscor:item>' + '\r\n'
      + '\t\t\t</dcsset:dataParameters>' + '\r\n'
      + '\t\t</dcsset:settings>' + '\r\n'
      + '\t</settingsVariant>' + '\r\n'
      + '</DataCompositionSchema>';
    assert.strictEqual(afterAddField, expectedAfterAddField);

    // Шаг 2: modify-field заменяет поле "Пользователь" на новый shorthand с одним
    // valueType. Реальный эффект replaceFieldBlock на multi-<v8:Type> поле: regex
    // matchBlocks находит блок только ДО первого валидного </field>, поэтому
    // подстановка захватывает не весь исходный блок — "хвост" старого <title>/
    // <valueType> остаётся в документе как осиротевший фрагмент. Это существующее
    // поведение сервиса ДО дробления, и golden обязан зафиксировать именно его,
    // а не "исправленный" ожидаемый вид — так работает byte-характеризация.
    const editModifyField = service.edit({
      templatePath,
      operation: 'modify-field',
      value: 'Пользователь [Пользователь(ФИО)]: CatalogRef.Пользователи',
      dataSet: 'НаборДанных1',
    });
    assert.strictEqual(editModifyField.changedFiles.length, 1);
    assert.strictEqual(editModifyField.warnings.length, 0);

    const afterModifyField = fs.readFileSync(templatePath, 'utf-8');
    const expectedAfterModifyField =
      '﻿<?xml version="1.0" encoding="UTF-8"?>' + '\r\n'
      + '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + '\r\n'
      + '\t<dataSource>' + '\r\n'
      + '\t\t<name>ИсточникДанных1</name>' + '\r\n'
      + '\t\t<dataSourceType>Local</dataSourceType>' + '\r\n'
      + '\t</dataSource>' + '\r\n'
      + '\t<dataSet xsi:type="DataSetQuery">' + '\r\n'
      + '\t\t<name>НаборДанных1</name>' + '\r\n'
      + '\t\t\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Пользователь</dataPath>' + '\r\n'
      + '\t\t\t<field>Пользователь</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Пользователь(ФИО)</v8:content></v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t\t<v8:content>Пользователь</v8:content>' + '\r\n'
      + '\t\t\t\t</v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ВнешниеПользователи</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыВнешнихПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '\t\t<dataSource>ИсточникДанных1</dataSource>' + '\r\n'
      + '\t\t<query>ВЫБРАТЬ НЕОПРЕДЕЛЕНО КАК Пользователь</query>' + '\r\n'
      + '\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Роль</dataPath>' + '\r\n'
      + '\t\t\t<field>Роль</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Роль</v8:content></v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Роли</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '</dataSet>' + '\r\n'
      + '\t<parameter>' + '\r\n'
      + '\t\t<name>ПодробныеСведенияОПравахДоступа</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Подробные сведения о правах доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>xs:boolean</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t\t<value xsi:type="xs:boolean">false</value>' + '\r\n'
      + '\t\t<useRestriction>false</useRestriction>' + '\r\n'
      + '\t\t<use>Always</use>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '\t<settingsVariant>' + '\r\n'
      + '\t\t<dcsset:name>ПраваДоступа</dcsset:name>' + '\r\n'
      + '\t\t<dcsset:presentation xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Права доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</dcsset:presentation>' + '\r\n'
      + '\t\t<dcsset:settings xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows">' + '\r\n'
      + '\t\t\t<dcsset:filter>' + '\r\n'
      + '\t\t\t\t<dcsset:item xsi:type="dcsset:FilterItemComparison">' + '\r\n'
      + '\t\t\t\t\t<dcsset:left xsi:type="dcscor:Field">Пользователь</dcsset:left>' + '\r\n'
      + '\t\t\t\t\t<dcsset:comparisonType>Equal</dcsset:comparisonType>' + '\r\n'
      + '\t\t\t\t\t<dcsset:viewMode>Inaccessible</dcsset:viewMode>' + '\r\n'
      + '\t\t\t\t</dcsset:item>' + '\r\n'
      + '\t\t\t</dcsset:filter>' + '\r\n'
      + '\t\t\t<dcsset:dataParameters>' + '\r\n'
      + '\t\t\t\t<dcscor:item xsi:type="dcsset:SettingsParameterValue">' + '\r\n'
      + '\t\t\t\t\t<dcscor:use>false</dcscor:use>' + '\r\n'
      + '\t\t\t\t\t<dcscor:parameter>ПодробныеСведенияОПравахДоступа</dcscor:parameter>' + '\r\n'
      + '\t\t\t\t\t<dcscor:value xsi:type="xs:boolean">false</dcscor:value>' + '\r\n'
      + '\t\t\t\t\t<dcsset:userSettingID>b61802a2-20e1-457e-ad65-c61886a04ff8</dcsset:userSettingID>' + '\r\n'
      + '\t\t\t\t</dcscor:item>' + '\r\n'
      + '\t\t\t</dcsset:dataParameters>' + '\r\n'
      + '\t\t</dcsset:settings>' + '\r\n'
      + '\t</settingsVariant>' + '\r\n'
      + '</DataCompositionSchema>';
    assert.strictEqual(afterModifyField, expectedAfterModifyField);

    // Шаг 3: add-parameter — новый параметр вставляется перед </DataCompositionSchema>,
    // то есть ПОСЛЕ settingsVariant (insertBeforeClose на корень схемы).
    const editAddParameter = service.edit({
      templatePath,
      operation: 'add-parameter',
      value: 'ПериодАнализа [Период анализа]: StandardPeriod',
    });
    assert.strictEqual(editAddParameter.changedFiles.length, 1);
    assert.strictEqual(editAddParameter.warnings.length, 0);

    const afterAddParameter = fs.readFileSync(templatePath, 'utf-8');
    assert.ok(afterAddParameter.endsWith(
      '\t<parameter>' + '\r\n'
      + '\t\t<name>ПериодАнализа</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Период анализа</v8:content></v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>v8:StandardPeriod</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '</DataCompositionSchema>'
    ), 'новый параметр ПериодАнализа должен быть вставлен последним перед закрытием корня');
    // Полный эталон — та же строка afterModifyField с точечной вставкой параметра
    // перед закрывающим корневым тегом (insertBeforeClose не переформатирует остальной документ).
    const expectedAfterAddParameter = expectedAfterModifyField.slice(0, -('</DataCompositionSchema>'.length))
      + '\t<parameter>' + '\r\n'
      + '\t\t<name>ПериодАнализа</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Период анализа</v8:content></v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>v8:StandardPeriod</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '</DataCompositionSchema>';
    assert.strictEqual(afterAddParameter, expectedAfterAddParameter);

    // Шаг 4: rename-parameter — переименовывает ТОЛЬКО <name> целевого <parameter>,
    // не трогая dataPath/field/значения фильтра (см. renameParameter и отдельный
    // dataCompositionSchemaMutationCorrectness.test.ts, M3). Здесь фиксируем полный
    // байтовый эффект: <name>ПодробныеСведенияОПравахДоступа</name> -> <name>ПоказыватьПодробности</name>,
    // остальной текст документа не меняется ни на символ.
    const editRename = service.edit({
      templatePath,
      operation: 'rename-parameter',
      value: 'ПодробныеСведенияОПравахДоступа => ПоказыватьПодробности',
    });
    assert.strictEqual(editRename.warnings.length, 0);

    const afterRename = fs.readFileSync(templatePath, 'utf-8');
    const expectedAfterRename = afterAddParameter.replace(
      '<name>ПодробныеСведенияОПравахДоступа</name>',
      '<name>ПоказыватьПодробности</name>'
    );
    assert.strictEqual(afterRename, expectedAfterRename);
    // rename-parameter не переименовывает dcscor:parameter внутри dataParameters —
    // это ссылка на СТАРОЕ имя вне прямых <parameter>-детей корня (см. renameParameter:
    // затрагиваются только findDirectElementRanges(rootInner, 'parameter')).
    assert.ok(afterRename.includes('<dcscor:parameter>ПодробныеСведенияОПравахДоступа</dcscor:parameter>'));

    // Шаг 5: reorder-parameters — переставляет местами блоки <parameter> целиком
    // (порядок "ПериодАнализа, ПоказыватьПодробности"), остальной документ (включая
    // settingsVariant между dataSet и параметрами) остаётся на прежнем месте.
    const editReorder = service.edit({
      templatePath,
      operation: 'reorder-parameters',
      value: 'ПериодАнализа, ПоказыватьПодробности',
    });
    assert.strictEqual(editReorder.warnings.length, 0);

    const afterReorder = fs.readFileSync(templatePath, 'utf-8');
    const expectedAfterReorder =
      '﻿<?xml version="1.0" encoding="UTF-8"?>' + '\r\n'
      + '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' + '\r\n'
      + '\t<dataSource>' + '\r\n'
      + '\t\t<name>ИсточникДанных1</name>' + '\r\n'
      + '\t\t<dataSourceType>Local</dataSourceType>' + '\r\n'
      + '\t</dataSource>' + '\r\n'
      + '\t<dataSet xsi:type="DataSetQuery">' + '\r\n'
      + '\t\t<name>НаборДанных1</name>' + '\r\n'
      + '\t\t\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Пользователь</dataPath>' + '\r\n'
      + '\t\t\t<field>Пользователь</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Пользователь(ФИО)</v8:content></v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t\t<v8:content>Пользователь</v8:content>' + '\r\n'
      + '\t\t\t\t</v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ВнешниеПользователи</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыВнешнихПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.ГруппыПользователей</v8:Type>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Пользователи</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '\t\t<dataSource>ИсточникДанных1</dataSource>' + '\r\n'
      + '\t\t<query>ВЫБРАТЬ НЕОПРЕДЕЛЕНО КАК Пользователь</query>' + '\r\n'
      + '\t\t<field xsi:type="DataSetFieldField">' + '\r\n'
      + '\t\t\t<dataPath>Роль</dataPath>' + '\r\n'
      + '\t\t\t<field>Роль</field>' + '\r\n'
      + '\t\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Роль</v8:content></v8:item>' + '\r\n'
      + '\t\t\t</title>' + '\r\n'
      + '\t\t\t<valueType>' + '\r\n'
      + '\t\t\t\t<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:CatalogRef.Роли</v8:Type>' + '\r\n'
      + '\t\t\t</valueType>' + '\r\n'
      + '\t\t</field>' + '\r\n'
      + '</dataSet>' + '\r\n'
      + '\t' + '\r\n'
      + '\t<settingsVariant>' + '\r\n'
      + '\t\t<dcsset:name>ПраваДоступа</dcsset:name>' + '\r\n'
      + '\t\t<dcsset:presentation xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Права доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</dcsset:presentation>' + '\r\n'
      + '\t\t<dcsset:settings xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows">' + '\r\n'
      + '\t\t\t<dcsset:filter>' + '\r\n'
      + '\t\t\t\t<dcsset:item xsi:type="dcsset:FilterItemComparison">' + '\r\n'
      + '\t\t\t\t\t<dcsset:left xsi:type="dcscor:Field">Пользователь</dcsset:left>' + '\r\n'
      + '\t\t\t\t\t<dcsset:comparisonType>Equal</dcsset:comparisonType>' + '\r\n'
      + '\t\t\t\t\t<dcsset:viewMode>Inaccessible</dcsset:viewMode>' + '\r\n'
      + '\t\t\t\t</dcsset:item>' + '\r\n'
      + '\t\t\t</dcsset:filter>' + '\r\n'
      + '\t\t\t<dcsset:dataParameters>' + '\r\n'
      + '\t\t\t\t<dcscor:item xsi:type="dcsset:SettingsParameterValue">' + '\r\n'
      + '\t\t\t\t\t<dcscor:use>false</dcscor:use>' + '\r\n'
      + '\t\t\t\t\t<dcscor:parameter>ПодробныеСведенияОПравахДоступа</dcscor:parameter>' + '\r\n'
      + '\t\t\t\t\t<dcscor:value xsi:type="xs:boolean">false</dcscor:value>' + '\r\n'
      + '\t\t\t\t\t<dcsset:userSettingID>b61802a2-20e1-457e-ad65-c61886a04ff8</dcsset:userSettingID>' + '\r\n'
      + '\t\t\t\t</dcscor:item>' + '\r\n'
      + '\t\t\t</dcsset:dataParameters>' + '\r\n'
      + '\t\t</dcsset:settings>' + '\r\n'
      + '\t</settingsVariant>' + '\r\n'
      + '\t' + '\r\n'
      + '<parameter>' + '\r\n'
      + '\t\t<name>ПериодАнализа</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item><v8:lang>ru</v8:lang><v8:content>Период анализа</v8:content></v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>v8:StandardPeriod</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '<parameter>' + '\r\n'
      + '\t\t<name>ПоказыватьПодробности</name>' + '\r\n'
      + '\t\t<title xsi:type="v8:LocalStringType">' + '\r\n'
      + '\t\t\t<v8:item>' + '\r\n'
      + '\t\t\t\t<v8:lang>ru</v8:lang>' + '\r\n'
      + '\t\t\t\t<v8:content>Подробные сведения о правах доступа</v8:content>' + '\r\n'
      + '\t\t\t</v8:item>' + '\r\n'
      + '\t\t</title>' + '\r\n'
      + '\t\t<valueType>' + '\r\n'
      + '\t\t\t<v8:Type>xs:boolean</v8:Type>' + '\r\n'
      + '\t\t</valueType>' + '\r\n'
      + '\t\t<value xsi:type="xs:boolean">false</value>' + '\r\n'
      + '\t\t<useRestriction>false</useRestriction>' + '\r\n'
      + '\t\t<use>Always</use>' + '\r\n'
      + '\t</parameter>' + '\r\n'
      + '</DataCompositionSchema>';
    assert.strictEqual(afterReorder, expectedAfterReorder);
  });

  test('info: полный эталон buildInfoLines (mode=full) на реальной выгрузке example/2.21 (Reports/ПраваДоступа) без предварительных edit', () => {
    const fixture = path.resolve(
      __dirname,
      '../../../example/2.21/src/cf/Reports/ПраваДоступа/Templates/МакетПараметров/Ext/Template.xml'
    );
    const service = new DataCompositionSchemaService();
    const info = service.info({ templatePath: fixture, mode: 'full' });

    const expectedLines = [
      '=== DataCompositionSchema ===',
      'Наборы данных: 1',
      'Поля: 1',
      'Вычисляемые поля: 0',
      'Итоги: 0',
      'Параметры: 1',
      'Варианты: 1',
      '',
      '--- Query: НаборДанных1 ---',
      'ВЫБРАТЬ НЕОПРЕДЕЛЕНО КАК Пользователь',
      '',
      '--- Fields ---',
      '  НаборДанных1: Пользователь',
      '',
      '--- Calculated ---',
      '',
      '--- Resources ---',
      '',
      '--- Parameters ---',
      '  ПодробныеСведенияОПравахДоступа: boolean',
      '',
      '--- Variants ---',
      // settingsVariant в этой реальной выгрузке использует namespace-префикс
      // dcsset:name/dcsset:settings — parseSchema ищет НЕпрефиксованные <name>/<selection>,
      // поэтому name и selection варианта закономерно пустые (задокументированное поведение).
      '  : selection=Auto',
    ];
    assert.deepStrictEqual(info.lines, expectedLines);
  });
});
