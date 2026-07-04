import * as assert from 'assert';
import * as path from 'path';
import {
  canonicalToXmlToken,
  getPlatformTypeRegistry,
  tokenToCanonical,
  type PlatformTypeGroup,
  type TypeContext,
} from '../../infra/xml/PlatformTypeRegistry';

const CONFIG_XML = path.resolve(__dirname, '../../../example/2.20/src/cf/Configuration.xml');

function findGroup(groups: PlatformTypeGroup[], id: string): PlatformTypeGroup | undefined {
  return groups.find((g) => g.id === id);
}

function collectCanonical(groups: PlatformTypeGroup[]): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.canonical));
}

suite('PlatformTypeRegistry — базовая группа без configXmlPath', () => {
  test('metadataAttribute содержит ровно 9 базовых типов', () => {
    const groups = getPlatformTypeRegistry(undefined, 'metadataAttribute');
    const base = findGroup(groups, 'base');
    assert.ok(base, 'нет группы base');
    const russianNames = base.items.map((i) => i.canonical);
    assert.deepStrictEqual(russianNames.sort(), [
      'Булево',
      'Дата',
      'ДатаВремя',
      'ДвоичныеДанные',
      'Картинка',
      'Строка',
      'УникальныйИдентификатор',
      'ХранилищеЗначения',
      'Число',
    ]);
  });

  test('formAttribute содержит 20 базовых типов', () => {
    const groups = getPlatformTypeRegistry(undefined, 'formAttribute');
    const base = findGroup(groups, 'base');
    assert.ok(base);
    assert.strictEqual(base.items.length, 20, `получено ${String(base.items.length)} типов`);
    const russian = base.items.map((i) => i.canonical);
    for (const expected of [
      'Строка', 'Число', 'Булево', 'Дата', 'ДатаВремя',
      'ХранилищеЗначения', 'УникальныйИдентификатор', 'ДвоичныеДанные',
      'Тип', 'ОписаниеТипов', 'СписокЗначений', 'ТаблицаЗначений',
      'ДеревоЗначений', 'Массив', 'ФиксированныйМассив', 'Структура',
      'ФиксированнаяСтруктура', 'ТабличныйДокумент', 'Картинка', 'ФорматированнаяСтрока',
    ]) {
      assert.ok(russian.includes(expected), `не найден ${expected}`);
    }
  });

  test('commandParameter возвращает пустую группу base', () => {
    const groups = getPlatformTypeRegistry(undefined, 'commandParameter');
    const base = findGroup(groups, 'base');
    // Базовая группа либо отсутствует, либо пустая.
    assert.ok(!base || base.items.length === 0);
  });

  test('eventSource возвращает пустую группу base', () => {
    const groups = getPlatformTypeRegistry(undefined, 'eventSource');
    const base = findGroup(groups, 'base');
    assert.ok(!base || base.items.length === 0);
  });
});

suite('PlatformTypeRegistry — ссылочные типы по Configuration.xml', () => {
  test('metadataAttribute даёт только *Ссылка для Catalog', () => {
    const groups = getPlatformTypeRegistry(CONFIG_XML, 'metadataAttribute');
    const catalog = findGroup(groups, 'Catalog');
    assert.ok(catalog, 'нет группы Catalog');
    for (const item of catalog.items) {
      assert.ok(
        item.canonical.startsWith('СправочникСсылка.'),
        `неожиданный тип ${item.canonical} в metadataAttribute`
      );
    }
    assert.ok(catalog.items.length > 0);
  });

  test('formAttribute даёт все суффиксы для Catalog', () => {
    const groups = getPlatformTypeRegistry(CONFIG_XML, 'formAttribute');
    const catalog = findGroup(groups, 'Catalog');
    assert.ok(catalog);
    const suffixes = new Set<string>();
    for (const item of catalog.items) {
      const match = /^Справочник([А-Яа-я]*)\./.exec(item.canonical);
      if (match) {
        suffixes.add(match[1]);
      }
    }
    // Ожидаем как минимум Ссылка/Объект/Менеджер/Выборка/Список.
    for (const s of ['Ссылка', 'Объект', 'Менеджер', 'Выборка', 'Список']) {
      assert.ok(suffixes.has(s), `не найден суффикс ${s}, есть: ${[...suffixes].join(',')}`);
    }
  });

  test('commandParameter — только *Ссылка', () => {
    const groups = getPlatformTypeRegistry(CONFIG_XML, 'commandParameter');
    const all = collectCanonical(groups);
    for (const item of all) {
      assert.ok(
        item.startsWith('СправочникСсылка.') ||
          item.startsWith('ОпределяемыйТип.') ||
          item.includes('Ссылка.'),
        `тип ${item} недопустим в commandParameter`
      );
    }
  });

  test('eventSource даёт *Объект / *НаборЗаписей и КонстантаМенеджерЗначения', () => {
    const groups = getPlatformTypeRegistry(CONFIG_XML, 'eventSource');
    const all = collectCanonical(groups);
    for (const item of all) {
      const ok =
        item.includes('Объект.') ||
        item.includes('НаборЗаписей.') ||
        item.startsWith('КонстантаМенеджерЗначения.');
      assert.ok(ok, `тип ${item} недопустим в eventSource`);
    }
  });
});

