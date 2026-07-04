/**
 * MCP-инструменты свойств, типов, переименования и удаления метаданных.
 *
 * Домен «property»: get_properties, set_property_by_path, set_properties,
 * set_type, rename_metadata, remove_metadata.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { ChildTag } from '../../../domain/ChildTag';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

export function registerPropertyTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, properties, services, gate } = deps;

  server.registerTool(
    'v8vscedit_get_properties',
    {
      title: 'Свойства объекта по пути',
      description: [
        'Возвращает ВСЕ свойства узла, включая readonly, со всеми допустимыми',
        'enum/multiEnum-значениями. Каждый контракт содержит propertyKey, title,',
        'kind, currentValue, supportedBySetProperty и notes. Свойства с kind=',
        '"metadataType" (Type/Source/CommandParameterType) сами список значений',
        'не несут — в notes указано, какой tool вызывать для смены и получения',
        'списка доступных типов.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
      }),
    },
    ({ path: canonical, configuration }) => gate.wrap(() => {
      const node = paths.resolveNode(canonical, configuration);
      return properties.getPropertyContracts(node);
    })
  );

  server.registerTool(
    'v8vscedit_set_property_by_path',
    {
      title: 'Изменить свойство по пути',
      description: [
        'Меняет простое свойство объекта по каноническому пути с проверками enum/boolean/readonly.',
        'Корневые свойства доступны по path="Конфигурация" или "Расширение".',
        'Для DefaultRoles удобнее v8vscedit_add_default_role / set_default_roles.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        propertyKey: z.string(),
        value: z.unknown(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, propertyKey, value }) => gate.wrap(() => {
      const node = paths.resolveNode(canonical, configuration);
      gate.assertNodeEditable(node);
      const result = properties.setProperty(node, propertyKey, value);
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_set_properties',
    {
      title: 'Пакетная смена свойств по пути',
      description: [
        'Меняет несколько простых свойств объекта за один вызов. properties —',
        'объект вида { propertyKey: value, ... }, ключи — английские имена свойств',
        'из v8vscedit_get_properties. Применяет последовательно, в отчёте',
        'показывает результат каждой пары. Для типов (Type/Source/CommandParameterType)',
        'используй v8vscedit_set_type — set_properties их пропустит.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        properties: z.record(z.string(), z.unknown()),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, properties: propertiesInput }) => gate.wrap(() => {
      const resolved = paths.resolveNodeSafe(canonical, configuration);
      if (!resolved.exists || !resolved.node) {
        throw new Error(`Метаданные по пути "${canonical}" не найдены.`);
      }
      const node = resolved.node;
      gate.assertNodeEditable(node);
      const totalRequested = Object.keys(propertiesInput).length;
      const result = properties.setProperties(node, propertiesInput);
      // McpSetPropertiesResult не несёт булева success: успех выражается наличием
      // реально применённых правок — сервис кладёт в changedFiles только их.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return {
        path: resolved.canonical,
        totalRequested,
        applied: result.applied,
        failed: result.failed,
        changedFiles: result.changedFiles,
      };
    })
  );

  server.registerTool(
    'v8vscedit_set_type',
    {
      title: 'Изменить тип объекта',
      description: [
        'Меняет свойство Тип / Источник / Тип параметра команды по каноническому пути.',
        'Перед ссылочным типом вызови v8vscedit_list_available_types для того же path.',
        'Принимает русские имена типов и квалификаторы (длина/точность).',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        propertyKey: z.string().optional(),
        value: z.unknown().optional(),
        type: z.string().optional(),
        items: z.array(z.string()).optional(),
        length: z.number().int().min(0).optional(),
        allowedLength: z.string().optional(),
        digits: z.number().int().min(1).optional(),
        fractionDigits: z.number().int().min(0).optional(),
        precision: z.number().int().min(0).optional(),
        allowedSign: z.string().optional(),
        dateFractions: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, propertyKey, ...typeInput }) => gate.wrap(() => {
      const node = paths.resolveNode(canonical, configuration);
      gate.assertNodeEditable(node);
      const result = properties.setType(node, propertyKey ?? 'Type', normalizeSetTypeToolInput(typeInput));
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_rename_metadata',
    {
      title: 'Переименовать метаданные',
      description: [
        'Переименовывает объект или дочерний элемент по каноническому пути.',
        'Для корневого объекта обновляет файл, каталог, ChildObjects и ссылки.',
        'Принимает канонический путь: Справочники.Контрагенты.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        newName: z.string(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, newName }) => gate.wrap(() => {
      const node = paths.resolveNode(canonical, configuration);
      gate.assertNodeEditable(node);
      const result = properties.rename(node, newName);
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_remove_metadata',
    {
      title: 'Удалить метаданные',
      description: [
        'Удаляет объект или дочерний элемент по каноническому пути через общий сервис',
        'удаления (используется и UI). Не удаляй XML/каталоги вручную.',
        'Принимает канонический путь: Справочники.Контрагенты или Справочники.X.ИНН.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        keepFiles: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, keepFiles }) => gate.wrap(() => {
      const node = paths.resolveNode(canonical, configuration);
      if (!node.xmlPath || !node.canRemoveMetadata) {
        throw new Error(`Узел "${node.textLabel}" не поддерживает удаление метаданных.`);
      }
      gate.assertNodeEditable(node);
      const result = node.metaContext
        ? services.metadataXmlRemover.removeChildElement({
            ownerObjectXmlPath: node.metaContext.ownerObjectXmlPath ?? node.xmlPath,
            childTag: toRemoveChildTag(node.nodeKind),
            name: node.textLabel,
            tabularSectionName: node.metaContext.tabularSectionName,
            keepFiles,
          })
        : services.metadataXmlRemover.removeRootObject({
            configRoot: getObjectLocationFromXml(node.xmlPath).configRoot,
            kind: node.nodeKind,
            name: node.textLabel,
            keepFiles,
          });
      if (result.success) {
        gate.afterMutationIfSucceeded(result.changedFiles, result.success);
        services.dynamicPanelController.handleMetadataRemoved(node);
        services.subsystemEditorViewProvider.handleMetadataRemoved();
      }
      return result;
    })
  );
}

function toRemoveChildTag(kind: string): ChildTag | 'Column' {
  if (
    kind === 'Attribute' ||
    kind === 'AddressingAttribute' ||
    kind === 'TabularSection' ||
    kind === 'Form' ||
    kind === 'Command' ||
    kind === 'Template' ||
    kind === 'Dimension' ||
    kind === 'Resource' ||
    kind === 'EnumValue' ||
    kind === 'Column'
  ) {
    return kind;
  }
  throw new Error(`Неподдерживаемый дочерний тип для удаления: ${kind}`);
}

function normalizeSetTypeToolInput(input: Record<string, unknown>): unknown {
  const rawValue = input.value;
  const items = Array.isArray(input.items)
    ? input.items.filter((item): item is string => typeof item === 'string')
    : undefined;
  const type = typeof input.type === 'string' ? input.type : undefined;
  const value = rawValue ?? (items ? { items } : type);

  if (value === undefined) {
    throw new Error('Укажите тип в value, type или items.');
  }

  const normalized: Record<string, unknown> = isPlainObject(value)
    ? { ...value }
    : { items: typeof value === 'string' ? [value] : value };

  if (items && !Array.isArray(normalized.items)) {
    normalized.items = items;
  }
  if (type && !Array.isArray(normalized.items)) {
    normalized.items = [type];
  }

  const stringQualifiers = mergeQualifierObject(normalized.stringQualifiers, {
    length: input.length,
    allowedLength: input.allowedLength,
  });
  const numberQualifiers = mergeQualifierObject(normalized.numberQualifiers, {
    digits: input.digits ?? input.length,
    fractionDigits: input.fractionDigits ?? input.precision,
    allowedSign: input.allowedSign,
  });
  const dateQualifiers = mergeQualifierObject(normalized.dateQualifiers, {
    dateFractions: input.dateFractions,
  });

  if (stringQualifiers) {
    normalized.stringQualifiers = stringQualifiers;
  }
  if (numberQualifiers) {
    normalized.numberQualifiers = numberQualifiers;
  }
  if (dateQualifiers) {
    normalized.dateQualifiers = dateQualifiers;
  }

  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeQualifierObject(current: unknown, additions: Record<string, unknown>): Record<string, unknown> | undefined {
  const result = isPlainObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
