/**
 * MCP-инструменты управляемых форм.
 *
 * Домен «form»: form_info, validate_form, add_form, remove_form,
 * compile_form, edit_form.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { resolveFormXmlByCanonical, resolveOwnerObjectXmlByCanonical } from '../McpPathResolvers';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

export function registerFormTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { paths, services, gate } = deps;

  server.registerTool(
    'v8vscedit_form_info',
    {
      title: 'Информация о форме',
      description: [
        'Возвращает структуру управляемой формы: иерархию элементов, реквизиты,',
        'команды и события. Принимает канонический путь формы:',
        'Справочники.Контрагенты.Форма.ФормаСписка или общую форму ОбщиеФормы.X.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        expand: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const formPath = resolveFormXmlByCanonical(paths, canonical, configuration);
      return services.formToolsService.info({ ...rest, formPath });
    })
  );

  server.registerTool(
    'v8vscedit_validate_form',
    {
      title: 'Валидировать форму',
      description: [
        'Проверяет Form.xml: версию, уникальность ID, DataPath, CommandName,',
        'события, callType, типы. Принимает канонический путь формы:',
        'Справочники.Контрагенты.Форма.ФормаСписка или ОбщиеФормы.X.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        detailed: z.boolean().optional(),
        maxErrors: z.number().int().min(1).max(500).optional(),
      }),
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      const formPath = resolveFormXmlByCanonical(paths, canonical, configuration);
      return services.formToolsService.validate({ ...rest, formPath });
    })
  );

  server.registerTool(
    'v8vscedit_add_form',
    {
      title: 'Добавить форму',
      description: [
        'Создаёт управляемую форму у объекта: Forms/<Имя>.xml, Form.xml, Module.bsl,',
        'регистрирует <Form>Имя</Form> в ChildObjects.',
        'parentPath — канонический путь объекта-владельца (Справочники.Контрагенты);',
        'name — идентификатор формы 1С (ФормаЭлемента/ФормаСписка/…).',
      ].join(' '),
      inputSchema: z.object({
        parentPath: z.string(),
        name: z.string(),
        configuration: z.string().optional(),
        purpose: z.string().optional(),
        synonym: z.string().optional(),
        setDefault: z.boolean().optional(),
        autoFill: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ parentPath, name, configuration, ...rest }) => gate.wrap(() => {
      const owner = resolveOwnerObjectXmlByCanonical(paths, parentPath, configuration);
      const objectPath = owner.xmlPath;
      if (!objectPath) {
        throw new Error(`У узла "${parentPath}" нет XML-файла.`);
      }
      gate.assertNodeEditable(owner);
      const result = services.formToolsService.addForm({ ...rest, objectPath, formName: name });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_remove_form',
    {
      title: 'Удалить форму',
      description: [
        'Удаляет форму у объекта: каталог формы, дескриптор Forms/<Имя>.xml,',
        'снимает регистрацию из ChildObjects и очищает DefaultForm/DefaultObjectForm/…',
        'Принимает канонический путь формы: Справочники.Контрагенты.Форма.ФормаСписка.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration }) => gate.wrap(() => {
      const node = paths.resolveNode(canonical, configuration);
      if (node.nodeKind !== 'Form' || !node.metaContext?.ownerObjectXmlPath) {
        throw new Error(`Путь "${canonical}" должен указывать на форму объекта (Справочники.X.Форма.Y).`);
      }
      gate.assertNodeEditable(node);
      const result = services.formToolsService.removeForm({
        objectPath: node.metaContext.ownerObjectXmlPath,
        formName: node.textLabel,
      });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_compile_form',
    {
      title: 'Скомпилировать форму',
      description: [
        'Перезаписывает Form.xml из JSON DSL (целиком).',
        'Для создания новой формы с регистрацией в объекте и Module.bsl используй v8vscedit_add_form.',
        'Принимает канонический путь существующей формы: Справочники.X.Форма.Y или ОбщиеФормы.X.',
      ].join(' '),
      inputSchema: z.object({
        path: z.string(),
        configuration: z.string().optional(),
        definition: z.any().optional(),
        fromObject: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, configuration, ...rest }) => gate.wrap(() => {
      gate.assertNodeEditable(paths.resolveNode(canonical, configuration));
      const outputPath = resolveFormXmlByCanonical(paths, canonical, configuration);
      const result = services.formToolsService.compile({ ...rest, outputPath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_edit_form',
    {
      title: 'Изменить форму',
      description: [
        'Точечно добавляет элементы, реквизиты, команды и события в существующий Form.xml.',
        'Не перезаписывает форму целиком (в отличие от compile).',
        'Принимает канонический путь формы: Справочники.X.Форма.Y или ОбщиеФормы.X.',
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
      const formPath = resolveFormXmlByCanonical(paths, args.path, args.configuration);
      const result = services.formToolsService.edit({ ...args, formPath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );
}
