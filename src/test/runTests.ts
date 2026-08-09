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

async function main(): Promise<void> {
  try {
    // Версию читаем ДО очистки окружения: sanitizeInheritedIdeEnv удаляет всё с
    // префиксом VSCODE_, включая саму VSCODE_TEST_VERSION, — иначе документированный
    // запуск `VSCODE_TEST_VERSION=1.85.0 npm test` молча откатывался бы на 'stable'.
    const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

    sanitizeInheritedIdeEnv();

    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
      version,
    });
  } catch (err) {
    console.error('Тесты завершились с ошибкой:', err);
    process.exit(1);
  }
}

void main();
