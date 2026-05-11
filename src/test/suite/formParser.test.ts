import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { parseFormXml } from '../../formEditor/FormXmlParser';
import { FormXmlDocument } from '../../formEditor/FormXmlSerializer';

// __dirname is dist/test/suite/ when compiled; fixture is at src/test/fixtures/
const FORM_XML_PATH = path.resolve(__dirname, '../../../src/test/fixtures/Form.xml');

function loadFormXml(): string {
  return fs.readFileSync(FORM_XML_PATH, 'utf-8');
}

suite('FormXmlParser — элементы формы', () => {
  test('Парсит корневой элемент с дочерними', () => {
    const model = parseFormXml(loadFormXml());
    assert.ok(model.root);
    assert.strictEqual(model.root.id, 0);
    assert.strictEqual(model.root.name, '__root__');
    // AutoCommandBar + 6 ChildItems top-level elements
    assert.ok(model.root.children.length >= 7, `Ожидалось минимум 7 элементов, найдено ${model.root.children.length}`);
  });

  test('Парсит AutoCommandBar на верхнем уровне', () => {
    const model = parseFormXml(loadFormXml());
    const autoBar = model.root.children.find((c) => c.type === 'AutoCommandBar');
    assert.ok(autoBar, 'AutoCommandBar не найден');
    assert.strictEqual(autoBar.name, 'АвтоКоманднаяПанель');
    assert.strictEqual(autoBar.id, 1);
    assert.strictEqual(autoBar.children.length, 2, 'Ожидалось 2 кнопки в AutoCommandBar');
  });

  test('Парсит UsualGroup с вложенными InputField и CheckBoxField', () => {
    const model = parseFormXml(loadFormXml());
    const group = model.root.children.find((c) => c.name === 'ОсновнаяГруппа');
    assert.ok(group, 'ОсновнаяГруппа не найдена');
    assert.strictEqual(group.type, 'UsualGroup');
    assert.strictEqual(group.group, 'Vertical');
    assert.strictEqual(group.horizontalStretch, true);
    assert.strictEqual(group.title, 'Основная группа');
    assert.strictEqual(group.children.length, 2);

    const nameField = group.children.find((c) => c.name === 'Наименование');
    assert.ok(nameField, 'Поле Наименование не найдено');
    assert.strictEqual(nameField.type, 'InputField');
    assert.strictEqual(nameField.dataPath, 'Object.Description');
    assert.strictEqual(nameField.title, 'Наименование');
    assert.strictEqual(nameField.showTitle, true);
    assert.strictEqual(nameField.width, 40);
    assert.strictEqual(nameField.horizontalStretch, true);
  });

  test('Парсит CheckBoxField с Visible=false', () => {
    const model = parseFormXml(loadFormXml());
    const group = model.root.children.find((c) => c.name === 'ОсновнаяГруппа');
    assert.ok(group);
    const checkbox = group.children.find((c) => c.name === 'Активен');
    assert.ok(checkbox, 'CheckBoxField Активен не найден');
    assert.strictEqual(checkbox.type, 'CheckBoxField');
    assert.strictEqual(checkbox.visible, false);
  });

  test('Парсит Pages с двумя Page', () => {
    const model = parseFormXml(loadFormXml());
    const pages = model.root.children.find((c) => c.name === 'СтраницыПараметров');
    assert.ok(pages, 'Pages не найдены');
    assert.strictEqual(pages.type, 'Pages');
    assert.strictEqual(pages.children.length, 2);
    assert.strictEqual(pages.children[0].type, 'Page');
    assert.strictEqual(pages.children[0].title, 'Основное');
    assert.strictEqual(pages.children[1].title, 'Дополнительно');
  });

  test('Парсит вложенный InputField с ReadOnly', () => {
    const model = parseFormXml(loadFormXml());
    const pages = model.root.children.find((c) => c.name === 'СтраницыПараметров');
    assert.ok(pages);
    const page1 = pages.children[0];
    assert.strictEqual(page1.children.length, 1);
    const field = page1.children[0];
    assert.strictEqual(field.name, 'ПутьОбработки');
    assert.strictEqual(field.readOnly, true);
  });

  test('Парсит Table, LabelDecoration, Separator, Button', () => {
    const model = parseFormXml(loadFormXml());
    const table = model.root.children.find((c) => c.name === 'ТаблицаПараметров');
    assert.ok(table, 'Table не найден');
    assert.strictEqual(table.type, 'Table');
    assert.strictEqual(table.height, 5);
    assert.strictEqual(table.verticalStretch, true);

    const label = model.root.children.find((c) => c.name === 'КомментарийНадпись');
    assert.ok(label, 'LabelDecoration не найден');
    assert.strictEqual(label.type, 'LabelDecoration');

    const sep = model.root.children.find((c) => c.name === 'Разделитель1');
    assert.ok(sep, 'Separator не найден');
    assert.strictEqual(sep.type, 'Separator');

    const btn = model.root.children.find((c) => c.name === 'КнопкаЗапустить');
    assert.ok(btn, 'Button не найден');
    assert.strictEqual(btn.type, 'Button');
    assert.strictEqual(btn.title, 'Запустить');
  });
});

