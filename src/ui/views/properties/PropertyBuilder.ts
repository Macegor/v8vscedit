import type { NodeKind } from '../../tree/TreeNode';
import type {
  EnumPropertyOption,
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataReferenceListValue,
  MetadataTypeValue,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from './_types';
import {
  escapeXmlText,
  extractElementInnerXml,
  extractFirstBalancedBlock,
  extractRepeatedSimpleTagValues,
  extractSimpleTag,
  extractTopLevelPropertiesChildren,
  extractXmlAttribute,
  stripXmlTagNamespacePrefixes,
} from '../../../infra/xml';
import { isTypedFieldControlledPropertyKey } from '../../../infra/xml/TypedFieldPropertyRules';
import {
  BOOLEAN_PROPERTY_TAGS,
  ENUM_DEFAULTS,
  ENUM_OPTIONS,
  LOCALIZED_PROPERTY_TAGS,
  USE_PURPOSE_OPTIONS,
} from '../../../infra/xml/PropertySchema';
import { parseMetadataType } from './MetadataTypeService';
import {
  formatEnumDisplayValue,
  formatPropertyDisplayValue,
  formatXmlPropertyDisplay,
} from './PropertyPresentationRegistry';
import { getStandardAttributePresentation } from '../../../domain/StandardAttribute';
import {
  coalesceSimpleTagText,
  extractLocalizedStringValue,
  extractPropertiesInnerFromElement,
  extractRootObjectElementXml,
  extractRootObjectPropertiesInnerXml,
  extractTypePropertyInner,
  hasSelfClosingProperty,
  isBooleanScalar,
  propertyTitle,
} from './propertyExtractors';
import {
  COMMAND_PROPERTY_KEYS,
  CONFIGURATION_PROPERTY_KEYS,
  ENUM_VALUE_PROPERTY_KEYS,
  FORM_PROPERTY_KEYS,
  STANDARD_ATTRIBUTE_PROPERTY_KEYS,
  TABULAR_SECTION_PROPERTY_KEYS,
  TEMPLATE_META_PROPERTY_KEYS,
  applyCatalogPropertySections,
  applyDocumentPropertySections,
  getRootPropertyKeyOrder,
  getTypeAwarePropertyKeyOrder,
  getTypedFieldPropertyKeyOrder,
  hasExplicitRootPropertyContract,
  isTypeAwareRootKind,
} from './propertyKeyOrder';

export {
  extractLocalizedStringValue,
  extractPropertiesInnerFromElement,
  extractRootObjectPropertiesInnerXml,
} from './propertyExtractors';
export { getRootPropertyKeyOrder } from './propertyKeyOrder';

/** Свойства, внутри которых хранится состав типа 1С. */
const TYPE_PROPERTY_TAGS = new Set(['Type', 'CommandParameterType']);

const ALWAYS_VISIBLE_STRING_PROPERTY_TAGS = new Set([
  'MethodName',
]);

function buildEnumValueForKey(key: string, current: string, options: EnumPropertyOption[]): EnumPropertyValue {
  const completeOptions = ensureCurrentOptionForKey(key, options, current);
  const opt = completeOptions.find((o) => o.value === current);
  return {
    current,
    currentLabel: opt?.label ?? current,
    allowedValues: completeOptions,
  };
}

function ensureCurrentOptionForKey(
  key: string,
  options: readonly EnumPropertyOption[],
  current: string
): EnumPropertyOption[] {
  const result = [...options];
  if (current && !result.some((option) => option.value === current)) {
    result.push({ value: current, label: formatEnumValueForKey(key, current) });
  }
  return result;
}

function formatEnumValueForKey(key: string, value: string): string {
  if (key === 'Group') {
    const customGroup = /^CommandGroup\.(.+)$/.exec(value);
    if (customGroup) {
      return `Группа команд: ${customGroup[1]}`;
    }
  }
  return formatEnumDisplayValue(value);
}

function ensureSelectedOptions(options: readonly EnumPropertyOption[], selected: readonly string[]): EnumPropertyOption[] {
  const result = [...options];
  for (const value of selected) {
    if (value && !result.some((option) => option.value === value)) {
      result.push({ value, label: formatPropertyDisplayValue(value) });
    }
  }
  return result;
}

/**
 * Собирает строковое свойство из простого тега и/или вложенного XML.
 * Параметр {@code simple} передаётся явно как {@code string | undefined}, без ложного сужения из цикла.
 */
function tryBuildScalarStringPropertyItem(params: {
  key: string;
  propsInner: string;
  simple: string | undefined;
  complexInner: string | undefined;
  showMissing?: boolean;
}): ObjectPropertyItem | null {
  const { key, propsInner, simple, complexInner, showMissing } = params;
  if (
    simple === undefined &&
    complexInner === undefined &&
    !hasSelfClosingProperty(propsInner, key) &&
    !ALWAYS_VISIBLE_STRING_PROPERTY_TAGS.has(key) &&
    showMissing !== true
  ) {
    return null;
  }
  return {
    key,
    title: propertyTitle(key),
    kind: 'string',
    value:
      complexInner?.trim().includes('<')
        ? formatReadonlyXmlProperty(key, complexInner)
        : simple === undefined
        ? ''
        : formatPropertyDisplayValue(simple),
    readonly: Boolean(complexInner?.trim().includes('<')),
  };
}

/**
 * Строит список свойств из XML-текста блока {@code Properties} (или целого фрагмента элемента).
 */
export function buildPropertyItemsForKeys(
  xmlOrPropertiesInner: string,
  orderedKeys: string[],
  options?: { elementXmlForType?: string; showMissingKeys?: boolean }
): ObjectPropertiesCollection {
  const propsInner = extractPropertiesInnerFromElement(xmlOrPropertiesInner) ?? xmlOrPropertiesInner;
  const typeSource = options?.elementXmlForType ?? xmlOrPropertiesInner;
  const childrenByTag = new Map(
    extractTopLevelPropertiesChildren(`<Properties>${propsInner}</Properties>`).map((child) => [child.tag, child.inner])
  );
  const items: ObjectPropertyItem[] = [];

  for (const key of orderedKeys) {
    if (TYPE_PROPERTY_TAGS.has(key)) {
      const typeInner = extractTypePropertyInner(typeSource.includes('<Properties>') ? typeSource : propsInner, key);
      if (!typeInner && !propsInner.includes(`<${key}`) && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataType',
        value: parseMetadataType(typeInner),
      });
      continue;
    }

    if (key === 'UsePurposes') {
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'multiEnum',
        value: {
          selected: extractUsePurposeValues(childrenByTag.get(key) ?? ''),
          allowedValues: [...USE_PURPOSE_OPTIONS],
        },
      });
      continue;
    }

    if (LOCALIZED_PROPERTY_TAGS.has(key)) {
      const loc = extractLocalizedStringValue(propsInner, key);
      if (!loc.presentation && loc.values.length === 0 && !propsInner.includes(`<${key}`) && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'localizedString',
        value: loc,
      });
      continue;
    }

    const rawSimpleValue = extractSimpleTag(propsInner, key);

    if (key === 'Owners') {
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataReferenceList',
        value: buildMetadataReferenceListValue(childrenByTag.get(key) ?? ''),
      });
      continue;
    }

    if (key === 'InputByString' || key === 'DataLockFields') {
      if (!propsInner.includes(`<${key}`) && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataReferenceList',
        value: buildMetadataReferenceListValue(childrenByTag.get(key) ?? '', 'Field', formatMetadataFieldDisplay),
      });
      continue;
    }

    if (key === 'BasedOn') {
      if (!propsInner.includes('<BasedOn') && options?.showMissingKeys !== true) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'metadataReferenceList',
        value: buildMetadataReferenceListValue(childrenByTag.get(key) ?? ''),
      });
      continue;
    }

    const isKnownBoolean = BOOLEAN_PROPERTY_TAGS.has(key);
    if (isKnownBoolean || isBooleanScalar(rawSimpleValue)) {
      if (!isKnownBoolean && !propsInner.includes(`<${key}>`)) {
        continue;
      }
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: (rawSimpleValue ?? 'false').trim().toLowerCase() === 'true',
      });
      continue;
    }

    const enumOptions = ENUM_OPTIONS[key] as readonly EnumPropertyOption[] | undefined;
    if (enumOptions) {
      if (!propsInner.includes(`<${key}>`) && options?.showMissingKeys !== true) {
        continue;
      }
      const current = coalesceSimpleTagText(rawSimpleValue) || ENUM_DEFAULTS[key] || enumOptions[0]?.value || '';
      items.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValueForKey(key, current, [...enumOptions]),
      });
      continue;
    }

    const scalarString = tryBuildScalarStringPropertyItem({
      key,
      propsInner,
      simple: rawSimpleValue,
      complexInner: childrenByTag.get(key),
      showMissing: options?.showMissingKeys === true,
    });
    if (!scalarString) {
      continue;
    }
    items.push(scalarString);
  }

  return items;
}

