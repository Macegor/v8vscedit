import * as assert from 'assert';
import {
  buildFormXmlFromDefinition,
  withCollectedWarnings,
} from '../../infra/xml/form/FormBuilders';
import type { FormDefinition } from '../../infra/xml/form/types';

/**
 * Байт-в-байт golden-тест `buildFormXmlFromDefinition` — обязательный
 * предварительный шаг перед дроблением `FormBuilders.ts` (God-класс #7,
 * инвариант CLAUDE.md №17). Фиксирует ТЕКУЩИЙ вывод генератора целиком
 * (включая `\n`/табы/самозакрывающиеся теги) для репрезентативного набора
 * определений формы, чтобы при переносе кода в `builders/*` вербатим любое
 * отклонение реального XML от эталона было немедленно замечено.
 *
 * Идентификаторы элементов детерминированы: `createIdAllocator('')` стартует
 * счётчики с 0 и инкрементирует их последовательно при обходе дерева —
 * никакого uuid/недетерминизма нет, поэтому эталон сравнивается через
 * `assert.strictEqual` без regex-плейсхолдеров.
 */
suite('FormBuilders — golden byte-for-byte эталон', () => {
  test('минимальная форма (только заголовок) — детерминированный полный XML', () => {
    const definition: FormDefinition = { title: 'Простая форма' };

    const actual = buildFormXmlFromDefinition(definition, '2.21');

    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">\n' +
      '\t<Title>\n' +
      '\t\t<v8:item>\n' +
      '\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t<v8:content>Простая форма</v8:content>\n' +
      '\t\t</v8:item>\n' +
      '\t</Title>\n' +
      '\t<AutoTitle>false</AutoTitle>\n' +
      '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>\n' +
      '</Form>\n';

    assert.strictEqual(actual, expected);
  });

  test('пустое определение (без заголовка) — только каркас Form + AutoCommandBar id=-1', () => {
    // Задевает ветку buildFormXmlFromDefinition, где title отсутствует вовсе:
    // тогда не эмитятся ни <Title>, ни <AutoTitle>, а AutoCommandBar остаётся
    // самозакрывающимся (hasInner=false).
    const actual = buildFormXmlFromDefinition({}, '2.21');

    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">\n' +
      '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>\n' +
      '</Form>\n';

    assert.strictEqual(actual, expected);
  });

  test('форма с атрибутами: основной реквизит, скалярные типы, ValueTable с колонками, DynamicList-настройки', () => {
    // Задевает buildAttributeXml-ветки внутри emitAttributes: MainAttribute+SavedData
    // (объектный тип главного реквизита), string(N), decimal(N,M), date, boolean,
    // ValueTable.Columns и Settings xsi:type="DynamicList".
    const definition: FormDefinition = {
      title: 'Форма с атрибутами',
      attributes: [
        { name: 'Объект', type: 'CatalogObject.Контрагенты', main: true },
        { name: 'Комментарий', type: 'string(150)' },
        { name: 'Количество', type: 'decimal(10,2)' },
        { name: 'ДатаДокумента', type: 'date' },
        { name: 'Активность', type: 'boolean' },
        {
          name: 'ТаблицаСтрок', type: 'ValueTable', columns: [
            { name: 'Товар', type: 'CatalogRef.Номенклатура' },
            { name: 'Сумма', type: 'decimal(15,2)' },
          ],
        },
        {
          name: 'СписокДинамический', type: 'DynamicList',
          settings: { mainTable: 'Справочник.Контрагенты', manualQuery: false, dynamicDataRead: true },
        },
      ],
    };

    const actual = buildFormXmlFromDefinition(definition, '2.21');

    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">\n' +
      '\t<Title>\n' +
      '\t\t<v8:item>\n' +
      '\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t<v8:content>Форма с атрибутами</v8:content>\n' +
      '\t\t</v8:item>\n' +
      '\t</Title>\n' +
      '\t<AutoTitle>false</AutoTitle>\n' +
      '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>\n' +
      '\t<Attributes>\n' +
      '\t\t<Attribute name="Объект" id="1">\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>cfg:CatalogObject.Контрагенты</v8:Type>\n' +
      '\t\t\t</Type>\n' +
      '\t\t\t<MainAttribute>true</MainAttribute>\n' +
      '\t\t\t<SavedData>true</SavedData>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="Комментарий" id="2">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Комментарий</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>xs:string</v8:Type>\n' +
      '\t\t\t\t<v8:StringQualifiers>\n' +
      '\t\t\t\t\t<v8:Length>150</v8:Length>\n' +
      '\t\t\t\t\t<v8:AllowedLength>Variable</v8:AllowedLength>\n' +
      '\t\t\t\t</v8:StringQualifiers>\n' +
      '\t\t\t</Type>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="Количество" id="3">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Количество</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>xs:decimal</v8:Type>\n' +
      '\t\t\t\t<v8:NumberQualifiers>\n' +
      '\t\t\t\t\t<v8:Digits>10</v8:Digits>\n' +
      '\t\t\t\t\t<v8:FractionDigits>2</v8:FractionDigits>\n' +
      '\t\t\t\t\t<v8:AllowedSign>Any</v8:AllowedSign>\n' +
      '\t\t\t\t</v8:NumberQualifiers>\n' +
      '\t\t\t</Type>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="ДатаДокумента" id="4">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Дата документа</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>xs:dateTime</v8:Type>\n' +
      '\t\t\t\t<v8:DateQualifiers>\n' +
      '\t\t\t\t\t<v8:DateFractions>Date</v8:DateFractions>\n' +
      '\t\t\t\t</v8:DateQualifiers>\n' +
      '\t\t\t</Type>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="Активность" id="5">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Активность</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>xs:boolean</v8:Type>\n' +
      '\t\t\t</Type>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="ТаблицаСтрок" id="6">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Таблица строк</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>v8:ValueTable</v8:Type>\n' +
      '\t\t\t</Type>\n' +
      '\t\t\t<Columns>\n' +
      '\t\t\t\t<Column name="Товар" id="7">\n' +
      '\t\t\t\t\t<Type>\n' +
      '\t\t\t\t\t\t<v8:Type>cfg:CatalogRef.Номенклатура</v8:Type>\n' +
      '\t\t\t\t\t</Type>\n' +
      '\t\t\t\t</Column>\n' +
      '\t\t\t\t<Column name="Сумма" id="8">\n' +
      '\t\t\t\t\t<Type>\n' +
      '\t\t\t\t\t\t<v8:Type>xs:decimal</v8:Type>\n' +
      '\t\t\t\t\t\t<v8:NumberQualifiers>\n' +
      '\t\t\t\t\t\t\t<v8:Digits>15</v8:Digits>\n' +
      '\t\t\t\t\t\t\t<v8:FractionDigits>2</v8:FractionDigits>\n' +
      '\t\t\t\t\t\t\t<v8:AllowedSign>Any</v8:AllowedSign>\n' +
      '\t\t\t\t\t\t</v8:NumberQualifiers>\n' +
      '\t\t\t\t\t</Type>\n' +
      '\t\t\t\t</Column>\n' +
      '\t\t\t</Columns>\n' +
      '\t\t</Attribute>\n' +
      '\t\t<Attribute name="СписокДинамический" id="9">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Список динамический</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Type>\n' +
      '\t\t\t\t<v8:Type>cfg:DynamicList</v8:Type>\n' +
      '\t\t\t</Type>\n' +
      '\t\t\t<Settings xsi:type="DynamicList">\n' +
      '\t\t\t\t<MainTable>Справочник.Контрагенты</MainTable>\n' +
      '\t\t\t\t<ManualQuery>false</ManualQuery>\n' +
      '\t\t\t\t<DynamicDataRead>true</DynamicDataRead>\n' +
      '\t\t\t</Settings>\n' +
      '\t\t</Attribute>\n' +
      '\t</Attributes>\n' +
      '</Form>\n';

    assert.strictEqual(actual, expected);
  });

  test('форма с командами (Action/Shortcut/Picture) и событиями формы (Events-блок)', () => {
    // Задевает emitCommands (три ветки Command: action+shortcut, picture,
    // без action/title — авто-заголовок из имени) и Events-блок формы.
    const definition: FormDefinition = {
      title: 'Форма с командами',
      events: {
        OnCreateAtServer: 'ПриСозданииНаСервере',
        OnOpen: 'ПриОткрытии',
        BeforeClose: 'ПередЗакрытием',
      },
      commands: [
        { name: 'ЗаписатьИЗакрыть', action: 'ЗаписатьИЗакрытьОбработка', shortcut: 'Ctrl+Enter' },
        { name: 'Печать', title: 'Печать документа', picture: 'ОбщаяКартинка.Печать' },
        { name: 'ОбновитьДанные', actions: [{ handler: 'ОбновитьДанныеНаСервере', callType: 'Before' }] },
      ],
    };

    const actual = buildFormXmlFromDefinition(definition, '2.21');

    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="2.21">\n' +
      '\t<Title>\n' +
      '\t\t<v8:item>\n' +
      '\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t<v8:content>Форма с командами</v8:content>\n' +
      '\t\t</v8:item>\n' +
      '\t</Title>\n' +
      '\t<AutoTitle>false</AutoTitle>\n' +
      '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>\n' +
      '\t<Events>\n' +
      '\t\t<Event name="OnCreateAtServer">ПриСозданииНаСервере</Event>\n' +
      '\t\t<Event name="OnOpen">ПриОткрытии</Event>\n' +
      '\t\t<Event name="BeforeClose">ПередЗакрытием</Event>\n' +
      '\t</Events>\n' +
      '\t<Commands>\n' +
      '\t\t<Command name="ЗаписатьИЗакрыть" id="1">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Записать и закрыть</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Action>ЗаписатьИЗакрытьОбработка</Action>\n' +
      '\t\t\t<Shortcut>Ctrl+Enter</Shortcut>\n' +
      '\t\t</Command>\n' +
      '\t\t<Command name="Печать" id="2">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Печать документа</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t\t<Picture>\n' +
      '\t\t\t\t<xr:Ref>ОбщаяКартинка.Печать</xr:Ref>\n' +
      '\t\t\t\t<xr:LoadTransparent>true</xr:LoadTransparent>\n' +
      '\t\t\t</Picture>\n' +
      '\t\t</Command>\n' +
      '\t\t<Command name="ОбновитьДанные" id="3">\n' +
      '\t\t\t<Title>\n' +
      '\t\t\t\t<v8:item>\n' +
      '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
      '\t\t\t\t\t<v8:content>Обновить данные</v8:content>\n' +
      '\t\t\t\t</v8:item>\n' +
      '\t\t\t</Title>\n' +
      '\t\t</Command>\n' +
      '\t</Commands>\n' +
      '</Form>\n';

    assert.strictEqual(actual, expected);
  });

  // Полная форма с максимальным ветвлением emitElement: главная авто-командная
  // панель с HorizontalAlign и дочерней кнопкой (stdCommand), группа (representation,
  // ExtendedTooltip, вложенные input/check/label/picture), ColumnGroup, Pages→Page
  // с CalendarField, Table с колонками (InputField) и собственным AutoCommandBar,
  // отдельная CommandBar и Popup с кнопками (command). Один и тот же definition
  // используется дважды (2.21 и 2.20), чтобы явно показать: versionVersion влияет
  // только на атрибут `version` корневого <Form>, структура и ID-аллокация — нет.
  const richElementsDefinition: FormDefinition = {
    title: 'Форма с элементами',
    properties: { windowOpeningMode: 'LockOwnerWindow' },
    attributes: [
      { name: 'Объект', type: 'CatalogObject.Контрагенты', main: true },
      { name: 'СпособОплаты', type: 'string(20)' },
      {
        name: 'Таблица', type: 'ValueTable', columns: [
          { name: 'Дата', type: 'date' },
          { name: 'Сумма', type: 'decimal(15,2)' },
        ],
      },
    ],
    elements: [
      {
        autoCmdBar: 'ФормаКоманднаяПанель', horizontalAlign: 'Right', children: [
          { button: 'Записать', stdCommand: 'Записать', defaultButton: true },
        ],
      },
      {
        group: 'Основное', representation: 'weak', children: [
          { input: 'Наименование', path: 'Объект.Наименование' },
          { check: 'Активность', path: 'Объект.ПометкаУдаления' },
          { label: 'Заголовок', title: 'Реквизиты контрагента' },
          { picture: 'Логотип', src: 'ОбщаяКартинка.Логотип' },
        ],
      },
      {
        columnGroup: 'Колонки', children: [
          { labelField: 'СпособОплатыПоле', path: 'СпособОплата' },
        ],
      },
      {
        pages: 'Страницы', children: [
          {
            page: 'СтраницаОсновная', children: [
              { calendar: 'ДатаДокумента', path: 'Объект.Дата' },
            ],
          },
        ],
      },
      {
        table: 'Таблица', path: 'Таблица', changeRowSet: true, commandBarLocation: 'Top', columns: [
          { input: 'Дата', path: 'Таблица.Дата' },
          { input: 'Сумма', path: 'Таблица.Сумма' },
        ],
      },
      {
        cmdBar: 'ПанельКоманд', children: [
          { button: 'Обновить', command: 'ОбновитьДанные' },
        ],
      },
      {
        popup: 'ЕщёМеню', children: [
          { button: 'Печать', command: 'Печать' },
        ],
      },
    ],
  };

  const richElementsExpectedBody =
    '\t<Title>\n' +
    '\t\t<v8:item>\n' +
    '\t\t\t<v8:lang>ru</v8:lang>\n' +
    '\t\t\t<v8:content>Форма с элементами</v8:content>\n' +
    '\t\t</v8:item>\n' +
    '\t</Title>\n' +
    '\t<AutoTitle>false</AutoTitle>\n' +
    '\t<WindowOpeningMode>LockOwnerWindow</WindowOpeningMode>\n' +
    '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1">\n' +
    '\t\t<HorizontalAlign>Right</HorizontalAlign>\n' +
    '\t\t<ChildItems>\n' +
    '\t\t\t<Button name="Записать" id="1">\n' +
    '\t\t\t\t<Type>CommandBarButton</Type>\n' +
    '\t\t\t\t<CommandName>Form.StandardCommand.Записать</CommandName>\n' +
    '\t\t\t\t<DefaultButton>true</DefaultButton>\n' +
    '\t\t\t\t<ExtendedTooltip name="ЗаписатьРасширеннаяПодсказка" id="2"/>\n' +
    '\t\t\t</Button>\n' +
    '\t\t</ChildItems>\n' +
    '\t</AutoCommandBar>\n' +
    '\t<ChildItems>\n' +
    '\t\t<UsualGroup name="Основное" id="3">\n' +
    '\t\t\t<Representation>WeakSeparation</Representation>\n' +
    '\t\t\t<ExtendedTooltip name="ОсновноеРасширеннаяПодсказка" id="4"/>\n' +
    '\t\t\t<ChildItems>\n' +
    '\t\t\t\t<InputField name="Наименование" id="5">\n' +
    '\t\t\t\t\t<DataPath>Объект.Наименование</DataPath>\n' +
    '\t\t\t\t\t<ContextMenu name="НаименованиеКонтекстноеМеню" id="6"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="НаименованиеРасширеннаяПодсказка" id="7"/>\n' +
    '\t\t\t\t</InputField>\n' +
    '\t\t\t\t<CheckBoxField name="Активность" id="8">\n' +
    '\t\t\t\t\t<DataPath>Объект.ПометкаУдаления</DataPath>\n' +
    '\t\t\t\t\t<TitleLocation>Right</TitleLocation>\n' +
    '\t\t\t\t\t<ContextMenu name="АктивностьКонтекстноеМеню" id="9"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="АктивностьРасширеннаяПодсказка" id="10"/>\n' +
    '\t\t\t\t</CheckBoxField>\n' +
    '\t\t\t\t<LabelDecoration name="Заголовок" id="11">\n' +
    '\t\t\t\t\t<Title formatted="false">\n' +
    '\t\t\t\t\t\t<v8:item>\n' +
    '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
    '\t\t\t\t\t\t\t<v8:content>Реквизиты контрагента</v8:content>\n' +
    '\t\t\t\t\t\t</v8:item>\n' +
    '\t\t\t\t\t</Title>\n' +
    '\t\t\t\t\t<ContextMenu name="ЗаголовокКонтекстноеМеню" id="12"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="ЗаголовокРасширеннаяПодсказка" id="13"/>\n' +
    '\t\t\t\t</LabelDecoration>\n' +
    '\t\t\t\t<PictureDecoration name="Логотип" id="14">\n' +
    '\t\t\t\t\t<Picture>\n' +
    '\t\t\t\t\t\t<xr:Ref>ОбщаяКартинка.Логотип</xr:Ref>\n' +
    '\t\t\t\t\t\t<xr:LoadTransparent>true</xr:LoadTransparent>\n' +
    '\t\t\t\t\t</Picture>\n' +
    '\t\t\t\t\t<ContextMenu name="ЛоготипКонтекстноеМеню" id="15"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="ЛоготипРасширеннаяПодсказка" id="16"/>\n' +
    '\t\t\t\t</PictureDecoration>\n' +
    '\t\t\t</ChildItems>\n' +
    '\t\t</UsualGroup>\n' +
    '\t\t<ColumnGroup name="Колонки" id="17">\n' +
    '\t\t\t<ExtendedTooltip name="КолонкиРасширеннаяПодсказка" id="18"/>\n' +
    '\t\t\t<ChildItems>\n' +
    '\t\t\t\t<LabelField name="СпособОплатыПоле" id="19">\n' +
    '\t\t\t\t\t<DataPath>СпособОплата</DataPath>\n' +
    '\t\t\t\t\t<ContextMenu name="СпособОплатыПолеКонтекстноеМеню" id="20"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="СпособОплатыПолеРасширеннаяПодсказка" id="21"/>\n' +
    '\t\t\t\t</LabelField>\n' +
    '\t\t\t</ChildItems>\n' +
    '\t\t</ColumnGroup>\n' +
    '\t\t<Pages name="Страницы" id="22">\n' +
    '\t\t\t<ExtendedTooltip name="СтраницыРасширеннаяПодсказка" id="23"/>\n' +
    '\t\t\t<ChildItems>\n' +
    '\t\t\t\t<Page name="СтраницаОсновная" id="24">\n' +
    '\t\t\t\t\t<Title>\n' +
    '\t\t\t\t\t\t<v8:item>\n' +
    '\t\t\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
    '\t\t\t\t\t\t\t<v8:content>Страница основная</v8:content>\n' +
    '\t\t\t\t\t\t</v8:item>\n' +
    '\t\t\t\t\t</Title>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="СтраницаОсновнаяРасширеннаяПодсказка" id="25"/>\n' +
    '\t\t\t\t\t<ChildItems>\n' +
    '\t\t\t\t\t\t<CalendarField name="ДатаДокумента" id="26">\n' +
    '\t\t\t\t\t\t\t<DataPath>Объект.Дата</DataPath>\n' +
    '\t\t\t\t\t\t\t<ContextMenu name="ДатаДокументаКонтекстноеМеню" id="27"/>\n' +
    '\t\t\t\t\t\t\t<ExtendedTooltip name="ДатаДокументаРасширеннаяПодсказка" id="28"/>\n' +
    '\t\t\t\t\t\t</CalendarField>\n' +
    '\t\t\t\t\t</ChildItems>\n' +
    '\t\t\t\t</Page>\n' +
    '\t\t\t</ChildItems>\n' +
    '\t\t</Pages>\n' +
    '\t\t<Table name="Таблица" id="29">\n' +
    '\t\t\t<DataPath>Таблица</DataPath>\n' +
    '\t\t\t<ChangeRowSet>true</ChangeRowSet>\n' +
    '\t\t\t<CommandBarLocation>Top</CommandBarLocation>\n' +
    '\t\t\t<ContextMenu name="ТаблицаКонтекстноеМеню" id="30"/>\n' +
    '\t\t\t<AutoCommandBar name="ТаблицаКоманднаяПанель" id="31"/>\n' +
    '\t\t\t<SearchStringAddition name="ТаблицаСтрокаПоиска" id="32"/>\n' +
    '\t\t\t<ViewStatusAddition name="ТаблицаСостояниеПросмотра" id="33"/>\n' +
    '\t\t\t<SearchControlAddition name="ТаблицаУправлениеПоиском" id="34"/>\n' +
    '\t\t\t<ChildItems>\n' +
    '\t\t\t\t<InputField name="Дата" id="35">\n' +
    '\t\t\t\t\t<DataPath>Таблица.Дата</DataPath>\n' +
    '\t\t\t\t\t<ContextMenu name="ДатаКонтекстноеМеню" id="36"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="ДатаРасширеннаяПодсказка" id="37"/>\n' +
    '\t\t\t\t</InputField>\n' +
    '\t\t\t\t<InputField name="Сумма" id="38">\n' +
    '\t\t\t\t\t<DataPath>Таблица.Сумма</DataPath>\n' +
    '\t\t\t\t\t<ContextMenu name="СуммаКонтекстноеМеню" id="39"/>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="СуммаРасширеннаяПодсказка" id="40"/>\n' +
    '\t\t\t\t</InputField>\n' +
    '\t\t\t</ChildItems>\n' +
    '\t\t</Table>\n' +
    '\t\t<CommandBar name="ПанельКоманд" id="41">\n' +
    '\t\t\t<ChildItems>\n' +
    '\t\t\t\t<Button name="Обновить" id="42">\n' +
    '\t\t\t\t\t<Type>CommandBarButton</Type>\n' +
    '\t\t\t\t\t<CommandName>Form.Command.ОбновитьДанные</CommandName>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="ОбновитьРасширеннаяПодсказка" id="43"/>\n' +
    '\t\t\t\t</Button>\n' +
    '\t\t\t</ChildItems>\n' +
    '\t\t</CommandBar>\n' +
    '\t\t<Popup name="ЕщёМеню" id="44">\n' +
    '\t\t\t<Title>\n' +
    '\t\t\t\t<v8:item>\n' +
    '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
    '\t\t\t\t\t<v8:content>ЕщёМеню</v8:content>\n' +
    '\t\t\t\t</v8:item>\n' +
    '\t\t\t</Title>\n' +
    '\t\t\t<ChildItems>\n' +
    '\t\t\t\t<Button name="Печать" id="45">\n' +
    '\t\t\t\t\t<Type>CommandBarButton</Type>\n' +
    '\t\t\t\t\t<CommandName>Form.Command.Печать</CommandName>\n' +
    '\t\t\t\t\t<ExtendedTooltip name="ПечатьРасширеннаяПодсказка" id="46"/>\n' +
    '\t\t\t\t</Button>\n' +
    '\t\t\t</ChildItems>\n' +
    '\t\t</Popup>\n' +
    '\t</ChildItems>\n' +
    '\t<Attributes>\n' +
    '\t\t<Attribute name="Объект" id="1">\n' +
    '\t\t\t<Type>\n' +
    '\t\t\t\t<v8:Type>cfg:CatalogObject.Контрагенты</v8:Type>\n' +
    '\t\t\t</Type>\n' +
    '\t\t\t<MainAttribute>true</MainAttribute>\n' +
    '\t\t\t<SavedData>true</SavedData>\n' +
    '\t\t</Attribute>\n' +
    '\t\t<Attribute name="СпособОплаты" id="2">\n' +
    '\t\t\t<Title>\n' +
    '\t\t\t\t<v8:item>\n' +
    '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
    '\t\t\t\t\t<v8:content>Способ оплаты</v8:content>\n' +
    '\t\t\t\t</v8:item>\n' +
    '\t\t\t</Title>\n' +
    '\t\t\t<Type>\n' +
    '\t\t\t\t<v8:Type>xs:string</v8:Type>\n' +
    '\t\t\t\t<v8:StringQualifiers>\n' +
    '\t\t\t\t\t<v8:Length>20</v8:Length>\n' +
    '\t\t\t\t\t<v8:AllowedLength>Variable</v8:AllowedLength>\n' +
    '\t\t\t\t</v8:StringQualifiers>\n' +
    '\t\t\t</Type>\n' +
    '\t\t</Attribute>\n' +
    '\t\t<Attribute name="Таблица" id="3">\n' +
    '\t\t\t<Title>\n' +
    '\t\t\t\t<v8:item>\n' +
    '\t\t\t\t\t<v8:lang>ru</v8:lang>\n' +
    '\t\t\t\t\t<v8:content>Таблица</v8:content>\n' +
    '\t\t\t\t</v8:item>\n' +
    '\t\t\t</Title>\n' +
    '\t\t\t<Type>\n' +
    '\t\t\t\t<v8:Type>v8:ValueTable</v8:Type>\n' +
    '\t\t\t</Type>\n' +
    '\t\t\t<Columns>\n' +
    '\t\t\t\t<Column name="Дата" id="4">\n' +
    '\t\t\t\t\t<Type>\n' +
    '\t\t\t\t\t\t<v8:Type>xs:dateTime</v8:Type>\n' +
    '\t\t\t\t\t\t<v8:DateQualifiers>\n' +
    '\t\t\t\t\t\t\t<v8:DateFractions>Date</v8:DateFractions>\n' +
    '\t\t\t\t\t\t</v8:DateQualifiers>\n' +
    '\t\t\t\t\t</Type>\n' +
    '\t\t\t\t</Column>\n' +
    '\t\t\t\t<Column name="Сумма" id="5">\n' +
    '\t\t\t\t\t<Type>\n' +
    '\t\t\t\t\t\t<v8:Type>xs:decimal</v8:Type>\n' +
    '\t\t\t\t\t\t<v8:NumberQualifiers>\n' +
    '\t\t\t\t\t\t\t<v8:Digits>15</v8:Digits>\n' +
    '\t\t\t\t\t\t\t<v8:FractionDigits>2</v8:FractionDigits>\n' +
    '\t\t\t\t\t\t\t<v8:AllowedSign>Any</v8:AllowedSign>\n' +
    '\t\t\t\t\t\t</v8:NumberQualifiers>\n' +
    '\t\t\t\t\t</Type>\n' +
    '\t\t\t\t</Column>\n' +
    '\t\t\t</Columns>\n' +
    '\t\t</Attribute>\n' +
    '\t</Attributes>\n' +
    '</Form>\n';

  function buildRichHeader(version: string): string {
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${version}">\n`
    );
  }

  test('форма с вложенными элементами (группы/таблица/командная панель/декорации), формат 2.21 — максимум веток emitElement', () => {
    // Один прогон задевает: группу (representation, ExtendedTooltip), ColumnGroup,
    // Pages→Page (вложенность на 2 уровня), Table с колонками-InputField и
    // собственным AutoCommandBar (companion-элементы), отдельный CommandBar,
    // Popup, кнопки со stdCommand/command, декорации Label/Picture — вместе с
    // последовательной ID-аллокацией через вложенность (id растёт монотонно
    // 1..46 для элементов и 1..5 для атрибутов/колонок).
    const actual = buildFormXmlFromDefinition(richElementsDefinition, '2.21');
    const expected = buildRichHeader('2.21') + richElementsExpectedBody;

    assert.strictEqual(actual, expected);
  });

  test('та же форма в формате 2.20 — версия влияет только на атрибут version корневого Form', () => {
    // Явно фиксирует: formatVersion не участвует в id-аллокации и структуре
    // XML, только подставляется в атрибут version корневого тега. Если это
    // изменится при дроблении FormBuilders.ts — тест немедленно упадёт.
    const actual = buildFormXmlFromDefinition(richElementsDefinition, '2.20');
    const expected = buildRichHeader('2.20') + richElementsExpectedBody;

    assert.strictEqual(actual, expected);
  });

  test('withCollectedWarnings собирает предупреждения и изолирует WARN_SINK между вызовами', () => {
    // WARN_SINK — module-синглтон; при дроблении FormBuilders.ts на builders/*
    // он переедет в общий модуль, поэтому его поведение фиксируется отдельно:
    // (1) вызов внутри withCollectedWarnings собирает [WARN]/[INFO]-сообщения
    //     из разных источников (неизвестное событие формы, авто-вывод главного
    //     реквизита, нераспознанный тип атрибута);
    // (2) вне обёртки функция не падает и не накапливает предупреждения молча
    //     (WARN_SINK.warnings восстанавливается в null через finally).
    const definitionWithWarnings: FormDefinition = {
      events: { НеизвестноеСобытие: 'Обработчик' },
      attributes: [
        { name: 'А1', type: 'object-like' },
        { name: 'А2', type: 'CatalogObject.Тест' },
      ],
    };

    const { result, warnings } = withCollectedWarnings(() =>
      buildFormXmlFromDefinition(definitionWithWarnings, '2.21')
    );

    assert.deepStrictEqual(warnings, [
      '[INFO] Inferred main attribute: А2 (CatalogObject.Тест)',
      "[WARN] Unknown form event 'НеизвестноеСобытие'. Known: OnCreateAtServer, OnOpen, BeforeClose, OnClose, NotificationProcessing, ChoiceProcessing, OnReadAtServer, AfterWriteAtServer, BeforeWriteAtServer, AfterWrite, BeforeWrite, OnWriteAtServer, FillCheckProcessingAtServer, OnLoadDataFromSettingsAtServer, BeforeLoadDataFromSettingsAtServer, OnSaveDataInSettingsAtServer, ExternalEvent, OnReopen, Opening",
      "WARNING: Unrecognized bare type 'object-like' — will be emitted without namespace prefix",
    ]);
    // Результат генерации не зависит от того, собираются предупреждения или нет.
    assert.ok(result.includes('<Event name="НеизвестноеСобытие">Обработчик</Event>'));

    // Повторный вызов ВНЕ withCollectedWarnings не должен ни падать, ни
    // «утекать» предупреждениями из предыдущего вызова — WARN_SINK.warnings
    // должен быть null (see finally в withCollectedWarnings), warn() — no-op.
    const plainResult = buildFormXmlFromDefinition(definitionWithWarnings, '2.21');
    assert.strictEqual(plainResult, result, 'вызов вне обёртки должен давать идентичный XML');

    // Проверка изоляции между двумя последовательными вызовами withCollectedWarnings:
    // второй набор предупреждений не должен содержать данных первого вызова.
    const { warnings: warnings2 } = withCollectedWarnings(() => buildFormXmlFromDefinition({}, '2.21'));
    assert.deepStrictEqual(warnings2, [], 'форма без предупреждений не должна наследовать warnings предыдущего вызова');
  });
});