suite('FormXmlParser — реквизиты', () => {
  test('Парсит 3 реквизита', () => {
    const model = parseFormXml(loadFormXml());
    assert.strictEqual(model.attributes.length, 3);
  });

  test('Парсит основной реквизит Object с колонками', () => {
    const model = parseFormXml(loadFormXml());
    const objAttr = model.attributes.find((a) => a.name === 'Object');
    assert.ok(objAttr, 'Реквизит Object не найден');
    assert.strictEqual(objAttr.id, 100);
    assert.strictEqual(objAttr.valueType, 'CatalogObject.AccountingCheckRules');
    assert.strictEqual(objAttr.isMain, true);
    assert.strictEqual(objAttr.savedData, true);
    assert.ok(objAttr.columns, 'Колонки не найдены');
    assert.strictEqual(objAttr.columns!.length, 2);

    const col1 = objAttr.columns![0];
    assert.strictEqual(col1.name, 'HandlerProcedurePath');
    assert.strictEqual(col1.valueType, 'xs:string');
    assert.strictEqual(col1.id, 101);

    const col2 = objAttr.columns![1];
    assert.strictEqual(col2.name, 'Active');
    assert.strictEqual(col2.valueType, 'xs:boolean');
  });

  test('Парсит реквизит с SavedData', () => {
    const model = parseFormXml(loadFormXml());
    const attr = model.attributes.find((a) => a.name === 'RunsInBackgroundOnSchedule');
    assert.ok(attr, 'Реквизит не найден');
    assert.strictEqual(attr.savedData, true);
    assert.strictEqual(attr.valueType, 'xs:boolean');
  });

  test('Реквизит без SavedData имеет savedData=false', () => {
    const model = parseFormXml(loadFormXml());
    const attr = model.attributes.find((a) => a.name === 'ScheduleSelector');
    assert.ok(attr);
    assert.strictEqual(attr.savedData, false);
    assert.strictEqual(attr.valueType, 'xs:decimal');
  });
});

suite('FormXmlParser — команды', () => {
  test('Парсит 2 команды', () => {
    const model = parseFormXml(loadFormXml());
    assert.strictEqual(model.commands.length, 2);
  });

  test('Команда RunCheck с заголовком и представлением', () => {
    const model = parseFormXml(loadFormXml());
    const cmd = model.commands.find((c) => c.name === 'RunCheck');
    assert.ok(cmd, 'Команда RunCheck не найдена');
    assert.strictEqual(cmd.id, 200);
    assert.strictEqual(cmd.title, 'Выполнить проверку');
    assert.strictEqual(cmd.action, 'RunCheck');
    assert.strictEqual(cmd.representation, 'Button');
  });

  test('Команда ClearResults без представления', () => {
    const model = parseFormXml(loadFormXml());
    const cmd = model.commands.find((c) => c.name === 'ClearResults');
    assert.ok(cmd, 'Команда ClearResults не найдена');
    assert.strictEqual(cmd.title, 'Очистить результаты');
    assert.strictEqual(cmd.action, 'ClearResults');
    assert.strictEqual(cmd.representation, undefined);
  });
});

suite('FormXmlParser — события', () => {
  test('Парсит 2 события', () => {
    const model = parseFormXml(loadFormXml());
    assert.strictEqual(model.events.length, 2);
  });

  test('Событие OnCreateAtServer', () => {
    const model = parseFormXml(loadFormXml());
    const evt = model.events.find((e) => e.name === 'OnCreateAtServer');
    assert.ok(evt, 'Событие OnCreateAtServer не найдено');
    assert.strictEqual(evt.handler, 'OnCreateAtServer');
  });

  test('Событие OnOpen', () => {
    const model = parseFormXml(loadFormXml());
    const evt = model.events.find((e) => e.name === 'OnOpen');
    assert.ok(evt);
    assert.strictEqual(evt.handler, 'OnOpen');
  });
});

