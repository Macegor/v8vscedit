import type { ConfigurationXmlEditor, SubsystemPropertyKey, SubsystemXmlService } from '../../infra/xml';
import type {
  EnumPropertyOption,
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataTypeItem,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
} from '../tree/nodeBuilders/_types';
import type { MetadataNode } from '../tree/TreeNode';
import { getHandlerForNode } from '../tree/nodeBuilders';
import {
  isRootObjectNode,
  resolvePropertyTarget,
  resolveTypeRegistryFilter,
  resolveTypeTarget,
} from '../views/properties/PropertiesTargetResolver';
import { toCanonicalPropertyInput } from '../views/properties/PropertyPresentationRegistry';
import { TypeRegistryService } from '../views/properties/TypeRegistryService';
import {
  buildCommandParameterTypeInnerXml,
  buildMetadataTypeInnerXml,
  buildMetadataTypeItem,
} from '../views/properties/MetadataTypeService';
import { buildEventSourceInnerXml } from '../views/properties/EventSubscriptionPropertyService';
import type { MetadataTypeValue } from '../views/properties/_types';

export interface McpPropertyContract {
  readonly propertyKey: string;
  readonly title: string;
  readonly kind: string;
  readonly readonly: boolean;
  readonly currentValue: unknown;
  readonly allowedValues?: readonly { readonly value: string; readonly label: string }[];
  readonly supportedBySetProperty: boolean;
  readonly notes: readonly string[];
}

export interface McpPropertyMutationResult {
  readonly success: boolean;
  readonly changed: boolean;
  readonly message: string;
  readonly changedFiles: readonly string[];
}

export interface McpSetPropertiesAppliedItem {
  readonly propertyKey: string;
  readonly changed: boolean;
  readonly message: string;
}

export interface McpSetPropertiesFailedItem {
  readonly propertyKey: string;
  readonly message: string;
}

export interface McpSetPropertiesResult {
  readonly applied: readonly McpSetPropertiesAppliedItem[];
  readonly failed: readonly McpSetPropertiesFailedItem[];
  readonly changedFiles: readonly string[];
}

export interface McpSetTypeInput {
  readonly items: readonly string[];
  readonly stringQualifiers?: {
    readonly length?: number;
    readonly allowedLength?: 'Variable' | 'Fixed';
  };
  readonly numberQualifiers?: {
    readonly digits?: number;
    readonly fractionDigits?: number;
    readonly allowedSign?: 'Any' | 'Nonnegative';
  };
  readonly dateQualifiers?: {
    readonly dateFractions?: 'Date' | 'DateTime' | 'Time';
  };
}

export interface McpTypeOption {
  readonly value: string;
  readonly canonical: string;
  readonly display: string;
  readonly aliases: readonly string[];
}

export interface McpTypeGroup {
  readonly id: string;
  readonly title: string;
  readonly items: readonly McpTypeOption[];
}

const SPECIALIZED_PROPERTY_KEYS = new Set([
  'FillValue',
  'MinValue',
  'MaxValue',
]);

/**
 * Контракт и запись простых свойств для MCP.
 * Перед изменением всегда строится фактическое свойство выбранного узла,
 * поэтому enum/boolean/readonly проверяются теми же обработчиками дерева,
 * которые питают панель свойств.
 */
export class McpPropertyService {
  private readonly typeRegistry = new TypeRegistryService();

  constructor(
    private readonly xmlEditor: ConfigurationXmlEditor,
    private readonly subsystemXmlService?: SubsystemXmlService
  ) {}

  getPropertyContracts(node: MetadataNode): McpPropertyContract[] {
    return this.getEditableProperties(node).map((property) => this.buildPropertyContract(node, property));
  }

  getPropertyContract(node: MetadataNode, propertyKey: string): McpPropertyContract {
    const property = this.findProperty(node, propertyKey);
    if (!property) {
      throw new Error(`Свойство "${propertyKey}" недоступно для узла "${node.textLabel}".`);
    }
    return this.buildPropertyContract(node, property);
  }

  getAvailableTypes(node: MetadataNode | undefined, propertyKey = 'Type'): McpTypeGroup[] {
    const sourceXmlPath = node?.metaContext?.ownerObjectXmlPath ?? node?.xmlPath;
    return this.typeRegistry
      .getAvailableTypes(sourceXmlPath, resolveTypeRegistryFilter(this.normalizePropertyKeyForNode(node, propertyKey)))
      .map((group) => ({
        id: group.id,
        title: group.title,
        items: group.items.map((item) => this.toTypeOption(item)),
      }));
  }

