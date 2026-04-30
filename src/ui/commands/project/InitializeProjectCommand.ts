import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommandServices } from '../_shared';

const PROJECT_DIRECTORIES = [
  '.vscode',
  'doc',
  'examples',
  'features',
  'fixtures',
  'lib',
  'src',
  path.join('src', 'cf'),
  path.join('src', 'cfe'),
  'tests',
  'tools',
  path.join('tools', 'JSON'),
  'vendor',
] as const;

const GITIGNORE_RULES = [
  '# Локальные настройки подключения',
  'env.json',
  '',
  '# Артефакты сборки и временные файлы 1С',
  'build/',
  'out/',
  'temp/',
  'tmp/',
  '*.cf',
  '*.cfe',
  '*.epf',
  '*.erf',
  '*.dt',
  '*.log',
  '',
  '# Служебные каталоги редакторов',
  '.vscode/',
  '.cursor/',
  '.codex/',
  '.v8vscedit/',
] as const;

/**
 * Создаёт минимальный каркас проекта 1С, совместимый с vanessa-bootstrap и командами расширения.
 */
export function registerInitializeProjectCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.initializeProject', async () => {
      const rootPath = services.workspaceFolder.uri.fsPath;
      try {
        ensureProjectDirectoryIsEmpty(rootPath);
        createProjectDirectories(rootPath);
        createEnvJson(rootPath);
        services.bslAnalyzerConfigService.ensureExists([]);
        ensureGitignore(rootPath);
        await services.reloadEntries();
        services.refreshActionsView();
        await vscode.window.showInformationMessage('Структура проекта создана. Заполните env.json перед запуском операций.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Не удалось инициализировать проект.\n${message}`);
      }
    })
  );
}

/**
 * Защищает от инициализации поверх уже существующего проекта или произвольного набора файлов.
 */
export function ensureProjectDirectoryIsEmpty(rootPath: string): void {
  const entries = fs.readdirSync(rootPath);
  if (entries.length > 0) {
    throw new Error('Каталог проекта не пуст. Для инициализации нужен пустой каталог.');
  }
}

function createProjectDirectories(rootPath: string): void {
  for (const directory of PROJECT_DIRECTORIES) {
    fs.mkdirSync(path.join(rootPath, directory), { recursive: true });
  }
}

function createEnvJson(rootPath: string): void {
  const envPath = path.join(rootPath, 'env.json');
  if (fs.existsSync(envPath)) {
    return;
  }

  const content = {
    $schema: 'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/develop/vanessa-runner-schema.json',
    default: {
      '--ibconnection': '',
      '--db-user': '',
      '--db-pwd': '',
      '--path': '',
      '--root': '.',
      '--workspace': '.',
      '--v8version': '',
      '--locale': 'ru',
      '--language': 'ru',
      '--additional': '/DisplayAllFunctions /Lru  /iTaxi /TESTMANAGER',
      '--ordinaryapp': '-1',
    },
  };

  fs.writeFileSync(envPath, `${JSON.stringify(content, null, 2)}\n`, 'utf-8');
}

function ensureGitignore(rootPath: string): void {
  const gitignorePath = path.join(rootPath, '.gitignore');
  const existing = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf-8')
    : '';
  const existingRules = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  );
  const missingRules = GITIGNORE_RULES.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#') && !existingRules.has(trimmed);
  });

  if (missingRules.length === 0) {
    return;
  }

  const block = [
    '# Локальные настройки подключения и артефакты 1С',
    ...missingRules,
  ];
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const prefix = existing.length > 0 ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${existing}${separator}${prefix}${block.join('\n')}\n`, 'utf-8');
}
