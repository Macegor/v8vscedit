import { ChildTag } from '../../domain/ChildTag';
import { MetaKind, getMetaLabel } from '../../domain/MetaTypes';
import type { MetadataGitDecorationTarget } from '../../infra/git/GitMetadataStatusService';

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

export type AddMetadataTarget =
  | {
    readonly kind: 'root';
    readonly configRoot: string;
    readonly configKind: 'cf' | 'cfe';
    readonly targetKind: MetaKind;
    readonly namePrefix?: string;
  }
  | {
    readonly kind: 'child';
    readonly ownerObjectXmlPath: string;
    readonly childTag: ChildTag | 'Column';
    readonly tabularSectionName?: string;
  };

/**
 * POJO-модель узла дерева без зависимости от vscode API.
 */
export interface TreeNodeModel {
  label: string;
  nodeKind: NodeKind;
  xmlPath?: string;
  /** Файл или каталог, по которому VS Code показывает git-декорации узла */
  decorationPath?: string;
  /** Виртуальная цель для git-декорации вложенного XML-элемента */
  gitDecorationTarget?: MetadataGitDecorationTarget;
  childrenLoader?: () => import('./TreeNode').MetadataNode[];
  ownershipTag?: 'OWN' | 'BORROWED';
  hidePropertiesCommand?: boolean;
  metaContext?: MetaTreeNodeContext;
  addMetadataTarget?: AddMetadataTarget;
  canRemoveMetadata?: boolean;
}

/** Возвращает человекочитаемую подпись типа узла */
export function getNodeKindLabel(nodeKind: NodeKind): string {
  return getMetaLabel(nodeKind);
}
