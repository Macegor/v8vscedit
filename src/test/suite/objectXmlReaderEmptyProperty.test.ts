import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { isEmptyPropertyValue } from '../../infra/xml/XmlUtils';
import { skipWithoutCorpus, EXAMPLE_ROOT, EXAMPLE_GENERATIONS } from './support/corpus';

/**
 * Пустое значение свойства платформа сериализует САМОЗАКРЫТЫМ тегом
 * (`<DefaultObjectForm/>`), парный пустой тег (`<DefaultObjectForm></…>`) в
 * выгрузке не встречается вовсе. Правило снято сканом контрпримеров по всему
 * эталону — числа и метод в docs/xml-format-rulesets.md.
 *
 * Практическое следствие, ради которого правило и понадобилось: сброс УЖЕ
 * пустого свойства обязан быть no-op. Пока очистка писала парный тег, каждый
 * сброс давал git-дифф на ровном месте и ломал идемпотентность операции.
 */

const CATALOG_XML = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">\r
\t<Catalog uuid="0b4a2a1e-0000-0000-0000-000000000001">\r
\t\t<Properties>\r
\t\t\t<Name>Контрагенты</Name>\r
\t\t\t<Synonym>\r
\t\t\t\t<v8:item>\r
\t\t\t\t\t<v8:lang>ru</v8:lang>\r
\t\t\t\t\t<v8:content>Контрагенты</v8:content>\r
\t\t\t\t</v8:item>\r
\t\t\t</Synonym>\r
\t\t\t<Comment/>\r
\t\t\t<DefaultObjectForm>Catalog.Контрагенты.Form.ФормаЭлемента</DefaultObjectForm>\r
\t\t\t<DefaultListForm/>\r
\t\t</Properties>\r
\t</Catalog>\r
</MetaDataObject>\r
`;

function writeFixture(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const xmlPath = path.join(dir, 'Контрагенты.xml');
  fs.writeFileSync(xmlPath, CATALOG_XML, 'utf-8');
  return xmlPath;
}

function clearSelf(xmlPath: string, propertyKey: string, valueKind: 'string' | 'localizedString'): boolean {
  return new ObjectXmlReader().updatePropertyInObject(xmlPath, {
    targetKind: 'Self',
    targetName: 'Контрагенты',
    propertyKey,
    valueKind,
    value: '',
  });
}

suite('ObjectXmlReader — пустое значение свойства пишется самозакрытым тегом', () => {
  test('очистка строкового свойства даёт <DefaultObjectForm/>, а не парный пустой тег', () => {
    const xmlPath = writeFixture('v8vscedit-empty-string-');

    assert.strictEqual(clearSelf(xmlPath, 'DefaultObjectForm', 'string'), true);

    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<DefaultObjectForm/>'), 'свойство должно стать самозакрытым');
    assert.ok(
      !/<DefaultObjectForm\s*><\/DefaultObjectForm>/.test(updated),
      'парный пустой тег в выгрузке не встречается ни разу — писать его нельзя'
    );
  });

  test('повторная очистка уже пустого свойства — no-op: false и файл байт-в-байт', () => {
    const xmlPath = writeFixture('v8vscedit-empty-idempotent-');
    assert.strictEqual(clearSelf(xmlPath, 'DefaultObjectForm', 'string'), true);
    const afterFirst = fs.readFileSync(xmlPath);

    // Ровно тот сценарий из жалобы: сброс уже пустого свойства не должен
    // порождать git-дифф.
    assert.strictEqual(clearSelf(xmlPath, 'DefaultObjectForm', 'string'), false);
    assert.deepStrictEqual(fs.readFileSync(xmlPath), afterFirst, 'файл не должен переписываться');

    // И то же для свойства, которое было самозакрытым изначально.
    assert.strictEqual(clearSelf(xmlPath, 'DefaultListForm', 'string'), false);
    assert.deepStrictEqual(fs.readFileSync(xmlPath), afterFirst);
  });

  test('очистка локализованного свойства схлопывает блок в <Synonym/>, без пустого <v8:content>', () => {
    const xmlPath = writeFixture('v8vscedit-empty-localized-');

    assert.strictEqual(clearSelf(xmlPath, 'Synonym', 'localizedString'), true);

    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<Synonym/>'), 'пустой синоним должен стать самозакрытым');
    assert.ok(!updated.includes('<v8:item>'), 'осиротевший <v8:item> оставаться не должен');
    assert.ok(
      !/<v8:content\s*\/>|<v8:content><\/v8:content>/.test(updated),
      'пустого <v8:content> в эталоне нет ни разу на 105 278 заполненных'
    );
  });

  test('непустое значение по-прежнему пишется парным тегом', () => {
    const xmlPath = writeFixture('v8vscedit-nonempty-');
    const reader = new ObjectXmlReader();

    assert.strictEqual(
      reader.updatePropertyInObject(xmlPath, {
        targetKind: 'Self',
        targetName: 'Контрагенты',
        propertyKey: 'DefaultObjectForm',
        valueKind: 'string',
        value: 'Catalog.Контрагенты.Form.ФормаСписка',
      }),
      true
    );

    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<DefaultObjectForm>Catalog.Контрагенты.Form.ФормаСписка</DefaultObjectForm>'));
  });

  test('запись значения в самозакрытый тег разворачивает его обратно в парный', () => {
    const xmlPath = writeFixture('v8vscedit-expand-');
    const reader = new ObjectXmlReader();

    // `DefaultListForm` в фикстуре изначально самозакрыт — путь selfClosingRe.
    assert.strictEqual(
      reader.updatePropertyInObject(xmlPath, {
        targetKind: 'Self',
        targetName: 'Контрагенты',
        propertyKey: 'DefaultListForm',
        valueKind: 'string',
        value: 'Catalog.Контрагенты.Form.ФормаСписка',
      }),
      true
    );

    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<DefaultListForm>Catalog.Контрагенты.Form.ФормаСписка</DefaultListForm>'));
  });

  test('цикл «очистить → заполнить» локализованного свойства сохраняет отступы блока', () => {
    const xmlPath = writeFixture('v8vscedit-localized-roundtrip-');
    const reader = new ObjectXmlReader();

    assert.strictEqual(clearSelf(xmlPath, 'Synonym', 'localizedString'), true);
    assert.strictEqual(
      reader.updatePropertyInObject(xmlPath, {
        targetKind: 'Self',
        targetName: 'Контрагенты',
        propertyKey: 'Synonym',
        valueKind: 'localizedString',
        value: 'Контрагенты',
      }),
      true
    );

    // Отступ должен совпасть с соседним свойством того же уровня: до правки
    // отступов блок собирался хардкодом и уезжал на лишний уровень, а закрывающий
    // тег вставал в нулевую колонку.
    const updated = fs.readFileSync(xmlPath, 'utf-8');
    const neighbourIndent = /(^|\n)([\t ]*)<Name>/.exec(updated)?.[2] ?? '';
    assert.ok(neighbourIndent.length > 0, 'фикстура должна иметь отступ у соседнего свойства');
    assert.ok(
      updated.includes(`${neighbourIndent}<Synonym>`),
      'открывающий тег должен стоять на уровне соседних свойств'
    );
    assert.ok(
      updated.includes(`${neighbourIndent}</Synonym>`),
      'закрывающий тег должен стоять на уровне открывающего, а не в нулевой колонке'
    );
    assert.ok(
      updated.includes(`${neighbourIndent}\t<v8:item>`),
      'элемент перевода должен быть ровно на один уровень глубже свойства'
    );
  });

  test('строка из пробелов — значение: пишется парным тегом и повтор даёт no-op', () => {
    const xmlPath = writeFixture('v8vscedit-space-value-');
    const reader = new ObjectXmlReader();
    const write = (value: string): boolean => reader.updatePropertyInObject(xmlPath, {
      targetKind: 'Self',
      targetName: 'Контрагенты',
      propertyKey: 'Comment',
      valueKind: 'string',
      value,
    });

    // В эталоне такие значения реальны (185 пар с пробельным содержимым), и
    // переход предиката на `trim()` схлопнул бы их в самозакрытый тег, то есть
    // молча уничтожил данные. Без этого теста такая правка проходит незаметно.
    assert.strictEqual(write(' '), true);
    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<Comment> </Comment>'), 'пробел — значение, тег обязан быть парным');
    assert.strictEqual(write(' '), false, 'повтор того же значения — не изменение');
  });

  test('очистка сохраняет BOM и CRLF исходного файла (запрет №12)', () => {
    const xmlPath = writeFixture('v8vscedit-empty-format-');
    assert.strictEqual(clearSelf(xmlPath, 'DefaultObjectForm', 'string'), true);

    const raw = fs.readFileSync(xmlPath);
    assert.strictEqual(raw[0], 0xef, 'BOM должен сохраниться');
    assert.strictEqual(raw[1], 0xbb);
    assert.strictEqual(raw[2], 0xbf);
    const text = raw.toString('utf-8');
    assert.ok(text.includes('\r\n'), 'CRLF должен сохраниться');
    assert.ok(!/(^|[^\r])\n/.test(text.replace(/^\uFEFF/, '')), 'смешанного EOL быть не должно');
  });
});

suite('isEmptyPropertyValue — граница пустоты', () => {
  test('пустая строка и пустой список — пусто; всё остальное — значение', () => {
    assert.strictEqual(isEmptyPropertyValue(''), true);
    assert.strictEqual(isEmptyPropertyValue([]), true);
    assert.strictEqual(isEmptyPropertyValue('Контрагенты'), false);
    assert.strictEqual(isEmptyPropertyValue(['Роль']), false);
    assert.strictEqual(isEmptyPropertyValue(false), false);
    assert.strictEqual(isEmptyPropertyValue(true), false);
  });

  test('строка из пробелов — ЗНАЧЕНИЕ, а не пустота', () => {
    // Граница, на которой держится весь отсев контрпримеров: в эталоне есть
    // 185 пар с пробельным содержимым (`<Comment> </Comment>`, 157 строковых
    // `FillValue`, 27 `<v8:content> </v8:content>`). Переход на `trim()` схлопнул
    // бы их в самозакрытый тег, то есть молча уничтожил данные — и это ровно та
    // правка, которую напишет следующий агент «чтобы пробелы тоже считались».
    assert.strictEqual(isEmptyPropertyValue(' '), false);
    assert.strictEqual(isEmptyPropertyValue('   '), false);
    assert.strictEqual(isEmptyPropertyValue('\t'), false);
  });
});

suite('Пустое значение свойства КОРНЯ конфигурации — тот же самозакрытый тег', () => {
  const CONFIG_XML = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\r
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">\r
\t<Configuration uuid="0b4a2a1e-0000-0000-0000-000000000002">\r
\t\t<Properties>\r
\t\t\t<Name>УправлениеТорговлей</Name>\r
\t\t\t<Synonym>\r
\t\t\t\t<v8:item>\r
\t\t\t\t\t<v8:lang>ru</v8:lang>\r
\t\t\t\t\t<v8:content>Управление торговлей</v8:content>\r
\t\t\t\t</v8:item>\r
\t\t\t</Synonym>\r
\t\t\t<Vendor/>\r
\t\t\t<Version>1.0.0.1</Version>\r
\t\t</Properties>\r
\t</Configuration>\r
</MetaDataObject>\r
`;

  function writeConfig(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const xmlPath = path.join(dir, 'Configuration.xml');
    fs.writeFileSync(xmlPath, CONFIG_XML, 'utf-8');
    return xmlPath;
  }

  // У корня СВОЙ построитель блока (`buildRootPropertyBlock`), а не общий с
  // объектом: делегирование в `updatePropertyInObject` идёт только для дочерних
  // объектов. Именно поэтому дефект пережил починку писателя объекта.
  test('сброс УЖЕ пустого <Vendor/> — no-op, файл не переписывается', () => {
    const xmlPath = writeConfig('v8vscedit-root-vendor-');
    const before = fs.readFileSync(xmlPath);

    const result = new ConfigurationXmlEditor().modifyConfigurationProperty(xmlPath, 'Vendor', '', 'scalar');

    assert.strictEqual(result.changed, false, 'сброс уже пустого свойства не является изменением');
    assert.deepStrictEqual(fs.readFileSync(xmlPath), before, 'git-диффа на ровном месте быть не должно');
  });

  test('очистка заполненного скалярного свойства даёт самозакрытый тег', () => {
    const xmlPath = writeConfig('v8vscedit-root-version-');

    const result = new ConfigurationXmlEditor().modifyConfigurationProperty(xmlPath, 'Version', '', 'scalar');

    assert.strictEqual(result.changed, true);
    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<Version/>'), 'ожидался самозакрытый тег');
    assert.ok(!/<Version\s*><\/Version>/.test(updated), 'парный пустой тег платформа не пишет');
  });

  test('очистка локализованного свойства корня не оставляет пустого <v8:content>', () => {
    const xmlPath = writeConfig('v8vscedit-root-synonym-');

    const result = new ConfigurationXmlEditor().modifyConfigurationProperty(xmlPath, 'Synonym', '', 'localized');

    assert.strictEqual(result.changed, true);
    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<Synonym/>'));
    assert.ok(!updated.includes('<v8:item>'), 'осиротевший <v8:item> оставаться не должен');
    assert.ok(!/<v8:content\s*\/>|<v8:content><\/v8:content>/.test(updated));
  });

  test('строка из пробелов на корне остаётся значением, а не схлопывается', () => {
    const xmlPath = writeConfig('v8vscedit-root-space-');
    const editor = new ConfigurationXmlEditor();

    assert.strictEqual(editor.modifyConfigurationProperty(xmlPath, 'Vendor', ' ', 'scalar').changed, true);
    const updated = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(updated.includes('<Vendor> </Vendor>'), 'пробел — значение: тег обязан быть парным');

    // И повтор того же значения — no-op.
    assert.strictEqual(editor.modifyConfigurationProperty(xmlPath, 'Vendor', ' ', 'scalar').changed, false);
  });
});