  setType(node: MetadataNode, propertyKey: string, value: unknown): McpPropertyMutationResult {
    propertyKey = this.normalizePropertyKeyForNode(node, propertyKey);
    const property = this.findProperty(node, propertyKey);
    if (!property) {
      throw new Error(`Свойство "${propertyKey}" недоступно для узла "${node.textLabel}".`);
    }
    if (property.readonly) {
      throw new Error(`Свойство "${propertyKey}" доступно только для чтения.`);
    }
    if (property.kind !== 'metadataType') {
      throw new Error(`Свойство "${propertyKey}" не является типом.`);
    }
    const typeTarget = resolveTypeTarget(node, propertyKey);
    if (!typeTarget) {
      throw new Error(`Для узла "${node.textLabel}" изменение типа не поддерживается.`);
    }

    const typeValue = this.normalizeTypeInput(value, node, propertyKey);
    const typeInnerXml = propertyKey === 'Source'
      ? buildEventSourceInnerXml(typeValue)
      : propertyKey === 'CommandParameterType'
      ? buildCommandParameterTypeInnerXml(typeValue)
      : buildMetadataTypeInnerXml(typeValue);
    const saved = this.xmlEditor.modifyObjectType(typeTarget.xmlPath, {
      targetKind: typeTarget.targetKind,
      targetName: typeTarget.targetName,
      tabularSectionName: typeTarget.tabularSectionName,
      propertyName: propertyKey === 'Source' ? 'Source' : propertyKey === 'CommandParameterType' ? 'CommandParameterType' : 'Type',
      typeInnerXml,
    });
    return this.toMutationResult(saved.success, saved.changed, propertyKey, saved.changedFiles, saved.errors);
  }

  private buildPropertyContract(node: MetadataNode, property: ObjectPropertyItem): McpPropertyContract {
    const allowedValues = property.kind === 'enum'
      ? (property.value as EnumPropertyValue).allowedValues
      : property.kind === 'multiEnum'
        ? (property.value as MultiEnumPropertyValue).allowedValues
        : undefined;

    const supportedBySetProperty = !SPECIALIZED_PROPERTY_KEYS.has(property.key) && (
      property.kind === 'string' ||
      property.kind === 'boolean' ||
      property.kind === 'enum' ||
      property.kind === 'multiEnum' ||
      property.kind === 'localizedString'
    ) && !(property.key === 'Name' && this.isRootRename(node));

    const notes = supportedBySetProperty
      ? []
      : SPECIALIZED_PROPERTY_KEYS.has(property.key)
        ? ['Свойство хранит типизированное XML-значение; запись простой строкой через set_property запрещена.']
      : property.key === 'Name' && this.isRootRename(node)
        ? ['Переименование корневого объекта выполняется отдельным инструментом, чтобы обновить файл, ссылки и кэш дерева.']
      : property.kind === 'metadataType'
        ? [buildMetadataTypeNote(property.key)]
        : ['Для этого свойства нужен специализированный инструмент с дополнительным контрактом значения.'];

    return {
      propertyKey: property.key,
      title: property.title,
      kind: property.kind,
      readonly: property.readonly === true,
      currentValue: this.describeCurrentValue(property),
      allowedValues,
      supportedBySetProperty,
      notes,
    };
  }

