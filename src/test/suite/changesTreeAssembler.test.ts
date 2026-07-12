/**
 * ВЕХА 2, доработка: дерево панели «Изменения метаданных» внутри каждой секции
 * (staged/unstaged/other) обязано повторять НАВИГАТОРНУЮ иерархию основного
 * дерева конфигурации (`Общие → Общие модули → <модуль>`, `Справочники →
 * <Имя> → <часть>`), а не быть плоским списком объектов, как раньше
 * (см. известное ограничение «Глубина дерева» в `docs/git-metadata-changes.md`).
 *
 * `changesTreeAssembler.assembleNavigatorSection` — ЧИСТАЯ (без `vscode`)
 * функция: сворачивает набор `ChangeChain` (путь предков + уже готовый лист)
 * в дерево `ChangesSectionDto`, дедуплицируя ОБЩИЕ цепочки предков по `key`
 * (два изменённых справочника делят один узел-коллекцию «Справочники»).
 * Резолвинг реального навигаторного дерева (`MetadataTreeProvider`) и
 * синтез цепочки для удалённых объектов — забота `MetadataChangesViewProvider`
 * (проверяется интеграционно в `metadataChangesViewProvider.test.ts`); здесь
 * же — чистая структурная логика сборки/дедупа над абстрактным `ChangeChain`,
 * поэтому фабрикованные литералы уместны (это не git-модель, а форма дерева).
 */
import * as assert from 'assert';
import {
  assembleNavigatorSection,
  synthesizeAncestors,
  type ChangeChain,
  type NavAncestorDto,
} from '../../ui/views/changes/changesTreeAssembler';
import type { IconDto, TreeNodeDto } from '../../ui/views/changes/changesDtoBuilder';
import { META_TYPES } from '../../domain/MetaTypes';
import type { ObjectChangeGroup } from '../../infra/git/MetadataChangeAggregator';
import type { NodeKind } from '../../ui/tree/TreeNode';

/**
 * Зеркало приватной `NODE_ID_RE` из `changesDtoBuilder.ts` (та же схема
 * `<side>#<groupIndex>[.<partIndex>]`/`other#<rawIndex>`, которую разбирает
 * `resolveChangeAddress`). Не экспортируется из production-кода, поэтому здесь
 * — независимая копия ТОЛЬКО для проверки, что синтетические id group-узлов
 * гарантированно НЕ совпадают с форматом actionable-узла (значит, действие на
 * них — безопасный no-op в `resolveChangeAddress`).
 */
const ACTIONABLE_NODE_ID_RE = /^(staged|unstaged|other)#(\d+)(?:\.(\d+))?$/;

function leaf(id: string, label: string): TreeNodeDto {
  return {
    id,
    key: id,
    label,
    kind: 'changeObject',
    hasChildren: true,
    loaded: true,
    children: [
      {
        id: `${id}.0`,
        key: `${id}.0`,
        label: 'Свойства',
        kind: 'changePart',
        hasChildren: false,
        loaded: true,
        actions: [],
        gitStatus: 'modified',
      },
    ],
    actions: [],
    gitStatus: 'modified',
  };
}

function ancestor(key: string, label: string): NavAncestorDto {
  return { key, label };
}

