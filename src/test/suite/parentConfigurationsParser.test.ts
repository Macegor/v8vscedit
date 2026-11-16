import * as assert from 'assert';
import { parseParentConfigurations } from '../../infra/support/ParentConfigurationsParser';
import { SupportMode } from '../../infra/support/SupportInfoService';
import { buildParentConfigurationsBin, testUuid, type BinVendor } from './support/parentConfigurationsBin';

const A = testUuid(1);
const B = testUuid(2);
const C = testUuid(3);

function parse(vendors: readonly BinVendor[]): ReturnType<typeof parseParentConfigurations> {
  return parseParentConfigurations(buildParentConfigurationsBin(vendors).toString('utf8'));
}

suite('ParentConfigurationsParser', () => {
  const codeToMode: readonly (readonly [number, SupportMode])[] = [
    [0, SupportMode.Locked],
    [1, SupportMode.Editable],
    [2, SupportMode.Removed],
  ];

  for (const [code, mode] of codeToMode) {
    test(`код ${String(code)} — режим ${mode}`, () => {
      const data = parse([{ name: 'П', records: [{ code, uuid: A }] }]);
      assert.strictEqual(data.modes.get(A), mode);
      assert.strictEqual(data.recordCount, 1);
      assert.strictEqual(data.unknownCodeCount, 0);
    });
  }

  test('код — первое поле записи: первая запись после count с кодом 1 не сдвигается, следующая с кодом 0 остаётся Locked', () => {
    const data = parse([{ name: 'П', records: [{ code: 1, uuid: A }, { code: 0, uuid: B }] }]);
    assert.strictEqual(data.modes.get(A), SupportMode.Editable);
    assert.strictEqual(data.modes.get(B), SupportMode.Locked);
    assert.strictEqual(data.recordCount, 2);
  });

  test('несовпадающая пара: ключ — локальный uuid, uuid поставщика не индексируется', () => {
    const data = parse([{ name: 'П', records: [{ code: 0, uuid: A, vendorUuid: B }] }]);
    assert.strictEqual(data.modes.get(A), SupportMode.Locked);
    assert.strictEqual(data.modes.has(B), false);
    assert.strictEqual(data.modes.size, 1);
  });

  const mergeCases: readonly (readonly [number, number, SupportMode])[] = [
    [0, 1, SupportMode.Locked],
    [1, 2, SupportMode.Editable],
    [0, 2, SupportMode.Locked],
    [2, 2, SupportMode.Removed],
    [1, 1, SupportMode.Editable],
  ];

  for (const [first, second, expected] of mergeCases) {
    for (const [x, y] of [[first, second], [second, first]]) {
      test(`два поставщика, коды (${String(x)}, ${String(y)}) — строгий побеждает: ${expected}`, () => {
        const data = parse([
          { name: 'П1', records: [{ code: x, uuid: C }] },
          { name: 'П2', records: [{ code: y, uuid: C }] },
        ]);
        assert.strictEqual(data.modes.get(C), expected);
        assert.strictEqual(data.recordCount, 2);
        assert.strictEqual(data.modes.size, 1);
      });
    }
  }

  test('неизвестный код — Locked (консервативно) и учитывается в unknownCodeCount', () => {
    const data = parse([{ name: 'П', records: [{ code: 3, uuid: A }, { code: 1, uuid: B }] }]);
    assert.strictEqual(data.modes.get(A), SupportMode.Locked);
    assert.strictEqual(data.modes.get(B), SupportMode.Editable);
    assert.strictEqual(data.unknownCodeCount, 1);
  });

  test('поставщики: имя, поставщик с "" , версия, declaredCount; recordCount совпадает с declaredCount', () => {
    const data = parse([
      { name: 'Бухгалтерия', vendor: 'АО ПФ "СКБ Контур"', version: '3.0.1', records: [{ code: 0, uuid: A }, { code: 1, uuid: B }] },
      { name: 'Диадок', vendor: 'Вендор', version: '2.23', records: [{ code: 2, uuid: C }] },
    ]);
    assert.deepStrictEqual(data.vendors, [
      { name: 'Бухгалтерия', vendor: 'АО ПФ "СКБ Контур"', version: '3.0.1', declaredCount: 2 },
      { name: 'Диадок', vendor: 'Вендор', version: '2.23', declaredCount: 1 },
    ]);
    assert.strictEqual(data.declaredCount, 3);
    assert.strictEqual(data.recordCount, 3);
  });

  test('расхождение числа записей с объявленным видно по recordCount !== declaredCount', () => {
    const data = parse([{ name: 'П', declaredCount: 5, records: [{ code: 0, uuid: A }] }]);
    assert.strictEqual(data.declaredCount, 5);
    assert.strictEqual(data.recordCount, 1);
  });

  test('BOM не мешает разбору, без BOM результат тот же', () => {
    const withBom = buildParentConfigurationsBin([{ name: 'П', records: [{ code: 1, uuid: A }] }]).toString('utf8');
    assert.strictEqual(withBom.charCodeAt(0), 0xfeff);
    const withoutBom = withBom.slice(1);
    assert.strictEqual(parseParentConfigurations(withBom).modes.get(A), SupportMode.Editable);
    assert.strictEqual(parseParentConfigurations(withoutBom).modes.get(A), SupportMode.Editable);
  });

  test('uuid в верхнем регистре нормализуется к нижнему', () => {
    const upper = 'ABCDEF01-0000-4000-8000-00000000AAAA';
    const data = parse([{ name: 'П', records: [{ code: 0, uuid: upper }] }]);
    assert.strictEqual(data.modes.get(upper.toLowerCase()), SupportMode.Locked);
    assert.strictEqual(data.modes.has(upper), false);
  });

  test('заголовок, разделитель блоков и хвост не порождают записей', () => {
    const data = parse([{ name: 'П1', records: [] }, { name: 'П2', records: [] }]);
    assert.strictEqual(data.modes.size, 0);
    assert.strictEqual(data.recordCount, 0);
    assert.strictEqual(data.vendors.length, 2);
    assert.strictEqual(data.declaredCount, 0);
  });

  for (const [title, input] of [['пустая строка', ''], ['мусор', 'не bin вовсе {1,2,3}']] as const) {
    test(`${title}: пустой результат без исключений`, () => {
      const data = parseParentConfigurations(input);
      assert.strictEqual(data.modes.size, 0);
      assert.deepStrictEqual(data.vendors, []);
      assert.strictEqual(data.recordCount, 0);
      assert.strictEqual(data.declaredCount, 0);
      assert.strictEqual(data.unknownCodeCount, 0);
    });
  }
});
