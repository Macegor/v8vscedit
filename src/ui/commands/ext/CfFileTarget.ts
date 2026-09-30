/**
 * Разрешение цели выгрузки/загрузки CF/CFE по узлу дерева — чистая функция без
 * диалогов.
 *
 * Нужна, чтобы вызов пункта контекстного меню корневого узла сразу открывал
 * системное окно выбора файла: цель уже определена самим узлом, спрашивать
 * «Основная конфигурация / Расширение» в этом случае не за чем. При вызове из
 * палитры команд узла нет — возвращается `undefined`, и команда идёт обычным
 * путём с QuickPick.
 *
 * Разбор узла расширения не дублируется: используется тот же
 * `extractExtensionTarget`, которым пользуются остальные команды расширений.
 */
import { resolveConfigDir } from '../../../infra/fs/ProjectLayout';
import type { ConfigTarget } from '../../../infra/fs/ProjectLayout';
import type { NodeArg } from '../_shared';
import { extractExtensionTarget } from './ExtensionCommandRunner';

export type CfFileNodeTarget =
  | { readonly kind: 'main' }
  | { readonly kind: 'extension'; readonly extensionName: string };

/** Цель операции по узлу дерева; `undefined` — узел не является корнем конфигурации/расширения. */
export function resolveCfFileTargetFromNode(node: NodeArg | undefined): CfFileNodeTarget | undefined {
  if (!node) {
    return undefined;
  }

  const extension = extractExtensionTarget(node);
  if (extension) {
    return { kind: 'extension', extensionName: extension.extensionName };
  }

  if (node.nodeKind === 'configuration' && node.xmlPath) {
    return { kind: 'main' };
  }
  return undefined;
}

/**
 * Цель применения изменений к базе (`/UpdateDBCfg`) после загрузки CF/CFE.
 *
 * Единственный источник этого знания в UI-слое. Раскладка проекта берётся из
 * `infra/fs/ProjectLayout` — того же места, откуда её берёт CLI: `rootPath`
 * уходит в резолвинг файла настроек подключения, поэтому разошедшиеся копии
 * означали бы применение к базе с чужими параметрами, причём молча.
 */
export function buildCfApplyTarget(
  workspaceRoot: string,
  extensionName: string
): { kind: ConfigTarget; name: string; rootPath: string; extensionName?: string } {
  const name = extensionName.trim();
  if (name) {
    return {
      kind: 'cfe',
      name,
      rootPath: resolveConfigDir(workspaceRoot, 'cfe', name),
      extensionName: name,
    };
  }
  return { kind: 'cf', name: 'Основная конфигурация', rootPath: resolveConfigDir(workspaceRoot, 'cf') };
}