/**
 * Строит свойства с учётом заимствования: локальное значение имеет приоритет,
 * совпадающее с основной конфигурацией значение считается унаследованным.
 */
export function buildEffectivePropertyItemsForKeys(
  localXmlOrPropertiesInner: string,
  inheritedXmlOrPropertiesInner: string | null | undefined,
  orderedKeys: string[],
  options?: {
    elementXmlForType?: string;
    inheritedElementXmlForType?: string;
    includeExtraKeys?: boolean;
    excludeExtraKey?: (key: string) => boolean;
    showMissingKeys?: boolean;
  }
): ObjectPropertiesCollection {
  const localEffectiveKeys = options?.includeExtraKeys
    ? extendKeysWithTopLevelProperties(orderedKeys, [localXmlOrPropertiesInner], options.excludeExtraKey)
    : orderedKeys;

  if (!inheritedXmlOrPropertiesInner) {
    return buildPropertyItemsForKeys(localXmlOrPropertiesInner, localEffectiveKeys, {
      elementXmlForType: options?.elementXmlForType,
      showMissingKeys: options?.showMissingKeys,
    }).map(markLocal);
  }

  const effectiveKeys = options?.includeExtraKeys
    ? extendKeysWithTopLevelProperties(
        orderedKeys,
        [localXmlOrPropertiesInner, inheritedXmlOrPropertiesInner],
        options.excludeExtraKey
      )
    : orderedKeys;

  const localItems = buildPropertyItemsForKeys(localXmlOrPropertiesInner, effectiveKeys, {
    elementXmlForType: options?.elementXmlForType,
    showMissingKeys: options?.showMissingKeys,
  });
  const inheritedItems = buildPropertyItemsForKeys(inheritedXmlOrPropertiesInner, effectiveKeys, {
    elementXmlForType: options?.inheritedElementXmlForType ?? inheritedXmlOrPropertiesInner,
    showMissingKeys: options?.showMissingKeys,
  });

  const localByKey = new Map(localItems.map((item) => [item.key, item]));
  const inheritedByKey = new Map(inheritedItems.map((item) => [item.key, item]));
  const result: ObjectPropertyItem[] = [];

  for (const key of effectiveKeys) {
    const local = localByKey.get(key);
    const inherited = inheritedByKey.get(key);
    if (local && inherited && arePropertyItemsEquivalent(local, inherited)) {
      result.push(markInherited(local));
      continue;
    }
    if (local) {
      result.push(markLocal(local));
      continue;
    }
    if (inherited) {
      result.push(markInherited(inherited));
    }
  }

  return result;
}

