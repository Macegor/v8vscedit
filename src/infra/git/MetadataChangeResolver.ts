import * as path from 'path';
import { canonicalRootPath, MODULE_SEGMENT_MAP, type ModuleSegmentInfo } from '../../domain/CanonicalNames';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import type { ModuleSlot } from '../../domain/ModuleSlot';

/**
 * Часть объекта метаданных, к которой относится файл (по СТРОКЕ пути).
 *
 * Классификация ведётся исключительно по структуре пути — без обращения к ФС,
 * поэтому резолвер корректно разбирает и удалённые/ещё не выгруженные файлы.
 */
export type MetadataPartKind =
  /** Корневой XML свойств объекта (`<Name>.xml`). */
  | 'objectProperties'
  /** BSL-модуль (объекта/менеджера/формы/команды/…). */
  | 'module'
  /** Описание формы (`Ext/Form.xml`). */
  | 'form'
  /** Макет (`Templates/<Имя>/Ext/Template.xml`). */
  | 'template'
  /** Справка объекта (`Ext/Help.xml`). */
  | 'help'
  /** Нераспознанный подпуть внутри каталога объекта. */
  | 'raw';

/** Разобранная принадлежность файла к части объекта метаданных. */
export interface MetadataChangePart {
  /** Тип корневого объекта. */
  readonly rootKind: MetaKind;
  /** Имя корневого объекта. */
  readonly rootName: string;
  /** Часть объекта. */
  readonly part: MetadataPartKind;
  /** UI-метка части («Свойства», «МодульОбъекта», …). */
  readonly partLabel: string;
  /** Слот модуля (только для `part === 'module'`). */
  readonly slot?: ModuleSlot;
  /** Имя дочерней формы/команды/макета (если применимо). */
  readonly childName?: string;
  /** Канонический путь владельца — всегда корневой канон, без сегмента «Свойства». */
  readonly canonicalOwnerPath: string;
  /** Относительный подпуть внутри каталога объекта для `part === 'raw'`. */
  readonly rawRelPath?: string;
}

// ─── Свёртки существующих реестров (без параллельных словарей) ────────────

/** Карта «папка выгрузки → MetaKind» — свёртка `META_TYPES.folder`. */
const FOLDER_TO_KIND = new Map<string, MetaKind>();
for (const [kindRaw, def] of Object.entries(META_TYPES)) {
  if (def.folder) {
    FOLDER_TO_KIND.set(def.folder, kindRaw as MetaKind);
  }
}

/**
 * Карта «относительный подпуть модуля внутри каталога объекта → слоты-кандидаты».
 * Свёртка `MODULE_SEGMENT_MAP` по объектным слотам (без `ChildForm`/`ChildCommand`,
 * которые размещаются в `Forms/`/`Commands/` и разбираются отдельно). Один и тот
 * же файл (`Ext/Module.bsl`) может принадлежать нескольким слотам — дизамбигуация
 * идёт через `META_TYPES[kind].modules`.
 */
const OBJECT_SLOT_BY_REL = new Map<string, ModuleSlot[]>();
for (const [slotRaw, info] of Object.entries(MODULE_SEGMENT_MAP) as readonly [ModuleSlot, ModuleSegmentInfo][]) {
  if (slotRaw === 'ChildForm' || slotRaw === 'ChildCommand') {
    continue;
  }
  const rel = [info.relativeDir, info.fileName].filter(Boolean).join('/');
  const list = OBJECT_SLOT_BY_REL.get(rel) ?? [];
  list.push(slotRaw);
  OBJECT_SLOT_BY_REL.set(rel, list);
}

// ─── Публичный резолвер ───────────────────────────────────────────────────

/**
 * Разбирает абсолютный путь файла относительно корня выгрузки `configRoot`
 * в часть объекта метаданных. Работает по строке пути; `null` — если файл
 * не относится ни к одному объекту (верхнеуровневые `Configuration.xml`/
 * `ConfigDumpInfo.xml`, файлы вне известных папок выгрузки, файлы вне corRoot).
 */
