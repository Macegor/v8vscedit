import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { buildMetadataCacheSnapshot, type MetadataCacheNode } from '../../infra/cache/MetadataCache';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';

/**
 * Дерево навигатора (`MetadataCache`) для десяти видов с ранее неполным
 * `META_TYPES.childTags`. Группы дерева строятся именно по `childTags`
 * («что расширение показывает»), поэтому реквизиты регистров и макеты
 * журнала/планов/бизнес-процесса/задачи, созданные через `add_*`, раньше
 * оставались в XML невидимыми: группы «Реквизиты»/«Макеты» у этих видов не
 * существовали.
 */

const A2_KINDS: readonly MetaKind[] = [
  'InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister',
  'DocumentJournal', 'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes',
  'BusinessProcess', 'Task',
];
const A2_TAGS = ['Attribute', 'Template'] as const;

/**
 * Набор тегов проверяется ПО ВИДУ, а не единым списком: у журнала документов
 * реквизитов не бывает — платформа выгружает у него графы (`Column`), и строка
 * канона сериализации journal'а (`CHILD_OBJECTS_ORDER`) реквизит не содержит.
 * Требовать здесь `Attribute` означало бы противоречить сразу трём зелёным
 * проверкам этой же задачи: двусторонней сшивке `childTags ↔ CHILD_OBJECTS_ORDER`,
 * негативу «реквизит у журнала даёт disallowed-child» и выводу владельцев
 * `add_attribute`. Поэтому исключение заводится ЯВНОЙ записью, а не выводится
 * из `META_TYPES` — вывод из реестра сделал бы тест тавтологией.
 */
const A2_TAGS_BY_KIND: Partial<Record<MetaKind, readonly (typeof A2_TAGS)[number][]>> = {
  DocumentJournal: ['Template'],
};

function tagsOf(kind: MetaKind): readonly (typeof A2_TAGS)[number][] {
  return A2_TAGS_BY_KIND[kind] ?? A2_TAGS;
}

function newConfigRoot(): string {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-childtags-tree-'));
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject version="2.21">',
    '\t<Configuration>',
    '\t\t<Properties><Name>Тест</Name><Synonym/></Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
    '',
  ].join('\n'), 'utf-8');
  return configRoot;
}

function findNode(node: MetadataCacheNode, predicate: (n: MetadataCacheNode) => boolean): MetadataCacheNode | undefined {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children) {
    const found = findNode(child, predicate);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Имена групп-детей объекта без `StandardAttribute`: эта группа появляется только при наличии стандартных реквизитов и в проверку порядка не входит. */
function groupNames(owner: MetadataCacheNode): string[] {
  return owner.children.filter((c) => c.type === 'group-type' && c.name !== 'StandardAttribute').map((c) => c.name);
}

suite('Дерево навигатора: группы для расширенного childTags десяти видов (T-A2.12)', () => {
  for (const kind of A2_KINDS) {
    test(`${kind}: группы «Реквизиты»/«Макеты» есть, в порядке childTags, созданные элементы видны в своих группах`, () => {
      const configRoot = newConfigRoot();
      const creator = new MetadataXmlCreator();
      const name = `${kind}Полный`;
      assert.strictEqual(creator.addRootObject({ configRoot, kind, name }).success, true);
      const ownerXml = path.join(configRoot, (META_TYPES[kind].folder ?? ''), `${name}.xml`);
      const leaves: Record<(typeof A2_TAGS)[number], string> = { Attribute: 'Реквизит1', Template: 'Макет1' };
      for (const tag of tagsOf(kind)) {
        const result = creator.addChildElement({
          ownerObjectXmlPath: ownerXml,
          childTag: tag,
          name: leaves[tag],
          ...(tag === 'Template' ? { templateType: 'SpreadsheetDocument' as const } : {}),
        });
        assert.strictEqual(result.success, true, `${kind}.${tag}: ${result.errors.join('; ')}`);
      }

      const snapshot = buildMetadataCacheSnapshot(`test-childtags-${kind}`, { rootPath: configRoot, kind: 'cf' });
      const owner: MetadataCacheNode | undefined = findNode(snapshot.root, (n) => n.type === kind && n.name === name);
      assert.ok(owner, `${kind}: объект не найден в дереве`);

      const expectedGroups = (META_TYPES[kind].childTags ?? []).filter((t: ChildTag) => t !== 'StandardAttribute');
      assert.deepStrictEqual(groupNames(owner), expectedGroups, 'порядок групп обязан совпадать с META_TYPES.childTags');
      for (const tag of tagsOf(kind)) {
        const group: MetadataCacheNode | undefined = owner.children.find((c: MetadataCacheNode) => c.type === 'group-type' && c.name === tag);
        assert.ok(group, `${kind}: нет группы ${tag} — созданный ${tag} невидим в дереве`);
        assert.deepStrictEqual(group.children.map((c) => c.name), [leaves[tag]], `${kind}: содержимое группы ${tag}`);
        assert.strictEqual(group.addMetadataTarget?.kind, 'child', `${kind}: из группы ${tag} должно быть можно добавлять`);
      }
    });

    test(`${kind}: объект без дочерних элементов — группы Attribute/Template присутствуют и пусты (пустые группы ничего не ломают)`, () => {
      const configRoot = newConfigRoot();
      const name = `${kind}Пустой`;
      assert.strictEqual(new MetadataXmlCreator().addRootObject({ configRoot, kind, name }).success, true);
      const snapshot = buildMetadataCacheSnapshot(`test-childtags-empty-${kind}`, { rootPath: configRoot, kind: 'cf' });
      const owner: MetadataCacheNode | undefined = findNode(snapshot.root, (n) => n.type === kind && n.name === name);
      assert.ok(owner);
      for (const tag of tagsOf(kind)) {
        const group: MetadataCacheNode | undefined = owner.children.find((c: MetadataCacheNode) => c.type === 'group-type' && c.name === tag);
        assert.ok(group, `${kind}: нет группы ${tag}`);
        assert.deepStrictEqual(group.children, []);
      }
    });
  }
});