/** Свойства корневого объекта метаданных по его полному XML */
export function buildRootMetaObjectProperties(
  fullObjectXml: string,
  rootMetaKind: NodeKind,
  inheritedFullObjectXml?: string | null
): ObjectPropertiesCollection {
  if (isTypeAwareRootKind(rootMetaKind)) {
    return buildTypeAwareRootProperties(
      extractRootObjectElementXml(fullObjectXml) ?? fullObjectXml,
      inheritedFullObjectXml ? extractRootObjectElementXml(inheritedFullObjectXml) ?? inheritedFullObjectXml : null,
      rootMetaKind
    );
  }

  const inner = extractRootObjectPropertiesInnerXml(fullObjectXml);
  if (!inner) {
    return [];
  }
  const inheritedInner = inheritedFullObjectXml
    ? extractRootObjectPropertiesInnerXml(inheritedFullObjectXml)
    : null;
  const properties = buildEffectivePropertyItemsForKeys(inner, inheritedInner, getRootPropertyKeyOrder(rootMetaKind), {
    includeExtraKeys: true,
    showMissingKeys: hasExplicitRootPropertyContract(rootMetaKind),
  });
  if (rootMetaKind === 'Catalog') {
    return applyCatalogPropertySections(properties);
  }
  if (rootMetaKind === 'Document') {
    return applyDocumentPropertySections(properties);
  }
  return properties;
}

