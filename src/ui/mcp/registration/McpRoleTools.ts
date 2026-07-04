/**
 * MCP-инструменты ролей и DefaultRoles.
 *
 * Домен «role»: role_info, validate_role, compile_role, edit_role,
 * list_default_roles, add_default_role, remove_default_role, set_default_roles.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  resolveConfigurationRootDirByCanonical,
  resolveConfigurationXmlByCanonical,
  resolveRoleXmlByCanonical,
} from '../McpPathResolvers';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

const ROLE_OBJECT_SCHEMA = z.union([
  z.string(),
  z.object({
    name: z.string().optional(),
    preset: z.string().optional(),
    rights: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    rls: z.record(z.string(), z.string()).optional(),
  }),
]);

const ROLE_EDIT_OPERATION_SCHEMA = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('grant'),
    object: z.string(),
    preset: z.string().optional(),
    rights: z.union([z.array(z.string()), z.record(z.string(), z.boolean())]).optional(),
    rls: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    op: z.literal('revoke'),
    object: z.string(),
    rights: z.array(z.string()).optional(),
  }),
  z.object({
    op: z.literal('setRls'),
    object: z.string(),
    right: z.string(),
    condition: z.string().optional(),
  }),
  z.object({
    op: z.literal('setFlags'),
    flags: z.object({
      setForNewObjects: z.boolean().optional(),
      setForAttributesByDefault: z.boolean().optional(),
      independentRightsOfChildObjects: z.boolean().optional(),
    }),
  }),
  z.object({
    op: z.literal('addTemplate'),
    name: z.string(),
    condition: z.string(),
  }),
  z.object({
    op: z.literal('removeTemplate'),
    name: z.string(),
  }),
]);

export function registerRoleTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, services, gate } = deps;

  server.registerTool(
    'v8vscedit_role_info',
    {
      title: 'Информация о правах роли',
      description: [
        'Возвращает разрешённые/запрещённые права, RLS и шаблоны ограничений из Rights.xml.',
        'Принимает канонический путь роли: Роли.БазовыеПрава.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        showDenied: z.boolean().optional(),
        limit: z.number().int().min(0).max(5000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const rightsPath = resolveRoleXmlByCanonical(paths, canonical, configuration);
      return services.roleRightsService.info({ ...rest, rightsPath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_role',
    {
      title: 'Валидировать роль',
      description: [
        'Проверяет Rights.xml роли: XML, глобальные флаги, права объектов, RLS, шаблоны',
        'и регистрацию в Configuration.xml. Принимает канонический путь роли: Роли.БазовыеПрава.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const rightsPath = resolveRoleXmlByCanonical(paths, canonical, configuration);
      return services.roleRightsService.validate({ ...rest, rightsPath });
    })
  );

  server.registerTool(
    'v8vscedit_compile_role',
    {
      title: 'Создать роль из DSL',
      description: [
        'Создаёт Roles/<Имя>.xml и Roles/<Имя>/Ext/Rights.xml из JSON DSL и регистрирует',
        'роль в Configuration.xml через ChildObjects. DefaultRoles не затрагивается.',
        'parentPath — канонический путь корня: Конфигурация (по умолчанию) или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        parentPath: z.string().optional(),
        configuration: z.string().optional(),
        definition: z.object({
          name: z.string(),
          synonym: z.string().optional(),
          comment: z.string().optional(),
          setForNewObjects: z.boolean().optional(),
          setForAttributesByDefault: z.boolean().optional(),
          independentRightsOfChildObjects: z.boolean().optional(),
          objects: z.array(ROLE_OBJECT_SCHEMA).optional(),
          rights: z.array(ROLE_OBJECT_SCHEMA).optional(),
          templates: z.array(z.object({ name: z.string(), condition: z.string() })).optional(),
        }),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ parentPath, configuration, definition }) => gate.wrap(() => {
      const canonicalParent = parentPath ?? 'Конфигурация';
      const outputDir = resolveConfigurationRootDirByCanonical(paths, canonicalParent, configuration);
      const result = services.roleRightsService.compile({ outputDir, definition });
      // RoleCompileResult без булева success — сервис бросает исключение при провале
      // (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_edit_role',
    {
      title: 'Точечное редактирование прав роли',
      description: [
        'Применяет операции к Rights.xml роли. Объекты задаются именами 1С с типами',
        '(Catalog.Контрагенты или Справочник.Контрагенты). Поддерживаются операции:',
        'grant/revoke/setRls/setFlags/addTemplate/removeTemplate.',
        'Принимает канонический путь роли: Роли.БазовыеПрава.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        operations: z.array(ROLE_EDIT_OPERATION_SCHEMA).min(1),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, operations }) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(canonical, configuration));
      const rightsPath = resolveRoleXmlByCanonical(paths, canonical, configuration);
      const result = services.roleRightsService.edit({ rightsPath, operations });
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_list_default_roles',
    {
      title: 'Список ролей по умолчанию',
      description: [
        'Возвращает текущий список <DefaultRoles> из Configuration.xml.',
        'Принимает канонический путь корня: Конфигурация или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
      }),
    },
    ({ path: canonical, configuration }) => gate.wrap(() => {
      const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
      return services.roleRightsService.listDefaultRoles({ configPath });
    })
  );

  server.registerTool(
    'v8vscedit_add_default_role',
    {
      title: 'Добавить роль в DefaultRoles',
      description: [
        'Добавляет роль в <DefaultRoles> Configuration.xml.',
        'role — имя роли (БазовыеПрава) или полная ссылка (Role.БазовыеПрава).',
        'Принимает канонический путь корня: Конфигурация или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        role: z.string(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, role }) => gate.wrap(() => {
      const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
      const result = services.roleRightsService.addDefaultRole({ configPath, role });
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_remove_default_role',
    {
      title: 'Удалить роль из DefaultRoles',
      description: [
        'Убирает роль из <DefaultRoles> Configuration.xml.',
        'role — имя роли (БазовыеПрава) или полная ссылка (Role.БазовыеПрава).',
        'Принимает канонический путь корня: Конфигурация или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        role: z.string(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, role }) => gate.wrap(() => {
      const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
      const result = services.roleRightsService.removeDefaultRole({ configPath, role });
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_set_default_roles',
    {
      title: 'Задать список DefaultRoles',
      description: [
        'Полностью заменяет список <DefaultRoles> в Configuration.xml.',
        'Каждое имя нормализуется в форму Role.<Имя>.',
        'Принимает канонический путь корня: Конфигурация или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        roles: z.array(z.string()),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, roles }) => gate.wrap(() => {
      const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
      const result = services.roleRightsService.setDefaultRoles({ configPath, roles });
      gate.afterMutationIfSucceeded(result.changedFiles, result.success);
      return result;
    })
  );
}
