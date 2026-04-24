import { MetaKind, getMetaLabel } from '../../domain/MetaTypes';

/**
 * Тип узла дерева совпадает с доменным идентификатором типа метаданных.
 * Служебные узлы дерева тоже описаны в `META_TYPES`.
 */
export type NodeKind = MetaKind;

/**
 * Контекст дочернего узла, который нужен общим обработчикам свойств.
 */
export interface MetaTreeNodeContext {
  /** Тип корневого объекта в ветке дерева */
  rootMetaKind: NodeKind;
  /** Имя табличной части для колонки */
  tabularSectionName?: string;
  /** XML корневого объекта, если текущий узел ссылается на вложенный файл */
  ownerObjectXmlPath?: string;
}

/**
 * POJO-модель узла дерева без зависимости от vscode API.
 */
export interface TreeNodeModel {
  label: string;
  nodeKind: NodeKind;
  xmlPath?: string;
  childrenLoader?: () => import('./TreeNode').MetadataNode[];
  ownershipTag?: 'OWN' | 'BORROWED';
  hidePropertiesCommand?: boolean;
  metaContext?: MetaTreeNodeContext;
}

/** Возвращает человекочитаемую подпись типа узла */
export function getNodeKindLabel(nodeKind: NodeKind): string {
  return getMetaLabel(nodeKind);
}