  setProperty(node: MetadataNode, propertyKey: string, value: unknown): McpPropertyMutationResult {
    propertyKey = this.normalizePropertyKeyForNode(node, propertyKey);
    const property = this.findProperty(node, propertyKey);
    if (!property) {
      throw new Error(`Свойство "${propertyKey}" недоступно для узла "${node.textLabel}".`);
    }
    if (property.readonly) {
      throw new Error(`Свойство "${propertyKey}" доступно только для чтения.`);
    }
    if (SPECIALIZED_PROPERTY_KEYS.has(property.key)) {
      throw new Error(`Свойство "${propertyKey}" требует специализированного инструмента.`);
    }
    if (property.key === 'Name' && this.isRootRename(node)) {
      throw new Error('Переименование корневого объекта через set_property запрещено: нужен отдельный инструмент.');
    }

    const normalized = this.normalizeInput(property, value);
    if (node.nodeKind === 'Subsystem') {
      if (!node.xmlPath || !this.subsystemXmlService) {
        throw new Error(`Для узла "${node.textLabel}" изменение свойств не поддерживается.`);
      }
      const changed = this.subsystemXmlService.updateProperty(
        node.xmlPath,
        property.key as SubsystemPropertyKey,
        Array.isArray(normalized) ? normalized.join(', ') : normalized
      );
      return this.toMutationResult(true, changed, property.key, changed ? [node.xmlPath] : [], []);
    }

    if (node.nodeKind === 'configuration' || node.nodeKind === 'extension') {
      if (property.kind === 'multiEnum' && !Array.isArray(normalized)) {
        throw new Error(`Свойство "${propertyKey}" ожидает массив строк.`);
      }
      const kind = property.kind === 'localizedString'
        ? 'localized'
        : property.kind === 'boolean'
          ? 'boolean'
          : property.kind === 'multiEnum'
            ? 'multiEnum'
            : property.key === 'DefaultLanguage'
              ? 'reference'
              : 'scalar';
      const saved = this.xmlEditor.modifyConfigurationProperty(
        node.xmlPath ?? '',
        property.key,
        typeof normalized === 'string' && (kind === 'scalar' || kind === 'reference')
          ? toCanonicalPropertyInput(normalized)
          : normalized,
        kind
      );
      return this.toMutationResult(saved.success, saved.changed, property.key, saved.changedFiles, saved.errors);
    }

    const target = resolvePropertyTarget(node);
    if (!target) {
      throw new Error(`Для узла "${node.textLabel}" изменение свойств не поддерживается.`);
    }
    if (property.kind === 'multiEnum') {
      throw new Error('Множественные enum-свойства сейчас поддержаны только для корня конфигурации.');
    }

    const valueKind = property.kind === 'enum' ? 'string' : property.kind;
    if (valueKind !== 'string' && valueKind !== 'boolean' && valueKind !== 'localizedString') {
      throw new Error(`Свойство "${propertyKey}" требует специализированного инструмента.`);
    }

    const saved = this.xmlEditor.modifyObjectProperty(target.xmlPath, {
      targetKind: target.targetKind,
      targetName: target.targetName,
      tabularSectionName: target.tabularSectionName,
      propertyKey: property.key,
      valueKind,
      value: typeof normalized === 'string' ? this.toCanonicalObjectPropertyInput(property.key, normalized) : normalized,
    });
    return this.toMutationResult(saved.success, saved.changed, property.key, saved.changedFiles, saved.errors);
  }

