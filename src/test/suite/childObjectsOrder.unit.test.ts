import * as assert from 'assert';
import { addChildToObjectXml } from '../../infra/xml/creator/childElementBuilders';
import { BASELINE_RULESET } from '../../infra/xml/format/baselineRuleset';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

/**
 * T-18 — 100% покрытие веток новых чистых модулей `ChildObjectsEditor.ts`
 * (`resolveInsertOffset`) за один проход, плюс ветки существующего
 * `childElementBuilders.addChildToObjectXml`, которые задание меняет
 * (владелец/тег без правила → делегирование в `resolveInsertOffset`).
 *
 * `ChildObjectsEditor.ts` ЕЩЁ НЕ СУЩЕСТВУЕТ на фазе «красный» — загрузка
 * через {@link tryRequireProductionModule} (см. её JSDoc про риск обрушения
 * загрузки всего раннера статическим `import`).
 */

interface ChildObjectsEditorModule {
  resolveInsertOffset(
    inner: string,
    ownerKind: string | undefined,
    tag: string,
    container: 'root' | 'nested'
  ): number | null;
}

const MARKER = '<<<NEW>>>';

/** Вставляет MARKER по offset (или в конец, если null) — не зависит от конкретного числового значения offset. */
function splice(inner: string, offset: number | null): string {
  return offset === null ? `${inner}${MARKER}` : `${inner.slice(0, offset)}${MARKER}${inner.slice(offset)}`;
}

