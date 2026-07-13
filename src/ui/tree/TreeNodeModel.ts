import type { ChildTag } from '../../domain/ChildTag';
import { type MetaKind, getMetaLabel } from '../../domain/MetaTypes';
import type { MetadataGitDecorationTarget } from '../../infra/git/GitMetadataStatusService';
import type { MetadataNode } from './TreeNode';

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
  /** Имя URL-шаблона-контейнера для метода HTTP-сервиса (аналог tabularSectionName) */
  urlTemplateName?: string;
  /** Техническое имя стандартного реквизита, если в дереве показано русское представление */
  standardAttributeName?: string;
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
    /** Имя URL-шаблона-контейнера при добавлении метода HTTP-сервиса. */
    readonly urlTemplateName?: string;
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
  childrenLoader?: () => MetadataNode[];
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
