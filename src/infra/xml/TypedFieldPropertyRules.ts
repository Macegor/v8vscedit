import {
  collectPropertyBlocks,
  type PropertyBlock,
  detectEol,
  findPropertiesRange,
  insertBlockInCanonicalPosition,
  removeBlocks,
  replaceBlock,
} from './typedField/PropertyBlockEditor';
import {
  controlledPropertyOrder,
  getFieldDefaultValues,
  getGeneratedPropertyKeys,
  getMemberPropertyKeys,
  isTypedFieldControlledPropertyKey,
  isOwnerDependentPropertyKey,
  listRolesForOwner,
  listRuleOwnerKinds,
  sortByControlledOrder,
  type TypeAwarePropertyOwnerKind,
} from './typedField/TypedFieldOwnerRules';

/**
 * Фасад состава свойств типизированного поля. Правило одно и двумерное:
 * **состав = вид объекта-владельца × роль поля** (см. `typedField/TypedFieldOwnerRules.ts`).
 * Здесь — только применение правила к XML: генерация блоков нового поля,
 * нормализация после смены типа, критерий валидации и набор для панели свойств.
 */

export type { TypeAwarePropertyOwnerKind };
export { isTypedFieldControlledPropertyKey, isTypedFieldRole } from './typedField/TypedFieldOwnerRules';

/**
 * Возвращает XML-блоки свойств, которые должны сопровождать новое типизированное
 * поле заданного типа. Используется генератором (ruleset формата), чтобы XML-правила
 * не жили в UI-командах.
 */
export function buildTypedFieldPropertyBlocks(
  role: TypeAwarePropertyOwnerKind,
  typeInnerXml: string,
  indent: string,
  ownerKind?: string
): string[] {
  const defaults = getFieldDefaultValues(role, ownerKind);
  return getGeneratedPropertyKeys(role, ownerKind, typeInnerXml)
    .map((key) => buildDefaultPropertyBlock(key, indent, defaults));
}

/**
 * Набор ключей для ПАНЕЛИ СВОЙСТВ. Панель показывает недостающие свойства как
 * редактируемые поля и дописывает их в XML при первом же вводе, поэтому основа
 * списка — ровно то, что дописывает путь записи ({@link getGeneratedPropertyKeys}).
 *
 * К нему добавляется уже записанное платформой owner-зависимое свойство:
 * правил его владельца мы могли не снимать (регистр расчёта), и прятать такое
 * поле нельзя. Типозависимые свойства, наоборот, сужаются по `<Type>` намеренно
 * — у ссылочного поля не место строковому `PasswordMode`.
 *
 * Неизвестная роль/владелец — состав объединяется по кандидатам
 * ({@link listRolesForOwner}, {@link listRuleOwnerKinds}).
 */
export function getDisplayTypedFieldPropertyKeys(
  role: TypeAwarePropertyOwnerKind | undefined,
  typeInnerXml: string,
  ownerKind?: string,
  elementXml?: string
): string[] {
  const roles = role ? [role] : listRolesForOwner(ownerKind);
  const owners = ownerKind ? [ownerKind] : listRuleOwnerKinds();
  const generated = new Set<string>();
  const members = new Set<string>();
  for (const candidateRole of roles) {
    for (const candidateOwner of owners) {
      for (const key of getGeneratedPropertyKeys(candidateRole, candidateOwner, typeInnerXml)) {
        generated.add(key);
      }
      for (const key of getMemberPropertyKeys(candidateRole, candidateOwner)) {
        members.add(key);
      }
    }
  }
  for (const key of existingControlledKeys(elementXml)) {
    if (isOwnerDependentPropertyKey(key) && members.has(key)) {
      generated.add(key);
    }
  }
  return sortByControlledOrder([...generated]);
}

/** Управляемые ключи, уже записанные в `<Properties>` элемента. */
function existingControlledKeys(elementXml?: string): string[] {
  const properties = elementXml ? findPropertiesRange(elementXml) : null;
  if (!properties) {
    return [];
  }
  return collectPropertyBlocks(properties.inner)
    .map((block) => block.key)
    .filter(isTypedFieldControlledPropertyKey);
}

/**
 * Возвращает управляемые свойства элемента, не входящие в состав его пары
 * владелец×роль. Основа проверки `validate_metadata`: платформа 1С отклоняет
 * загрузку конфигурации при свойстве чужого состава («Свойство FillValue не
 * входит в состав объекта метаданных Attribute» у колонки ТЧ справочника).
 *
 * Критерий — ровно тот же {@link getMemberPropertyKeys}, что и у пути записи:
 * иначе валидатор терпел бы порчу, которую сам же set_type чинит.
 */
