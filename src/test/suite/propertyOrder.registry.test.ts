import * as assert from 'assert';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { FORM_PROPERTY_KEYS_BY_KIND } from '../../infra/xml/PropertySchema';
import { requirePropertyOrder } from './support/propertyOrderCorpus';

/**
 * Сшивка таблицы порядка свойств корня (`ROOT_PROPERTY_ORDER`) с соседними
 * реестрами. Тесты не зависят от корпуса: они ловят расхождение двух ТАБЛИЦ
 * в коде (а не таблицы и эталона — это гейты `propertyOrderCorpus.test.ts`).
 *
 * Модуль `infra/xml/properties/PropertyOrder.ts` на фазе «красный» ещё не
 * существует — загрузка ленивая (см. `support/propertyOrderCorpus.ts`).
 */

/** Подпоследовательность: все элементы `part` есть в `whole` в том же относительном порядке. */
function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let cursor = 0;
  for (const item of whole) {
    if (item === part[cursor]) {
      cursor++;
    }
  }
  return cursor === part.length;
}

/** Ключи выбора форм отчёта — 6, поимённо (эталон 2.21). */
const REPORT_FORM_KEYS = [
  'DefaultForm',
  'AuxiliaryForm',
  'DefaultSettingsForm',
  'AuxiliarySettingsForm',
  'DefaultVariantForm',
  'AuxiliaryVariantForm',
] as const;

/**
 * Ключи форм уровня приложения у корня выгрузки — 18, поимённо. На выгрузке 2.20
 * платформа пишет только 10 основных, 8 `Auxiliary*` там отсутствуют — из-за них
 * выбор вспомогательных форм на 2.20 сегодня отказывает (нет якоря/места вставки).
 */
const CONFIGURATION_FORM_KEYS = [
  'DefaultReportForm',
  'DefaultReportVariantForm',
  'DefaultReportSettingsForm',
  'DefaultDynamicListSettingsForm',
  'DefaultSearchForm',
  'DefaultDataHistoryChangeHistoryForm',
  'DefaultDataHistoryVersionDataForm',
  'DefaultDataHistoryVersionDifferencesForm',
  'DefaultCollaborationSystemUsersChoiceForm',
  'AuxiliaryReportForm',
  'AuxiliaryReportVariantForm',
  'AuxiliaryReportSettingsForm',
  'AuxiliaryDynamicListSettingsForm',
  'AuxiliaryDataHistoryChangeHistoryForm',
  'AuxiliaryDataHistoryVersionDataForm',
  'AuxiliaryDataHistoryVersionDifferencesForm',
  'AuxiliaryCollaborationSystemUsersChoiceForm',
  'DefaultConstantsForm',
] as const;

