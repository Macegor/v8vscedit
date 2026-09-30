import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { XMLValidator } from 'fast-xml-parser';
import {
  CONFIGURATION_PROPERTY_KEYS,
  applyFormPropertySection,
  getRootPropertyKeyOrder,
  getTypeAwarePropertyKeyOrder,
} from '../../ui/views/properties/propertyKeyOrder';
import {
  FORM_PROPERTY_KEYS_BY_KIND,
  PROPERTY_TITLE_RU,
  getFormPropertyKeys,
  isFormPropertyKey,
} from '../../infra/xml/PropertySchema';
import { extractTopLevelPropertiesChildren } from '../../infra/xml/MetadataPropertiesXml';
import { detectRootObjectKind } from '../../infra/xml/XmlUtils';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';
import { buildRootMetaObjectProperties } from '../../ui/views/properties/PropertyBuilder';
import type { NodeKind } from '../../ui/tree/TreeNode';
import type { ObjectPropertiesCollection } from '../../ui/views/properties/_types';
import { META_TYPES } from '../../domain/MetaTypes';
import { EXAMPLE_ROOT, skipWithoutCorpus } from './support/corpus';

/**
 * Гейт «схема не отстаёт от платформы»: состав свойств выбора форм у каждого вида
 * метаданных обязан совпадать с тем, что платформа реально пишет в эталонной
 * выгрузке `example/` (генерации 2.20 и 2.21, cf и cfe).
 *
 * Обе оси проверяются явно и по отдельности:
 *  - прямая: тег `*Form`, встреченный в корпусе, обязан быть в наборе ключей
 *    своего вида — иначе панель свойств его не покажет и отредактировать нельзя;
 *  - обратная: объявленный ключ обязан иметь в корпусе хотя бы один пример —
 *    иначе панель предложит записать свойство, которого у вида не бывает.
 *
 * Критерий присутствия — сам тег, а не заполненное значение: пустой
 * `<DefaultForm/>` доказывает существование свойства у вида ничуть не хуже.
 */

interface CorpusFact {
  count: number;
  example: string;
}

type CorpusFacts = Map<string, Map<string, CorpusFact>>;

/** Теги `*Form`, которые к выбору основной формы объекта отношения не имеют. */
const NON_OBJECT_FORM_TAGS = new Set([
  // Форма выбора ТИПА типизированного поля (константа, общий реквизит) — другая
  // ось контракта, её состав живёт в TypedFieldPropertyRules.
  'ChoiceForm',
]);

let cachedFacts: CorpusFacts | undefined;

function collectCorpusFacts(): CorpusFacts {
  if (cachedFacts) {
    return cachedFacts;
  }
  const facts: CorpusFacts = new Map();
  for (const file of findRootObjectXmlFiles(EXAMPLE_ROOT)) {
    const xml = fs.readFileSync(file, 'utf-8');
    const kind = detectRootObjectKind(xml);
    if (!kind) {
      continue;
    }
    const bucket = facts.get(kind) ?? new Map<string, CorpusFact>();
    facts.set(kind, bucket);
    for (const child of extractTopLevelPropertiesChildren(xml)) {
      if (!child.tag.endsWith('Form') || NON_OBJECT_FORM_TAGS.has(child.tag)) {
        continue;
      }
      const fact = bucket.get(child.tag) ?? { count: 0, example: file };
      fact.count++;
      bucket.set(child.tag, fact);
    }
  }
  cachedFacts = facts;
  return facts;
}

/** Все XML-файлы корпуса; фильтр «корневой объект» даёт detectRootObjectKind. */
function findRootObjectXmlFiles(root: string): string[] {
  // example/ лежит в .gitignore — на чистом клоне корня нет, и обход обязан
  // вернуть пустой список, а не рушить загрузку модуля (см. formFixtures).
  if (!fs.existsSync(root)) {
    return [];
  }
  const result: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.xml')) {
        result.push(full);
      }
    }
  };
  walk(root);
  return result;
}

/** Таблица как плоская запись — в тесте она обходится, а не индексируется по MetaKind. */
const FORM_KEYS_TABLE: Readonly<Record<string, readonly string[]>> = FORM_PROPERTY_KEYS_BY_KIND;

/**
 * Корневой элемент XML → `MetaKind`. Совпадение имён у большинства видов —
 * следствие `englishKind`, а не правило, поэтому сверяемся с реестром, а не с
 * совпадением строк (корень конфигурации: `Configuration` → `configuration`).
 */