export function resolveFilePart(configRoot: string, absFilePath: string): MetadataChangePart | null {
  const rel = path.relative(configRoot, absFilePath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const folderName = parts[0];
  const kind = FOLDER_TO_KIND.get(folderName);
  if (!kind) {
    return null;
  }

  // Плоский корневой XML: <Folder>/<Name>.xml.
  if (parts.length === 2) {
    if (parts[1].toLowerCase().endsWith('.xml')) {
      return objectProperties(kind, parts[1].replace(/\.xml$/i, ''));
    }
    return null;
  }

  const objectName = parts[1];
  const remaining = parts.slice(2);

  // Глубокий корневой XML: <Folder>/<Name>/<Name>.xml.
  if (remaining.length === 1 && remaining[0] === `${objectName}.xml`) {
    return objectProperties(kind, objectName);
  }

  return resolveSubPath(kind, objectName, remaining);
}

// ─── Построение частей ────────────────────────────────────────────────────

function base(kind: MetaKind, name: string): { rootKind: MetaKind; rootName: string; canonicalOwnerPath: string } {
  return { rootKind: kind, rootName: name, canonicalOwnerPath: canonicalRootPath(kind, name) };
}

function objectProperties(kind: MetaKind, name: string): MetadataChangePart {
  return { ...base(kind, name), part: 'objectProperties', partLabel: 'Свойства' };
}

function raw(kind: MetaKind, name: string, remaining: readonly string[]): MetadataChangePart {
  return { ...base(kind, name), part: 'raw', partLabel: 'Прочее', rawRelPath: remaining.join(path.sep) };
}

/** UI-метка модуля — канонический сегмент из `MODULE_SEGMENT_MAP` (например «МодульОбъекта»). */
function moduleLabel(slot: ModuleSlot): string {
  return MODULE_SEGMENT_MAP[slot].segment || 'Модуль';
}

function moduleChild(
  kind: MetaKind,
  name: string,
  slot: ModuleSlot,
  childName: string,
): MetadataChangePart {
  return { ...base(kind, name), part: 'module', slot, partLabel: moduleLabel(slot), childName };
}

function resolveSubPath(kind: MetaKind, objectName: string, remaining: readonly string[]): MetadataChangePart {
  switch (remaining[0]) {
    case 'Forms': return resolveForms(kind, objectName, remaining);
    case 'Commands': return resolveCommands(kind, objectName, remaining);
    case 'Templates': return resolveTemplates(kind, objectName, remaining);
    case 'Ext': return resolveExt(kind, objectName, remaining);
    default: return raw(kind, objectName, remaining);
  }
}

function resolveForms(kind: MetaKind, objectName: string, remaining: readonly string[]): MetadataChangePart {
  const formName = remaining[1];
  if (!formName) {
    return raw(kind, objectName, remaining);
  }
  const inner = remaining.slice(2).join('/');
  if (inner.toLowerCase() === 'ext/form.xml') {
    return { ...base(kind, objectName), part: 'form', partLabel: 'Форма', childName: formName };
  }
  if (inner === 'Ext/Form/Module.bsl' || inner === 'Ext/Module.bsl') {
    return moduleChild(kind, objectName, 'ChildForm', formName);
  }
  return raw(kind, objectName, remaining);
}

function resolveCommands(kind: MetaKind, objectName: string, remaining: readonly string[]): MetadataChangePart {
  const commandName = remaining[1];
  if (!commandName) {
    return raw(kind, objectName, remaining);
  }
  const inner = remaining.slice(2).join('/');
  if (inner === 'Ext/CommandModule.bsl' || inner === 'Ext/Module.bsl') {
    return moduleChild(kind, objectName, 'ChildCommand', commandName);
  }
  return raw(kind, objectName, remaining);
}

function resolveTemplates(kind: MetaKind, objectName: string, remaining: readonly string[]): MetadataChangePart {
  const templateName = remaining[1];
  if (!templateName) {
    return raw(kind, objectName, remaining);
  }
  const inner = remaining.slice(2).join('/');
  if (inner.toLowerCase() === 'ext/template.xml') {
    return { ...base(kind, objectName), part: 'template', partLabel: 'Макет', childName: templateName };
  }
  return raw(kind, objectName, remaining);
}

function resolveExt(kind: MetaKind, objectName: string, remaining: readonly string[]): MetadataChangePart {
  const rel = remaining.join('/');
  if (rel.toLowerCase() === 'ext/help.xml') {
    return { ...base(kind, objectName), part: 'help', partLabel: 'Справка' };
  }

  const candidates = OBJECT_SLOT_BY_REL.get(rel);
  if (candidates && candidates.length > 0) {
    const slot = disambiguateSlot(candidates, kind);
    if (slot) {
      return { ...base(kind, objectName), part: 'module', slot, partLabel: moduleLabel(slot) };
    }
  }
  return raw(kind, objectName, remaining);
}

/**
 * Выбирает единственный слот из кандидатов: при одном кандидате — его,
 * при нескольких (`Ext/Module.bsl` → Service|CommonModule) — пересечением
 * со списком допустимых слотов типа (`META_TYPES[kind].modules`).
 */
function disambiguateSlot(candidates: readonly ModuleSlot[], kind: MetaKind): ModuleSlot | undefined {
  if (candidates.length === 1) {
    return candidates[0];
  }
  const allowed = META_TYPES[kind].modules ?? [];
  return candidates.find((slot) => allowed.includes(slot));
}
