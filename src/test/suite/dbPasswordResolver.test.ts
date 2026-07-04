import * as assert from 'assert';
import type { SecretStore } from '../../infra/ai/AiSecretStorage';
import { resolveDbPassword } from '../../infra/environment/DbPasswordResolver';
import { ProjectSecretStorage } from '../../infra/environment/ProjectSecretStorage';

/**
 * Фейковый SecretStore на Map — структурный контракт vscode.SecretStorage,
 * реального Extension Host в модульных тестах нет.
 */
function createFakeSecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(map.get(key)),
    store: (key: string, value: string) => {
      map.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

// Задача S1: DbRunCommandRunner/ExtensionCommandRunner/RepositoryCommandRunner
// сейчас читают пароль БД напрямую из env.json (--db-pwd). Общий резолвер
// должен сначала смотреть в ProjectSecretStorage и только при отсутствии
// секрета — на legacy-значение из env.json (для конфигураций, ещё не
// сохранённых через новый ProjectEnvironmentService.save).
suite('resolveDbPassword', () => {
  test('Возвращает пароль из ProjectSecretStorage, если он там сохранён', async () => {
    const secrets = new ProjectSecretStorage(createFakeSecretStore(), '/workspace/db-resolver');
    await secrets.setDbPassword('stored-secret');

    const password = await resolveDbPassword(secrets, 'legacy-from-env-json');
    assert.strictEqual(password, 'stored-secret');
  });

  test('Fallback на legacy --db-pwd из env.json, если секрета в хранилище ещё нет', async () => {
    const secrets = new ProjectSecretStorage(createFakeSecretStore(), '/workspace/db-resolver-empty');

    const password = await resolveDbPassword(secrets, 'legacy-from-env-json');
    assert.strictEqual(password, 'legacy-from-env-json');
  });

  test('Пустая строка и в секрете, и в legacy даёт пустой пароль без падения', async () => {
    const secrets = new ProjectSecretStorage(createFakeSecretStore(), '/workspace/db-resolver-blank');

    const password = await resolveDbPassword(secrets, '');
    assert.strictEqual(password, '');
  });
});
