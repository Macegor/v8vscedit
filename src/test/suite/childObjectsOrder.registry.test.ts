import * as assert from 'assert';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import type { ChildTag } from '../../domain/ChildTag';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

/**
 * T-12 — анти-параллельный-реестр: `ChildObjectsOrder.ts` не должен стать
 * ВТОРЫМ, расходящимся с `META_TYPES` источником правды о дочерних тегах вида.
 * Тест обязан падать, если новый `ChildTag` добавлен виду в `META_TYPES`, но
 * забыт в таблице порядка (структурная сверка, а не подгонка одного снимка).
 *
 * Модуль `infra/xml/childObjects/ChildObjectsOrder.ts` на момент написания
 * теста ЕЩЁ НЕ СУЩЕСТВУЕТ (фаза «красный» TDD) — загрузка через
 * {@link tryRequireProductionModule}, а не статический `import`, иначе
 * `MODULE_NOT_FOUND` рушит загрузку ВСЕХ файлов раннера (см. её JSDoc).
 */

type SerializedChildTag = ChildTag | 'AccountingFlag' | 'ExtDimensionAccountingFlag';

interface ChildObjectsOrderModule {
  readonly CHILD_OBJECTS_ORDER: Partial<Record<MetaKind, readonly SerializedChildTag[]>>;
  readonly CONFIGURATION_CHILD_ORDER: readonly string[];
  childTagRank(ownerKind: string | undefined, tag: string): number | null;
  hasOrderRule(ownerKind: string | undefined): boolean;
}

const REAL_CHILD_TAGS = new Set<string>([
  'StandardAttribute', 'Attribute', 'AddressingAttribute', 'TabularSection', 'Form', 'Command',
  'Template', 'Dimension', 'Resource', 'EnumValue', 'URLTemplate', 'Method',
]);

/**
 * Известный ОТДЕЛЬНЫЙ дефект реестра (см. очередь недочётов в CLAUDE.md/audit):
 * `META_TYPES[kind].childTags` у ряда видов НЕ содержит некоторые теги, хотя
 * они реально добавляемы через API (см. `ADDABLE_CANON` в
 * `childObjectsOrder.creator.test.ts`) и присутствуют в каноне порядка:
 *  - регистры (`InformationRegister`/`AccumulationRegister`/`AccountingRegister`/
 *    `CalculationRegister`) не содержат `Attribute` И `Template`;
 *  - `DocumentJournal`/`ChartOfCharacteristicTypes`/`ChartOfAccounts`/
 *    `ChartOfCalculationTypes`/`BusinessProcess`/`Task` не содержат ТОЛЬКО
 *    `Template` (макеты этим видам реально добавляемы).
 *
 * Эта задача НЕ обязана чинить `META_TYPES` (центральный контракт, другая ось —
 * состав групп дерева) — разрыв уже занесён в очередь недочётов ОТДЕЛЬНЫМ
 * пунктом. Здесь фиксируется ТОЧЕЧНОЕ исключение по паре «вид + тег», а НЕ по
 * виду целиком: направление проверки «каждый ChildTag из строки входит в
 * childTags» по-прежнему выполняется для этого же вида и ловит анти-паттерн
 * «добавили тег в реестр — забыли таблицу» для ЛЮБОГО тега, кроме перечисленных
 * здесь явно known-gap пар.
 */
const KNOWN_CHILD_TAGS_GAP: ReadonlyMap<MetaKind, ReadonlySet<ChildTag>> = new Map([
  ['InformationRegister', new Set<ChildTag>(['Attribute', 'Template'])],
  ['AccumulationRegister', new Set<ChildTag>(['Attribute', 'Template'])],
  ['AccountingRegister', new Set<ChildTag>(['Attribute', 'Template'])],
  ['CalculationRegister', new Set<ChildTag>(['Attribute', 'Template'])],
  ['DocumentJournal', new Set<ChildTag>(['Template'])],
  ['ChartOfCharacteristicTypes', new Set<ChildTag>(['Template'])],
  ['ChartOfAccounts', new Set<ChildTag>(['Template'])],
  ['ChartOfCalculationTypes', new Set<ChildTag>(['Template'])],
  ['BusinessProcess', new Set<ChildTag>(['Template'])],
  ['Task', new Set<ChildTag>(['Template'])],
]);