suite('ROOT_PROPERTY_ORDER — сшивка с реестрами (META_TYPES, FORM_PROPERTY_KEYS_BY_KIND)', () => {
  test('модуль PropertyOrder.ts существует и экспортирует таблицу и обе функции', () => {
    const order = requirePropertyOrder();
    assert.strictEqual(typeof order.ROOT_PROPERTY_ORDER, 'object');
    assert.strictEqual(typeof order.rootPropertyRank, 'function');
    assert.strictEqual(typeof order.hasRootPropertyOrderRule, 'function');
  });

  test('FORM_PROPERTY_KEYS_BY_KIND[вид] — подпоследовательность строки ROOT_PROPERTY_ORDER[вид] для КАЖДОГО вида таблицы форм', () => {
    const order = requirePropertyOrder();
    const table: Readonly<Record<string, readonly string[] | undefined>> = FORM_PROPERTY_KEYS_BY_KIND;
    const kinds = Object.keys(table);
    assert.ok(kinds.length >= 20, 'таблица форм выродилась: обход по видам ничего не проверит');
    for (const kind of kinds) {
      const formKeys = table[kind] ?? [];
      const row = order.ROOT_PROPERTY_ORDER[kind as MetaKind];
      assert.ok(row, `вид «${kind}» выбирает формы, но строки в ROOT_PROPERTY_ORDER у него нет`);
      const missing = formKeys.filter((key) => !row.includes(key));
      assert.deepStrictEqual(missing, [], `вид «${kind}»: ключи форм отсутствуют в строке порядка: ${missing.join(', ')}`);
      // Подпоследовательность ловит и пропуск ключа, и РАСХОЖДЕНИЕ порядка двух реестров.
      assert.ok(
        isSubsequence(formKeys, row),
        `вид «${kind}»: порядок ключей форм ${JSON.stringify(formKeys)} не совпадает с порядком в строке порядка`
      );
    }
  });

  test('шесть ключей форм отчёта — поимённо и в этом порядке — лежат в строке Report', () => {
    const order = requirePropertyOrder();
    assert.deepStrictEqual([...(FORM_PROPERTY_KEYS_BY_KIND.Report ?? [])], [...REPORT_FORM_KEYS]);
    const row = order.ROOT_PROPERTY_ORDER.Report ?? [];
    for (const key of REPORT_FORM_KEYS) {
      assert.ok(row.includes(key), `Report: в строке порядка нет «${key}»`);
    }
    assert.ok(isSubsequence(REPORT_FORM_KEYS, row));
    // Место, ради которого задача заведена: вспомогательная форма варианта — между
    // основной формой варианта и хранилищем вариантов, а не в конце блока.
    assert.strictEqual(row.indexOf('AuxiliaryVariantForm'), row.indexOf('DefaultVariantForm') + 1);
    assert.ok(row.indexOf('AuxiliaryVariantForm') < row.indexOf('VariantsStorage'));
  });

  test('восемнадцать ключей форм корня выгрузки — поимённо — лежат в строке configuration', () => {
    const order = requirePropertyOrder();
    assert.deepStrictEqual([...(FORM_PROPERTY_KEYS_BY_KIND.configuration ?? [])], [...CONFIGURATION_FORM_KEYS]);
    assert.strictEqual(CONFIGURATION_FORM_KEYS.length, 18);
    const row = order.ROOT_PROPERTY_ORDER.configuration ?? [];
    for (const key of CONFIGURATION_FORM_KEYS) {
      assert.ok(row.includes(key), `configuration: в строке порядка нет «${key}»`);
    }
    assert.ok(isSubsequence(CONFIGURATION_FORM_KEYS, row));
  });

  test('rootPropertyRank: неизвестный вид, неизвестный ключ и undefined дают null', () => {
    const order = requirePropertyOrder();
    assert.strictEqual(order.rootPropertyRank('НетТакогоВида', 'Name'), null, 'вид вне таблицы');
    assert.strictEqual(order.rootPropertyRank('Report', 'НетТакогоКлюча'), null, 'ключ вне строки известного вида');
    assert.strictEqual(order.rootPropertyRank(undefined, 'Name'), null, 'владелец не определён');
    // Вид, существующий в META_TYPES, но без снятого правила (в корпусе экземпляров нет).
    assert.strictEqual(order.rootPropertyRank('Sequence', 'Name'), null, 'вид без строки');
    // Регистр важен: тег XML — не строка для нормализации.
    assert.strictEqual(order.rootPropertyRank('report', 'Name'), null);
    assert.strictEqual(order.rootPropertyRank('Report', 'name'), null);
  });

  test('hasRootPropertyOrderRule: true только у видов со строкой; undefined и неизвестный вид — false', () => {
    const order = requirePropertyOrder();
    assert.strictEqual(order.hasRootPropertyOrderRule(undefined), false);
    assert.strictEqual(order.hasRootPropertyOrderRule('НетТакогоВида'), false);
    assert.strictEqual(order.hasRootPropertyOrderRule('Sequence'), false);
    assert.strictEqual(order.hasRootPropertyOrderRule('Report'), true);
    assert.strictEqual(order.hasRootPropertyOrderRule('Catalog'), true);
    assert.strictEqual(order.hasRootPropertyOrderRule('Configuration'), true);
  });

  test('ранги строго растут вдоль строки каждого вида (rank — индекс места, а не «какое-то число»)', () => {
    const order = requirePropertyOrder();
    const rows = Object.entries(order.ROOT_PROPERTY_ORDER);
    assert.ok(rows.length >= 40, 'таблица выродилась: замер снят по 48 видам');
    for (const [kind, row] of rows) {
      const xmlRoot = kind === 'configuration' ? 'Configuration' : (META_TYPES[kind as MetaKind].englishKind ?? kind);
      assert.strictEqual(new Set(row).size, row.length, `вид «${kind}»: в строке есть повторяющийся ключ`);
      assert.ok(row.includes('Name'), `вид «${kind}»: в строке нет Name`);
      let previous = -Infinity;
      for (const key of row) {
        const rank = order.rootPropertyRank(xmlRoot, key);
        if (rank === null) {
          assert.fail(`вид «${kind}»: у ключа «${key}» нет ранга`);
        }
        assert.ok(rank > previous, `вид «${kind}»: ранг «${key}» (${String(rank)}) не больше предыдущего (${String(previous)})`);
        previous = rank;
      }
    }
  });

  test('ранг ObjectBelonging равен 0 — законному значению, а не «отсутствию» ранга', () => {
    const order = requirePropertyOrder();
    // Ранг 0 — легитимный первый: реализация, проверяющая ранг на «истинность»,
    // потеряла бы ObjectBelonging (он идёт ДО Name в заимствованных объектах).
    assert.strictEqual(order.rootPropertyRank('Catalog', 'ObjectBelonging'), 0);
    assert.strictEqual(order.rootPropertyRank('Catalog', 'Name'), 1);
    assert.strictEqual(order.rootPropertyRank('Configuration', 'ObjectBelonging'), 0);
  });

  test('Configuration резолвится в строку configuration; она же обслуживает корень расширения', () => {
    const order = requirePropertyOrder();
    const row = order.ROOT_PROPERTY_ORDER.configuration;
    assert.ok(row && row.length > 0, 'строка configuration обязана быть');
    // Корень расширения пишет ТОТ ЖЕ тег `Configuration` (вид extension в дереве — про
    // навигацию, а не про XML), поэтому отдельной строки у него быть не должно.
    assert.strictEqual(order.ROOT_PROPERTY_ORDER.extension, undefined, 'у расширения нет своей строки — общая с конфигурацией');
    row.forEach((key, index) => {
      assert.strictEqual(order.rootPropertyRank('Configuration', key), index, `Configuration.${key}: ранг = индекс в строке`);
    });
    assert.strictEqual(order.rootPropertyRank('Configuration', 'Name'), row.indexOf('Name'));
    assert.strictEqual(order.rootPropertyRank('Configuration', 'ConfigurationExtensionPurpose') !== null, true);
    assert.strictEqual(order.hasRootPropertyOrderRule('Configuration'), true);
  });

  test('ни один ключ верхнего уровня таблицы не лежит вне META_TYPES (нет параллельного реестра видов)', () => {
    const order = requirePropertyOrder();
    const stray = Object.keys(order.ROOT_PROPERTY_ORDER).filter((kind) => !(kind in META_TYPES));
    assert.deepStrictEqual(stray, []);
  });

  test('корневой тег каждой строки резолвится из META_TYPES (englishKind ?? kind), без рукописной карты', () => {
    const order = requirePropertyOrder();
    for (const kind of Object.keys(order.ROOT_PROPERTY_ORDER)) {
      const xmlRoot = META_TYPES[kind as MetaKind].englishKind ?? kind;
      assert.strictEqual(
        order.hasRootPropertyOrderRule(xmlRoot),
        true,
        `вид «${kind}»: корневой тег «${xmlRoot}» не распознан как вид со снятым правилом`
      );
    }
  });
});
