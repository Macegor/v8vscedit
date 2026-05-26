import * as fs from 'fs';
import * as path from 'path';
import { writeTextFilePreservingBomAndEol } from '../xml/XmlUtils';
import {
  DEFAULT_FORMAT_VERSION,
  KNOWN_RIGHTS,
  PRESETS,
  asArray,
  getObjectType,
  parseRightsRoot,
  resolveRightsXmlPath,
  serializeRightsXml,
  translateObjectName,
  translateRightName,
  type RightsXmlRoot,
  type SerializableRoleObject,
} from './RoleRightsXml';
import type {
  RoleRightsEditOperation,
  RoleRightsEditOptions,
  RoleRightsEditResult,
} from './types';

interface RightEntry {
  value: 'true' | 'false';
  condition?: string;
}

interface RoleRightsState {
  setForNewObjects: boolean;
  setForAttributesByDefault: boolean;
  independentRightsOfChildObjects: boolean;
  objects: Map<string, Map<string, RightEntry>>;
  templates: Map<string, string>;
  formatVersion: string;
}

/**
 * Точечное редактирование Rights.xml существующей роли:
 * выдача и снятие прав на объекты и их дочерние элементы (реквизиты,
 * табличные части, команды, каналы сервисов интеграции), управление RLS,
 * глобальными флагами и шаблонами ограничений.
 *
 * Парсит Rights.xml в state, применяет операции, сериализует обратно через
 * общий serializeRightsXml — стиль и порядок такой же, как у role-compile.
 */
