/**
 * MCP-инструменты чтения и валидации конфигурации, объектов и подсистем (read-only).
 *
 * Домен «configInfo»: configuration_info, validate_configuration, metadata_info,
 * validate_metadata, subsystem_info, validate_subsystem.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import {
  resolveConfigurationXmlByCanonical,
  resolveObjectXmlByCanonical,
  resolveSubsystemXmlByCanonical,
} from '../McpPathResolvers';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

export function registerConfigInfoTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, services, gate } = deps;

  server.registerTool(
    'v8vscedit_configuration_info',
    {
      title: 'Информация о конфигурации',
      description: [
        'Свойства конфигурации/расширения и счётчики ChildObjects.',
        'Принимает канонический путь корня: Конфигурация или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        mode: z.enum(['overview', 'brief', 'full']).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
      return services.configurationInfoService.read({ ...rest, configPath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_configuration',
    {
      title: 'Валидировать конфигурацию',
      description: [
        'Проверяет Configuration.xml, ChildObjects, DefaultLanguage и базовые enum-значения.',
        'Принимает канонический путь корня: Конфигурация или Расширение.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const configPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
      return services.configurationValidationService.validate({ ...rest, configPath });
    })
  );

  server.registerTool(
    'v8vscedit_metadata_info',
    {
      title: 'Информация об объекте метаданных',
      description: [
        'Возвращает структуру объекта: реквизиты, табличные части, формы, команды, макеты.',
        'Принимает канонический путь объекта: Справочники.Контрагенты, Документы.РасходТовара,',
        'РегистрыСведений.КурсыВалют, Перечисления.СтатусыЗаказа и т.п.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        mode: z.enum(['overview', 'brief', 'full']).optional(),
        name: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const objectPath = resolveObjectXmlByCanonical(paths, canonical, configuration);
      return services.metadataInfoService.read({ ...rest, objectPath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_metadata',
    {
      title: 'Валидировать объект метаданных',
      description: [
        'Проверяет XML объекта, тип, имя, UUID, дочерние элементы и связанные файлы.',
        'Принимает канонический путь объекта (Справочники.Контрагенты) либо массив',
        'таких путей через `paths` для пакетной проверки.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string().optional(),
        paths: z.array(z.string()).optional(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, paths: canonicals, configuration, ...rest }) => gate.wrap(() => {
      const items = (canonicals && canonicals.length > 0
        ? canonicals
        : canonical
          ? [canonical]
          : [])
        .map((item) => item.trim())
        .filter(Boolean);
      if (items.length === 0) {
        throw new Error('Укажите path или paths с каноническим путём объекта.');
      }
      const resolvedJoined = items
        .map((item) => resolveObjectXmlByCanonical(paths, item, configuration))
        .join('|');
      return services.metadataValidationService.validate({ ...rest, objectPath: resolvedJoined });
    })
  );

  server.registerTool(
    'v8vscedit_subsystem_info',
    {
      title: 'Информация о подсистеме',
      description: [
        'Возвращает свойства подсистемы, состав, дерево дочерних подсистем и CommandInterface.xml.',
        'Принимает канонический путь подсистемы: Подсистема.Продажи.Розница.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        mode: z.enum(['overview', 'content', 'ci', 'tree', 'full']).optional(),
        name: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const subsystemPath = resolveSubsystemXmlByCanonical(paths, canonical, configuration);
      return services.subsystemToolsService.info({ ...rest, subsystemPath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_subsystem',
    {
      title: 'Валидировать подсистему',
      description: [
        'Проверяет XML подсистемы: свойства, Content, ChildObjects, файлы и CommandInterface.xml.',
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
      const subsystemPath = resolveSubsystemXmlByCanonical(paths, canonical, configuration);
      return services.subsystemToolsService.validate({ ...rest, subsystemPath });
    })
  );
}