suite('PlatformTypeRegistry — конверсия токенов', () => {
  test('Примитивы: xs:string ↔ Строка', () => {
    assert.strictEqual(tokenToCanonical('xs:string'), 'Строка');
    assert.strictEqual(canonicalToXmlToken('Строка', 'metadataAttribute'), 'xs:string');
  });

  test('Ссылочный: CatalogRef.X → СправочникСсылка.X', () => {
    assert.strictEqual(tokenToCanonical('CatalogRef.Контрагенты'), 'СправочникСсылка.Контрагенты');
    assert.strictEqual(
      canonicalToXmlToken('СправочникСсылка.Контрагенты', 'metadataAttribute'),
      'CatalogRef.Контрагенты'
    );
  });

  test('Ссылочный с префиксом неймспейса: d5p1:DocumentRef.X', () => {
    assert.strictEqual(tokenToCanonical('d5p1:DocumentRef.Заказ'), 'ДокументСсылка.Заказ');
  });

  test('Определяемый тип: cfg:DefinedType.X', () => {
    assert.strictEqual(tokenToCanonical('cfg:DefinedType.Контакт'), 'ОпределяемыйТип.Контакт');
    assert.strictEqual(
      canonicalToXmlToken('ОпределяемыйТип.Контакт', 'metadataAttribute'),
      'DefinedType.Контакт'
    );
  });

  test('Неизвестный токен → undefined', () => {
    assert.strictEqual(tokenToCanonical('xs:unknownThing'), undefined);
  });

  test('canonicalToXmlToken: тип не допустим в контексте → undefined', () => {
    // Тип «ТаблицаЗначений» допустим только для формы, а не для метаданных.
    assert.strictEqual(canonicalToXmlToken('ТаблицаЗначений', 'metadataAttribute'), undefined);
    assert.strictEqual(canonicalToXmlToken('ТаблицаЗначений', 'formAttribute'), 'v8:ValueTable');
  });

  test('v8-токены платформенных типов читаются и пишутся', () => {
    assert.strictEqual(tokenToCanonical('v8:ValueStorage'), 'ХранилищеЗначения');
    assert.strictEqual(canonicalToXmlToken('ХранилищеЗначения', 'metadataAttribute'), 'v8:ValueStorage');
    assert.strictEqual(tokenToCanonical('v8:FixedStructure'), 'ФиксированнаяСтруктура');
    assert.strictEqual(canonicalToXmlToken('ФиксированнаяСтруктура', 'formAttribute'), 'v8:FixedStructure');
    assert.strictEqual(tokenToCanonical('v8:Array'), 'Массив');
    assert.strictEqual(canonicalToXmlToken('Массив', 'formAttribute'), 'v8:Array');
  });

  test('Все контексты вычисляются без ошибок для всех поддерживаемых типов', () => {
    const contexts: TypeContext[] = ['metadataAttribute', 'formAttribute', 'commandParameter', 'eventSource'];
    for (const ctx of contexts) {
      const groups = getPlatformTypeRegistry(CONFIG_XML, ctx);
      for (const g of groups) {
        for (const item of g.items) {
          const token = canonicalToXmlToken(item.canonical, ctx);
          assert.ok(token, `нет XML-токена для ${item.canonical} в контексте ${ctx}`);
        }
      }
    }
  });
});