const KIND_BY_XML_ROOT: ReadonlyMap<string, string> = new Map(
  Object.values(META_TYPES).map((def) => [def.englishKind ?? def.kind, def.kind])
);

/** Набор свойств форм, который панель реально предъявляет для вида. */
function declaredFormKeys(kind: string): string[] {
  const order = kind === 'Constant'
    // Константа идёт типозависимой веткой панели, а не общим порядком корня.
    ? getTypeAwarePropertyKeyOrder('<Constant><Properties><Type/></Properties></Constant>', 'Constant')
    // Корень выгрузки идёт своим каноном свойств, а не порядком вида метаданных.
    : kind === 'configuration'
      ? CONFIGURATION_PROPERTY_KEYS
      : getRootPropertyKeyOrder(kind as NodeKind);
  return order.filter((key) => key.endsWith('Form') && !NON_OBJECT_FORM_TAGS.has(key));
}

suite('Свойства выбора форм — гейт по эталону example/', () => {
  // Единый гейт наличия корпуса: без example/ сьют пропускается, а не падает.
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('прямой гейт: каждый тег *Form эталона есть в наборе ключей своего вида', function () {
    this.timeout(120_000);
    const violations: string[] = [];
    for (const [xmlRoot, bucket] of collectCorpusFacts()) {
      const kind = KIND_BY_XML_ROOT.get(xmlRoot) ?? xmlRoot;
      const declared = declaredFormKeys(kind);
      for (const [tag, fact] of bucket) {
        if (!declared.includes(tag)) {
          violations.push(
            `вид «${kind}», ключ «${tag}»: в эталоне ${String(fact.count)} шт., пример — ` +
            `${path.relative(EXAMPLE_ROOT, fact.example)}, но в наборе ключей вида его нет`
          );
        }
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      'платформа пишет свойство формы, которого панель не знает — добавьте ключ в FORM_PROPERTY_KEYS_BY_KIND:\n' +
      violations.join('\n')
    );
  });

  test('обратный гейт: каждый объявленный ключ *Form встречается в эталоне у своего вида', function () {
    this.timeout(120_000);
    const facts = collectCorpusFacts();
    const unconfirmed: string[] = [];
    for (const [kind, keys] of Object.entries(FORM_KEYS_TABLE)) {
      const bucket = facts.get(xmlRootOfKind(kind));
      for (const key of keys) {
        const count = bucket?.get(key)?.count ?? 0;
        if (count === 0) {
          unconfirmed.push(`вид «${kind}», ключ «${key}»: в эталоне 0 примеров`);
        }
      }
    }
    assert.deepStrictEqual(
      unconfirmed,
      [],
      'объявлен ключ выбора формы, которого эталон не подтверждает ни одним примером — ' +
      'решение об удалении принимает человек, молча ключ не убирать:\n' + unconfirmed.join('\n')
    );
  });

  test('числа замера: у каждого вида таблицы есть заявленное количество объектов-носителей', function () {
    this.timeout(120_000);
    const facts = collectCorpusFacts();
    // Опорные числа скана (присутствие тега, обе генерации, cf+cfe). Держат
    // комментарий к FORM_PROPERTY_KEYS_BY_KIND честным: если корпус подменят или
    // обход сломается, тест упадёт раньше, чем «гейт» станет пустой формальностью.
    const expectedCarriers: Readonly<Record<string, number>> = {
      Catalog: 750,
      InformationRegister: 1155,
      Enum: 1144,
      Constant: 999,
      Report: 362,
      DataProcessor: 357,
      Document: 356,
      AccumulationRegister: 140,
      DocumentJournal: 51,
      ExchangePlan: 26,
      FilterCriterion: 12,
      ChartOfCharacteristicTypes: 11,
      SettingsStorage: 5,
      BusinessProcess: 10,
      ChartOfCalculationTypes: 3,
      AccountingRegister: 2,
      ChartOfAccounts: 2,
      Task: 2,
      CalculationRegister: 1,
    };
    for (const [kind, expected] of Object.entries(expectedCarriers)) {
      const firstKey = FORM_KEYS_TABLE[kind][0];
      assert.strictEqual(
        facts.get(xmlRootOfKind(kind))?.get(firstKey)?.count,
        expected,
        `вид «${kind}»: число объектов с тегом «${firstKey}» разошлось с замером`
      );
    }
  });

  test('формы уровня конфигурации: все теги Configuration.xml объявлены в каноне конфигурации', function () {
    this.timeout(120_000);
    const bucket = collectCorpusFacts().get('Configuration');
    assert.ok(bucket && bucket.size > 0, 'в корпусе должен быть хотя бы один Configuration.xml с формами');
    for (const [tag, fact] of bucket) {
      assert.ok(
        CONFIGURATION_PROPERTY_KEYS.includes(tag),
        `свойство формы конфигурации «${tag}» (${String(fact.count)} шт., пример — ` +
        `${path.relative(EXAMPLE_ROOT, fact.example)}) отсутствует в CONFIGURATION_PROPERTY_KEYS`
      );
    }
  });
});

suite('Свойства выбора форм — сшивка таблицы с панелью свойств', () => {
  test('порядок ключей панели берёт формы из таблицы: состав и порядок совпадают', () => {
    for (const kind of Object.keys(FORM_KEYS_TABLE)) {
      assert.deepStrictEqual(
        declaredFormKeys(kind),
        [...FORM_KEYS_TABLE[kind]],
        `вид «${kind}»: панель показывает не тот набор форм, что объявлен в таблице`
      );
    }
  });

  test('у каждого ключа таблицы есть русская подпись', () => {
    for (const [kind, keys] of Object.entries(FORM_KEYS_TABLE)) {
      for (const key of keys) {
        const title = PROPERTY_TITLE_RU[key];
        assert.ok(title, `вид «${kind}», ключ «${key}»: нет подписи в PROPERTY_TITLE_RU`);
        assert.ok(/^[А-ЯЁ]/.test(title), `ключ «${key}»: подпись «${title}» должна быть на русском`);
      }
    }
  });

  test('getFormPropertyKeys: неизвестный вид форм не выбирает', () => {
    assert.deepStrictEqual(getFormPropertyKeys('Subsystem'), []);
    assert.deepStrictEqual(getFormPropertyKeys('CommonModule'), []);
    assert.deepStrictEqual(getFormPropertyKeys('DataProcessor'), ['DefaultForm', 'AuxiliaryForm']);
  });

  test('isFormPropertyKey: только ключи таблицы, форма выбора типа сюда не входит', () => {
    assert.strictEqual(isFormPropertyKey('DefaultVariantForm'), true);
    assert.strictEqual(isFormPropertyKey('AuxiliaryFolderChoiceForm'), true);
    assert.strictEqual(isFormPropertyKey('ChoiceForm'), false);
    assert.strictEqual(isFormPropertyKey('Synonym'), false);
  });

  test('applyFormPropertySection: секция «Формы» (80) только у свойств форм, остальные не тронуты', () => {
    const input: ObjectPropertiesCollection = [
      { key: 'Name', title: 'Имя', kind: 'string', value: 'Отчёт1' },
      { key: 'DefaultForm', title: 'Основная форма', kind: 'string', value: '' },
      { key: 'ChoiceForm', title: 'Форма выбора', kind: 'string', value: '' },
      { key: 'Comment', title: 'Комментарий', kind: 'string', value: '', section: 'Основные', sectionOrder: 10 },
    ];
    const result = applyFormPropertySection(input);

    assert.deepStrictEqual(
      result.map((item) => [item.key, item.section ?? null, item.sectionOrder ?? null]),
      [
        ['Name', null, null],
        ['DefaultForm', 'Формы', 80],
        ['ChoiceForm', null, null],
        ['Comment', 'Основные', 10],
      ]
    );
    // Исходная коллекция не мутируется — панель пересобирает список на каждый показ.
    assert.strictEqual(input[1].section, undefined);
  });
});

suite('Свойства выбора форм — панель на созданном объекте', () => {
  test('обработка и отчёт отдают свои свойства форм в секции «Формы»', () => {
    const configRoot = createTempConfigRoot();
    const creator = new MetadataXmlCreator();

    for (const [kind, name] of [['DataProcessor', 'ОбработкаФорм'], ['Report', 'ОтчётФорм']] as const) {
      assert.strictEqual(creator.addRootObject({ configRoot, kind, name }).success, true, `создание ${kind}`);
      const xmlPath = resolveCreatedXmlPath(configRoot, kind, name);
      const properties = buildRootMetaObjectProperties(fs.readFileSync(xmlPath, 'utf-8'), kind);

      for (const key of FORM_KEYS_TABLE[kind]) {
        const property = properties.find((item) => item.key === key);
        assert.ok(property, `${kind}: свойство «${key}» не попало в панель`);
        assert.strictEqual(property.section, 'Формы', `${kind}.${key}: свойство обязано быть в секции «Формы»`);
        assert.strictEqual(property.sectionOrder, 80, `${kind}.${key}: порядок секции «Формы»`);
        assert.strictEqual(property.title, PROPERTY_TITLE_RU[key], `${kind}.${key}: подпись из реестра`);
        assert.strictEqual(property.value, '', `${kind}.${key}: у нового объекта форма не выбрана`);
      }
    }
  });

  test('запись значения свойства формы не ломает XML и читается панелью обратно', () => {
    const configRoot = createTempConfigRoot();
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Report', name: 'ОтчётЗапись' }).success, true);
    const xmlPath = resolveCreatedXmlPath(configRoot, 'Report', 'ОтчётЗапись');
    const before = fs.readFileSync(xmlPath, 'utf-8');

    const editor = new ConfigurationXmlEditor();
    const written: Record<string, string> = {
      DefaultForm: 'Report.ОтчётЗапись.Form.ФормаОтчёта',
      // В эталоне 202 из 265 основных форм отчёта — общие формы: значение
      // свойства не обязано указывать на собственную форму объекта.
      DefaultVariantForm: 'CommonForm.ФормаВариантаОтчета',
    };
    for (const [key, value] of Object.entries(written)) {
      const result = editor.modifyObjectProperty(xmlPath, {
        targetKind: 'Self',
        targetName: 'ОтчётЗапись',
        propertyKey: key,
        valueKind: 'string',
        value,
      });
      assert.strictEqual(result.success, true, `запись ${key}: ${result.errors.join('; ')}`);
    }

    const after = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(
      XMLValidator.validate(after, { allowBooleanAttributes: true }),
      true,
      'после записи свойств формы XML обязан остаться well-formed'
    );
    assert.strictEqual(after.startsWith('﻿'), before.startsWith('﻿'), 'BOM сохраняется');

    for (const [key, value] of Object.entries(written)) {
      assert.ok(after.includes(`<${key}>${value}</${key}>`), `в XML не записано значение свойства «${key}»`);
    }

    // Панель показывает ссылку в русском представлении (общий форматтер ссылок
    // на метаданные), но само значение — то, что записано в XML.
    const properties = buildRootMetaObjectProperties(after, 'Report');
    const displayed: Record<string, string> = {
      DefaultForm: 'Отчёты.ОтчётЗапись.Form.ФормаОтчёта',
      DefaultVariantForm: 'ОбщиеФормы.ФормаВариантаОтчета',
    };
    for (const key of Object.keys(written)) {
      const property = properties.find((item) => item.key === key);
      assert.ok(property, `свойство «${key}» пропало из панели после записи`);
      assert.strictEqual(property.value, displayed[key], `свойство «${key}» прочиталось не тем значением`);
      assert.strictEqual(property.section, 'Формы');
    }
  });
});

/** Обратное отображение: `MetaKind` → имя корневого элемента XML. */
function xmlRootOfKind(kind: string): string {
  return META_TYPES[kind as keyof typeof META_TYPES].englishKind ?? kind;
}

function createTempConfigRoot(): string {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-keys-'));
  fs.writeFileSync(
    path.join(configRoot, 'Configuration.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<MetaDataObject version="2.21">\n'
    + '  <Configuration>\n'
    + '    <Properties>\n'
    + '      <Name>ТестоваяКонфигурация</Name>\n'
    + '      <Synonym/>\n'
    + '    </Properties>\n'
    + '    <ChildObjects/>\n'
    + '  </Configuration>\n'
    + '</MetaDataObject>',
    'utf-8'
  );
  return configRoot;
}

function resolveCreatedXmlPath(configRoot: string, kind: 'DataProcessor' | 'Report', name: string): string {
  const folder = kind === 'Report' ? 'Reports' : 'DataProcessors';
  const xmlPath = path.join(configRoot, folder, `${name}.xml`);
  assert.ok(fs.existsSync(xmlPath), `созданный объект ${kind}.${name} не найден по пути ${xmlPath}`);
  return xmlPath;
}
