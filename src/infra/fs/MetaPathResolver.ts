import * as fs from 'fs';
import * as path from 'path';
import { MetaKind, getMetaFolder } from '../../domain/MetaTypes';
import { ModuleSlot } from '../../domain/ModuleSlot';
import { ObjectLocation, getObjectLocationFromXml } from './ObjectLocation';

export { getObjectLocationFromXml } from './ObjectLocation';

/**
 * Минимальный контракт узла, от которого можно резолвить путь.
 * Поля совпадают с `ui/tree/TreeNodeModel`, но `MetaPathResolver` не знает о vscode.
 */
export interface NodePathInfo {
  xmlPath?: string;
  kind?: string;
  label?: string;
}

/**
 * Единый резолвер путей к XML и BSL-модулям объектов метаданных.
 * Заменяет прежние 9 функций `get<Что-то>ModulePath` + `resolveObjectXmlPath`.
 *
 * Карта слотов → кандидаты путей внутри `objectDir` — здесь же, как данные.
 * Для слотов форм/команд, принадлежащих объекту, имя формы/команды берётся
 * из `node.label` (раньше именно так работал `getFormModulePathForChild`).
 */
export class MetaPathResolver {
  /**
   * Путь к XML-файлу объекта по каталогу конфигурации, типу и имени.
   * Пробует две формы выгрузки: глубокую `<Folder>/<Name>/<Name>.xml` и
   * плоскую `<Folder>/<Name>.xml`.
   */
  resolveXml(configRoot: string, kind: MetaKind, name: string): string | null {
    const folder = getMetaFolder(kind);
    if (!folder) {
      return null;
    }

    const deepPath = path.join(configRoot, folder, name, `${name}.xml`);
    if (fs.existsSync(deepPath)) {
      return deepPath;
    }

    const flatPath = path.join(configRoot, folder, `${name}.xml`);
    if (fs.existsSync(flatPath)) {
      return flatPath;
    }

    return null;
  }

  /** Разбор пути к объекту: корень, папка категории, имя, каталог объекта */
  getObjectLocation(xmlPath: string): ObjectLocation {
    return getObjectLocationFromXml(xmlPath);
  }

  /**
   * Возвращает существующий путь к модулю указанного слота или `null`, если
   * файл отсутствует. Для `ensureCommonModuleFile` см. отдельный метод.
   */
  resolveModule(node: NodePathInfo, slot: ModuleSlot): string | null {
    const xmlPath = node.xmlPath;
    if (!xmlPath) {
      return null;
    }
    const loc = getObjectLocationFromXml(xmlPath);
    const candidates = this.getSlotCandidates(slot, loc, node.label);
    return this.firstExisting(candidates);
  }

  /**
   * Путь к модулю общего модуля; при отсутствии создаёт пустой файл.
   * Нужен для сценария «объект уже создан в XML, но пустой модуль ещё не существует».
   */
  ensureCommonModuleFile(node: NodePathInfo): string | null {
    const existing = this.resolveModule(node, 'CommonModule');
    if (existing) {
      return existing;
    }

    if (!node.xmlPath) {
      return null;
    }
    const loc = getObjectLocationFromXml(node.xmlPath);
    const modulePath = path.join(loc.objectDir, 'Ext', 'Module.bsl');

    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    if (!fs.existsSync(modulePath)) {
      fs.writeFileSync(modulePath, '', { encoding: 'utf-8' });
    }
    return modulePath;
  }

  /**
   * Строит список путей-кандидатов для слота относительно каталога объекта.
   * Для дочерних форм/команд имя берётся из {@link label} — это имя узла дерева.
   */
  private getSlotCandidates(slot: ModuleSlot, loc: ObjectLocation, label: string | undefined): string[] {
    const extDir = path.join(loc.objectDir, 'Ext');

    switch (slot) {
      case 'Object':
        return [path.join(extDir, 'ObjectModule.bsl')];
      case 'Manager':
        return [path.join(extDir, 'ManagerModule.bsl')];
      case 'ValueManager':
        return [path.join(extDir, 'ValueManagerModule.bsl')];
      case 'Service':
        return [path.join(extDir, 'Module.bsl')];
      case 'CommonModule':
        return [path.join(extDir, 'Module.bsl')];
      case 'CommonCommand':
        return [path.join(extDir, 'CommandModule.bsl')];
      case 'CommonForm':
        return [path.join(extDir, 'Form', 'Module.bsl')];
      case 'ChildForm': {
        if (!label) return [];
        return [
          path.join(loc.objectDir, 'Forms', label, 'Ext', 'Form', 'Module.bsl'),
          path.join(loc.objectDir, 'Forms', label, 'Ext', 'Module.bsl'),
        ];
      }
      case 'ChildCommand': {
        if (!label) return [];
        return [
          path.join(loc.objectDir, 'Commands', label, 'Ext', 'CommandModule.bsl'),
          path.join(loc.objectDir, 'Commands', label, 'Ext', 'Module.bsl'),
        ];
      }
      default:
        return [];
    }
  }

  private firstExisting(candidates: string[]): string | null {
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Функции-фасады для совместимости с legacy-кодом.
// Точно так же, как работал `ModulePathResolver.ts`; внутри — делегат в класс.
// ---------------------------------------------------------------------------

const singleton = new MetaPathResolver();

type NodeLike = {
  xmlPath?: string;
  nodeKind?: string;
  kind?: string;
  label?: string;
};

function toInfo(node: NodeLike | null | undefined): NodePathInfo | null {
  if (!node || !node.xmlPath) {
    return null;
  }
  return {
    xmlPath: node.xmlPath,
    kind: node.nodeKind ?? node.kind,
    label: node.label,
  };
}

function resolve(slot: ModuleSlot, node: NodeLike): string | null {
  const info = toInfo(node);
  if (!info) return null;
  return singleton.resolveModule(info, slot);
}

/** Путь к XML объекта по корню конфигурации, типу и имени */
export function resolveObjectXmlPath(
  configRoot: string,
  objectType: string,
  objectName: string
): string | null {
  return singleton.resolveXml(configRoot, objectType as MetaKind, objectName);
}

export function getObjectModulePath(node: NodeLike): string | null {
  return resolve('Object', node);
}

export function getManagerModulePath(node: NodeLike): string | null {
  return resolve('Manager', node);
}

export function getConstantModulePath(node: NodeLike): string | null {
  return resolve('ValueManager', node);
}

export function getServiceModulePath(node: NodeLike): string | null {
  return resolve('Service', node);
}

export function getCommonFormModulePath(node: NodeLike): string | null {
  return resolve('CommonForm', node);
}

export function getCommonCommandModulePath(node: NodeLike): string | null {
  return resolve('CommonCommand', node);
}

export function getFormModulePathForChild(node: NodeLike): string | null {
  return resolve('ChildForm', node);
}

export function getCommandModulePathForChild(node: NodeLike): string | null {
  return resolve('ChildCommand', node);
}

export function getCommonModuleCodePath(node: NodeLike): string | null {
  return resolve('CommonModule', node);
}

/** Возвращает путь к модулю общего модуля; создаёт пустой файл при отсутствии */
export function ensureCommonModuleCodePath(node: NodeLike): string | null {
  const info = toInfo(node);
  if (!info) return null;
  return singleton.ensureCommonModuleFile(info);
}
