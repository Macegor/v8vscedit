import * as assert from 'assert';
import * as fs from 'fs';
import { META_TYPES } from '../../domain/MetaTypes';
import { collectPropertyBlocks, findPropertiesRange } from '../../infra/xml/typedField/PropertyBlockEditor';
import { escapeRegExp } from '../../infra/xml/XmlUtils';
import { skipWithoutCorpus } from './support/corpus';
import {
  metaKindOfXmlRoot,
  relativeToCorpus,
  requirePropertyOrder,
  scanRootPropertyFacts,
  xmlRootOfMetaKind,
} from './support/propertyOrderCorpus';

/**
 * Корпусные гейты канона порядка свойств в `<Properties>` КОРНЕВОГО объекта
 * (`ROOT_PROPERTY_ORDER`).
 *
 * Правило снято с эталона `example/` (2.20 cf, 2.21 cf, 2.21 cfe/EVOLC) сканом
 * КОНТРПРИМЕРОВ по прямым детям `<Properties>` корня — 48 видов, ни одного
 * противоречия между файлами: общая надпоследовательность существует. Порядок
 * 2.20 — подпоследовательность 2.21, поэтому оси версии формата нет.
 *
 * Гейты не доверяют таблице на слово: каждый обходит ВСЕ виды корпуса. Критерий
 * присутствия — сам тег, а не заполненное значение: пустой `<DefaultForm/>`
 * доказывает существование свойства у вида ничуть не хуже заполненного.
 *
 * Без корпуса (`example/` в .gitignore) сьют пропускается, а не падает.
 */

/**
 * Число файлов-корней по видам (по корневому тегу XML), обе генерации + cfe.
 * Пин защищает гейты от вырождения: если обход корпуса сломается или корпус
 * подменят, гейт «0 контрпримеров» стал бы вакуумным зелёным, а не проверкой.
 * Ровно 48 видов — столько снято замером; `Form`/`Template` — дескрипторы форм
 * и макетов (тоже корни `<MetaDataObject>`), а не корень выгрузки конфигурации.
 */
const EXPECTED_FILES_BY_XML_ROOT: Readonly<Record<string, number>> = {
  AccountingRegister: 2,
  AccumulationRegister: 140,
  Bot: 1,
  BusinessProcess: 10,
  CalculationRegister: 1,
  Catalog: 755,
  ChartOfAccounts: 2,
  ChartOfCalculationTypes: 3,
  ChartOfCharacteristicTypes: 11,
  CommandGroup: 30,
  CommonAttribute: 7,
  CommonCommand: 316,
  CommonForm: 397,
  CommonModule: 3333,
  CommonPicture: 3005,
  CommonTemplate: 282,
  Configuration: 3,
  Constant: 999,
  DataProcessor: 357,
  DefinedType: 622,
  Document: 356,
  DocumentJournal: 51,
  DocumentNumerator: 2,
  Enum: 1146,
  EventSubscription: 451,
  ExchangePlan: 26,
  FilterCriterion: 12,
  Form: 5932,
  FunctionalOption: 502,
  FunctionalOptionsParameter: 10,
  HTTPService: 20,
  InformationRegister: 1155,
  IntegrationService: 1,
  Language: 3,
  PaletteColor: 129,
  Report: 362,
  Role: 1038,
  ScheduledJob: 178,
  SessionParameter: 111,
  SettingsStorage: 5,
  Style: 1,
  StyleItem: 529,
  Subsystem: 732,
  Task: 2,
  Template: 4797,
  WSReference: 1,
  WebService: 19,
  XDTOPackage: 410,
};

/**
 * Носители `ExtendedConfigurationObject` (только заимствованные объекты
 * расширения): вид → число файлов. Итого 23.
 */
const EXTENDED_CONFIGURATION_OBJECT_CARRIERS: Readonly<Record<string, number>> = {
  Catalog: 5,
  CommonPicture: 10,
  Enum: 2,
  Form: 2,
  Language: 1,
  StyleItem: 3,
};