  /**
   * Пакетная установка простых свойств за один проход.
   * Последовательно вызывает `setProperty` для каждой пары; ошибки одной пары
   * не прерывают цикл. Возвращает массивы успешных и неуспешных применений
   * и объединённый уникальный список изменённых файлов. Накопление файлов
   * нужно, чтобы вызывающий код (V8McpServer) сделал один общий
   * `afterMutation`, а не дёргал refresh дерева на каждое свойство.
   */
  setProperties(node: MetadataNode, properties: Record<string, unknown>): McpSetPropertiesResult {
    const applied: McpSetPropertiesAppliedItem[] = [];
    const failed: McpSetPropertiesFailedItem[] = [];
    const changedFiles = new Set<string>();
    for (const [propertyKey, value] of Object.entries(properties)) {
      try {
        const result = this.setProperty(node, propertyKey, value);
        if (result.success) {
          applied.push({
            propertyKey,
            changed: result.changed,
            message: result.message,
          });
          for (const file of result.changedFiles) {
            changedFiles.add(file);
          }
        } else {
          failed.push({ propertyKey, message: result.message });
        }
      } catch (error) {
        failed.push({
          propertyKey,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { applied, failed, changedFiles: [...changedFiles] };
  }

  rename(node: MetadataNode, newName: string): McpPropertyMutationResult {
    const target = resolvePropertyTarget(node);
    if (!target) {
      throw new Error(`Для узла "${node.textLabel}" переименование не поддерживается.`);
    }
    if (!isRootObjectNode(node, target)) {
      return this.setProperty(node, 'Name', newName);
    }

    const validation = this.xmlEditor.validateRenameMetadataObject(target.xmlPath, node.nodeKind, newName.trim());
    if (!validation.success) {
      return this.toMutationResult(false, false, 'Name', [], validation.errors);
    }
    const saved = this.xmlEditor.renameMetadataObject(target.xmlPath, node.nodeKind, newName.trim());
    return this.toMutationResult(saved.success, saved.changed, 'Name', saved.changedFiles, saved.errors);
  }

  private findProperty(node: MetadataNode, propertyKey: string): ObjectPropertyItem | undefined {
    const normalized = normalizeForCompare(propertyKey);
    return this.getEditableProperties(node).find((property) => (
      normalizeForCompare(property.key) === normalized ||
      normalizeForCompare(property.title) === normalized
    ));
  }

  private getEditableProperties(node: MetadataNode): ObjectPropertyItem[] {
    const handler = getHandlerForNode(node);
    if (!handler?.canShowProperties?.(node) || !handler.getProperties) {
      return [];
    }
    return handler.getProperties(node);
  }

  private normalizeInput(property: ObjectPropertyItem, value: unknown): string | boolean | string[] {
    if (property.kind === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`Свойство "${property.key}" ожидает boolean.`);
      }
      return value;
    }
    if (property.kind === 'multiEnum') {
      if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
        throw new Error(`Свойство "${property.key}" ожидает массив строк.`);
      }
      const allowed = new Set((property.value as MultiEnumPropertyValue).allowedValues.map((item) => item.value));
      const normalized = value.map((item) => normalizeEnumInput(item, (property.value as MultiEnumPropertyValue).allowedValues));
      const invalid = normalized.filter((item) => !allowed.has(item));
      if (invalid.length > 0) {
        throw new Error(`Недопустимые значения свойства "${property.key}": ${invalid.join(', ')}.`);
      }
      return normalized;
    }
    if (property.kind === 'enum') {
      if (typeof value !== 'string') {
        throw new Error(`Свойство "${property.key}" ожидает строку.`);
      }
      const allowed = new Set((property.value as EnumPropertyValue).allowedValues.map((item) => item.value));
      const normalized = normalizeEnumInput(value, (property.value as EnumPropertyValue).allowedValues);
      if (!allowed.has(normalized)) {
        throw new Error(`Недопустимое значение свойства "${property.key}": ${value}.`);
      }
      return normalized;
    }
    if (property.kind === 'string' || property.kind === 'localizedString') {
      if (typeof value !== 'string') {
        throw new Error(`Свойство "${property.key}" ожидает строку.`);
      }
      return value;
    }
    throw new Error(`Свойство "${property.key}" требует специализированного инструмента.`);
  }

  private describeCurrentValue(property: ObjectPropertyItem): unknown {
    if (property.kind === 'localizedString') {
      return (property.value as LocalizedStringValue).presentation;
    }
    if (property.kind === 'enum') {
      return (property.value as EnumPropertyValue).current;
    }
    if (property.kind === 'multiEnum') {
      return (property.value as MultiEnumPropertyValue).selected;
    }
    if (property.kind === 'metadataType') {
      return property.value;
    }
    return property.value;
  }

  private normalizeTypeInput(value: unknown, node: MetadataNode, propertyKey: string): MetadataTypeValue {
    const input = readTypeInput(value);
    const allowed = new Map<string, MetadataTypeItem>();
    for (const group of this.getAvailableTypes(node, propertyKey)) {
      for (const item of group.items) {
        for (const alias of item.aliases) {
          allowed.set(normalizeForCompare(alias), {
            canonical: item.canonical,
            display: item.display,
            group: buildMetadataTypeItem(item.canonical).group,
          });
        }
      }
    }

    const normalizedItems = input.items.map((item) => allowed.get(normalizeForCompare(item)));
    const invalid = input.items.filter((_, index) => !normalizedItems[index]);
    if (invalid.length > 0) {
      const examples = [...new Set([...allowed.values()].map((item) => item.display))].slice(0, 20).join(', ');
      throw new Error(`Недопустимые типы для свойства "${propertyKey}": ${invalid.join(', ')}. Доступные примеры: ${examples}.`);
    }

    const items = normalizedItems.filter((item): item is MetadataTypeItem => Boolean(item));
    return {
      items,
      stringQualifiers: input.stringQualifiers,
      numberQualifiers: input.numberQualifiers,
      dateQualifiers: input.dateQualifiers,
      presentation: items.map((item) => item.display).join(', '),
      rawInnerXml: '',
    };
  }

  private normalizePropertyKeyForNode(node: MetadataNode | undefined, propertyKey: string): string {
    if (!node) {
      return normalizePropertyKey(propertyKey);
    }
    return this.findProperty(node, propertyKey)?.key ?? normalizePropertyKey(propertyKey);
  }

  private toTypeOption(item: MetadataTypeItem): McpTypeOption {
    const aliases = unique([
      item.display,
      item.canonical,
      toRussianTypeAlias(item.canonical),
    ]);
    return {
      value: item.display,
      canonical: item.canonical,
      display: item.display,
      aliases,
    };
  }

  private isRootRename(node: MetadataNode): boolean {
    const target = resolvePropertyTarget(node);
    return Boolean(target && isRootObjectNode(node, target));
  }

  private toCanonicalObjectPropertyInput(propertyKey: string, value: string): string {
    if (propertyKey === 'MethodName') {
      return normalizeMethodName(value);
    }
    return toCanonicalPropertyInput(value);
  }

  private toMutationResult(
    success: boolean,
    changed: boolean,
    propertyKey: string,
    changedFiles: readonly string[],
    errors: readonly string[]
  ): McpPropertyMutationResult {
    if (!success) {
      return {
        success: false,
        changed: false,
        message: errors[0] ?? `Не удалось изменить свойство "${propertyKey}".`,
        changedFiles: [],
      };
    }
    return {
      success: true,
      changed,
      message: changed ? `Свойство "${propertyKey}" изменено.` : `Свойство "${propertyKey}" не изменилось.`,
      changedFiles,
    };
  }
}

/**
 * Подсказка в `notes` для свойств с типом `metadataType`. Поясняет, каким
 * инструментом менять значение и где брать список доступных типов.
 */
function buildMetadataTypeNote(propertyKey: string): string {
  if (propertyKey === 'Source') {
    return 'Тип источника подписки. Для смены вызови v8vscedit_set_type с propertyKey="Source". Доступные источники — v8vscedit_list_available_types.';
  }
  if (propertyKey === 'CommandParameterType') {
    return 'Тип параметра команды. Для смены вызови v8vscedit_set_type с propertyKey="CommandParameterType".';
  }
  return 'Для смены значения вызови v8vscedit_set_type. Список доступных типов конфигурации возвращает v8vscedit_list_available_types с теми же path и propertyKey, базовый реестр типов — v8vscedit_list_supported_types.';
}

function readTypeInput(value: unknown): McpSetTypeInput {
  if (typeof value === 'string') {
    const items = splitTypeItems(value);
    if (items.length === 0) {
      throw new Error('Нужно указать хотя бы один тип.');
    }
    return { items };
  }
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    return { items: value };
  }
  if (!value || typeof value !== 'object') {
    throw new Error('Тип задаётся массивом канонических имён или объектом { items, ...qualifiers }.');
  }
  const raw = value as Record<string, unknown>;
  const rawItems = Array.isArray(raw.items)
    ? raw.items
    : typeof raw.value === 'string'
      ? splitTypeItems(raw.value)
      : typeof raw.type === 'string'
        ? splitTypeItems(raw.type)
        : undefined;
  if (!rawItems) {
    throw new Error('Поле items должно быть массивом имён типов, либо укажите строковое поле value/type.');
  }
  const items = rawItems.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).canonical === 'string') {
      return (item as Record<string, string>).canonical;
    }
    throw new Error('Каждый элемент items должен быть строкой или объектом с canonical.');
  });
  if (items.length === 0) {
    throw new Error('Нужно указать хотя бы один тип.');
  }
  return {
    items,
    stringQualifiers: readStringQualifiers(raw.stringQualifiers ?? raw),
    numberQualifiers: readNumberQualifiers(raw.numberQualifiers ?? raw),
    dateQualifiers: readDateQualifiers(raw.dateQualifiers ?? raw),
  };
}

