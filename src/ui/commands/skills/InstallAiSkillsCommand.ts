import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AI_SKILLS_PLATFORMS, buildRoleFiles, type AiSkillsPlatform } from '../../../infra/skills/AiSkillsInstaller';
import type { CommandServices } from '../_shared';

interface PlatformPickItem extends vscode.QuickPickItem {
  readonly platform: AiSkillsPlatform;
}

/** Регистрирует команду установки AI-ролей 1С в текущий проект. */
export function registerInstallAiSkillsCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('v8vscedit.installAiSkills', async () => {
      const platform = await pickPlatform(services.workspaceFolder.uri.fsPath);
      if (!platform) {
        return;
      }

      const targetDir = path.join(services.workspaceFolder.uri.fsPath, ...platform.targetPrefix.split('/'));
      if (hasExistingRoleFiles(targetDir, platform)) {
        const confirmed = await vscode.window.showWarningMessage(
          `Файлы ролей v8vscedit в ${platform.targetPrefix}/ будут обновлены.`,
          { modal: true },
          'Обновить'
        );
        if (confirmed !== 'Обновить') {
          return;
        }
      }

      try {
        const result = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Установка ИИ-ролей: ${platform.label}`,
          cancellable: false,
        }, (progress) => {
          progress.report({ message: 'запись проектных ролей' });
          const installResult = services.aiSkillsInstaller.installProjectRoles({
            projectRoot: services.workspaceFolder.uri.fsPath,
            platform,
          });
          progress.report({ message: 'готово' });
          return Promise.resolve(installResult);
        });

        for (const message of result.info) {
          services.outputChannel.appendLine(`[ai-roles][info] ${message}`);
        }
        for (const message of result.warnings) {
          services.outputChannel.appendLine(`[ai-roles][warn] ${message}`);
        }

        const warningSuffix = result.warnings.length > 0 || result.info.length > 0
          ? ' Есть замечания в журнале.'
          : '';
        await vscode.window.showInformationMessage(
          `Установлено ролей: ${String(result.installedCount)}. Каталог: ${result.targetPrefix}/.${warningSuffix}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        services.outputChannel.appendLine(`[ai-roles][error] ${message}`);
        await vscode.window.showErrorMessage(
          `Не удалось установить ИИ-роли.\n${message}`,
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

async function pickPlatform(projectRoot: string): Promise<AiSkillsPlatform | undefined> {
  const items = AI_SKILLS_PLATFORMS.map((platform): PlatformPickItem => ({
    label: platform.label,
    description: hasExistingRoleFiles(path.join(projectRoot, ...platform.targetPrefix.split('/')), platform)
      ? `${platform.targetPrefix} — роли v8vscedit уже установлены, будут обновлены`
      : platform.targetPrefix,
    platform,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Для какой платформы установить ИИ-роли',
    placeHolder: 'Роли будут установлены в текущий проект',
  });
  return picked?.platform;
}

function hasExistingRoleFiles(targetDir: string, platform: AiSkillsPlatform): boolean {
  return buildRoleFiles(platform).some((file) => fs.existsSync(path.join(targetDir, ...file.relativePath.split('/'))));
}
