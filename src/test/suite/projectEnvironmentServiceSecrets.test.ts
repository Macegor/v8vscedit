import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SecretStore } from '../../infra/ai/AiSecretStorage';
import { ProjectEnvironmentService } from '../../infra/environment/ProjectEnvironmentService';
import { ProjectSecretStorage } from '../../infra/environment/ProjectSecretStorage';

/**
 * Системный реестр баз 1С и список установленных платформ — внешние сканы ОС,
 * недоступные в тест-хосте и медленные. Инжектируем детерминированные фейки,
 * чтобы проверять именно S1-логику паролей (реестр содержит нужную базу
 * `any-base-id`, платформы не нужны). Секрет-хранилище — реальный код на Map.
 */
function makeService(workspaceRoot: string, secrets: ProjectSecretStorage): ProjectEnvironmentService {
  return new ProjectEnvironmentService(workspaceRoot, secrets, {
    scanInfoBases: () => ({
      bases: [
        {
          id: 'any-base-id',
          name: 'Тестовая база',
          kind: 'file',
          connection: 'File="/tmp/test-base";',
          sourcePath: '/tmp/ibases.v8i',
        },
      ],
      sources: [],
      warnings: [],
    }),
    scanPlatforms: () => [],
  });
}

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

// Задача S1: ProjectEnvironmentService.save не должен писать непустой
// --db-pwd в env.json — пароль переезжает в ProjectSecretStorage. Тесты
// фиксируют целевое поведение конструктора (принимает ProjectSecretStorage),
// формата env.json после save и снапшота (dbPasswordSet вместо пароля).
suite('ProjectEnvironmentService — секреты (S1)', () => {
  let workspaceRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-project-env-'));
  });

  teardown(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function readEnvJson(): Record<string, unknown> {
    const raw = fs.readFileSync(path.join(workspaceRoot, 'env.json'), 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  function writeEnvJson(content: Record<string, unknown>): void {
    fs.mkdirSync(workspaceRoot, { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'env.json'), JSON.stringify(content, null, 2), 'utf-8');
  }

  test('save с паролем не пишет непустой --db-pwd в env.json, пароль уходит в секрет-хранилище', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = makeService(workspaceRoot, secrets);

    await service.save({
      platformPath: '/opt/1C/8.3.20/1cv8',
      baseId: 'any-base-id',
      dbUser: 'Администратор',
      dbPassword: 'my-real-password',
    });

    const env = readEnvJson();
    const defaults = env.default as Record<string, unknown>;
    // Пароль не должен утекать в git вместе с env.json.
    assert.notStrictEqual(defaults['--db-pwd'], 'my-real-password');
    assert.ok(
      defaults['--db-pwd'] === '' || defaults['--db-pwd'] === undefined,
      `--db-pwd должен быть пустым в env.json, получено: ${JSON.stringify(defaults['--db-pwd'])}`
    );

    assert.strictEqual(await secrets.getDbPassword(), 'my-real-password');
  });

  test('снапшот содержит dbPasswordSet:true и не содержит самого пароля', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = makeService(workspaceRoot, secrets);

    await service.save({
      platformPath: '/opt/1C/8.3.20/1cv8',
      baseId: 'any-base-id',
      dbUser: 'Администратор',
      dbPassword: 'my-real-password',
    });

    const snapshot = await service.getSnapshot();
    const settings = snapshot.settings as unknown as Record<string, unknown>;

    assert.strictEqual(settings.dbPasswordSet, true);
    // Реального пароля в снапшоте (который уходит в webview) быть не должно.
    assert.strictEqual(settings.dbPassword, undefined);
    assert.notStrictEqual(JSON.stringify(snapshot).includes('my-real-password'), true);
  });

  test('повторный save с пустым паролем не стирает ранее сохранённый секрет', async () => {
    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = makeService(workspaceRoot, secrets);

    await service.save({
      platformPath: '/opt/1C/8.3.20/1cv8',
      baseId: 'any-base-id',
      dbUser: 'Администратор',
      dbPassword: 'kept-password',
    });

    // Пользователь пересохраняет настройки, не трогая поле пароля (пустой ввод).
    await service.save({
      platformPath: '/opt/1C/8.3.20/1cv8',
      baseId: 'any-base-id',
      dbUser: 'Администратор2',
      dbPassword: '',
    });

    assert.strictEqual(await secrets.getDbPassword(), 'kept-password');
    const snapshot = await service.getSnapshot();
    assert.strictEqual((snapshot.settings as unknown as Record<string, unknown>).dbPasswordSet, true);
  });

  test('миграция: legacy непустой --db-pwd в env.json переносится в секрет-хранилище и стирается из файла', async () => {
    writeEnvJson({
      default: {
        '--ibconnection': '/Flegacy',
        '--db-user': 'Администратор',
        '--db-pwd': 'legacy-plaintext-password',
        '--path': '',
        '--v8version': '',
      },
    });

    const secretStore = createFakeSecretStore();
    const secrets = new ProjectSecretStorage(secretStore, workspaceRoot);
    const service = makeService(workspaceRoot, secrets);

    // Обращение к снапшоту должно запускать миграцию legacy-пароля.
    const snapshot = await service.getSnapshot();

    assert.strictEqual(await secrets.getDbPassword(), 'legacy-plaintext-password');
    assert.strictEqual((snapshot.settings as unknown as Record<string, unknown>).dbPasswordSet, true);

    const env = readEnvJson();
    const defaults = env.default as Record<string, unknown>;
    assert.ok(
      defaults['--db-pwd'] === '' || defaults['--db-pwd'] === undefined,
      'После миграции legacy --db-pwd в env.json должен быть затёрт'
    );
  });
});
