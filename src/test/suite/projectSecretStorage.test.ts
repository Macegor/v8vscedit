import * as assert from 'assert';
import type { SecretStore } from '../../infra/ai/AiSecretStorage';
import { ProjectSecretStorage } from '../../infra/environment/ProjectSecretStorage';

/**
 * Фейковый SecretStore на базе Map — это структурный контракт (совместим с
 * vscode.SecretStorage), а не внешняя система: реальный `context.secrets`
 * в тестовом окружении недоступен без запуска Extension Host, поэтому
 * поведение асинхронного get/store/delete проверяем на такой реализации.
 */
function createFakeSecretStore(): SecretStore & { size: () => number } {
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
    size: () => map.size,
  };
}

// Задача S1: пароли БД и хранилища переезжают из открытых JSON-файлов
// (env.json) в SecretStorage. Тесты фиксируют целевой контракт обёртки
// ProjectSecretStorage, под который developer должен реализовать класс.
suite('ProjectSecretStorage', () => {
  test('setDbPassword сохраняет пароль, getDbPassword его возвращает', async () => {
    const store = createFakeSecretStore();
    const storage = new ProjectSecretStorage(store, '/workspace/one');

    assert.strictEqual(await storage.hasDbPassword(), false);
    await storage.setDbPassword('super-secret');
    assert.strictEqual(await storage.getDbPassword(), 'super-secret');
    assert.strictEqual(await storage.hasDbPassword(), true);
  });

  test('setDbPassword с пустой строкой удаляет ранее сохранённый пароль', async () => {
    const store = createFakeSecretStore();
    const storage = new ProjectSecretStorage(store, '/workspace/one');

    await storage.setDbPassword('initial');
    assert.strictEqual(await storage.getDbPassword(), 'initial');

    await storage.setDbPassword('');
    assert.strictEqual(await storage.getDbPassword(), undefined);
    assert.strictEqual(await storage.hasDbPassword(), false);
  });

  test('Пароли БД разных workspace-корней не пересекаются', async () => {
    const store = createFakeSecretStore();
    const storageOne = new ProjectSecretStorage(store, '/workspace/one');
    const storageTwo = new ProjectSecretStorage(store, '/workspace/two');

    await storageOne.setDbPassword('pwd-one');
    await storageTwo.setDbPassword('pwd-two');

    assert.strictEqual(await storageOne.getDbPassword(), 'pwd-one');
    assert.strictEqual(await storageTwo.getDbPassword(), 'pwd-two');
  });

  test('setRepoPassword/getRepoPassword работают per-scopeKey', async () => {
    const store = createFakeSecretStore();
    const storage = new ProjectSecretStorage(store, '/workspace/one');
    const scopeA = 'scope-a-hash';
    const scopeB = 'scope-b-hash';

    assert.strictEqual(await storage.hasRepoPassword(scopeA), false);

    await storage.setRepoPassword(scopeA, 'repo-secret-a');
    await storage.setRepoPassword(scopeB, 'repo-secret-b');

    assert.strictEqual(await storage.getRepoPassword(scopeA), 'repo-secret-a');
    assert.strictEqual(await storage.getRepoPassword(scopeB), 'repo-secret-b');
    assert.strictEqual(await storage.hasRepoPassword(scopeA), true);
    assert.strictEqual(await storage.hasRepoPassword(scopeB), true);
  });

  test('setRepoPassword с пустой строкой удаляет пароль только для своего scopeKey', async () => {
    const store = createFakeSecretStore();
    const storage = new ProjectSecretStorage(store, '/workspace/one');
    const scopeA = 'scope-a-hash';
    const scopeB = 'scope-b-hash';

    await storage.setRepoPassword(scopeA, 'repo-secret-a');
    await storage.setRepoPassword(scopeB, 'repo-secret-b');

    await storage.setRepoPassword(scopeA, '');

    assert.strictEqual(await storage.getRepoPassword(scopeA), undefined);
    assert.strictEqual(await storage.hasRepoPassword(scopeA), false);
    // Соседний scope не должен пострадать от удаления другого.
    assert.strictEqual(await storage.getRepoPassword(scopeB), 'repo-secret-b');
    assert.strictEqual(await storage.hasRepoPassword(scopeB), true);
  });

  test('Namespace-ключи в SecretStore реально изолированы (нет коллизии dbPassword/repoPassword)', async () => {
    const store = createFakeSecretStore();
    const storage = new ProjectSecretStorage(store, '/workspace/one');

    await storage.setDbPassword('db-secret');
    await storage.setRepoPassword('same-key-as-workspace', 'repo-secret');

    // В одном сторе должно оказаться ровно две независимые записи —
    // это подтверждает, что ключи реально неймспейсятся, а не коллизируют.
    assert.strictEqual(store.size(), 2);
    assert.strictEqual(await storage.getDbPassword(), 'db-secret');
    assert.strictEqual(await storage.getRepoPassword('same-key-as-workspace'), 'repo-secret');
  });
});