suite('Порядок свойств корня — гейты по эталону example/', () => {
  // Единый гейт наличия корпуса: без example/ сьют пропускается, а не падает.
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('прямой гейт: ни один файл корпуса не нарушает порядок таблицы (0 контрпримеров по всем видам и трём корням)', function () {
    this.timeout(300_000);
    const order = requirePropertyOrder();
    const violations = new Map<string, { count: number; example: string }>();
    const comparedPairs = new Map<string, number>();

    for (const [xmlRoot, bucket] of scanRootPropertyFacts()) {
      for (const file of bucket.files) {
        // Теги, которых нет в таблице, здесь пропускаются: их отсутствие ловит
        // гейт полноты (следующий тест), а не гейт порядка.
        const ranked = file.keys
          .map((key) => ({ key, rank: order.rootPropertyRank(xmlRoot, key) }))
          .filter((item): item is { key: string; rank: number } => item.rank !== null);
        for (let index = 1; index < ranked.length; index++) {
          comparedPairs.set(xmlRoot, (comparedPairs.get(xmlRoot) ?? 0) + 1);
          // >=, а не >: повтор одного тега в документе тоже не канон (ранги строго растут).
          if (ranked[index - 1].rank >= ranked[index].rank) {
            const label = `вид «${xmlRoot}»: «${ranked[index - 1].key}» идёт раньше «${ranked[index].key}», а таблица требует обратного`;
            const known = violations.get(label);
            if (known) {
              known.count++;
            } else {
              violations.set(label, { count: 1, example: relativeToCorpus(file.file) });
            }
          }
        }
      }
    }

    assert.deepStrictEqual(
      [...violations].map(([label, fact]) => `${label} (${String(fact.count)} файлов, пример — ${fact.example})`),
      [],
      'платформа пишет свойства корня в порядке, противоречащем таблице ROOT_PROPERTY_ORDER'
    );
    // Гейт не должен быть вакуумным: у каждого вида, где в файле ≥2 свойств, что-то сравнено.
    const vacuous = [...scanRootPropertyFacts()]
      .filter(([, bucket]) => bucket.files.some((file) => file.keys.length >= 2))
      .map(([xmlRoot]) => xmlRoot)
      .filter((xmlRoot) => (comparedPairs.get(xmlRoot) ?? 0) === 0);
    assert.deepStrictEqual(vacuous, [], 'у этих видов гейт порядка не сравнил ни одной пары — таблица не знает их тегов');
  });

  test('полнота: каждый тег, наблюдаемый у вида в эталоне, есть в строке таблицы (иначе он не станет якорем вставки)', function () {
    this.timeout(300_000);
    const order = requirePropertyOrder();
    const missing: string[] = [];
    for (const [xmlRoot, bucket] of scanRootPropertyFacts()) {
      const kind = metaKindOfXmlRoot(xmlRoot);
      const row = kind ? order.ROOT_PROPERTY_ORDER[kind] ?? [] : [];
      for (const [tag, fact] of bucket.tags) {
        if (!row.includes(tag)) {
          missing.push(
            `вид «${xmlRoot}», тег «${tag}»: в эталоне ${String(fact.count)} файлов, пример — ${relativeToCorpus(fact.example)}, но в строке таблицы его нет`
          );
        }
      }
    }
    assert.deepStrictEqual(missing, [], 'добавьте тег в строку ROOT_PROPERTY_ORDER по месту, снятому с эталона:\n' + missing.join('\n'));
  });

  test('обратный гейт: каждый ключ строки таблицы подтверждён примером эталона у своего вида', function () {
    this.timeout(300_000);
    const order = requirePropertyOrder();
    const facts = scanRootPropertyFacts();
    const unconfirmed: string[] = [];
    for (const [kind, row] of Object.entries(order.ROOT_PROPERTY_ORDER)) {
      const bucket = facts.get(xmlRootOfMetaKind(kind as keyof typeof META_TYPES));
      for (const key of row) {
        if ((bucket?.tags.get(key)?.count ?? 0) === 0) {
          unconfirmed.push(`вид «${kind}», ключ «${key}»: в эталоне 0 примеров`);
        }
      }
    }
    assert.deepStrictEqual(
      unconfirmed,
      [],
      'ключ таблицы без подтверждения корпусом — решение об удалении принимает человек, молча не убирать:\n' + unconfirmed.join('\n')
    );
  });

  test('каждый вид с экземплярами в эталоне резолвится из META_TYPES и имеет строку; виды без экземпляров — вакуумный ноль', function () {
    this.timeout(300_000);
    const order = requirePropertyOrder();
    const facts = scanRootPropertyFacts();

    const problems: string[] = [];
    for (const xmlRoot of facts.keys()) {
      const kind = metaKindOfXmlRoot(xmlRoot);
      if (!kind) {
        problems.push(`корневой тег «${xmlRoot}» не резолвится в MetaKind через META_TYPES (englishKind ?? kind)`);
        continue;
      }
      if (!order.ROOT_PROPERTY_ORDER[kind]?.length) {
        problems.push(`вид «${kind}» (корень «${xmlRoot}») есть в эталоне, но строки в ROOT_PROPERTY_ORDER нет`);
      }
      if (!order.hasRootPropertyOrderRule(xmlRoot)) {
        problems.push(`hasRootPropertyOrderRule('${xmlRoot}') === false, хотя вид есть в эталоне`);
      }
    }
    assert.deepStrictEqual(problems, []);

    // Корневые объекты выгрузки (есть папка), которых в корпусе нет вовсе: гейт по ним
    // вакуумный, строку они не требуют. Список пинится — расширение реестра новым видом
    // без экземпляров в корпусе должно быть осознанным решением, а не молчаливым.
    const vacuousKinds = Object.values(META_TYPES)
      .filter((def) => def.folder !== undefined && !facts.has(def.englishKind ?? def.kind))
      .map((def) => def.kind)
      .sort();
    assert.deepStrictEqual(vacuousKinds, ['ExternalDataSource', 'Interface', 'Sequence', 'WebSocketClient']);
  });

  test('пин замера: число файлов по каждому из 48 видов совпадает с заявленным', function () {
    this.timeout(300_000);
    const facts = scanRootPropertyFacts();
    const actual: Record<string, number> = {};
    for (const xmlRoot of [...facts.keys()].sort()) {
      actual[xmlRoot] = facts.get(xmlRoot)?.files.length ?? 0;
    }
    assert.deepStrictEqual(actual, EXPECTED_FILES_BY_XML_ROOT);
    assert.strictEqual(Object.keys(actual).length, 48, 'замер снят по 48 видам метаданных');
  });

  test('ExtendedConfigurationObject стоит непосредственно после Comment во всех 23 носителях; ObjectBelonging — первым', function () {
    this.timeout(300_000);
    const carriers = new Map<string, number>();
    let carrierTotal = 0;
    let objectBelongingTotal = 0;
    for (const [xmlRoot, bucket] of scanRootPropertyFacts()) {
      for (const file of bucket.files) {
        const belongingIndex = file.keys.indexOf('ObjectBelonging');
        if (belongingIndex >= 0) {
          objectBelongingTotal++;
          assert.strictEqual(belongingIndex, 0, `${relativeToCorpus(file.file)}: ObjectBelonging обязан идти первым, до Name`);
        }
        const index = file.keys.indexOf('ExtendedConfigurationObject');
        if (index < 0) {
          continue;
        }
        carrierTotal++;
        carriers.set(xmlRoot, (carriers.get(xmlRoot) ?? 0) + 1);
        assert.strictEqual(
          file.keys[index - 1],
          'Comment',
          `${relativeToCorpus(file.file)}: ExtendedConfigurationObject не сразу после Comment`
        );
      }
    }
    assert.strictEqual(carrierTotal, 23);
    assert.deepStrictEqual(Object.fromEntries([...carriers].sort()), EXTENDED_CONFIGURATION_OBJECT_CARRIERS);
    // 23 заимствованных объекта + корень самого расширения (Configuration с ObjectBelonging).
    assert.strictEqual(objectBelongingTotal, 24);
  });

  test('таблица кладёт ExtendedConfigurationObject сразу за Comment и ObjectBelonging первым во всех строках, где они есть', function () {
    this.timeout(300_000);
    const order = requirePropertyOrder();
    for (const [kind, row] of Object.entries(order.ROOT_PROPERTY_ORDER)) {
      const extended = row.indexOf('ExtendedConfigurationObject');
      if (extended >= 0) {
        // Порядок относительно остальных тегов корпус не определяет (у заимствованных объектов
        // их нет), поэтому место задано замером «после Comment», а не выведено из графа пар.
        assert.strictEqual(extended, row.indexOf('Comment') + 1, `вид «${kind}»: ExtendedConfigurationObject должен идти сразу за Comment`);
      }
      const belonging = row.indexOf('ObjectBelonging');
      if (belonging >= 0) {
        assert.strictEqual(belonging, 0, `вид «${kind}»: ObjectBelonging должен быть первым`);
      }
    }
    // Хотя бы у одного вида оба тега действительно заведены — иначе цикл выше вырожден.
    assert.ok(order.ROOT_PROPERTY_ORDER.Catalog?.includes('ExtendedConfigurationObject'));
    assert.strictEqual(order.ROOT_PROPERTY_ORDER.Catalog?.[0], 'ObjectBelonging');
  });

  test('допущение nesting: у прямых детей корневого <Properties> нет вложенного ОДНОИМЁННОГО тега', function () {
    this.timeout(300_000);
    // collectPropertyBlocks не nesting-aware: закрывающий тег ищется первым indexOf.
    // Вложенный одноимённый тег обрезал бы блок посередине, и splice-вставка
    // разорвала бы XML. Допущение проверяется на всём корпусе, а не берётся на веру
    // (прецедент — CfeBorrowService).
    const nested: string[] = [];
    let checkedChildren = 0;
    for (const bucket of scanRootPropertyFacts().values()) {
      for (const file of bucket.files) {
        for (const child of file.children) {
          checkedChildren++;
          if (new RegExp(`<${escapeRegExp(child.tag)}[\\s/>]`).test(child.inner)) {
            nested.push(`${relativeToCorpus(file.file)}: внутри «${child.tag}» есть вложенный «${child.tag}»`);
          }
        }
      }
    }
    assert.deepStrictEqual(nested.slice(0, 20), []);
    assert.ok(checkedChildren > 100_000, 'обход корпуса выродился: проверено подозрительно мало свойств');
  });

  test('collectPropertyBlocks на корне выгрузки видит ровно те же прямые дети, что и nesting-aware скан', function () {
    this.timeout(300_000);
    // Прямая проверка применимости механики вставки: если хоть один файл корпуса даст
    // другой список ключей, якоря каноничной вставки окажутся не там, где их видит скан.
    const mismatches: string[] = [];
    for (const bucket of scanRootPropertyFacts().values()) {
      for (const file of bucket.files) {
        if (file.keys.length === 0) {
          continue;
        }
        const range = findPropertiesRange(fs.readFileSync(file.file, 'utf-8'));
        const blockKeys = range ? collectPropertyBlocks(range.inner).map((block) => block.key) : [];
        if (JSON.stringify(blockKeys) !== JSON.stringify(file.keys)) {
          mismatches.push(relativeToCorpus(file.file));
        }
      }
    }
    assert.deepStrictEqual(mismatches.slice(0, 20), []);
  });
});
