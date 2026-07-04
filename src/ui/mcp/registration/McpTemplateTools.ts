/**
 * MCP-инструменты работы с макетами: табличные документы (MXL) и схемы
 * компоновки данных (СКД).
 *
 * Домен «template»: mxl_info, validate_mxl, compile_mxl, decompile_mxl,
 * skd_info, validate_skd, compile_skd, edit_skd.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { resolveTemplateXmlByCanonical } from '../McpPathResolvers';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

export function registerTemplateTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, services, gate } = deps;

  server.registerTool(
    'v8vscedit_mxl_info',
    {
      title: 'Информация о MXL-макете',
      description: [
        'Возвращает области, параметры, текст и статистику табличного документа.',
        'Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        withText: z.boolean().optional(),
        maxParams: z.number().int().min(1).max(100).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
      return services.mxlTemplateService.info({ ...rest, templatePath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_mxl',
    {
      title: 'Валидировать MXL-макет',
      description: [
        'Проверяет Template.xml табличного документа: строки, колонки, палитры, области.',
        'Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
      return services.mxlTemplateService.validate({ ...rest, templatePath });
    })
  );

  server.registerTool(
    'v8vscedit_compile_mxl',
    {
      title: 'Скомпилировать MXL-макет',
      description: [
        'Перезаписывает содержимое существующего MXL Template.xml из JSON DSL.',
        'Для нового макета сначала используй v8vscedit_add_template с templateType="Табличный документ".',
        'Принимает канонический путь существующего макета: Справочники.X.Макет.Y.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        definition: z.any(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    (args) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(args.path, args.configuration));
      const outputPath = resolveTemplateXmlByCanonical(paths, args.path, args.configuration);
      // args.definition имеет тип any (z.any()); сервис нормализует данные внутри.
      const result = services.mxlTemplateService.compile({ ...args, outputPath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_decompile_mxl',
    {
      title: 'Декомпилировать MXL-макет',
      description: [
        'Возвращает редактируемый JSON DSL по существующему Template.xml табличного документа.',
        'Принимает канонический путь макета: Справочники.X.Макет.СчетФактура или ОбщиеМакеты.X.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
      }),
    },
    ({ path: canonical, configuration }) => gate.wrap(() => {
      const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
      return services.mxlTemplateService.decompile({ templatePath });
    })
  );

  server.registerTool(
    'v8vscedit_skd_info',
    {
      title: 'Информация о СКД',
      description: [
        'Возвращает наборы, запросы, поля, итоги, параметры и варианты СКД.',
        'Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        mode: z.enum(['overview', 'query', 'fields', 'calculated', 'resources', 'params', 'variant', 'full']).optional(),
        name: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
      return services.dataCompositionSchemaService.info({ ...rest, templatePath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_skd',
    {
      title: 'Валидировать СКД',
      description: [
        'Проверяет Template.xml схемы компоновки данных: XML, дубли наборов, полей и параметров.',
        'Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
      return services.dataCompositionSchemaService.validate({ ...rest, templatePath });
    })
  );

  server.registerTool(
    'v8vscedit_compile_skd',
    {
      title: 'Скомпилировать СКД',
      description: [
        'Перезаписывает содержимое существующей СКД Template.xml из JSON DSL.',
        'Для новой СКД сначала используй v8vscedit_add_template с templateType="Схема компоновки данных".',
        'Принимает канонический путь существующего макета СКД.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        definition: z.any(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    (args) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(args.path, args.configuration));
      const outputPath = resolveTemplateXmlByCanonical(paths, args.path, args.configuration);
      const result = services.dataCompositionSchemaService.compile({ ...args, outputPath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_edit_skd',
    {
      title: 'Изменить СКД',
      description: [
        'Точечно редактирует Template.xml СКД: поля, итоги, параметры, запрос, выборку, фильтры.',
        'Принимает канонический путь макета: Отчеты.X.Макет.ОсновнаяСхема.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        operation: z.enum([
          'add-field',
          'add-total',
          'add-calculated-field',
          'add-parameter',
          'add-filter',
          'add-dataParameter',
          'add-order',
          'add-selection',
          'add-dataSetLink',
          'add-dataSet',
          'add-variant',
          'add-conditionalAppearance',
          'add-drilldown',
          'set-query',
          'patch-query',
          'set-outputParameter',
          'set-structure',
          'modify-field',
          'modify-filter',
          'modify-dataParameter',
          'modify-parameter',
          'rename-parameter',
          'reorder-parameters',
          'clear-selection',
          'clear-order',
          'clear-filter',
          'remove-field',
          'remove-total',
          'remove-calculated-field',
          'remove-parameter',
          'remove-filter',
        ]),
        value: z.string(),
        dataSet: z.string().optional(),
        variant: z.string().optional(),
        noSelection: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(canonical, configuration));
      const templatePath = resolveTemplateXmlByCanonical(paths, canonical, configuration);
      const result = services.dataCompositionSchemaService.edit({ ...rest, templatePath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );
}