suite('ChildObjectsEditor.resolveInsertOffset — T-18: ветки', () => {
  let editorModule: ChildObjectsEditorModule | undefined;

  suiteSetup(() => {
    editorModule = tryRequireProductionModule('../../../infra/xml/childObjects/ChildObjectsEditor') as ChildObjectsEditorModule | undefined;
  });

  test('модуль ChildObjectsEditor.ts существует и экспортирует resolveInsertOffset', () => {
    assert.ok(editorModule, 'infra/xml/childObjects/ChildObjectsEditor.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function resolve(inner: string, ownerKind: string | undefined, tag: string, container: 'root' | 'nested' = 'root'): number | null {
    if (!editorModule) {
      assert.fail('ChildObjectsEditor.ts не реализован — см. первый тест');
    }
    return editorModule.resolveInsertOffset(inner, ownerKind, tag, container);
  }

  const catalogInner = [
    '',
    '\t\t\t<Attribute uuid="11111111-1111-1111-1111-111111111111"><Properties><Name>Р1</Name></Properties></Attribute>',
    '\t\t\t<Command uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>К1</Name></Properties></Command>',
    '\t\t',
  ].join('\n');

  test('ownerKind === undefined → null (в конец)', () => {
    const offset = resolve(catalogInner, undefined, 'TabularSection');
    assert.strictEqual(offset, null);
  });

  test('вид без строки в таблице (Constant) → null', () => {
    const offset = resolve(catalogInner, 'Constant', 'TabularSection');
    assert.strictEqual(offset, null);
  });

  test('известный вид, но тег без ранга для него (EnumValue у Catalog) → null', () => {
    const offset = resolve(catalogInner, 'Catalog', 'EnumValue');
    assert.strictEqual(offset, null);
  });

  test('пустой inner ("") → null', () => {
    const offset = resolve('', 'Catalog', 'TabularSection');
    assert.strictEqual(offset, null);
  });

  test('inner из одних пробелов/переводов строк → null', () => {
    const offset = resolve('\n\t\t\t\n\t\t', 'Catalog', 'TabularSection');
    assert.strictEqual(offset, null);
  });

  test('container="nested" → всегда null, даже если у owner/tag формально есть ранг', () => {
    const offset = resolve(catalogInner, 'Catalog', 'TabularSection', 'nested');
    assert.strictEqual(offset, null);
  });

  test('ребёнок с бо́льшим рангом — ПЕРВЫЙ (Command, ранг 4) при вставке TabularSection (ранг 1) → перед Command, ПОСЛЕ Attribute', () => {
    // inner = [Attribute(ранг0), Command(ранг4)] — TabularSection(ранг1) должен
    // встать МЕЖДУ ними: первый ребёнок со строго большим рангом — Command.
    const offset = resolve(catalogInner, 'Catalog', 'TabularSection');
    assert.notStrictEqual(offset, null, 'обязана быть найдена позиция ДО Command');
    const spliced = splice(catalogInner, offset);
    const markerIndex = spliced.indexOf(MARKER);
    assert.ok(markerIndex > spliced.indexOf('Р1'), 'маркер обязан быть ПОСЛЕ Attribute');
    assert.ok(markerIndex < spliced.indexOf('К1'), 'маркер обязан быть ДО Command');
  });

  test('ребёнок с бо́льшим рангом — ЕДИНСТВЕННЫЙ (только Command) при вставке Attribute (ранг0) → перед единственным ребёнком', () => {
    const singleChildInner = '\n\t\t\t<Command uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>К1</Name></Properties></Command>\n\t\t';
    const offset = resolve(singleChildInner, 'Catalog', 'Attribute');
    assert.notStrictEqual(offset, null);
    const spliced = splice(singleChildInner, offset);
    assert.ok(spliced.indexOf(MARKER) < spliced.indexOf('К1'));
  });

  test('ребёнок с бо́льшим рангом — ПОСЛЕДНИЙ (Attribute, Command — оба меньше/равны, кроме последнего Template) при вставке Form (ранг2)', () => {
    const inner = [
      '',
      '\t\t\t<Attribute uuid="11111111-1111-1111-1111-111111111111"><Properties><Name>Р1</Name></Properties></Attribute>',
      '\t\t\t<TabularSection uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>ТЧ1</Name></Properties><ChildObjects/></TabularSection>',
      '\t\t\t<Template>Макет1</Template>',
      '\t\t',
    ].join('\n');
    const offset = resolve(inner, 'Catalog', 'Form');
    assert.notStrictEqual(offset, null);
    const spliced = splice(inner, offset);
    const markerIndex = spliced.indexOf(MARKER);
    assert.ok(markerIndex > spliced.indexOf('ТЧ1'), 'маркер обязан быть ПОСЛЕ TabularSection');
    assert.ok(markerIndex < spliced.indexOf('Макет1'), 'маркер обязан быть ДО Template (последнего ребёнка с бо́льшим рангом)');
  });

  test('ВСЕ существующие дети со СТРОГО меньшим или равным рангом → null (в конец)', () => {
    // Catalog: Attribute(0) < TabularSection(1); вставляем Command(4) — оба
    // существующих ребёнка строго меньше нового ранга.
    const offset = resolve(catalogInner, 'Catalog', 'Command');
    assert.strictEqual(offset, null);
  });
});

// ── addChildToObjectXml — ветки, актуальные после делегирования в resolveInsertOffset ──

suite('childElementBuilders.addChildToObjectXml — T-18: ветки guard-ов (существующий модуль)', () => {
  test('нет корневого элемента объекта метаданных (regex extractMetadataObjectKind не матчится) → ошибка', () => {
    const xml = '<NotAMetaDataObject></NotAMetaDataObject>';
    const result = addChildToObjectXml(xml, { ownerObjectXmlPath: 'x', childTag: 'Attribute', name: 'Р1' }, BASELINE_RULESET);
    assert.strictEqual(result.changed, false);
    assert.ok(result.error.includes('Не найден корневой элемент'));
  });

  test('нет <ChildObjects> в объекте → ошибка', () => {
    const xml = [
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Catalog uuid="00000000-0000-0000-0000-000000000000">',
      '\t\t<Properties><Name>Тест</Name></Properties>',
      '\t</Catalog>',
      '</MetaDataObject>',
    ].join('\n');
    const result = addChildToObjectXml(xml, { ownerObjectXmlPath: 'x', childTag: 'Attribute', name: 'Р1' }, BASELINE_RULESET);
    assert.strictEqual(result.changed, false);
    assert.ok(result.error.includes('отсутствует блок <ChildObjects>'));
  });

  test('Column без tabularSectionName → ошибка «Не указана табличная часть»', () => {
    const result = addChildToObjectXml('<x/>', { ownerObjectXmlPath: 'x', childTag: 'Column', name: 'К1' }, BASELINE_RULESET);
    assert.strictEqual(result.changed, false);
    assert.ok(result.error.includes('Не указана табличная часть'));
  });

  test('Method без urlTemplateName → ошибка «Не указан URL-шаблон»', () => {
    const result = addChildToObjectXml('<x/>', { ownerObjectXmlPath: 'x', childTag: 'Method', name: 'GET' }, BASELINE_RULESET);
    assert.strictEqual(result.changed, false);
    assert.ok(result.error.includes('Не указан URL-шаблон'));
  });

  test('StandardAttribute → throw (создаются платформой, не вручную)', () => {
    const xml = [
      '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
      '\t<Catalog uuid="00000000-0000-0000-0000-000000000000">',
      '\t\t<Properties><Name>Тест</Name></Properties>',
      '\t\t<ChildObjects/>',
      '\t</Catalog>',
      '</MetaDataObject>',
    ].join('\n');
    assert.throws(
      () => addChildToObjectXml(xml, { ownerObjectXmlPath: 'x', childTag: 'StandardAttribute', name: 'Х' }, BASELINE_RULESET),
      /Стандартные реквизиты создаются платформой/
    );
  });
});