function splitTypeItems(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeEnumInput(value: string, allowedValues: readonly EnumPropertyOption[]): string {
  const normalized = normalizeForCompare(value);
  return allowedValues.find((item) => (
    normalizeForCompare(item.value) === normalized ||
    normalizeForCompare(item.label) === normalized
  ))?.value ?? value;
}

function normalizePropertyKey(value: string): string {
  const normalized = normalizeForCompare(value);
  const known: Record<string, string> = {
    [normalizeForCompare('Тип')]: 'Type',
    [normalizeForCompare('Источник')]: 'Source',
    [normalizeForCompare('Тип параметра команды')]: 'CommandParameterType',
  };
  return known[normalized] ?? value;
}

function normalizeMethodName(value: string): string {
  const trimmed = value.trim();
  const segments = trimmed.split('.').map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  if (segments.length === 2) {
    return `CommonModule.${segments[0]}.${segments[1]}`;
  }
  if (segments.length !== 3) {
    return trimmed;
  }
  const normalizedType = normalizeForCompare(segments[0]);
  if (
    normalizedType === normalizeForCompare('CommonModule') ||
    normalizedType === normalizeForCompare('CommonModules') ||
    normalizedType === normalizeForCompare('ОбщийМодуль') ||
    normalizedType === normalizeForCompare('ОбщиеМодули')
  ) {
    return `CommonModule.${segments[1]}.${segments[2]}`;
  }
  return toCanonicalPropertyInput(trimmed);
}

function toRussianTypeAlias(canonical: string): string {
  if (canonical.startsWith('CatalogRef.')) {
    return `Справочник.${canonical.slice('CatalogRef.'.length)}`;
  }
  if (canonical.startsWith('DocumentRef.')) {
    return `Документ.${canonical.slice('DocumentRef.'.length)}`;
  }
  if (canonical.startsWith('EnumRef.')) {
    return `Перечисление.${canonical.slice('EnumRef.'.length)}`;
  }
  if (canonical.startsWith('DefinedType.')) {
    return `ОпределяемыйТип.${canonical.slice('DefinedType.'.length)}`;
  }
  return '';
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function normalizeForCompare(value: string): string {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, '');
}

function readStringQualifiers(value: unknown): McpSetTypeInput['stringQualifiers'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    length: typeof raw.length === 'number' ? raw.length : undefined,
    allowedLength: normalizeAllowedLength(raw.allowedLength),
  };
}

