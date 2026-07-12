import type { ChangesSectionDto, IconDto, TreeNodeDto } from './changesDtoBuilder';

/**
 * Чистая (без `vscode`) сборка дерева секции «Изменения метаданных» по
 * навигаторной иерархии основного дерева конфигурации.
 *
 * Резолвинг реального навигаторного дерева (`MetadataTreeProvider`) и синтез
 * цепочки для удалённых объектов — забота `MetadataChangesViewProvider`; сюда
 * приходят уже готовые {@link ChangeChain} (путь предков + готовый лист), а
 * задача сборщика — свернуть ОБЩИЕ цепочки предков по `key` в общий group-узел
 * (два изменённых справочника делят один узел-коллекцию «Справочники»).
 */

/** Один предок навигаторной ветви (узел-коллекция/группа): ключ дедупа, метка, иконка. */
export interface NavAncestorDto {
  readonly key: string;
  readonly label: string;
  readonly icon?: IconDto;
}

/** Путь предков + уже построенный лист (объектный узел) одной изменённой единицы. */
export interface ChangeChain {
  readonly ancestors: readonly NavAncestorDto[];
  readonly leaf: TreeNodeDto;
}

/** Внутренний билдер group-узла с изменяемым списком детей. */
interface GroupBuilder {
  readonly node: TreeNodeDto;
  readonly children: TreeNodeDto[];
}

/**
 * Сворачивает набор {@link ChangeChain} в дерево {@link ChangesSectionDto},
 * дедуплицируя общие цепочки предков по `key`. Лист вставляется без изменений.
 */
export function assembleNavigatorSection(
  side: 'staged' | 'unstaged',
  chains: readonly ChangeChain[],
  sectionLabel: string,
): ChangesSectionDto {
  const roots: TreeNodeDto[] = [];
  // Ключ — накопленный путь ключей предков от корня: одинаковая
  // последовательность предков схлопывается в один и тот же group-узел.
  const byKeyPath = new Map<string, GroupBuilder>();

  for (const chain of chains) {
    let siblings = roots;
    let keyPath = '';
    for (const ancestor of chain.ancestors) {
      keyPath = keyPath ? `${keyPath}~${ancestor.key}` : ancestor.key;
      let builder = byKeyPath.get(keyPath);
      if (!builder) {
        const children: TreeNodeDto[] = [];
        const id = `${side}#nav#${keyPath}`;
        const node: TreeNodeDto = {
          id,
          key: id,
          label: ancestor.label,
          icon: ancestor.icon,
          kind: 'changeGroup',
          hasChildren: true,
          loaded: true,
          children,
          actions: [],
        };
        builder = { node, children };
        byKeyPath.set(keyPath, builder);
        siblings.push(node);
      }
      siblings = builder.children;
    }
    siblings.push(chain.leaf);
  }

  return { kind: side, label: sectionLabel, nodes: roots };
}