/** Собирает плоский список ВСЕХ узлов дерева (рекурсивно) для проверок уникальности id. */
function collectAll(nodes: readonly TreeNodeDto[]): TreeNodeDto[] {
  const result: TreeNodeDto[] = [];
  const visit = (list: readonly TreeNodeDto[]): void => {
    for (const node of list) {
      result.push(node);
      if (node.children) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return result;
}

/** Ищет узел с данной меткой где угодно в дереве (по всем уровням). */
function findByLabel(nodes: readonly TreeNodeDto[], label: string): TreeNodeDto | undefined {
  return collectAll(nodes).find((n) => n.label === label);
}

suite('changesTreeAssembler — assembleNavigatorSection сворачивает цепочки предков в дерево секции', () => {
  test('пустой список цепочек → пустая секция (nodes: [])', () => {
    const section = assembleNavigatorSection('staged', [], 'Проиндексировано');

    assert.strictEqual(section.kind, 'staged');
    assert.strictEqual(section.label, 'Проиндексировано');
    assert.deepStrictEqual(section.nodes, []);
  });

  test('одиночная цепочка → линейная ветвь root → … → leaf без лишних узлов', () => {
    const chain: ChangeChain = {
      ancestors: [ancestor('nav:common', 'Общие'), ancestor('nav:CommonModule', 'Общие модули')],
      leaf: leaf('unstaged#0', 'ОбщиеМодули.GoogleПереводчик'),
    };

    const section = assembleNavigatorSection('unstaged', [chain], 'Не проиндексировано');

    assert.strictEqual(section.nodes.length, 1, 'единственная цепочка даёт единственный корневой узел');
    const common = section.nodes[0];
    assert.strictEqual(common.label, 'Общие');
    assert.strictEqual(common.children?.length, 1, 'на каждом уровне ветки — ровно один дочерний узел');
    // `common.children` уже сужен предыдущим `assert.strictEqual` до непустого
    // массива (length===1), поэтому дальше по цепочке `?.` избыточен.
    const commonModules = common.children[0];
    assert.strictEqual(commonModules.label, 'Общие модули');
    assert.strictEqual(commonModules.children?.length, 1);
    const leafNode = commonModules.children[0];
    assert.strictEqual(leafNode.id, 'unstaged#0', 'лист вставлен как есть, id не переписан');
    assert.strictEqual(leafNode.label, 'ОбщиеМодули.GoogleПереводчик');
  });

  test('две цепочки с общим предком (одинаковый key) → один общий group-узел с двумя листьями (дедуп)', () => {
    const shared = ancestor('nav:top:Catalog', 'Справочники');
    const chainA: ChangeChain = { ancestors: [shared], leaf: leaf('unstaged#0', 'Справочники.ПричиныВозврата') };
    const chainB: ChangeChain = { ancestors: [shared], leaf: leaf('unstaged#1', 'Справочники.РолиКонтактныхЛиц') };

    const section = assembleNavigatorSection('unstaged', [chainA, chainB], 'Не проиндексировано');

    assert.strictEqual(section.nodes.length, 1, 'два справочника обязаны делить ОДИН узел-коллекцию «Справочники»');
    const catalogsNode = section.nodes[0];
    assert.strictEqual(catalogsNode.label, 'Справочники');
    assert.strictEqual(catalogsNode.children?.length, 2, 'под общим предком — оба листа, а не один');
    const ids = (catalogsNode.children ?? []).map((n: TreeNodeDto) => n.id);
    assert.deepStrictEqual(new Set(ids), new Set(['unstaged#0', 'unstaged#1']));
  });

  test('две цепочки с разными предками (разные key) → отдельные, НЕ слитые ветви', () => {
    const chainA: ChangeChain = {
      ancestors: [ancestor('nav:common', 'Общие'), ancestor('nav:CommonModule', 'Общие модули')],
      leaf: leaf('staged#0', 'ОбщиеМодули.GoogleПереводчик'),
    };
    const chainB: ChangeChain = {
      ancestors: [ancestor('nav:top:Catalog', 'Справочники')],
      leaf: leaf('staged#1', 'Справочники.ПричиныВозврата'),
    };

    const section = assembleNavigatorSection('staged', [chainA, chainB], 'Проиндексировано');

    assert.strictEqual(section.nodes.length, 2, 'разные корневые предки — разные ветви, слияния быть не должно');
    const labels = section.nodes.map((n: TreeNodeDto) => n.label).sort();
    assert.deepStrictEqual(labels, ['Общие', 'Справочники']);
  });

  test('общий префикс, расхождение на втором уровне → общий верхний узел, две ветви под ним', () => {
    const commonRoot = ancestor('nav:common', 'Общие');
    const chainModule: ChangeChain = {
      ancestors: [commonRoot, ancestor('nav:CommonModule', 'Общие модули')],
      leaf: leaf('unstaged#0', 'ОбщиеМодули.GoogleПереводчик'),
    };
    const chainRole: ChangeChain = {
      ancestors: [commonRoot, ancestor('nav:Role', 'Роли')],
      leaf: leaf('unstaged#1', 'Роли.ПолныеПрава'),
    };

    const section = assembleNavigatorSection('unstaged', [chainModule, chainRole], 'Не проиндексировано');

    assert.strictEqual(section.nodes.length, 1, 'общий предок первого уровня («Общие») должен быть один');
    const common = section.nodes[0];
    assert.strictEqual(common.children?.length, 2, 'дальше пути расходятся — два разных дочерних узла');
    const childLabels = (common.children ?? []).map((n: TreeNodeDto) => n.label).sort();
    assert.deepStrictEqual(childLabels, ['Общие модули', 'Роли']);
  });

  test('все group-узлы получают loaded:true/hasChildren:true, их id уникальны и НЕ совпадают со схемой actionable-узла', () => {
    const chainA: ChangeChain = {
      ancestors: [ancestor('nav:common', 'Общие'), ancestor('nav:CommonModule', 'Общие модули')],
      leaf: leaf('staged#0', 'ОбщиеМодули.GoogleПереводчик'),
    };
    const chainB: ChangeChain = {
      ancestors: [ancestor('nav:top:Catalog', 'Справочники')],
      leaf: leaf('staged#1', 'Справочники.ПричиныВозврата'),
    };

    const section = assembleNavigatorSection('staged', [chainA, chainB], 'Проиндексировано');
    const all = collectAll(section.nodes);
    const groupNodes = all.filter((n) => n.kind !== 'changeObject' && n.kind !== 'changePart');

    assert.ok(groupNodes.length >= 3, `ожидались group-узлы «Общие»/«Общие модули»/«Справочники», получено: ${JSON.stringify(groupNodes.map((n) => n.label))}`);
    for (const node of groupNodes) {
      assert.strictEqual(node.loaded, true, `group-узел «${node.label}» обязан быть loaded`);
      assert.strictEqual(node.hasChildren, true, `group-узел «${node.label}» обязан иметь hasChildren:true`);
      assert.ok(
        !ACTIONABLE_NODE_ID_RE.test(node.id),
        `id group-узла «${node.label}» (${node.id}) не должен совпадать со схемой actionable-узла — иначе stage/discard по нему случайно затронет чужой объект`
      );
    }

    const allIds = all.map((n) => n.id);
    assert.strictEqual(new Set(allIds).size, allIds.length, `id всех узлов дерева секции должны быть уникальны, получено: ${allIds.join(', ')}`);
  });

  test('лист сохраняет свой id/детей без изменений — сборщик не трогает поддерево, пришедшее из ChangeChain.leaf', () => {
    const chain: ChangeChain = {
      ancestors: [ancestor('nav:top:Catalog', 'Справочники')],
      leaf: leaf('unstaged#0', 'Справочники.ПричиныВозврата'),
    };

    const section = assembleNavigatorSection('unstaged', [chain], 'Не проиндексировано');

    const found = findByLabel(section.nodes, 'Справочники.ПричиныВозврата');
    assert.ok(found);
    assert.strictEqual(found.id, 'unstaged#0');
    assert.strictEqual(found.gitStatus, 'modified');
    assert.strictEqual(found.children?.length, 1);
    assert.strictEqual(found.children[0].id, 'unstaged#0.0', 'дочерняя часть листа (Свойства) должна дойти без переименования id');
  });
});

/**
 * ВЫНОС ИЗ ПРОВАЙДЕРА: `synthesizeAncestors` (Слой 3a, задача B) переезжает
 * из приватного метода `MetadataChangesViewProvider.synthesizeAncestors` в
 * ЧИСТУЮ функцию модуля — синтез цепочки предков для объекта, которого нет в
 * навигаторном дереве (удалённый объект метаданных). Поведение ДО выноса
 * зафиксировано characterization-тестами на реальной фикстуре в
 * `metadataChangesViewProvider.test.ts` («удалённый объект без остатка на
 * диске» / «удалённый ОБЩИЙ модуль» — group==='common' даёт промежуточную
 * обёртку «Общие» перед коллекцией, group!=='common' — только сама
 * коллекция); здесь — тот же контракт, но на уровне чистой функции с
 * инъекцией `buildIcon` вместо `vscode`/webview-URI.
 */
suite('changesTreeAssembler — synthesizeAncestors синтезирует предков удалённого объекта из META_TYPES', () => {
  function group(rootKind: ObjectChangeGroup['rootKind'], rootName: string): ObjectChangeGroup {
    return {
      canonicalPath: `${rootKind}.${rootName}`,
      rootKind,
      rootName,
      configRoot: '/fake/config/root',
      parts: [],
      aggregateStatus: 'D',
    };
  }

  function fakeBuildIcon(
    calls: { kind: NodeKind; ownership: 'OWN' | 'BORROWED' | undefined }[],
  ): (kind: NodeKind, ownership?: 'OWN' | 'BORROWED') => IconDto {
    return (kind, ownership) => {
      calls.push({ kind, ownership });
      return { kind: 'metadata', name: kind };
    };
  }

  test('common-объект (CommonModule): две записи — обёртка «group-common» ПЕРЕД коллекцией «Общие модули»', () => {
    const calls: { kind: NodeKind; ownership: 'OWN' | 'BORROWED' | undefined }[] = [];

    const ancestors = synthesizeAncestors(group('CommonModule', 'GoogleПереводчик'), fakeBuildIcon(calls));

    assert.strictEqual(ancestors.length, 2, 'у типа из группы "common" обязана быть промежуточная обёртка «Общие»');
    assert.strictEqual(ancestors[0].key, 'syn~group-common');
    assert.strictEqual(ancestors[0].label, META_TYPES['group-common'].pluralLabel);
    assert.strictEqual(ancestors[1].key, 'syn~CommonModule');
    assert.strictEqual(ancestors[1].label, META_TYPES.CommonModule.pluralLabel);
    assert.deepStrictEqual(
      calls.map((c) => c.kind),
      ['group-common', 'CommonModule'],
      'buildIcon обязан быть вызван для ОБЕИХ синтезированных записей, в порядке group-common → rootKind'
    );
  });

  test('не-common объект (Catalog): одна запись-коллекция, без промежуточной обёртки', () => {
    const calls: { kind: NodeKind; ownership: 'OWN' | 'BORROWED' | undefined }[] = [];

    const ancestors = synthesizeAncestors(group('Catalog', 'ПричиныВозврата'), fakeBuildIcon(calls));

    assert.strictEqual(ancestors.length, 1, 'у типа группы "top" обёртки не должно быть — только сама коллекция');
    assert.strictEqual(ancestors[0].key, 'syn~Catalog');
    assert.strictEqual(ancestors[0].label, META_TYPES.Catalog.pluralLabel);
    assert.deepStrictEqual(calls.map((c) => c.kind), ['Catalog']);
  });

  test('иконка каждой синтезированной записи — результат buildIcon для её собственного kind', () => {
    const ancestors = synthesizeAncestors(
      group('CommonModule', 'GoogleПереводчик'),
      (kind: NodeKind): IconDto => ({ kind: 'metadata', name: kind }),
    );

    assert.deepStrictEqual(ancestors[0].icon, { kind: 'metadata', name: 'group-common' });
    assert.deepStrictEqual(ancestors[1].icon, { kind: 'metadata', name: 'CommonModule' });
  });
});