export function findDisallowedTypedFieldProperties(
  elementXml: string,
  role: TypeAwarePropertyOwnerKind,
  ownerKind?: string
): string[] {
  const members = new Set(getMemberPropertyKeys(role, ownerKind));
  return existingControlledKeys(elementXml).filter((key) => !members.has(key));
}

/**
 * Приводит состав `<Properties>` в соответствие паре владелец×роль после смены
 * `<Type>`. Ровно три действия, всё остальное не трогается:
 *  1) содержимое `<Type>` заменяется на новый тип НА МЕСТЕ;
 *  2) удаляется блок, ключ которого управляемый и не входит в состав пары;
 *  3) дописываются недостающие ключи из {@link getGeneratedPropertyKeys}.
 *
 * Неуправляемые теги (`Use` реквизита справочника, незнакомые свойства будущих
 * версий платформы), порядок, значения и отступы сохраняются байт-в-байт: файл
 * правится точечным splice, а не пересобирается из «разрешённых ключей».
 */
export function normalizeTypedFieldPropertiesAfterTypeChange(
  elementXml: string,
  role: TypeAwarePropertyOwnerKind,
  typeInnerXml: string,
  ownerKind?: string
): string {
  const properties = findPropertiesRange(elementXml);
  if (!properties) {
    return elementXml;
  }
  const eol = detectEol(properties.inner);
  // Блоки перечитываются только после фактической правки: на идемпотентном
  // вызове (тот же тип, состав уже верный) разбор выполняется ровно один раз —
  // иначе обход выгрузки целиком упирался бы в парсинг каждого поля десятки раз.
  let blocks = collectPropertyBlocks(properties.inner);
  let inner = replaceTypeInner(properties.inner, blocks, typeInnerXml, eol);
  if (inner !== properties.inner) {
    blocks = collectPropertyBlocks(inner);
  }

  const members = new Set(getMemberPropertyKeys(role, ownerKind));
  const disallowed = blocks.filter((block) => isTypedFieldControlledPropertyKey(block.key) && !members.has(block.key));
  if (disallowed.length > 0) {
    inner = removeBlocks(inner, disallowed);
    blocks = collectPropertyBlocks(inner);
  }

  const defaults = getFieldDefaultValues(role, ownerKind);
  for (const key of getGeneratedPropertyKeys(role, ownerKind, typeInnerXml)) {
    if (blocks.some((block) => block.key === key)) {
      continue;
    }
    inner = insertBlockInCanonicalPosition(
      inner,
      blocks,
      controlledOrderOf,
      controlledPropertyOrder(key),
      buildDefaultPropertyBlock(key, '', defaults),
      eol
    );
    blocks = collectPropertyBlocks(inner);
  }

  return `${elementXml.slice(0, properties.start)}${inner}${elementXml.slice(properties.end)}`;
}

function controlledOrderOf(key: string): number | undefined {
  return isTypedFieldControlledPropertyKey(key) ? controlledPropertyOrder(key) : undefined;
}

/**
 * Заменяет содержимое `<Type>` на новый тип, сохраняя отступ закрывающего тега
 * из самого файла. Самозакрытый `<Type/>` и отсутствие типа — не её дело:
 * развёрнутый блок в этих случаях ставит вызывающий (`updateTypeInElement`),
 * который знает отступ места вставки.
 */
function replaceTypeInner(
  propertiesInner: string,
  blocks: readonly PropertyBlock[],
  typeInnerXml: string,
  eol: string
): string {
  const block = blocks.find((item) => item.key === 'Type');
  if (!block?.xml.startsWith('<Type>')) {
    return propertiesInner;
  }
  const closeIndent = /\r?\n([ \t]*)<\/Type>$/.exec(block.xml)?.[1] ?? block.indent;
  return replaceBlock(propertiesInner, block, `<Type>${eol}${typeInnerXml}${eol}${closeIndent}</Type>`);
}

function buildDefaultPropertyBlock(
  key: string,
  indent: string,
  defaults: Readonly<Record<string, string>>
): string {
  const value = defaults[key] ?? '';
  if (value === 'nil') {
    return `${indent}<${key} xsi:nil="true"/>`;
  }
  if (value === '') {
    return `${indent}<${key}/>`;
  }
  return `${indent}<${key}>${value}</${key}>`;
}
