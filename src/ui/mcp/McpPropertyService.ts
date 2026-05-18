import type { ConfigurationXmlEditor } from '../../infra/xml';
import type {
  EnumPropertyValue,
  LocalizedStringValue,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
} from '../tree/nodeBuilders/_types';
import type { MetadataNode } from '../tree/TreeNode';
import { getHandlerForNode } from '../tree/nodeBuilders';
import {
  isRootObjectNode,
  resolvePropertyTarget,
} from '../views/properties/PropertiesTargetResolver';
import { toCanonicalPropertyInput } from '../views/properties/PropertyPresentationRegistry';

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

/**
 * Контракт и запись простых свойств для MCP.
 * Перед изменением всегда строится фактическое свойство выбранного узла,
 * поэтому enum/boolean/readonly проверяются теми же обработчиками дерева,
 * которые питают панель свойств.
 */
export class McpPropertyService {
  constructor(private readonly xmlEditor: ConfigurationXmlEditor) {}

  getPropertyContract(node: MetadataNode, propertyKey: string): McpPropertyContract {
    const property = this.findProperty(node, propertyKey);
    if (!property) {
      throw new Error(`Свойство "${propertyKey}" недоступно для узла "${node.textLabel}".`);
    }

    const allowedValues = property.kind === 'enum'
      ? (property.value as EnumPropertyValue).allowedValues
      : property.kind === 'multiEnum'
        ? (property.value as MultiEnumPropertyValue).allowedValues
        : undefined;

    const supportedBySetProperty = (
      property.kind === 'string' ||
      property.kind === 'boolean' ||
      property.kind === 'enum' ||
      property.kind === 'multiEnum' ||
      property.kind === 'localizedString'
    ) && !(property.key === 'Name' && this.isRootRename(node));

    const notes = supportedBySetProperty
      ? []
      : property.key === 'Name' && this.isRootRename(node)
        ? ['Переименование корневого объекта выполняется отдельным инструментом, чтобы обновить файл, ссылки и кэш дерева.']
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
    const property = this.findProperty(node, propertyKey);
    if (!property) {
      throw new Error(`Свойство "${propertyKey}" недоступно для узла "${node.textLabel}".`);
    }
    if (property.readonly) {
      throw new Error(`Свойство "${propertyKey}" доступно только для чтения.`);
    }
    if (property.key === 'Name' && this.isRootRename(node)) {
      throw new Error('Переименование корневого объекта через set_property запрещено: нужен отдельный инструмент.');
    }

    const normalized = this.normalizeInput(property, value);
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
      value: typeof normalized === 'string' ? toCanonicalPropertyInput(normalized) : normalized,
    });
    return this.toMutationResult(saved.success, saved.changed, property.key, saved.changedFiles, saved.errors);
  }

  private findProperty(node: MetadataNode, propertyKey: string): ObjectPropertyItem | undefined {
    const handler = getHandlerForNode(node);
    if (!handler?.canShowProperties?.(node) || !handler.getProperties) {
      return undefined;
    }
    return handler.getProperties(node).find((property) => property.key === propertyKey);
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
      const invalid = value.filter((item) => !allowed.has(item));
      if (invalid.length > 0) {
        throw new Error(`Недопустимые значения свойства "${property.key}": ${invalid.join(', ')}.`);
      }
      return value;
    }
    if (property.kind === 'enum') {
      if (typeof value !== 'string') {
        throw new Error(`Свойство "${property.key}" ожидает строку.`);
      }
      const allowed = new Set((property.value as EnumPropertyValue).allowedValues.map((item) => item.value));
      if (!allowed.has(value)) {
        throw new Error(`Недопустимое значение свойства "${property.key}": ${value}.`);
      }
      return value;
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
    return property.value;
  }

  private isRootRename(node: MetadataNode): boolean {
    const target = resolvePropertyTarget(node);
    return Boolean(target && isRootObjectNode(node, target));
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
