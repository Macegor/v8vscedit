import { NodeKind } from '../TreeNode';
import { NodeDescriptor, ChildTag } from './_types';
import { META_TYPES, MetaKind } from '../../../domain/MetaTypes';
import { OpenModuleCommandId } from '../../../domain/ModuleSlot';

/**
 * Описание типа узла дерева вычисляется из единого реестра `META_TYPES`
 * (см. `src/domain/MetaTypes.ts`). Раньше на каждый тип был отдельный
 * файл-дескриптор в `nodes/{common,objects,children,groups,root}/*` —
 * все они удалены как избыточные: набор полей дескриптора полностью
 * покрывается `MetaTypeDef`.
 *
 * Добавление нового типа метаданных теперь сводится к одной записи в `META_TYPES`.
 */
export function getNodeDescriptor(kind: NodeKind): NodeDescriptor | undefined {
  const def = META_TYPES[kind as MetaKind];
  if (!def) {
    return undefined;
  }
  return {
    icon: def.icon,
    folderName: def.folder,
    children: def.childTags as ReadonlyArray<ChildTag> | undefined,
    singleClickCommand: def.singleClickCommand as OpenModuleCommandId | undefined,
  };
}