function readNumberQualifiers(value: unknown): McpSetTypeInput['numberQualifiers'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    digits: readNumberOption(raw.digits) ?? readNumberOption(raw.length),
    fractionDigits: readNumberOption(raw.fractionDigits) ?? readNumberOption(raw.precision),
    allowedSign: normalizeAllowedSign(raw.allowedSign),
  };
}

function readDateQualifiers(value: unknown): McpSetTypeInput['dateQualifiers'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    dateFractions: normalizeDateFractions(raw.dateFractions),
  };
}

function readNumberOption(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeAllowedLength(value: unknown): 'Variable' | 'Fixed' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizeForCompare(value);
  if (normalized === normalizeForCompare('Fixed') || normalized === normalizeForCompare('Фиксированная')) {
    return 'Fixed';
  }
  if (normalized === normalizeForCompare('Variable') || normalized === normalizeForCompare('Переменная')) {
    return 'Variable';
  }
  return undefined;
}

function normalizeAllowedSign(value: unknown): 'Any' | 'Nonnegative' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizeForCompare(value);
  if (normalized === normalizeForCompare('Any') || normalized === normalizeForCompare('Любой')) {
    return 'Any';
  }
  if (
    normalized === normalizeForCompare('Nonnegative') ||
    normalized === normalizeForCompare('Неотрицательное') ||
    normalized === normalizeForCompare('Неотрицательный')
  ) {
    return 'Nonnegative';
  }
  return undefined;
}

function normalizeDateFractions(value: unknown): 'Date' | 'DateTime' | 'Time' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizeForCompare(value);
  if (normalized === normalizeForCompare('Date') || normalized === normalizeForCompare('Дата')) {
    return 'Date';
  }
  if (normalized === normalizeForCompare('DateTime') || normalized === normalizeForCompare('ДатаВремя') || normalized === normalizeForCompare('Дата и время')) {
    return 'DateTime';
  }
  if (normalized === normalizeForCompare('Time') || normalized === normalizeForCompare('Время')) {
    return 'Time';
  }
  return undefined;
}