/** Свойства корневого объекта, где состав полей зависит от блока `<Type>`. */
export function buildTypeAwareRootProperties(
  elementFullXml: string,
  inheritedElementFullXml: string | null | undefined,
  kind: 'Constant' | 'CommonAttribute'
): ObjectPropertiesCollection {
  const keySource = elementFullXml || (inheritedElementFullXml ?? '');
  return buildEffectivePropertyItemsForKeys(
    elementFullXml,
    inheritedElementFullXml,
    getTypeAwarePropertyKeyOrder(keySource, kind),
    {
      elementXmlForType: elementFullXml,
      inheritedElementXmlForType: inheritedElementFullXml ?? undefined,
      includeExtraKeys: true,
      excludeExtraKey: isTypedFieldControlledPropertyKey,
      showMissingKeys: true,
    }
  );
}

/** Свойства самой конфигурации или расширения из корневого Configuration.xml */
export function buildConfigurationProperties(fullConfigXml: string): ObjectPropertiesCollection {
  const propertiesInner = extractFirstBalancedBlock(fullConfigXml, 'Properties');
  if (propertiesInner === null) {
    return [];
  }

  const children = extractTopLevelPropertiesChildren(`<Properties>${propertiesInner}</Properties>`);
  const byTag = new Map(children.map((child) => [child.tag, child.inner]));
  const orderedKeys = extendKeysWithTopLevelProperties(CONFIGURATION_PROPERTY_KEYS, [propertiesInner]);
  const roleOptions = buildRoleOptions(fullConfigXml);
  const result: ObjectPropertyItem[] = [];

  for (const key of orderedKeys) {
    if (!byTag.has(key)) {
      continue;
    }

    if (key === 'UsePurposes') {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'multiEnum',
        value: {
          selected: extractUsePurposeValues(byTag.get(key) ?? ''),
          allowedValues: [...USE_PURPOSE_OPTIONS],
        },
      });
      continue;
    }

    if (key === 'DefaultRoles') {
      const selected = extractDefaultRoleValues(byTag.get(key) ?? '');
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'multiEnum',
        value: {
          selected,
          allowedValues: ensureSelectedOptions(roleOptions, selected),
        },
      });
      continue;
    }

    if (LOCALIZED_PROPERTY_TAGS.has(key)) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'localizedString',
        value: extractLocalizedStringValue(propertiesInner, key),
      });
      continue;
    }

    const rawSimpleValue = extractSimpleTag(propertiesInner, key);

    // Known-boolean тег остаётся boolean при ЛЮБОМ значении (в т.ч. пустом/self-closing):
    // раньше конъюнкция `(... || isBooleanScalar) && isBooleanScalar` схлопывалась в
    // `isBooleanScalar`, из-за чего known-boolean тег без 'true'/'false' уезжал в enum/string.
    // Эталон — buildPropertyItemsForKeys (~1795): правильное ИЛИ.
    if (BOOLEAN_PROPERTY_TAGS.has(key) || isBooleanScalar(rawSimpleValue)) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'boolean',
        value: (rawSimpleValue ?? 'false').trim().toLowerCase() === 'true',
      });
      continue;
    }

    const enumOptions = ENUM_OPTIONS[key] as readonly EnumPropertyOption[] | undefined;
    if (enumOptions) {
      result.push({
        key,
        title: propertyTitle(key),
        kind: 'enum',
        value: buildEnumValueForKey(key, coalesceSimpleTagText(rawSimpleValue).trim(), [...enumOptions]),
      });
      continue;
    }

    const inner = byTag.get(key) ?? '';
    const configString = tryBuildScalarStringPropertyItem({
      key,
      propsInner: propertiesInner,
      simple: rawSimpleValue,
      complexInner: inner,
    });
    if (!configString) {
      continue;
    }
    result.push(configString);
  }

  return result;
}

