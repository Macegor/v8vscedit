import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveChildFormXml } from '../../infra/fs/MetaPathResolver';
import { isFormRootXml } from '../../infra/xml/form/FormShared';
import type { McpMetadataPathService } from '../../ui/mcp/McpMetadataPathService';
import { resolveFormXmlByCanonical, resolveObjectFormNodeByCanonical } from '../../ui/mcp/McpPathResolvers';
import { MetadataNode, type TreeNodeModel } from '../../ui/tree/TreeNode';
import { createFormMcpFixture, type FormMcpFixture } from './support/mcpFormToolsHarness';

/**
 * T3. `resolveFormXmlByCanonical` возвращает ТЕЛО формы (не дескриптор и не XML объекта),
 * `resolveObjectFormNodeByCanonical` — единая точка правды «что такое узел формы объекта».
 *
 * Дерево — настоящее (`MetadataTreeProvider` над временной выгрузкой), поэтому узлы такие же,
 * какие видит ИИ-агент. Стабы `paths` нужны лишь для двух защитных веток, состояния которых
 * настоящее дерево не порождает (форма без владельца, общая форма без XML).
 */

/** `resolveNode` возвращает заданный узел: настоящее дерево не строит узлов с дефектным контекстом. */
function stubPaths(node: MetadataNode): McpMetadataPathService {
  return { resolveNode: () => node } as unknown as McpMetadataPathService;
}

function node(model: TreeNodeModel): MetadataNode {
  return new MetadataNode(model, vscode.TreeItemCollapsibleState.None);
}

