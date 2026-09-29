import * as assert from 'assert';
import * as fs from 'fs';
import { XMLValidator } from 'fast-xml-parser';
import type { ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { CHILD_ADD_TOOLS, type ChildAddToolDescriptor } from '../../ui/mcp/McpAddToolsRegistration';
import { CANON_CHILD_ORDER, directChildObjectsTagSequence } from './support/childObjectsCorpus';
import { createAddToolsHarness, resultText } from './support/mcpAddToolsHarness';

/**
 * `allowedOwnerKinds` в `McpAddToolsRegistration.CHILD_ADD_TOOLS` был рукописным
 * параллельным списком владельцев, дублирующим `META_TYPES.childTags` (запрет
 * №2 CLAUDE.md): регистры добавлялись к `add_attribute` вручную, а `add_template`
 * не знал журнал/планы/бизнес-процесс/задачу. Теперь список выводится из
 * реестра, с РОВНО двумя явными исключениями — там, где владельца не
 * выразить через `childTags`:
 *  - `add_attribute` дополнительно принимает `CommonAttribute` (общий реквизит —
 *    сам по себе объект-реквизит, у него нет владельца с тегом `Attribute`);
 *  - `add_column` принимает `TabularSection` (`Column` не входит в `ChildTag`,
 *    владелец колонки — контейнер-табличная часть).
 */

const EXPECTED_EXCEPTIONS: Readonly<Partial<Record<string, readonly MetaKind[]>>> = {
  v8vscedit_add_attribute: ['CommonAttribute'],
  v8vscedit_add_column: ['TabularSection'],
};

/**
 * Независимая от реализации выводимость: виды, у которых `META_TYPES.childTags`
 * содержит тег дескриптора. НЕ импортирует функцию вывода из production —
 * иначе тест сверял бы реализацию саму с собой.
 */
function ownersByChildTags(descriptor: ChildAddToolDescriptor): MetaKind[] {
  return (Object.values(META_TYPES))
    .filter((def) => def.childTags?.includes(descriptor.childTag as ChildTag) === true)
    .map((def) => def.kind);
}

function sorted(kinds: readonly string[]): string[] {
  return [...kinds].sort();
}

suite('MCP add_*: allowedOwnerKinds выводится из META_TYPES (T-A2.13)', () => {
  test('дескрипторов ровно 11 (множество параметризации не сузилось молча)', () => {
    assert.strictEqual(CHILD_ADD_TOOLS.length, 11);
  });

  for (const descriptor of CHILD_ADD_TOOLS) {
    test(`${descriptor.toolName}: владельцы = виды с ${descriptor.childTag} в childTags${EXPECTED_EXCEPTIONS[descriptor.toolName] ? ` + исключение ${(EXPECTED_EXCEPTIONS[descriptor.toolName] ?? []).join(', ')}` : ''}`, () => {
      const expected = [...ownersByChildTags(descriptor), ...(EXPECTED_EXCEPTIONS[descriptor.toolName] ?? [])];
      assert.deepStrictEqual(sorted(descriptor.allowedOwnerKinds), sorted(expected));
    });
  }

  test('исключений из вывода ровно два: add_attribute (CommonAttribute) и add_column (TabularSection)', () => {
    const withException = CHILD_ADD_TOOLS.filter((d) => {
      const derived = new Set<string>(ownersByChildTags(d));
      return d.allowedOwnerKinds.some((kind) => !derived.has(kind));
    });
    assert.deepStrictEqual(withException.map((d) => d.toolName).sort(), ['v8vscedit_add_attribute', 'v8vscedit_add_column']);
    const extraOwners = withException.flatMap((d) => {
      const derived = new Set<string>(ownersByChildTags(d));
      return d.allowedOwnerKinds.filter((kind) => !derived.has(kind));
    });
    assert.deepStrictEqual(sorted(extraOwners), ['CommonAttribute', 'TabularSection']);
  });

  test('после расширения childTags: add_attribute принимает регистры, add_template — журнал, планы, бизнес-процесс и задачу', () => {
    const byName = new Map(CHILD_ADD_TOOLS.map((d) => [d.toolName, d.allowedOwnerKinds]));
    const attribute = byName.get('v8vscedit_add_attribute') ?? [];
    const template = byName.get('v8vscedit_add_template') ?? [];
    for (const kind of ['InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister'] as const) {
      assert.ok(attribute.includes(kind), `add_attribute: нет ${kind}`);
      assert.ok(template.includes(kind), `add_template: нет ${kind}`);
    }
    for (const kind of ['DocumentJournal', 'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes', 'BusinessProcess', 'Task'] as const) {
      assert.ok(template.includes(kind), `add_template: нет ${kind}`);
    }
  });
});

const REGISTERS: readonly MetaKind[] = ['InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister'];
const TEMPLATE_ONLY: readonly MetaKind[] = [
  'DocumentJournal', 'BusinessProcess', 'Task', 'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes',
];

function assertIndicesAscending(kind: string, actual: readonly string[]): void {
  const canon = CANON_CHILD_ORDER[kind];
  const indices = actual.map((tag) => canon.indexOf(tag));
  assert.ok(indices.every((i) => i >= 0), `${kind}: тег вне канона в ${actual.join(',')}`);
  assert.deepStrictEqual(indices, [...indices].sort((a, b) => a - b), `${kind}: порядок ${actual.join(',')} нарушает канон ${canon.join(',')}`);
}

suite('MCP add_*: функциональное добавление на видах с расширенным childTags (T-A2.14)', function () {
  this.timeout(30000);

  for (const kind of REGISTERS) {
    test(`${kind}: add_template + add_attribute (в обратном каноническому порядке вызовов) → успех, well-formed, позиция по канону, повтор не меняет файл`, async () => {
      const h = createAddToolsHarness();
      const owner = h.createOwner(kind, 'Тест');
      const template = await h.call('v8vscedit_add_template', { path: owner.path, name: 'Макет1', templateType: 'Табличный документ' });
      assert.ok(!template.isError, resultText(template));
      const attribute = await h.call('v8vscedit_add_attribute', { path: owner.path, name: 'Реквизит1' });
      assert.ok(!attribute.isError, resultText(attribute));

      const xml = fs.readFileSync(owner.xmlPath, 'utf-8');
      assert.strictEqual(XMLValidator.validate(xml), true, 'XML владельца должен остаться well-formed');
      const tags = directChildObjectsTagSequence(xml, kind) ?? [];
      assert.deepStrictEqual(tags, ['Attribute', 'Template'], `${kind}: реквизит обязан стоять ПЕРЕД макетом независимо от порядка вызовов`);
      assertIndicesAscending(kind, tags);

      // Повтор с тем же именем — отказ «уже существует», файл байт-в-байт прежний.
      const before = fs.readFileSync(owner.xmlPath);
      for (const [tool, args] of [
        ['v8vscedit_add_template', { path: owner.path, name: 'Макет1', templateType: 'Табличный документ' }],
        ['v8vscedit_add_attribute', { path: owner.path, name: 'Реквизит1' }],
      ] as const) {
        const again = await h.call(tool, { ...args });
        const parsed = JSON.parse(resultText(again)) as { success: boolean; errors: string[] };
        assert.strictEqual(parsed.success, false, `${tool}: повтор обязан быть отклонён`);
        assert.ok(parsed.errors.some((e) => e.includes('уже существует')), `${tool}: ${JSON.stringify(parsed.errors)}`);
      }
      assert.ok(fs.readFileSync(owner.xmlPath).equals(before), `${kind}: повторный вызов изменил файл`);
    });
  }

  for (const kind of TEMPLATE_ONLY) {
    test(`${kind}: add_template + add_command (в обратном каноническому порядке) → успех, well-formed, макет перед командой, повтор не меняет файл`, async () => {
      const h = createAddToolsHarness();
      const owner = h.createOwner(kind, 'Тест');
      const command = await h.call('v8vscedit_add_command', { path: owner.path, name: 'Команда1' });
      assert.ok(!command.isError, resultText(command));
      const template = await h.call('v8vscedit_add_template', { path: owner.path, name: 'Макет1', templateType: 'Табличный документ' });
      assert.ok(!template.isError, resultText(template));

      const xml = fs.readFileSync(owner.xmlPath, 'utf-8');
      assert.strictEqual(XMLValidator.validate(xml), true);
      const tags = directChildObjectsTagSequence(xml, kind) ?? [];
      assert.deepStrictEqual(tags, ['Template', 'Command']);
      assertIndicesAscending(kind, tags);

      const before = fs.readFileSync(owner.xmlPath);
      const again = await h.call('v8vscedit_add_template', { path: owner.path, name: 'Макет1', templateType: 'Табличный документ' });
      assert.strictEqual((JSON.parse(resultText(again)) as { success: boolean }).success, false);
      assert.ok(fs.readFileSync(owner.xmlPath).equals(before), `${kind}: повторный вызов изменил файл`);
    });
  }
});

suite('MCP add_*: понятный отказ для несовместимого владельца (T-A2.15)', function () {
  this.timeout(30000);

  const negatives: readonly (readonly [string, MetaKind, string])[] = [
    ['v8vscedit_add_dimension', 'Catalog', 'измерение'],
    ['v8vscedit_add_attribute', 'Enum', 'реквизит'],
    ['v8vscedit_add_template', 'Constant', 'макет'],
  ];
  for (const [tool, kind, russianLabel] of negatives) {
    test(`${tool} на ${kind}: isError, сообщение называет элемент и вид владельца, файл не тронут`, async () => {
      const h = createAddToolsHarness();
      const owner = h.createOwner(kind, 'Тест');
      const before = fs.readFileSync(owner.xmlPath);
      const result = await h.call(tool, { path: owner.path, name: 'Х1', templateType: 'Табличный документ' });
      assert.strictEqual(result.isError, true);
      const text = resultText(result);
      assert.ok(text.includes('нельзя добавить'), text);
      assert.ok(text.includes(russianLabel), `нет названия элемента «${russianLabel}»: ${text}`);
      assert.ok(text.includes(META_TYPES[kind].label), `нет названия вида владельца «${META_TYPES[kind].label}»: ${text}`);
      assert.ok(fs.readFileSync(owner.xmlPath).equals(before), 'при отказе файл владельца не должен меняться');
    });
  }
});
