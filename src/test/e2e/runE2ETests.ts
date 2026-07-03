import * as path from 'path';
import { runTests } from '@vscode/test-electron';

const VSCODE_ENV_PREFIXES = ['VSCODE_', 'ELECTRON_'];

function sanitizeInheritedIdeEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (VSCODE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      Reflect.deleteProperty(process.env, key);
    }
  }
}

/**
 * Запуск E2E-набора: открывает проект-выгрузку 1С как workspace и гоняет
 * реальные команды/сервисы расширения (создание → загрузка в базу → правка →
 * удаление). Workspace по умолчанию — `example/2.20`; переопределяется
 * переменной `E2E_WORKSPACE` (абсолютный путь), чтобы прогонять на другой
 * выгрузке/базе (напр. временной). Реальная загрузка в базу требует платформы
 * 1С и базы из `env.json`; без них тесты внутри набора пропускаются.
 */
async function main(): Promise<void> {
  try {
    sanitizeInheritedIdeEnv();

    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './index');
    const workspace = process.env.E2E_WORKSPACE ?? path.resolve(__dirname, '../../../example/2.20');
    const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, '--disable-extensions'],
      version,
    });
  } catch (err) {
    console.error('E2E завершились с ошибкой:', err);
    process.exit(1);
  }
}

void main();
