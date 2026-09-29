import * as fs from 'fs';
import * as path from 'path';
import { type MetaKind, getMetaFolder, getMetaLabel, isModuleSlotValid } from '../../domain/MetaTypes';
import type { ModuleSlot } from '../../domain/ModuleSlot';
import { type ObjectLocation, getObjectLocationFromXml } from './ObjectLocation';

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
   * Возвращает путь к модулю, создавая пустой BSL-файл в штатном месте,
   * если модуль ещё не выгружен. Используется только явными командами
   * открытия модулей, когда пользователь ожидает получить редактируемый файл.
   *
   * Если файл не существует и слот не поддерживается типом метаданных —
   * выбрасывает ошибку, чтобы предотвратить создание файла, который платформа
   * не распознаёт (например, ObjectModule для регистров).
   */
  ensureModule(node: NodePathInfo, slot: ModuleSlot): string | null {
    const xmlPath = node.xmlPath;
    if (!xmlPath) {
      return null;
    }

    const loc = getObjectLocationFromXml(xmlPath);
    const candidates = this.getSlotCandidates(slot, loc, node.label);
    const existing = this.firstExisting(candidates);
    if (existing) {
      return existing;
    }

    if (node.kind && !isModuleSlotValid(node.kind, slot)) {
      const typeLabel = this.kindLabel(node.kind);
      throw new Error(`Тип «${typeLabel}» не поддерживает слот модуля «${slot}»`);
    }

    const target = candidates[0];
    if (!target) {
      return null;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' });
    return target;
  }

  /**
   * Тело формы по её файлу-дескриптору: `<dir>/<имя>/Ext/Form.xml`.
   *
   * Считается ЯВНОЙ арифметикой, без обращений к ФС и без
   * {@link getObjectLocationFromXml}: эвристика «глубокая/плоская раскладка» там
   * опирается на совпадение имени файла с именем родительского каталога, и на
   * форме с именем `Forms` (`Forms/Forms.xml`) она принимает дескриптор за
   * объект глубокой раскладки и уводит путь на уровень выше.
   */
  resolveFormXmlByDescriptor(descriptorXmlPath: string): string {
    const dir = path.dirname(descriptorXmlPath);
    const formName = path.basename(descriptorXmlPath, '.xml');
    return path.join(dir, formName, 'Ext', 'Form.xml');
  }

  /**
   * Дескриптор формы объекта: `<каталог объекта>/Forms/<Имя>.xml`.
   * Здесь {@link getObjectLocationFromXml} уместен — на входе именно XML
   * объекта метаданных, для которого эвристика раскладки и написана.
   */
  resolveChildFormDescriptor(ownerObjectXmlPath: string, formName: string): string {
    const loc = getObjectLocationFromXml(ownerObjectXmlPath);
    return path.join(loc.objectDir, 'Forms', `${formName}.xml`);
  }

  /** Тело формы объекта по XML владельца и имени формы. */
  resolveChildFormXml(ownerObjectXmlPath: string, formName: string): string {
    return this.resolveFormXmlByDescriptor(this.resolveChildFormDescriptor(ownerObjectXmlPath, formName));
  }

  private kindLabel(kind: string): string {
    try {
      return getMetaLabel(kind as MetaKind);
    } catch {
      return kind;
    }
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
        if (!label) {return [];}
        return [
          path.join(loc.objectDir, 'Forms', label, 'Ext', 'Form', 'Module.bsl'),
          path.join(loc.objectDir, 'Forms', label, 'Ext', 'Module.bsl'),
        ];
      }
      case 'ChildCommand': {
        if (!label) {return [];}
        return [
          path.join(loc.objectDir, 'Commands', label, 'Ext', 'CommandModule.bsl'),
          path.join(loc.objectDir, 'Commands', label, 'Ext', 'Module.bsl'),
        ];
      }
      case 'RecordSet':
        return [path.join(extDir, 'RecordSetModule.bsl')];
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

interface NodeLike {
  xmlPath?: string;
  nodeKind?: string;
  kind?: string;
  label?: string;
}

function toInfo(node: NodeLike | null | undefined): NodePathInfo | null {
  if (!node?.xmlPath) {
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
  if (!info) {return null;}
  return singleton.resolveModule(info, slot);
}

function ensure(slot: ModuleSlot, node: NodeLike): string | null {
  const info = toInfo(node);
  if (!info) {return null;}
  return singleton.ensureModule(info, slot);
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

/** Путь к модулю объекта; создаёт пустой файл, если его ещё нет */
export function ensureObjectModulePath(node: NodeLike): string | null {
  return ensure('Object', node);
}

export function getManagerModulePath(node: NodeLike): string | null {
  return resolve('Manager', node);
}

/** Путь к модулю менеджера; создаёт пустой файл, если его ещё нет */
export function ensureManagerModulePath(node: NodeLike): string | null {
  return ensure('Manager', node);
}

export function getConstantModulePath(node: NodeLike): string | null {
  return resolve('ValueManager', node);
}

/** Путь к модулю менеджера значения; создаёт пустой файл, если его ещё нет */
export function ensureConstantModulePath(node: NodeLike): string | null {
  return ensure('ValueManager', node);
}

export function getServiceModulePath(node: NodeLike): string | null {
  return resolve('Service', node);
}

/** Путь к модулю сервиса; создаёт пустой файл, если его ещё нет */
export function ensureServiceModulePath(node: NodeLike): string | null {
  return ensure('Service', node);
}

export function getCommonFormModulePath(node: NodeLike): string | null {
  return resolve('CommonForm', node);
}

/** Путь к модулю общей формы; создаёт пустой файл, если его ещё нет */
export function ensureCommonFormModulePath(node: NodeLike): string | null {
  return ensure('CommonForm', node);
}

export function getCommonCommandModulePath(node: NodeLike): string | null {
  return resolve('CommonCommand', node);
}

/** Путь к модулю общей команды; создаёт пустой файл, если его ещё нет */
export function ensureCommonCommandModulePath(node: NodeLike): string | null {
  return ensure('CommonCommand', node);
}

/** Тело формы по её дескриптору — см. {@link MetaPathResolver.resolveFormXmlByDescriptor}. */
export function resolveFormXmlByDescriptor(descriptorXmlPath: string): string {
  return singleton.resolveFormXmlByDescriptor(descriptorXmlPath);
}

/** Дескриптор формы объекта — см. {@link MetaPathResolver.resolveChildFormDescriptor}. */
export function resolveChildFormDescriptor(ownerObjectXmlPath: string, formName: string): string {
  return singleton.resolveChildFormDescriptor(ownerObjectXmlPath, formName);
}

/** Тело формы объекта — см. {@link MetaPathResolver.resolveChildFormXml}. */
export function resolveChildFormXml(ownerObjectXmlPath: string, formName: string): string {
  return singleton.resolveChildFormXml(ownerObjectXmlPath, formName);
}

export function getFormModulePathForChild(node: NodeLike): string | null {
  return resolve('ChildForm', node);
}

/** Путь к модулю формы объекта; создаёт пустой файл, если его ещё нет */
export function ensureFormModulePathForChild(node: NodeLike): string | null {
  return ensure('ChildForm', node);
}

export function getCommandModulePathForChild(node: NodeLike): string | null {
  return resolve('ChildCommand', node);
}

/** Путь к модулю команды объекта; создаёт пустой файл, если его ещё нет */
export function ensureCommandModulePathForChild(node: NodeLike): string | null {
  return ensure('ChildCommand', node);
}

export function getCommonModuleCodePath(node: NodeLike): string | null {
  return resolve('CommonModule', node);
}

/** Путь к коду общего модуля; создаёт пустой файл, если его ещё нет */
export function ensureCommonModuleFile(node: NodeLike): string | null {
  return ensure('CommonModule', node);
}

export function getRecordSetModulePath(node: NodeLike): string | null {
  return resolve('RecordSet', node);
}

/** Путь к модулю записи регистра; создаёт пустой файл, если его ещё нет */
export function ensureRecordSetModulePath(node: NodeLike): string | null {
  return ensure('RecordSet', node);
}
