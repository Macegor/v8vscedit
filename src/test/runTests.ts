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
    sanitizeInheritedIdeEnv();

    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

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