/** Свойства типового реквизита / измерения / ресурса / колонки */
export function buildTypedFieldProperties(
  elementFullXml: string,
  inheritedElementFullXml?: string | null
): ObjectPropertiesCollection {
  const keySource = elementFullXml || (inheritedElementFullXml ?? '');
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, getTypedFieldPropertyKeyOrder(keySource), {
    elementXmlForType: elementFullXml,
    inheritedElementXmlForType: inheritedElementFullXml ?? undefined,
    includeExtraKeys: true,
    excludeExtraKey: isTypedFieldControlledPropertyKey,
    showMissingKeys: true,
  });
}

function extractUsePurposeValues(innerXml: string): string[] {
  return extractRepeatedSimpleTagValues(innerXml, 'Value');
}

function extractDefaultRoleValues(innerXml: string): string[] {
  return extractRepeatedSimpleTagValues(innerXml, 'Item');
}

function buildRoleOptions(fullConfigXml: string): EnumPropertyOption[] {
  const childObjectsInner = extractFirstBalancedBlock(fullConfigXml, 'ChildObjects') ?? '';
  const roles = extractRepeatedSimpleTagValues(childObjectsInner, 'Role');
  return roles.map((role) => ({
    value: role.includes('.') ? role : `Role.${role}`,
    label: formatPropertyDisplayValue(role.includes('.') ? role : `Role.${role}`),
  }));
}

function formatReadonlyXmlProperty(key: string, innerXml: string): string {
  return formatXmlPropertyDisplay(key, innerXml);
}

function buildMetadataReferenceListValue(
  innerXml: string,
  itemLocalName = 'Item',
  formatDisplay: (canonical: string) => string = formatPropertyDisplayValue
): MetadataReferenceListValue {
  return {
    items: extractRepeatedSimpleTagValues(innerXml, itemLocalName)
      .map((canonical) => ({
        canonical,
        display: formatDisplay(canonical),
      })),
  };
}

function formatMetadataFieldDisplay(canonical: string): string {
  const standardAttribute = /\.StandardAttribute\.([A-Za-z][A-Za-z0-9]*)$/.exec(canonical);
  if (standardAttribute) {
    return getStandardAttributePresentation(standardAttribute[1]);
  }
  const namedField = /\.(?:Attribute|Dimension|Resource)\.([^.]+)$/.exec(canonical);
  if (namedField) {
    return namedField[1];
  }
  return canonical.split('.').at(-1) ?? canonical;
}

