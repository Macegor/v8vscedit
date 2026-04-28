import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AI_SKILLS_PLATFORMS, AiSkillsPlatform, AiSkillsRuntime } from '../../../infra/skills/AiSkillsInstaller';
import { runProcess } from '../../../infra/process';
import { CommandServices } from '../_shared';

interface PlatformPickItem extends vscode.QuickPickItem {
  readonly platform: AiSkillsPlatform;
}

interface RuntimePickItem extends vscode.QuickPickItem {
  readonly runtime: AiSkillsRuntime;
}

type HostOs = 'windows' | 'macos';

/** Регистрирует команду установки AI-скилов 1С в текущий проект. */
export function registerInstallAiSkillsCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.installAiSkills', async () => {
      const hostOs = detectSupportedOs();
      if (!hostOs) {
        await vscode.window.showErrorMessage('Установка ИИ-скилов поддержана только на Windows и macOS.');
        return;
      }

      const platform = await pickPlatform(services.workspaceFolder.uri.fsPath);
      if (!platform) {
        return;
      }

      const runtime = hostOs === 'windows'
        ? await pickWindowsRuntime()
        : 'python';
      if (!runtime) {
        return;
      }

      if (hostOs === 'macos' || runtime === 'python') {
        const python = await findPython();
        if (!python) {
          await vscode.window.showErrorMessage(getPythonMissingMessage(hostOs), 'Открыть журнал').then((action) => {
            if (action === 'Открыть журнал') {
              services.outputChannel.show(true);
            }
          });
          return;
        }
        services.outputChannel.appendLine(`[ai-skills] Python найден: ${python.command} (${python.version})`);
      }

      const targetDir = path.join(services.workspaceFolder.uri.fsPath, ...platform.targetPrefix.split('/'));
      if (hasExistingSkills(targetDir)) {
        const confirmed = await vscode.window.showWarningMessage(
          `Каталог ${platform.targetPrefix}/ уже содержит скилы и будет перезаписан.`,
          { modal: true },
          'Установить'
        );
        if (confirmed !== 'Установить') {
          return;
        }
      }

      try {
        const result = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Установка ИИ-скилов: ${platform.label}`,
          cancellable: false,
        }, async (progress) => {
          progress.report({ message: 'клонирование репозитория' });
          const installResult = await services.aiSkillsInstaller.installFromRepository({
            projectRoot: services.workspaceFolder.uri.fsPath,
            platform,
            runtime,
          });
          progress.report({ message: 'готово' });
          return installResult;
        });

        for (const message of result.info) {
          services.outputChannel.appendLine(`[ai-skills][info] ${message}`);
        }
        for (const message of result.warnings) {
          services.outputChannel.appendLine(`[ai-skills][warn] ${message}`);
        }

        const warningSuffix = result.warnings.length > 0 || result.info.length > 0
          ? ' Есть замечания в журнале.'
          : '';
        await vscode.window.showInformationMessage(
          `Установлено скилов: ${result.installedCount}. Каталог: ${result.targetPrefix}/.${warningSuffix}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        services.outputChannel.appendLine(`[ai-skills][error] ${message}`);
        await vscode.window.showErrorMessage(
          `Не удалось установить ИИ-скилы.\n${message}`,
          'Открыть журнал'
        ).then((action) => {
          if (action === 'Открыть журнал') {
            services.outputChannel.show(true);
          }
        });
      }
    })
  );
}

function detectSupportedOs(): HostOs | null {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'macos';
  }
  return null;
}

async function pickPlatform(projectRoot: string): Promise<AiSkillsPlatform | undefined> {
  const items = AI_SKILLS_PLATFORMS.map((platform): PlatformPickItem => ({
    label: platform.label,
    description: hasExistingSkills(path.join(projectRoot, ...platform.targetPrefix.split('/')))
      ? `${platform.targetPrefix} — уже установлен, будет обновлён`
      : platform.targetPrefix,
    platform,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Для какой платформы установить ИИ-скилы',
    placeHolder: 'Скилы будут установлены в текущий проект',
  });
  return picked?.platform;
}

async function pickWindowsRuntime(): Promise<AiSkillsRuntime | undefined> {
  const picked = await vscode.window.showQuickPick<RuntimePickItem>([
    {
      label: 'PowerShell',
      description: 'Рекомендуется для Windows',
      runtime: 'powershell',
    },
    {
      label: 'Python',
      description: 'Использовать Python-скрипты',
      runtime: 'python',
    },
  ], {
    title: 'Какой рантайм использовать для скилов',
    placeHolder: 'На macOS всегда используется Python',
  });
  return picked?.runtime;
}

async function findPython(): Promise<{ readonly command: string; readonly version: string } | null> {
  for (const command of ['python', 'python3']) {
    try {
      const result = await runProcess({
        command,
        args: ['--version'],
        shell: false,
      });
      const version = result.lastStdout || result.lastStderr;
      if (result.exitCode === 0 && /Python\s+3\./i.test(version)) {
        return { command, version };
      }
    } catch {
      // Проверяем следующий вариант имени интерпретатора.
    }
  }

  return null;
}

function getPythonMissingMessage(hostOs: HostOs): string {
  if (hostOs === 'windows') {
    return 'Python 3 не найден. Установите Python с python.org или через winget install Python.Python.3 и проверьте, что python доступен в PATH.';
  }

  return 'Python 3 не найден. Установите Python с python.org или через brew install python и проверьте, что python3 доступен в PATH.';
}

function hasExistingSkills(targetDir: string): boolean {
  try {
    return fs.readdirSync(targetDir).some((entry) => {
      const skillPath = path.join(targetDir, entry);
      return fs.statSync(skillPath).isDirectory() && fs.existsSync(path.join(skillPath, 'SKILL.md'));
    });
  } catch {
    return false;
  }
}
