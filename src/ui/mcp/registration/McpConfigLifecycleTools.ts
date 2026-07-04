/**
 * MCP-инструменты жизненного цикла конфигурации/расширения и мостов CFE.
 *
 * Домен «configLifecycle»: create_configuration, create_extension, cfe_borrow,
 * cfe_patch_method, cfe_diff, execute_command.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as vscode from 'vscode';
import * as z from 'zod/v4';
import { canonicalToLegacyModulePath } from '../McpPathResolvers';
import type { McpRegistrationDeps } from './McpRegistrationDeps';

const ALLOWED_COMMANDS = new Set([
  'v8vscedit.refresh',
  'v8vscedit.importConfigurations',
  'v8vscedit.updateChangedConfigurations',
]);

export function registerConfigLifecycleTools(server: McpServer, deps: McpRegistrationDeps): void {
  const { services, gate } = deps;

  server.registerTool(
    'v8vscedit_create_configuration',
    {
      title: 'Создать пустую конфигурацию',
      description: 'Создаёт scaffold CF: Configuration.xml и Languages/Русский.xml.',
      inputSchema: z.object({
        name: z.string(),
        synonym: z.string().optional(),
        outputDir: z.string(),
        version: z.string().optional(),
        vendor: z.string().optional(),
        compatibilityMode: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    (args) => gate.wrap(() => {
      const result = services.configurationScaffoldService.createConfiguration(args);
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_create_extension',
    {
      title: 'Создать расширение',
      description: 'Создаёт scaffold CFE: Configuration.xml, язык и опциональную основную роль.',
      inputSchema: z.object({
        name: z.string(),
        synonym: z.string().optional(),
        namePrefix: z.string().optional(),
        outputDir: z.string(),
        purpose: z.enum(['Patch', 'Customization', 'AddOn']).optional(),
        version: z.string().optional(),
        vendor: z.string().optional(),
        compatibilityMode: z.string().optional(),
        configPath: z.string().optional(),
        noRole: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    (args) => gate.wrap(() => {
      const result = services.configurationScaffoldService.createExtension(args);
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_cfe_borrow',
    {
      title: 'Заимствовать объект в расширение',
      description: 'Заимствует объект, форму или дочерний элемент из CF в CFE через CfeBorrowService.',
      inputSchema: z.object({
        configRoot: z.string(),
        extensionRoot: z.string(),
        typeName: z.string(),
        objectName: z.string(),
        formName: z.string().optional(),
        childTag: z.string().optional(),
        childName: z.string().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ configRoot, extensionRoot, typeName, objectName, formName, childTag, childName }) => gate.wrap(() => {
      const result = formName
        ? services.cfeBorrowService.borrowForm(configRoot, extensionRoot, typeName, objectName, formName)
        : childTag && childName
          ? services.cfeBorrowService.borrowChild(configRoot, extensionRoot, typeName, objectName, childTag, childName)
          : services.cfeBorrowService.borrowObject(configRoot, extensionRoot, typeName, objectName);
      // CfeBorrowService сигналит провал исключением (перехват в wrap), а при
      // alreadyBorrowed возвращает пустой files — гейт по списку изменённых файлов.
      gate.afterMutationIfSucceeded(result.files);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_cfe_patch_method',
    {
      title: 'Добавить перехватчик метода CFE',
      description: [
        'Создаёт или дописывает BSL-модуль расширения перехватчиком &Перед/&После/&ИзменениеИКонтроль.',
        'path — канонический путь модуля расширения: Справочники.X.МодульОбъекта,',
        'Справочники.X.Форма.Y.МодульФормы, ОбщиеМодули.X. Модуль может пока отсутствовать.',
      ].join(' '),
      inputSchema: z.object({
        extensionPath: z.string(),
        path: z.string(),
        methodName: z.string(),
        interceptorType: z.enum(['Before', 'After', 'ModificationAndControl']),
        context: z.string().optional(),
        isFunction: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    ({ path: canonical, ...rest }) => gate.wrap(() => {
      const modulePath = canonicalToLegacyModulePath(canonical);
      const result = services.cfePatchMethodService.addMethodInterceptor({ ...rest, modulePath });
      // Сервис бросает исключение при провале (перехват в wrap); дошли сюда — успех.
      gate.afterMutationIfSucceeded(result.changedFiles);
      return result;
    })
  );

  server.registerTool(
    'v8vscedit_cfe_diff',
    {
      title: 'Анализ расширения CFE',
      description: 'Возвращает состав расширения, заимствованные объекты, BSL-перехватчики и опционально проверку переноса #Вставка.',
      inputSchema: z.object({
        extensionPath: z.string(),
        configPath: z.string().optional(),
        mode: z.enum(['overview', 'transfer']).optional(),
      }),
    },
    (args) => gate.wrap(() => services.cfeDiffService.analyze(args))
  );

  server.registerTool(
    'v8vscedit_execute_command',
    {
      title: 'Выполнить команду расширения',
      description: 'Безопасный мост только для явно разрешённых команд расширения: refresh, importConfigurations, updateChangedConfigurations.',
      inputSchema: z.object({
        command: z.enum([...ALLOWED_COMMANDS] as [string, ...string[]]),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ command }) => gate.wrapAsync(async () => {
      const result = await vscode.commands.executeCommand(command);
      return { command, result: result ?? null };
    })
  );
}