export class RoleRightsEditService {
  edit(options: RoleRightsEditOptions): RoleRightsEditResult {
    const rightsPath = resolveRightsXmlPath(options.rightsPath);
    if (!rightsPath) {
      return fail(options.rightsPath, `Rights.xml не найден: ${options.rightsPath}`);
    }
    const original = fs.readFileSync(rightsPath, 'utf-8');
    const root = parseRightsRoot(original);
    if (!root) {
      return fail(rightsPath, 'Не удалось распарсить Rights.xml.');
    }

    const state = loadState(root);
    const warnings: string[] = [];
    const errors: string[] = [];
    let applied = 0;

    for (const operation of options.operations) {
      const before = snapshotKey(state);
      try {
        const opWarnings = applyOperation(state, operation);
        warnings.push(...opWarnings);
        if (snapshotKey(state) !== before) {
          applied += 1;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        changed: false,
        rightsPath,
        applied: 0,
        changedFiles: [],
        warnings,
        errors,
      };
    }

    const nextXml = serializeRightsXml({
      setForNewObjects: state.setForNewObjects,
      setForAttributesByDefault: state.setForAttributesByDefault,
      independentRightsOfChildObjects: state.independentRightsOfChildObjects,
      objects: stateToObjects(state),
      templates: [...state.templates.entries()].map(([name, condition]) => ({ name, condition })),
      formatVersion: state.formatVersion,
    });

    if (nextXml === original) {
      return {
        success: true,
        changed: false,
        rightsPath,
        applied,
        changedFiles: [],
        warnings,
        errors,
      };
    }

    writeTextFilePreservingBomAndEol(rightsPath, original, nextXml);
    return {
      success: true,
      changed: true,
      rightsPath,
      applied,
      changedFiles: [rightsPath],
      warnings,
      errors,
    };
  }
}

function loadState(root: RightsXmlRoot): RoleRightsState {
  const state: RoleRightsState = {
    setForNewObjects: parseFlag(root.setForNewObjects, false),
    setForAttributesByDefault: parseFlag(root.setForAttributesByDefault, true),
    independentRightsOfChildObjects: parseFlag(root.independentRightsOfChildObjects, false),
    objects: new Map(),
    templates: new Map(),
    formatVersion: root['@_version'] ?? DEFAULT_FORMAT_VERSION,
  };
  for (const object of asArray(root.object)) {
    const name = object.name?.trim();
    if (!name) {
      continue;
    }
    const rights = new Map<string, RightEntry>();
    for (const right of asArray(object.right)) {
      const rightName = right.name?.trim();
      if (!rightName) {
        continue;
      }
      const value: 'true' | 'false' = right.value === 'true' ? 'true' : 'false';
      const condition = right.restrictionByCondition?.condition;
      rights.set(rightName, condition ? { value, condition } : { value });
    }
    state.objects.set(name, rights);
  }
  for (const template of asArray(root.restrictionTemplate)) {
    const name = template.name?.trim();
    if (!name) {
      continue;
    }
    state.templates.set(name, template.condition ?? '');
  }
  return state;
}

function applyOperation(state: RoleRightsState, operation: RoleRightsEditOperation): string[] {
  switch (operation.op) {
    case 'grant':
      return applyGrant(state, operation);
    case 'revoke':
      return applyRevoke(state, operation);
    case 'setRls':
      return applySetRls(state, operation);
    case 'setFlags':
      return applySetFlags(state, operation);
    case 'addTemplate':
      state.templates.set(operation.name, operation.condition);
      return [];
    case 'removeTemplate':
      if (!state.templates.delete(operation.name)) {
        return [`Шаблон "${operation.name}" отсутствует.`];
      }
      return [];
    default: {
      const exhaustive: never = operation;
      throw new Error(`Неизвестная операция: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function applyGrant(state: RoleRightsState, op: { object: string; preset?: string; rights?: readonly string[] | Record<string, boolean>; rls?: Record<string, string> }): string[] {
  const warnings: string[] = [];
  const objectName = translateObjectName(op.object);
  if (!objectName) {
    throw new Error('grant: пустое имя объекта.');
  }
  const rights = state.objects.get(objectName) ?? new Map<string, RightEntry>();

  if (op.preset) {
    const presetName = op.preset.replace(/^@/, '');
    const presetRights = PRESETS[presetName]?.[getObjectType(objectName)];
    if (!presetRights) {
      warnings.push(`Пресет @${presetName} не определён для типа ${getObjectType(objectName)}.`);
    } else {
      for (const right of presetRights) {
        if (!rights.has(right)) {
          rights.set(right, { value: 'true' });
        }
      }
    }
  }

  if (Array.isArray(op.rights)) {
    for (const raw of op.rights) {
      const rightName = translateRightName(String(raw));
      if (!isKnownRight(objectName, rightName)) {
        warnings.push(unknownRightMessage(objectName, rightName));
        continue;
      }
      rights.set(rightName, { ...(rights.get(rightName) ?? {}), value: 'true' });
    }
  } else if (op.rights && typeof op.rights === 'object') {
    for (const [raw, value] of Object.entries(op.rights)) {
      const rightName = translateRightName(raw);
      if (!isKnownRight(objectName, rightName)) {
        warnings.push(unknownRightMessage(objectName, rightName));
        continue;
      }
      rights.set(rightName, { ...(rights.get(rightName) ?? {}), value: value ? 'true' : 'false' });
    }
  }

  if (op.rls) {
    for (const [raw, condition] of Object.entries(op.rls)) {
      const rightName = translateRightName(raw);
      const existing = rights.get(rightName);
      if (!existing) {
        warnings.push(`${objectName}: RLS задано для отсутствующего права ${rightName}; добавь его в grant.rights.`);
        continue;
      }
      const next: RightEntry = { value: existing.value };
      if (condition) {
        next.condition = condition;
      }
      rights.set(rightName, next);
    }
  }

  if (rights.size === 0 && !op.preset) {
    warnings.push(`grant ${objectName}: ничего не выдано — укажи rights, preset или rls.`);
    return warnings;
  }

  state.objects.set(objectName, rights);
  return warnings;
}

function isKnownRight(objectName: string, rightName: string): boolean {
  // Для вложенных объектов (Catalog.X.Attribute.Y, ...Command.Z, ...Channel.W) допустимы
  // ограниченные наборы прав — иначе ориентируемся на KNOWN_RIGHTS по типу владельца.
  const parts = objectName.split('.');
  if (parts.length >= 3) {
    const nestedKind = parts[parts.length - 2];
    if (nestedKind === 'Command') {
      return rightName === 'View';
    }
    if (nestedKind === 'Channel') {
      return rightName === 'Use';
    }
    return rightName === 'View' || rightName === 'Edit';
  }
  const objectType = getObjectType(objectName);
  const allowed = KNOWN_RIGHTS[objectType];
  if (!allowed) {
    // Тип объекта не каталогизирован в KNOWN_RIGHTS — пропускаем без отбивки,
    // чтобы не блокировать пользовательские/расширительные конструкции.
    return true;
  }
  return allowed.includes(rightName);
}

function unknownRightMessage(objectName: string, rightName: string): string {
  return `${objectName}: право "${rightName}" не существует в платформе 1С 8.3 и пропущено — проверь имя или удали его из grant.rights.`;
}

function applyRevoke(state: RoleRightsState, op: { object: string; rights?: readonly string[] }): string[] {
  const warnings: string[] = [];
  const objectName = translateObjectName(op.object);
  if (!objectName) {
    throw new Error('revoke: пустое имя объекта.');
  }
  if (!op.rights || op.rights.length === 0) {
    if (!state.objects.delete(objectName)) {
      warnings.push(`Объект ${objectName} отсутствует в Rights.xml.`);
    }
    return warnings;
  }
  const rights = state.objects.get(objectName);
  if (!rights) {
    warnings.push(`Объект ${objectName} отсутствует в Rights.xml.`);
    return warnings;
  }
  for (const raw of op.rights) {
    const rightName = translateRightName(raw);
    if (!rights.delete(rightName)) {
      warnings.push(`${objectName}: право ${rightName} не было задано.`);
    }
  }
  if (rights.size === 0) {
    state.objects.delete(objectName);
  } else {
    state.objects.set(objectName, rights);
  }
  return warnings;
}

function applySetRls(state: RoleRightsState, op: { object: string; right: string; condition?: string }): string[] {
  const warnings: string[] = [];
  const objectName = translateObjectName(op.object);
  const rightName = translateRightName(op.right);
  const rights = state.objects.get(objectName);
  if (!rights) {
    warnings.push(`Объект ${objectName} отсутствует — RLS не применено.`);
    return warnings;
  }
  const existing = rights.get(rightName);
  if (!existing) {
    warnings.push(`${objectName}: право ${rightName} отсутствует — RLS не применено.`);
    return warnings;
  }
  const next: RightEntry = { value: existing.value };
  if (op.condition && op.condition.trim().length > 0) {
    next.condition = op.condition;
  }
  rights.set(rightName, next);
  return warnings;
}

function applySetFlags(state: RoleRightsState, op: { flags: { setForNewObjects?: boolean; setForAttributesByDefault?: boolean; independentRightsOfChildObjects?: boolean } }): string[] {
  if (op.flags.setForNewObjects !== undefined) {
    state.setForNewObjects = op.flags.setForNewObjects;
  }
  if (op.flags.setForAttributesByDefault !== undefined) {
    state.setForAttributesByDefault = op.flags.setForAttributesByDefault;
  }
  if (op.flags.independentRightsOfChildObjects !== undefined) {
    state.independentRightsOfChildObjects = op.flags.independentRightsOfChildObjects;
  }
  return [];
}

function parseFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function stateToObjects(state: RoleRightsState): SerializableRoleObject[] {
  return [...state.objects.entries()].map(([name, rights]) => ({
    name,
    rights: [...rights.entries()].map(([rightName, entry]) => ({
      name: rightName,
      value: entry.value,
      condition: entry.condition,
    })),
  }));
}

function snapshotKey(state: RoleRightsState): string {
  return JSON.stringify({
    f: [state.setForNewObjects, state.setForAttributesByDefault, state.independentRightsOfChildObjects],
    o: [...state.objects.entries()].map(([name, rights]) => [
      name,
      [...rights.entries()].map(([rightName, entry]) => [rightName, entry.value, entry.condition ?? '']),
    ]),
    t: [...state.templates.entries()],
  });
}

function fail(rightsPath: string, message: string): RoleRightsEditResult {
  return {
    success: false,
    changed: false,
    rightsPath: path.resolve(rightsPath),
    applied: 0,
    changedFiles: [],
    warnings: [],
    errors: [message],
  };
}