suite('FormXmlSerializer — round-trip', () => {
  test('Сериализация и повторный парсинг сохраняет структуру', () => {
    const xml = loadFormXml();
    const doc = new FormXmlDocument(xml);
    const reserialized = doc.serialize();
    const model = parseFormXml(reserialized);

    assert.strictEqual(model.root.children.length >= 7, true);
    assert.strictEqual(model.attributes.length, 3);
    assert.strictEqual(model.commands.length, 2);
    assert.strictEqual(model.events.length, 2);
  });

  test('Удаление элемента работает', () => {
    const xml = loadFormXml();
    const doc = new FormXmlDocument(xml);
    const ok = doc.deleteElement(12); // CheckBoxField Активен
    assert.strictEqual(ok, true);

    const model = parseFormXml(doc.serialize());
    const group = model.root.children.find((c) => c.name === 'ОсновнаяГруппа');
    assert.ok(group);
    assert.strictEqual(group.children.length, 1, 'Ожидался 1 элемент после удаления');
    assert.strictEqual(group.children[0].name, 'Наименование');
  });

  test('Обновление свойства Title работает', () => {
    const xml = loadFormXml();
    const doc = new FormXmlDocument(xml);
    const ok = doc.updateElementProperty(11, 'Width', '60');
    assert.strictEqual(ok, true);

    const model = parseFormXml(doc.serialize());
    const group = model.root.children.find((c) => c.name === 'ОсновнаяГруппа');
    assert.ok(group);
    const field = group.children.find((c) => c.name === 'Наименование');
    assert.ok(field);
    assert.strictEqual(field.width, 60);
  });

  test('Перемещение элемента работает', () => {
    const xml = loadFormXml();
    const doc = new FormXmlDocument(xml);
    // Перемещаем CheckBoxField (id=12) из ОсновнаяГруппа (id=10) в корень (id=0)
    const ok = doc.moveElement(12, 0, null);
    assert.strictEqual(ok, true);

    const model = parseFormXml(doc.serialize());
    // Проверяем что элемент убрался из группы
    const group = model.root.children.find((c) => c.name === 'ОсновнаяГруппа');
    assert.ok(group);
    assert.strictEqual(group.children.length, 1);
    // И добавился в корень
    const moved = model.root.children.find((c) => c.name === 'Активен');
    assert.ok(moved, 'Перемещённый элемент не найден в корне');
  });
});

suite('FormXmlSerializer — createElement', () => {
  test('Создание UsualGroup в корне', () => {
    const doc = new FormXmlDocument(loadFormXml());
    const result = doc.createElement(0, 'UsualGroup', 'НоваяГруппа', null);
    assert.strictEqual(result.success, true);
    assert.ok(result.newId > 0);

    const model = parseFormXml(doc.serialize());
    const newGroup = model.root.children.find((c) => c.name === 'НоваяГруппа');
    assert.ok(newGroup, 'Новая группа не найдена');
    assert.strictEqual(newGroup.type, 'UsualGroup');
    assert.strictEqual(newGroup.id, result.newId);
  });

  test('Создание InputField внутри группы', () => {
    const doc = new FormXmlDocument(loadFormXml());
    const result = doc.createElement(10, 'InputField', 'НовоеПоле', null); // 10 = ОсновнаяГруппа
    assert.strictEqual(result.success, true);

    const model = parseFormXml(doc.serialize());
    const group = model.root.children.find((c) => c.name === 'ОсновнаяГруппа');
    assert.ok(group);
    const newField = group.children.find((c) => c.name === 'НовоеПоле');
    assert.ok(newField, 'Новое поле не найдено в группе');
    assert.strictEqual(newField.type, 'InputField');
  });

  test('ID нового элемента уникален', () => {
    const doc = new FormXmlDocument(loadFormXml());
    const r1 = doc.createElement(0, 'Button', 'Кнопка1', null);
    const r2 = doc.createElement(0, 'Button', 'Кнопка2', null);
    assert.strictEqual(r1.success, true);
    assert.strictEqual(r2.success, true);
    assert.notStrictEqual(r1.newId, r2.newId);
  });

  test('Создание в несуществующем parent возвращает ошибку', () => {
    const doc = new FormXmlDocument(loadFormXml());
    const result = doc.createElement(9999, 'Button', 'X', null);
    assert.strictEqual(result.success, false);
  });
});

suite('FormXmlParser — пустой/некорректный XML', () => {
  test('Пустой XML возвращает пустую модель', () => {
    const model = parseFormXml('');
    assert.strictEqual(model.root.children.length, 0);
    assert.strictEqual(model.attributes.length, 0);
    assert.strictEqual(model.commands.length, 0);
    assert.strictEqual(model.events.length, 0);
  });

  test('XML без Form тега возвращает пустую модель', () => {
    const model = parseFormXml('<?xml version="1.0"?><Root></Root>');
    assert.strictEqual(model.root.children.length, 0);
  });
});
