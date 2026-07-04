/**
 * MCP-инструменты подсистем и командного интерфейса.
 *
 * Домен «subsystem»: compile_subsystem, edit_subsystem_content,
 * edit_command_interface, validate_command_interface.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as path from 'path';
import * as z from 'zod/v4';
import { parseCanonicalPath } from '../../../domain/CanonicalNames';
import { META_TYPES } from '../../../domain/MetaTypes';
import type { MetadataNode } from '../../tree/TreeNode';
import type { McpMetadataPathService } from '../McpMetadataPathService';
import {
  resolveCommandInterfaceXmlByCanonical,
  resolveConfigurationRootDirByCanonical,
  resolveSubsystemXmlByCanonical,
} from '../McpPathResolvers';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

const COMMAND_INTERFACE_OPERATION_SCHEMA = z.discriminatedUnion('operation', [
  z.object({
    operation: z.enum(['hide', 'show']),
    value: z.union([z.string(), z.array(z.string())]),
  }),
  z.object({
    operation: z.literal('place'),
    value: z.object({ command: z.string(), group: z.string() }),
  }),
  z.object({
    operation: z.literal('order'),
    value: z.object({ group: z.string(), commands: z.array(z.string()) }),
  }),
  z.object({
    operation: z.literal('subsystem-order'),
    value: z.array(z.string()),
  }),
  z.object({
    operation: z.literal('group-order'),
    value: z.array(z.string()),
  }),
]);

export function registerSubsystemTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, services, gate } = deps;

  server.registerTool(
    'v8vscedit_compile_subsystem',
    {
      title: 'Создать подсистему',
      description: [
        'Создаёт XML подсистемы из JSON DSL и регистрирует её в Configuration.xml',
        'или родительской подсистеме. parentPath — канонический путь:',
        'Конфигурация / Расширение (по умолчанию) или Подсистема.X.Y.',
      ].join(' '),
      inputSchema: z.object({
        parentPath: z.string().optional(),
        configuration: z.string().optional(),
        definition: z.object({
          name: z.string(),
          synonym: z.string().optional(),
          comment: z.string().optional(),
          includeHelpInContents: z.boolean().optional(),
          includeInCommandInterface: z.boolean().optional(),
          useOneCommand: z.boolean().optional(),
          explanation: z.string().optional(),
          picture: z.string().optional(),
          content: z.array(z.string()).optional(),
          children: z.array(z.string()).optional(),
        }),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ parentPath, configuration, definition }) => gate.wrap(() => {
      const canonicalParent = parentPath ?? 'Конфигурация';
      const parsed = parseCanonicalPath(canonicalParent);
      let outputDir: string;
      let subsystemParentPath: string | undefined;
      if (parsed.kind === 'subsystem') {
        subsystemParentPath = resolveSubsystemXmlByCanonical(paths, canonicalParent, configuration);
        outputDir = path.dirname(subsystemParentPath);
      } else {
        outputDir = resolveConfigurationRootDirByCanonical(paths, canonicalParent, configuration);
      }
      const result = services.subsystemToolsService.compile({
        outputDir,
        parentPath: subsystemParentPath,
        definition,
      });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_edit_subsystem_content',
    {
      title: 'Изменить состав подсистемы',
      description: [
        'Добавляет и убирает объекты из Content подсистемы по каноническим путям',
        'или ссылкам вида Catalog.Товары. Свойства подсистемы — через',
        'v8vscedit_get_properties и v8vscedit_set_property_by_path.',
        'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, add, remove }) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(canonical, configuration));
      const subsystemPath = resolveSubsystemXmlByCanonical(paths, canonical, configuration);
      const result = services.subsystemXmlService.editContentRefs(subsystemPath, {
        add: resolveSubsystemContentRefs(paths, add ?? [], configuration),
        remove: resolveSubsystemContentRefs(paths, remove ?? [], configuration),
      });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_edit_command_interface',
    {
      title: 'Изменить командный интерфейс',
      description: [
        'Редактирует CommandInterface.xml подсистемы: hide/show/place/order/subsystem-order/group-order.',
        'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
        'CommandInterface.xml ищется рядом с её XML; createIfMissing создаёт его, если отсутствует.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        createIfMissing: z.boolean().optional(),
        operations: z.array(COMMAND_INTERFACE_OPERATION_SCHEMA).min(1),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(canonical, configuration));
      const ciPath = resolveCommandInterfaceXmlByCanonical(paths, canonical, configuration);
      const result = services.commandInterfaceService.edit({ ...rest, ciPath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_validate_command_interface',
    {
      title: 'Валидировать командный интерфейс',
      description: [
        'Проверяет CommandInterface.xml: разделы, порядок, ссылки команд, дубли и форматы списков.',
        'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const ciPath = resolveCommandInterfaceXmlByCanonical(paths, canonical, configuration);
      return services.commandInterfaceService.validate({ ...rest, ciPath });
    })
  );
}

function resolveSubsystemContentRefs(
  paths: McpMetadataPathService,
  values: readonly string[],
  configuration?: string
): string[] {
  return uniqueStrings(values.map((value) => resolveSubsystemContentRef(paths, value, configuration)));
}

function resolveSubsystemContentRef(paths: McpMetadataPathService, value: string, configuration?: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Пустая ссылка на объект состава подсистемы.');
  }
  const node = paths.resolveNode(trimmed, configuration);
  return metadataNodeToObjectRef(node, trimmed);
}

function metadataNodeToObjectRef(node: MetadataNode, source: string): string {
  if (node.metaContext || !node.xmlPath) {
    throw new Error(`В Content подсистемы можно добавлять только корневые объекты метаданных: ${source}.`);
  }
  const def = META_TYPES[node.nodeKind];
  if (!def.folder || def.group === 'service' || def.group === 'root' || def.group === 'child' || node.nodeKind === 'Subsystem') {
    throw new Error(`Тип узла не поддерживается в Content подсистемы: ${node.nodeKind}.`);
  }
  return `${node.nodeKind}.${node.textLabel}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
