/**
 * MCP-инструменты навигации по конфигурации (read-only).
 *
 * Домен «navigation» из декомпозиции `V8McpServer.registerTools`:
 * workspace_overview, search_metadata, list_metadata, tree, resolve_path,
 * list_supported_types, list_available_types.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as path from 'path';
import * as z from 'zod/v4';
import { getPlatformTypeRegistry, type TypeContext } from '../../../infra/xml/PlatformTypeRegistry';
import type { McpCommandServices, McpRegistrationDeps } from './McpRegistrationDeps';

export function registerNavigationTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, properties, gate } = deps;

  server.registerTool(
    'v8vscedit_workspace_overview',
    {
      title: 'Обзор конфигураций и расширений',
      description: 'Возвращает основную конфигурацию, расширения, корневые пути и счётчики объектов без обхода дерева по nodeId.',
      inputSchema: z.object({}),
    },
    () => gate.ok(paths.getWorkspaceOverview())
  );

  server.registerTool(
    'v8vscedit_search_metadata',
    {
      title: 'Поиск метаданных по пути',
      description: 'Ищет по части строки в предметных путях метаданных выбранной конфигурации: например "Польз" найдёт Справочники.Пользователи.',
      inputSchema: z.object({
        query: z.string(),
        configuration: z.string(),
        kind: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    },
    (args) => gate.ok(paths.search(args))
  );

  server.registerTool(
    'v8vscedit_list_metadata',
    {
      title: 'Список метаданных по группе или объекту',
      description: 'Возвращает объекты группы или дочерние элементы по предметному пути без nodeId: список справочников, форм, реквизитов, измерений, ресурсов и т.п.',
      inputSchema: z.object({
        configuration: z.string().optional(),
        parentPath: z.string().optional(),
        kind: z.string().optional(),
        group: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      }),
    },
    (args) => gate.ok(paths.list(args))
  );

  server.registerTool(
    'v8vscedit_tree',
    {
      title: 'Плоское дерево канонических путей',
      description: [
        'Возвращает плоский список канонических путей метаданных. Используй для',
        'быстрой ориентации в конфигурации без пагинации. Канон путей: множественное',
        'число корня, прямые реквизиты/ТЧ, без английских алиасов',
        '(Справочники.Контрагенты.ИНН, не Catalog.Counterparties.Attribute.TIN).',
      ].join(' '),
      inputSchema: z.object({
        configuration: z.string().optional(),
        scope: z.enum(['all', 'objects', 'common', 'subsystems']).optional(),
        depth: z.enum(['roots', 'objects', 'children']).optional(),
        include: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50_000).optional(),
      }),
    },
    (args) => gate.wrap(() => paths.listTreePaths(args))
  );

  server.registerTool(
    'v8vscedit_resolve_path',
    {
      title: 'Резолв канонического пути',
      description: [
        'Нормализует канонический путь и проверяет наличие узла в дереве.',
        'Возвращает каноническую форму входа и exists. На вход принимает только',
        'канонические русские пути; английские/legacy формы (Catalog.X) отбиваются',
        'с подсказкой канона. exists=false без ошибки означает «узла нет».',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
      }),
    },
    (args) => gate.wrap(() => {
      const result = paths.resolveNodeSafe(args.path, args.configuration);
      if (!result.exists || !result.node) {
        return { canonical: result.canonical, exists: false };
      }
      return {
        canonical: result.canonical,
        exists: true,
        nodeKind: result.node.nodeKind,
        xmlPath: result.node.xmlPath,
      };
    })
  );

  server.registerTool(
    'v8vscedit_list_supported_types',
    {
      title: 'Реестр платформенных типов',
      description: [
        'Возвращает доступные типы для свойства по контексту: реквизит метаданных,',
        'реквизит формы, параметр команды, источник подписки. Для metadataAttribute /',
        'formAttribute базовая группа выдаётся даже без configuration; ссылочные',
        'группы (Справочник/Документ/…) появляются только при указанной configuration.',
      ].join(' '),
      inputSchema: z.object({
        context: z.enum(['metadataAttribute', 'formAttribute', 'commandParameter', 'eventSource']),
        configuration: z.string().optional(),
      }),
    },
    (args) => gate.wrap(() => listSupportedTypes(deps.services.treeProvider, args.context, args.configuration))
  );

  server.registerTool(
    'v8vscedit_list_available_types',
    {
      title: 'Доступные типы 1С',
      description: [
        'Возвращает стандартные и конфигурационные типы для свойства Тип / Источник /',
        'Тип параметра команды. Для CFE показывает только собственные и заимствованные',
        'объекты текущего расширения. Используй русское поле value при вызове set_type.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string().optional(),
        configuration: z.string().optional(),
        propertyKey: z.string().optional(),
      }),
    },
    ({ path: canonical, configuration, propertyKey }) => gate.wrap(() => {
      const node = canonical ? paths.resolveNode(canonical, configuration) : undefined;
      return properties.getAvailableTypes(node, propertyKey ?? 'Type');
    })
  );
}

/**
 * Возвращает реестр платформенных типов для указанного контекста.
 *
 * `configuration` нужна только для генерации ссылочных групп (`Справочник.X`,
 * `Документ.X`, …). Если конфигураций больше одной и `configuration` не задан,
 * возвращается только базовая группа без ссылочных типов.
 */
function listSupportedTypes(
  treeProvider: McpCommandServices['treeProvider'],
  context: TypeContext,
  configuration: string | undefined,
): {
  readonly context: TypeContext;
  readonly groups: ReturnType<typeof getPlatformTypeRegistry>;
} {
  const entries = treeProvider.getEntries();
  let configXmlPath: string | undefined;
  if (entries.length === 1) {
    configXmlPath = path.join(entries[0].rootPath, 'Configuration.xml');
  } else if (configuration && configuration.trim().length > 0) {
    const normalized = configuration.trim().toLocaleLowerCase('ru-RU');
    const match = entries.find((entry) => {
      const baseName = path.basename(entry.rootPath).toLocaleLowerCase('ru-RU');
      return baseName === normalized || entry.rootPath.toLocaleLowerCase('ru-RU') === normalized;
    });
    if (match) {
      configXmlPath = path.join(match.rootPath, 'Configuration.xml');
    }
  }
  // Без configXmlPath реестр вернёт только базовую группу — это ровно требуемое поведение
  // при отсутствии однозначного выбора конфигурации.
  const groups = getPlatformTypeRegistry(configXmlPath, context);
  return { context, groups };
}