suite('McpPathResolvers: формы (T3)', () => {
  let fixture: FormMcpFixture;

  suiteSetup(function () {
    this.timeout(30_000);
    fixture = createFormMcpFixture();
  });
  suiteTeardown(() => {
    fixture.dispose();
  });

  const formPath = (): string => `Справочники.${fixture.catalogName}.Форма.${fixture.catalogFormName}`;
  const commonFormPath = (): string => `ОбщиеФормы.${fixture.commonFormName}`;

  // Каждый nodeKind, не являющийся формой, — отдельный кейс: единичный представитель
  // не поймал бы ветку, которая перепутает соседний вид узла с формой.
  const nonFormCases = (): readonly { readonly kind: string; readonly canonical: string }[] => [
    { kind: 'Catalog', canonical: `Справочники.${fixture.catalogName}` },
    { kind: 'Attribute', canonical: `Справочники.${fixture.catalogName}.${fixture.attributeName}` },
    { kind: 'Template', canonical: `Справочники.${fixture.catalogName}.Макет.${fixture.templateName}` },
    { kind: 'Subsystem', canonical: `Подсистема.${fixture.subsystemName}` },
    { kind: 'configuration', canonical: 'Конфигурация' },
  ];
  const NON_FORM_KINDS = ['Catalog', 'Attribute', 'Template', 'Subsystem', 'configuration'];

  suite('resolveFormXmlByCanonical', () => {
    test('nodeKind Form → тело формы объекта Catalogs/X/Forms/Y/Ext/Form.xml', () => {
      const result = resolveFormXmlByCanonical(fixture.harness.paths, formPath());
      assert.strictEqual(result, fixture.catalogFormBody);
      assert.ok(fs.existsSync(result));
      assert.ok(isFormRootXml(fs.readFileSync(result, 'utf-8')), 'по результату лежит настоящая форма, а не XML объекта');
    });

    test('nodeKind CommonForm → тело общей формы CommonForms/X/Ext/Form.xml', () => {
      const result = resolveFormXmlByCanonical(fixture.harness.paths, commonFormPath());
      assert.strictEqual(result, fixture.commonFormBody);
      assert.ok(isFormRootXml(fs.readFileSync(result, 'utf-8')));
    });

    test('результат никогда не совпадает ни с XML объекта, ни с дескриптором формы (регресс: правка формы поверх XML объекта)', () => {
      for (const canonical of [formPath(), commonFormPath()]) {
        const result = resolveFormXmlByCanonical(fixture.harness.paths, canonical);
        for (const forbidden of [fixture.catalogXml, fixture.catalogFormDescriptor, fixture.commonFormXml]) {
          assert.notStrictEqual(result, forbidden, canonical);
        }
        assert.strictEqual(path.basename(result), 'Form.xml');
      }
    });

    test('параметр configuration: имя конфигурации принимается, неизвестное — ошибка', () => {
      assert.strictEqual(
        resolveFormXmlByCanonical(fixture.harness.paths, formPath(), fixture.configName),
        fixture.catalogFormBody,
      );
      assert.throws(
        () => resolveFormXmlByCanonical(fixture.harness.paths, formPath(), 'НетТакойКонфигурации'),
        /не найдена/,
      );
    });

    test('форма, которой нет в дереве, — ошибка резолва пути (а не путь к несуществующему файлу)', () => {
      assert.throws(
        () => resolveFormXmlByCanonical(fixture.harness.paths, `Справочники.${fixture.catalogName}.Форма.НетТакой`),
        /не найден/,
      );
    });

    for (const kind of NON_FORM_KINDS) {
      test(`nodeKind ${kind} → ошибка про форму`, () => {
        const c = nonFormCases().find((item) => item.kind === kind);
        assert.ok(c);
        assert.strictEqual(fixture.harness.paths.resolveNode(c.canonical).nodeKind, kind, 'предусловие: узел найден и имеет ожидаемый вид');
        assert.throws(() => resolveFormXmlByCanonical(fixture.harness.paths, c.canonical), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(c.canonical), error.message);
          assert.match(error.message, /форм/i);
          assert.doesNotMatch(error.message, /не найден/, 'узел найден — ошибка именно про вид узла');
          return true;
        });
      });
    }

    test('nodeKind Form без metaContext.ownerObjectXmlPath → отдельная ошибка про объект-владельца', () => {
      const orphan = node({ label: 'Ф', nodeKind: 'Form', xmlPath: fixture.catalogXml });
      assert.throws(() => resolveFormXmlByCanonical(stubPaths(orphan), 'Справочники.Х.Форма.Ф'), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('Справочники.Х.Форма.Ф'), error.message);
        assert.match(error.message, /владел|owner/i);
        return true;
      });
    });

    test('nodeKind Form с metaContext без ownerObjectXmlPath → та же ошибка про владельца', () => {
      const orphan = node({
        label: 'Ф', nodeKind: 'Form', xmlPath: fixture.catalogXml, metaContext: { rootMetaKind: 'Catalog' },
      });
      assert.throws(() => resolveFormXmlByCanonical(stubPaths(orphan), 'Справочники.Х.Форма.Ф'), /владел|owner/i);
    });

    test('nodeKind CommonForm без xmlPath → ошибка', () => {
      const withoutXml = node({ label: 'Ф', nodeKind: 'CommonForm' });
      assert.throws(() => resolveFormXmlByCanonical(stubPaths(withoutXml), 'ОбщиеФормы.Ф'), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes('ОбщиеФормы.Ф'), error.message);
        assert.match(error.message, /XML/);
        return true;
      });
    });
  });

  suite('resolveObjectFormNodeByCanonical', () => {
    test('nodeKind Form → { node, ownerObjectXmlPath, formName } — ровно эти три поля', () => {
      const result = resolveObjectFormNodeByCanonical(fixture.harness.paths, formPath());
      // Узел возвращается вместе с путями, чтобы вызывающий не резолвил его вторично ради
      // проверки блокировки; смысловая часть та же — владелец и имя формы.
      assert.deepStrictEqual(Object.keys(result).sort(), ['formName', 'node', 'ownerObjectXmlPath']);
      assert.strictEqual(result.ownerObjectXmlPath, fixture.catalogXml);
      assert.strictEqual(result.formName, fixture.catalogFormName);
      assert.strictEqual(result.node.nodeKind, 'Form');
      assert.strictEqual(result.node.textLabel, fixture.catalogFormName);
      assert.strictEqual(result.node.metaContext?.ownerObjectXmlPath, fixture.catalogXml);
    });

    test('согласована с resolveFormXmlByCanonical: тело формы = resolveChildFormXml(владелец, имя)', () => {
      const { ownerObjectXmlPath, formName } = resolveObjectFormNodeByCanonical(fixture.harness.paths, formPath());
      assert.strictEqual(
        resolveChildFormXml(ownerObjectXmlPath, formName),
        resolveFormXmlByCanonical(fixture.harness.paths, formPath()),
      );
    });

    test('параметр configuration', () => {
      assert.strictEqual(
        resolveObjectFormNodeByCanonical(fixture.harness.paths, formPath(), fixture.configName).formName,
        fixture.catalogFormName,
      );
    });

    test('общая форма — не форма объекта: отбивается (remove_form не должен удалять общие формы)', () => {
      assert.throws(() => resolveObjectFormNodeByCanonical(fixture.harness.paths, commonFormPath()), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(commonFormPath()), error.message);
        assert.match(error.message, /форм/i);
        return true;
      });
    });

    for (const kind of NON_FORM_KINDS) {
      test(`nodeKind ${kind} → ошибка про форму объекта`, () => {
        const c = nonFormCases().find((item) => item.kind === kind);
        assert.ok(c);
        assert.throws(() => resolveObjectFormNodeByCanonical(fixture.harness.paths, c.canonical), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(c.canonical), error.message);
          assert.match(error.message, /форм/i);
          return true;
        });
      });
    }

    test('Form без ownerObjectXmlPath → ошибка, называющая путь (нечем определить владельца формы)', () => {
      const orphan = node({ label: 'Ф', nodeKind: 'Form', xmlPath: fixture.catalogXml });
      assert.throws(
        () => resolveObjectFormNodeByCanonical(stubPaths(orphan), 'Справочники.Х.Форма.Ф'),
        (error: unknown) => error instanceof Error && error.message.includes('Справочники.Х.Форма.Ф'),
      );
    });
  });
});
