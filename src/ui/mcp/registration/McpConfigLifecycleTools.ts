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
import { runDumpConfigurationToCf, runLoadConfigurationFromCf } from '../../commands/ext/CfFileCommandRunner';
import { runDumpAllExtensionsToCfe, runLoadAllExtensionsFromCfe } from '../../commands/ext/CfeBatchCommandRunner';
import { CFE_MANIFEST_FILE_NAME, type CfeBatchReport } from '../../../infra/cfFile';
import { buildCfApplyTarget } from '../../commands/ext/CfFileTarget';
import { runApplyDatabaseConfiguration } from '../../commands/ext/ExtensionCommandRunner';
import {
  endConfigurationOperation,
  tryBeginConfigurationOperation,
} from '../../commands/ext/configurationOperationLock';
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
    'v8vscedit_dump_cf',
    {
      title: 'Выгрузить конфигурацию в CF-файл',
      description: [
        'Выгружает конфигурацию базы в бинарный файл через пакетный Конфигуратор: основную конфигурацию в .cf,',
        'расширение — в .cfe (если задан extensionName).',
        'Файл появляется на целевом пути только при успешном завершении; overwrite разрешает заменить существующий файл.',
        'Для выгрузки ВСЕХ расширений базы одной операцией используйте v8vscedit_dump_all_cfe — этот инструмент работает с одним объектом за вызов.',
      ].join(' '),
      inputSchema: z.object({
        outputFile: z.string(),
        extensionName: z.string().optional(),
        overwrite: z.boolean().optional(),
      }),
      annotations: {
        // Выгрузка не меняет ни базу, ни файлы проекта; единственный побочный
        // эффект — создание указанного файла, защищённого guard'ом overwrite.
        destructiveHint: false,
      },
    },
    async ({ outputFile, extensionName, overwrite }) => gate.wrapAsync(async () => {
      const dumped = await withConfigurationOperationLock(() => runDumpConfigurationToCf({
        workspaceFolder: services.workspaceFolder,
        outputChannel: services.outputChannel,
        outputFile,
        extensionName,
        overwrite: overwrite ?? false,
        silent: true,
      }));
      if (!dumped) {
        throw new Error('Выгрузка в файл не выполнена. Подробности — в журнале «1С Редактор».');
      }
      return { outputFile, extensionName: extensionName ?? '', overwrite: overwrite ?? false };
    })
  );

  server.registerTool(
    'v8vscedit_load_cf',
    {
      title: 'Загрузить конфигурацию из CF-файла',
      description: [
        'Загружает конфигурацию из бинарного файла в базу через пакетный Конфигуратор: .cf — в основную конфигурацию,',
        '.cfe — в расширение (если задан extensionName; несуществующее расширение при этом создаётся в базе).',
        'Операция необратима и требует confirm: true.',
        'Конфигурация БАЗЫ при загрузке не обновляется — примените изменения отдельно через applyToDatabase: true.',
        'XML-выгрузка проекта после загрузки перестаёт соответствовать базе: выполните импорт конфигураций.',
      ].join(' '),
      inputSchema: z.object({
        inputFile: z.string(),
        extensionName: z.string().optional(),
        confirm: z.boolean(),
        applyToDatabase: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ inputFile, extensionName, confirm, applyToDatabase }) => {
      // Проверяем значение, а не только наличие поля: агент может прислать
      // confirm=false — неявного согласия по умолчанию у необратимой
      // операции быть не должно.
      if (!confirm) {
        return gate.toolError(new Error(
          'Загрузка из файла необратимо заменяет содержимое конфигурации в базе: '
          + 'текущее содержимое будет потеряно, а при сбое часть изменений всё равно может быть применена. '
          + 'Передайте confirm: true, чтобы подтвердить операцию.'
        ));
      }
      return gate.wrapAsync(async () => withConfigurationOperationLock(async () => {
        const loaded = await runLoadConfigurationFromCf({
          workspaceFolder: services.workspaceFolder,
          outputChannel: services.outputChannel,
          inputFile,
          extensionName,
          silent: true,
        });
        if (!loaded) {
          throw new Error(
            'Загрузка из файла не выполнена. Часть изменений могла быть применена — проверьте состояние базы. '
            + 'Подробности — в журнале «1С Редактор».'
          );
        }
        const applied = applyToDatabase === true
          ? await runApplyDatabaseConfiguration(
              buildCfApplyTarget(services.workspaceFolder.uri.fsPath, extensionName ?? ''),
              services.workspaceFolder,
              services.outputChannel
            )
          : false;
        // Конфигурация проекта НЕ помечается изменённой: файлы проекта не
        // менялись, а пометка привела бы к тому, что «обновить изменённые
        // конфигурации» залило бы СТАРЫЕ файлы обратно в базу поверх
        // только что загруженного CF.
        return {
          inputFile,
          extensionName: extensionName ?? '',
          databaseConfigurationUpdated: applied,
          projectSourcesOutdated: true,
        };
      }));
    }
  );

  server.registerTool(
    'v8vscedit_dump_all_cfe',
    {
      title: 'Выгрузить все расширения базы в CFE-файлы',
      description: [
        'Выгружает КАЖДОЕ подключённое к базе расширение в отдельный .cfe-файл каталога outputDir.',
        'Список расширений берётся у самой базы; рядом с файлами пишется манифест cfe-dump.json,',
        'по которому загрузка восстанавливает исходные имена расширений (имя файла санитизируется необратимо).',
        'Отказ по отдельному расширению не останавливает операцию: такие расширения возвращаются в failed,',
        'их прежние файлы остаются нетронутыми. overwrite разрешает заменять уже существующие файлы каталога.',
      ].join(' '),
      inputSchema: z.object({
        outputDir: z.string(),
        overwrite: z.boolean().optional(),
      }),
      annotations: {
        // Выгрузка не меняет ни базу, ни файлы проекта.
        destructiveHint: false,
      },
    },
    async ({ outputDir, overwrite }) => gate.wrapAsync(async () => withConfigurationOperationLock(async () => {
      const result = await runDumpAllExtensionsToCfe({
        workspaceFolder: services.workspaceFolder,
        outputChannel: services.outputChannel,
        outputDir,
        overwrite: overwrite ?? false,
        silent: true,
      });
      const report = assertBatchReport(result.report, 'Пакетная выгрузка расширений не выполнена.');
      // Частичный отказ — УСПЕХ со списком failed: выгрузка базу не меняет, а
      // готовые бэкапы ценны сами по себе и исключение их бы скрыло.
      return {
        outputDir,
        overwrite: overwrite ?? false,
        manifestFile: CFE_MANIFEST_FILE_NAME,
        dumped: report.items.filter((item) => item.status === 'ok').map((item) => ({ extensionName: item.extensionName, fileName: item.fileName })),
        failed: report.items
          .filter((item) => item.status !== 'ok')
          .map((item) => ({ extensionName: item.extensionName, fileName: item.fileName, status: item.status, message: item.message })),
      };
    }))
  );

  server.registerTool(
    'v8vscedit_load_all_cfe',
    {
      title: 'Загрузить все расширения базы из CFE-файлов',
      description: [
        'Загружает в базу КАЖДОЕ расширение из .cfe-файлов каталога inputDir (имена восстанавливаются по манифесту cfe-dump.json).',
        'Операция необратима и требует confirm: true.',
        'При отказе на любом расширении загрузка ОСТАНАВЛИВАЕТСЯ: состояние сбойного расширения в базе неопределённо,',
        'остальные не трогаются. createMissing разрешает создавать в базе расширения, которых в ней ещё нет.',
        'Конфигурация БАЗЫ при загрузке не обновляется — примените изменения отдельно через applyToDatabase: true.',
        'XML-выгрузка проекта после загрузки перестаёт соответствовать базе: выполните импорт конфигураций.',
      ].join(' '),
      inputSchema: z.object({
        inputDir: z.string(),
        confirm: z.boolean(),
        createMissing: z.boolean().optional(),
        applyToDatabase: z.boolean().optional(),
      }),
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ inputDir, confirm, createMissing, applyToDatabase }) => {
      // Проверяем значение, а не наличие поля: неявного согласия у необратимой
      // операции быть не должно.
      if (!confirm) {
        return gate.toolError(new Error(
          'Загрузка необратимо заменяет содержимое расширений в базе: текущее содержимое будет потеряно, '
          + 'а при сбое часть расширений всё равно окажется загруженной. '
          + 'Передайте confirm: true, чтобы подтвердить операцию.'
        ));
      }
      return gate.wrapAsync(async () => withConfigurationOperationLock(async () => {
        const result = await runLoadAllExtensionsFromCfe({
          workspaceFolder: services.workspaceFolder,
          outputChannel: services.outputChannel,
          inputDir,
          createMissing: createMissing ?? false,
          silent: true,
        });
        const report = assertBatchReport(result.report, 'Пакетная загрузка расширений не выполнена.');
        if (report.failedAt) {
          // Частичный отказ загрузки — исключение, а не «успех со списком»:
          // база в промежуточном состоянии, и штатным итогом это не является.
          throw new Error(
            `Загрузка остановлена на расширении "${report.failedAt.extensionName}" (файл ${report.failedAt.fileName}): `
            + 'состояние этого расширения в базе НЕОПРЕДЕЛЕНО (неудачная загрузка всё равно регистрирует расширение в базе). '
            + 'Расширения после него не загружались, конфигурация базы не обновлялась.'
          );
        }

        const loaded = report.items.filter((item) => item.status === 'ok').map((item) => item.extensionName);
        const applied: string[] = [];
        if (applyToDatabase === true) {
          // Применение — по расширению на вызов через ТОТ ЖЕ путь, что у
          // одиночной загрузки: `/UpdateDBCfg -AllExtensions` применил бы и
          // расширения, которых мы не грузили.
          for (const extensionName of loaded) {
            const ok = await runApplyDatabaseConfiguration(
              buildCfApplyTarget(services.workspaceFolder.uri.fsPath, extensionName),
              services.workspaceFolder,
              services.outputChannel
            );
            if (!ok) {
              throw new Error(`Расширения загружены, но применение к базе не выполнено на "${extensionName}". Подробности — в журнале «1С Редактор».`);
            }
            applied.push(extensionName);
          }
        }
        // Конфигурация проекта НЕ помечается изменённой: файлы проекта не
        // менялись, а пометка заставила бы «обновить изменённые конфигурации»
        // залить СТАРЫЕ файлы обратно в базу поверх загруженного.
        return {
          inputDir,
          loaded,
          applied,
          notInDirectory: report.notInDirectory,
          ignoredFiles: report.ignoredFiles,
          // Имя расширения для этих файлов взято из ИМЕНИ ФАЙЛА, а не из
          // манифеста (`A_B.cfe` — это и `A:B`, и `A/B`): единственный признак,
          // что в базу могло уехать чужое поколение бэкапа.
          restoredByFileName: report.restoredByFileName,
          databaseConfigurationUpdated: applyToDatabase === true,
          projectSourcesOutdated: true,
        };
      }));
    }
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

/**
 * Отчёт прогона пакетной операции.
 *
 * Три случая — не итог, а отказ, и молчать о них нельзя: отчёта нет вовсе (CLI
 * не дошёл до его записи — например, платформа недоступна), отказ ДО старта
 * (`errors`: ни одного спавна Конфигуратора не было) и прерывание сигналом
 * (обработаны не все расширения). «Успехом с пустым результатом» агент принял
 * бы любой из них за штатный итог.
 */
function assertBatchReport(report: CfeBatchReport | undefined, failureMessage: string): CfeBatchReport {
  if (!report) {
    throw new Error(`${failureMessage} Подробности — в журнале «1С Редактор».`);
  }
  const errors = report.errors ?? [];
  if (errors.length > 0 || report.interrupted) {
    throw new Error([failureMessage, ...errors, 'Подробности — в журнале «1С Редактор».'].join(' '));
  }
  return report;
}

/**
 * Берёт ОБЩИЙ замок операций над конфигурацией на время работы с базой —
 * тот же, что у команд импорта/обновления: MCP-агент и пользователь работают
 * с одной базой, и параллельный запуск повредил бы данные. Валидация входа
 * выполняется внутри `action()`, то есть уже ПОСЛЕ захвата замка: при занятом
 * замке вызывающий получит «операция уже выполняется», а не диагностику
 * формата входа.
 */
async function withConfigurationOperationLock<T>(action: () => Promise<T>): Promise<T> {
  if (!await tryBeginConfigurationOperation()) {
    throw new Error('Операция с конфигурацией уже выполняется. Дождитесь её завершения.');
  }
  try {
    return await action();
  } finally {
    await endConfigurationOperation();
  }
}