suite('Эталон example/ — парного пустого тега не бывает (скан контрпримеров)', () => {
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('во всех корнях MetaDataObject: ноль парных пустых тегов при непустой выборке самозакрытых', function () {
    // Полный обход корпуса — бюджет как у соседних корпусных сьютов.
    this.timeout(120_000);
    let selfClosing = 0;
    const violations: string[] = [];

    for (const base of Object.values(EXAMPLE_GENERATIONS)) {
      if (!fs.existsSync(base)) {
        continue;
      }
      for (const file of walkXml(base)) {
        const text = fs.readFileSync(file, 'utf-8');
        if (!text.slice(0, 400).includes('<MetaDataObject')) {
          continue;
        }
        // Класс символов включает `:` и `-`: без них скан не видит ни `<v8:content>`,
        // ни `<xr:Item>` — то есть не проверяет ровно ту форму, ради которой
        // правилось поведение локализованных свойств. Атрибуты разрешены по той же
        // причине (`<FillValue xsi:type="xs:string"></FillValue>`).
        selfClosing += (text.match(/<[A-Za-z_][\w.:-]*(\s[^<>]*?)?\s*\/>/g) ?? []).length;
        const paired = text.match(/<([A-Za-z_][\w.:-]*)(\s[^<>]*?)?><\/\1>/g);
        if (paired) {
          violations.push(`${path.relative(EXAMPLE_ROOT, file)}: ${paired.join(', ')}`);
        }
      }
    }

    // Защита от вакуумного зелёного: ноль нарушений что-то доказывает только
    // на непустой выборке. На корпусе разработки самозакрытых ~475 тысяч.
    assert.ok(selfClosing > 100_000, `выборка подозрительно мала: ${String(selfClosing)} самозакрытых тегов`);
    assert.deepStrictEqual(violations, [], 'платформа парный пустой тег не пишет');
  });
});

function* walkXml(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkXml(full);
    } else if (entry.name.endsWith('.xml')) {
      yield full;
    }
  }
}