suite('ChildObjectsOrder — T-12: анти-параллельный-реестр (сшивка с META_TYPES)', () => {
  let orderModule: ChildObjectsOrderModule | undefined;

  suiteSetup(() => {
    orderModule = tryRequireProductionModule('../../../infra/xml/childObjects/ChildObjectsOrder') as ChildObjectsOrderModule | undefined;
  });

  test('модуль ChildObjectsOrder.ts существует и экспортирует CHILD_OBJECTS_ORDER', () => {
    assert.ok(orderModule, 'infra/xml/childObjects/ChildObjectsOrder.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  for (const kind of Object.keys(META_TYPES) as MetaKind[]) {
    const def = META_TYPES[kind];
    const childTags = def.childTags;
    if (!childTags?.length) {
      continue;
    }

    test(`${kind}: childTags \\ {StandardAttribute} ⊆ строка CHILD_OBJECTS_ORDER (ловит «добавили тег в реестр — забыли таблицу»)`, () => {
      if (!orderModule) {
        assert.fail('ChildObjectsOrder.ts не реализован — см. предыдущий тест');
        return;
      }
      const row = orderModule.CHILD_OBJECTS_ORDER[kind];
      assert.ok(row, `${kind}: у вида с непустым childTags обязана быть строка в CHILD_OBJECTS_ORDER`);
      const relevantChildTags = childTags.filter((tag) => tag !== 'StandardAttribute');
      const missing = relevantChildTags.filter((tag) => !row.includes(tag as SerializedChildTag));
      assert.deepStrictEqual(missing, [], `${kind}: теги из childTags отсутствуют в строке канона: ${missing.join(', ')}`);
    });

    const knownGap = KNOWN_CHILD_TAGS_GAP.get(kind) ?? new Set<ChildTag>();
    test(`${kind}: каждый ChildTag-элемент строки CHILD_OBJECTS_ORDER входит в childTags (обратное направление, минус точечный known-gap этого вида)`, () => {
      if (!orderModule) {
        assert.fail('ChildObjectsOrder.ts не реализован — см. предыдущий тест');
        return;
      }
      const row = orderModule.CHILD_OBJECTS_ORDER[kind] ?? [];
      const realChildTagsInRow = row.filter((tag) => REAL_CHILD_TAGS.has(tag));
      // Известный точечный разрыв (см. KNOWN_CHILD_TAGS_GAP) вычитается из
      // проверки ТОЛЬКО для конкретных тегов этого вида — любой ДРУГОЙ тег
      // строки канона по-прежнему обязан присутствовать в childTags, иначе
      // тест падает (анти-паттерн «добавили тег в реестр — забыли таблицу»
      // остаётся под защитой).
      const missing = realChildTagsInRow.filter((tag) => !childTags.includes(tag as ChildTag) && !knownGap.has(tag as ChildTag));
      assert.deepStrictEqual(missing, [], `${kind}: теги строки канона отсутствуют в childTags: ${missing.join(', ')}`);
    });
  }

  test('известный точечный разрыв (KNOWN_CHILD_TAGS_GAP): каждый указанный тег есть в строке канона, но осознанно НЕ требуется в childTags этой задачей', () => {
    if (!orderModule) {
      assert.fail('ChildObjectsOrder.ts не реализован — см. первый тест');
      return;
    }
    for (const [kind, gapTags] of KNOWN_CHILD_TAGS_GAP) {
      const row = orderModule.CHILD_OBJECTS_ORDER[kind] ?? [];
      for (const tag of gapTags) {
        assert.ok(row.includes(tag), `${kind}: строка канона обязана включать ${tag}`);
        assert.ok(
          !META_TYPES[kind].childTags?.includes(tag),
          `${kind}: если childTags уже содержит ${tag} — известный разрыв починен, убери пару из KNOWN_CHILD_TAGS_GAP`
        );
      }
    }
  });

  test('childTagRank: неизвестный вид владельца → null для любого тега', () => {
    if (!orderModule) {
      assert.fail('ChildObjectsOrder.ts не реализован');
      return;
    }
    assert.strictEqual(orderModule.childTagRank('НесуществующийВид', 'Attribute'), null);
  });

  test('childTagRank: известный вид, неизвестный тег → null', () => {
    if (!orderModule) {
      assert.fail('ChildObjectsOrder.ts не реализован');
      return;
    }
    assert.strictEqual(orderModule.childTagRank('Catalog', 'НесуществующийТег'), null);
  });

  test('hasOrderRule: true для всех 17 видов с известным правилом, false для вида без записи', () => {
    if (!orderModule) {
      assert.fail('ChildObjectsOrder.ts не реализован');
      return;
    }
    for (const kind of Object.keys(orderModule.CHILD_OBJECTS_ORDER)) {
      assert.strictEqual(orderModule.hasOrderRule(kind), true, `${kind}: hasOrderRule обязан вернуть true`);
    }
    assert.strictEqual(orderModule.hasOrderRule('Constant'), false, 'Constant не имеет childTags/правила порядка');
  });

  test('CONFIGURATION_CHILD_ORDER: перенесённый массив непуст и содержит Catalog/Document (сверка после переезда из ConfigurationXmlEditor)', () => {
    if (!orderModule) {
      assert.fail('ChildObjectsOrder.ts не реализован');
      return;
    }
    assert.ok(orderModule.CONFIGURATION_CHILD_ORDER.length > 30, 'ожидался перенесённый БЕЗ ИЗМЕНЕНИЙ массив (>30 типов)');
    assert.ok(orderModule.CONFIGURATION_CHILD_ORDER.includes('Catalog'));
    assert.ok(orderModule.CONFIGURATION_CHILD_ORDER.includes('Document'));
  });
});