export function buildStandardAttributeProperties(
  elementXml: string,
  inheritedElementXml?: string | null
): ObjectPropertiesCollection {
  const local = normalizeStandardAttributeElementXml(elementXml);
  const inherited = inheritedElementXml ? normalizeStandardAttributeElementXml(inheritedElementXml) : null;
  return buildEffectivePropertyItemsForKeys(local, inherited, STANDARD_ATTRIBUTE_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

function normalizeStandardAttributeElementXml(elementXml: string): string {
  if (!elementXml.trim()) {
    return '';
  }
  const name = extractXmlAttribute(elementXml, 'name') ?? '';
  const inner = extractElementInnerXml(elementXml);
  const normalizedInner = stripXmlTagNamespacePrefixes(inner);
  const displayName = escapeXmlText(getStandardAttributePresentation(name));
  return `<StandardAttribute><Properties><Name>${displayName}</Name>${normalizedInner}</Properties></StandardAttribute>`;
}

export function buildTabularSectionProperties(
  elementFullXml: string,
  inheritedElementFullXml?: string | null
): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TABULAR_SECTION_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

export function buildFormLikeProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, FORM_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

export function buildCommandProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, COMMAND_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

export function buildEnumValueProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, ENUM_VALUE_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

/** Свойства макета по файлу описания в каталоге Templates */
export function buildTemplateMetaProperties(elementFullXml: string, inheritedElementFullXml?: string | null): ObjectPropertiesCollection {
  return buildEffectivePropertyItemsForKeys(elementFullXml, inheritedElementFullXml, TEMPLATE_META_PROPERTY_KEYS, {
    includeExtraKeys: true,
    showMissingKeys: true,
  });
}

const READONLY_SYSTEM_PROPERTY_KEYS = new Set(['ObjectBelonging', 'ExtendedConfigurationObject']);

function markInherited(item: ObjectPropertyItem): ObjectPropertyItem {
  return {
    ...item,
    inherited: true,
    readonly: true,
    source: 'inherited',
  };
}

function markLocal(item: ObjectPropertyItem): ObjectPropertyItem {
  if (!READONLY_SYSTEM_PROPERTY_KEYS.has(item.key)) {
    return {
      ...item,
      source: 'local',
    };
  }

  return {
    ...item,
    readonly: true,
    source: 'local',
  };
}

function extendKeysWithTopLevelProperties(
  orderedKeys: string[],
  sources: string[],
  excludeKey?: (key: string) => boolean
): string[] {
  const result = [...orderedKeys];
  const seen = new Set(result);

  for (const source of sources) {
    const propertiesXml = source.includes('<Properties') ? source : `<Properties>${source}</Properties>`;
    for (const child of extractTopLevelPropertiesChildren(propertiesXml)) {
      if (seen.has(child.tag) || excludeKey?.(child.tag)) {
        continue;
      }
      seen.add(child.tag);
      result.push(child.tag);
    }
  }

  return result;
}

function arePropertyItemsEquivalent(left: ObjectPropertyItem, right: ObjectPropertyItem): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case 'boolean':
      return left.value === right.value;
    case 'enum':
      return (left.value as EnumPropertyValue).current === (right.value as EnumPropertyValue).current;
    case 'multiEnum':
      return areStringArraysEquivalent(
        (left.value as MultiEnumPropertyValue).selected,
        (right.value as MultiEnumPropertyValue).selected
      );
    case 'localizedString':
      return areLocalizedValuesEquivalent(left.value as LocalizedStringValue, right.value as LocalizedStringValue);
    case 'metadataType':
      return areMetadataTypesEquivalent(left.value as MetadataTypeValue, right.value as MetadataTypeValue);
    case 'string':
    default:
      return normalizeScalarValue(left.value as string) === normalizeScalarValue(right.value as string);
  }
}

function areStringArraysEquivalent(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function areLocalizedValuesEquivalent(left: LocalizedStringValue, right: LocalizedStringValue): boolean {
  if (normalizeScalarValue(left.presentation) !== normalizeScalarValue(right.presentation)) {
    return false;
  }
  if (left.values.length !== right.values.length) {
    return false;
  }
  return left.values.every((item, index) => {
    const other = right.values.at(index);
    return item.lang === other?.lang && normalizeScalarValue(item.content) === normalizeScalarValue(other.content);
  });
}

function areMetadataTypesEquivalent(left: MetadataTypeValue, right: MetadataTypeValue): boolean {
  if (left.items.length !== right.items.length) {
    return false;
  }
  const sameItems = left.items.every((item, index) => item.canonical === right.items[index]?.canonical);
  if (!sameItems) {
    return false;
  }
  return (
    JSON.stringify(left.stringQualifiers ?? null) === JSON.stringify(right.stringQualifiers ?? null) &&
    JSON.stringify(left.numberQualifiers ?? null) === JSON.stringify(right.numberQualifiers ?? null) &&
    JSON.stringify(left.dateQualifiers ?? null) === JSON.stringify(right.dateQualifiers ?? null)
  );
}

function normalizeScalarValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
