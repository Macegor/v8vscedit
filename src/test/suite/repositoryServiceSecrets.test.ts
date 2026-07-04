import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SecretStore } from '../../infra/ai/AiSecretStorage';
import { ProjectSecretStorage } from '../../infra/environment/ProjectSecretStorage';
import { RepositoryService, type RepositoryTarget } from '../../infra/repository/RepositoryService';

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

// Задача S1: RepositoryService.loadBinding не должен отдавать реальный
// пароль наружу (в webview), а RepositoryService должен уметь мигрировать
// legacy repo-pwd из env.json в ProjectSecretStorage.
suite('RepositoryService — секреты (S1)', () => {
  let workspaceRoot: string;
  let target: RepositoryTarget;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-repo-secrets-'));
    const configRoot = path.join(workspaceRoot, 'src', 'cf');
    fs.mkdirSync(configRoot, { recursive: true });
    fs.writeFileSync(
      path.join(configRoot, 'Configuration.xml'),
      '<?xml version="1.0" encoding="UTF-8"?><MetaDataObject><Configuration uuid="11111111-1111-1111-1111-111111111111"><Properties><Name>ТестоваяКонфигурация</Name></Properties></Configuration></MetaDataObject>',
      'utf-8'
    );
    target = {
      configRoot,
      configKind: 'cf',
      displayName: 'Тест',
    };
  });

  teardown(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function writeEnvJson(content: Record<string, unknown>): void {
    fs.writeFileSync(path.join(workspaceRoot, 'env.json'), JSON.stringify(content, null, 2), 'utf-8');
  }

  test('loadBinding не отдаёт пароль наружу после сохранения через ProjectSecretStorage', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = new RepositoryService(workspaceRoot, secrets);

    await service.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'repo-real-secret',
    });

    const binding = await service.loadBinding(target);
    assert.ok(binding, 'Привязка должна существовать после saveBinding.');
    // Объект, уходящий во внешний слой (webview), не должен содержать пароль.
    assert.strictEqual((binding as unknown as Record<string, unknown>).repoPassword, undefined);
    assert.notStrictEqual(JSON.stringify(binding).includes('repo-real-secret'), true);

    assert.strictEqual(await service.hasStoredRepoPassword(target), true);
  });

  test('миграция: legacy repo-pwd в env.json переносится в ProjectSecretStorage', async () => {
    writeEnvJson({
      default: {
        '--repo-path': '\\\\repo\\legacy',
        '--repo-user': 'legacy-user',
        '--repo-pwd': 'legacy-repo-secret',
      },
    });

    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = new RepositoryService(workspaceRoot, secrets);

    // Обращение к loadBinding должно запускать миграцию legacy repo-pwd.
    const binding = await service.loadBinding(target);
    assert.ok(binding);
    assert.strictEqual((binding as unknown as Record<string, unknown>).repoPassword, undefined);

    assert.strictEqual(await service.hasStoredRepoPassword(target), true);

    const rawEnv = fs.readFileSync(path.join(workspaceRoot, 'env.json'), 'utf-8');
    const env = JSON.parse(rawEnv) as { default?: Record<string, unknown> };
    const defaults = env.default ?? {};
    assert.ok(
      defaults['--repo-pwd'] === '' || defaults['--repo-pwd'] === undefined,
      'После миграции legacy --repo-pwd в env.json должен быть затёрт'
    );
  });

  test('hasStoredRepoPassword ложно для цели без сохранённого пароля хранилища', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = new RepositoryService(workspaceRoot, secrets);

    assert.strictEqual(await service.hasStoredRepoPassword(target), false);
  });

  test('resolveBindingForCommand отдаёт реальный пароль из ProjectSecretStorage для запуска команды', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = new RepositoryService(workspaceRoot, secrets);

    await service.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'repo-real-secret',
    });

    const binding = await service.resolveBindingForCommand(target);
    assert.ok(binding);
    assert.strictEqual(binding.repoPath, '\\\\repo\\storage');
    assert.strictEqual(binding.repoUser, 'tester');
    assert.strictEqual(binding.repoPassword, 'repo-real-secret');
  });

  test('resolveBindingForCommand возвращает null без сохранённой привязки', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = new RepositoryService(workspaceRoot, secrets);

    assert.strictEqual(await service.resolveBindingForCommand(target), null);
  });

  test('clearBinding для основной конфигурации удаляет привязку из env.json и стирает пароль хранилища', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = new RepositoryService(workspaceRoot, secrets);

    await service.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'repo-real-secret',
    });
    assert.strictEqual(await service.hasStoredRepoPassword(target), true);

    await service.clearBinding(target);

    assert.strictEqual(await service.loadBinding(target), null);
    assert.strictEqual(await service.hasStoredRepoPassword(target), false);

    const rawEnv = fs.readFileSync(path.join(workspaceRoot, 'env.json'), 'utf-8');
    const env = JSON.parse(rawEnv) as { default?: Record<string, unknown> };
    const defaults = env.default ?? {};
    assert.strictEqual(defaults['--repo-path'], undefined);
    assert.strictEqual(defaults['--repo-user'], undefined);
    assert.strictEqual(defaults['--repo-pwd'], undefined);
  });

  suite('расширение (cfe)', () => {
    let extensionTarget: RepositoryTarget;

    setup(() => {
      const extensionRoot = path.join(workspaceRoot, 'src', 'cfe', 'МоеРасширение');
      fs.mkdirSync(extensionRoot, { recursive: true });
      fs.writeFileSync(
        path.join(extensionRoot, 'Configuration.xml'),
        '<?xml version="1.0" encoding="UTF-8"?><MetaDataObject><Configuration uuid="22222222-2222-2222-2222-222222222222"><Properties><Name>МоеРасширение</Name></Properties></Configuration></MetaDataObject>',
        'utf-8'
      );
      extensionTarget = {
        configRoot: extensionRoot,
        configKind: 'cfe',
        extensionName: 'МоеРасширение',
        displayName: 'Моё расширение',
      };
    });

    test('saveBinding/loadBinding для расширения не отдают пароль наружу и хранят его отдельно по scopeKey', async () => {
      const secretStore = createFakeSecretStore();
      const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
      const service = new RepositoryService(workspaceRoot, secrets);

      await service.saveBinding(extensionTarget, {
        repoPath: '\\\\repo\\ext-storage',
        repoUser: 'ext-tester',
        repoPassword: 'ext-repo-secret',
      });

      const binding = await service.loadBinding(extensionTarget);
      assert.ok(binding);
      assert.strictEqual(binding.repoPath, '\\\\repo\\ext-storage');
      assert.strictEqual(binding.repoUser, 'ext-tester');
      assert.strictEqual((binding as unknown as Record<string, unknown>).repoPassword, undefined);
      assert.strictEqual(await service.hasStoredRepoPassword(extensionTarget), true);

      // Пароль основной конфигурации (другой scopeKey) не задет сохранением расширения.
      assert.strictEqual(await service.hasStoredRepoPassword(target), false);

      const resolved = await service.resolveBindingForCommand(extensionTarget);
      assert.strictEqual(resolved?.repoPassword, 'ext-repo-secret');
    });

    test('миграция: legacy repo-pwd расширения в env.json переносится в ProjectSecretStorage и стирается из файла', async () => {
      writeEnvJson({
        default: {
          extension: {
            МоеРасширение: {
              'repo-path': '\\\\repo\\ext-legacy',
              'repo-user': 'ext-legacy-user',
              'repo-pwd': 'ext-legacy-secret',
            },
          },
        },
      });

      const secretStore = createFakeSecretStore();
      const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
      const service = new RepositoryService(workspaceRoot, secrets);

      const binding = await service.loadBinding(extensionTarget);
      assert.ok(binding);
      assert.strictEqual(binding.repoPath, '\\\\repo\\ext-legacy');
      assert.strictEqual((binding as unknown as Record<string, unknown>).repoPassword, undefined);
      assert.strictEqual(await service.hasStoredRepoPassword(extensionTarget), true);

      const rawEnv = fs.readFileSync(path.join(workspaceRoot, 'env.json'), 'utf-8');
      const env = JSON.parse(rawEnv) as {
        default?: { extension?: Record<string, Record<string, unknown>> };
      };
      const item = env.default?.extension?.['МоеРасширение'] ?? {};
      assert.strictEqual(
        item['repo-pwd'],
        undefined,
        'После миграции legacy repo-pwd расширения в env.json должен быть удалён'
      );
    });

    test('clearBinding для расширения удаляет секцию из env.json и стирает пароль хранилища', async () => {
      const secretStore = createFakeSecretStore();
      const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
      const service = new RepositoryService(workspaceRoot, secrets);

      await service.saveBinding(extensionTarget, {
        repoPath: '\\\\repo\\ext-storage',
        repoUser: 'ext-tester',
        repoPassword: 'ext-repo-secret',
      });
      assert.strictEqual(await service.hasStoredRepoPassword(extensionTarget), true);

      await service.clearBinding(extensionTarget);

      assert.strictEqual(await service.loadBinding(extensionTarget), null);
      assert.strictEqual(await service.hasStoredRepoPassword(extensionTarget), false);
    });
  });
});
