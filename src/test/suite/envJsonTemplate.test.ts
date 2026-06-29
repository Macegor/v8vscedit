import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_ENV_JSON, ensureEnvJson } from '../../infra/repository/envJsonTemplate';

suite('envJsonTemplate.ensureEnvJson', () => {
  let dir: string;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-env-'));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('создаёт env.json из шаблона, если файл отсутствует', () => {
    const created = ensureEnvJson(dir);
    assert.strictEqual(created, true);

    const raw = fs.readFileSync(path.join(dir, 'env.json'), 'utf-8');
    assert.deepStrictEqual(JSON.parse(raw), DEFAULT_ENV_JSON);
  });

  test('пересоздаёт env.json, если файл пуст', () => {
    const envPath = path.join(dir, 'env.json');
    fs.writeFileSync(envPath, '   \n', 'utf-8');

    const created = ensureEnvJson(dir);
    assert.strictEqual(created, true);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(envPath, 'utf-8')), DEFAULT_ENV_JSON);
  });

  test('не трогает существующий непустой env.json', () => {
    const envPath = path.join(dir, 'env.json');
    fs.writeFileSync(envPath, '{"default":{"--ibconnection":"keep"}}', 'utf-8');

    const created = ensureEnvJson(dir);
    assert.strictEqual(created, false);
    const parsed = JSON.parse(fs.readFileSync(envPath, 'utf-8')) as {
      default: Record<string, string>;
    };
    assert.strictEqual(parsed.default['--ibconnection'], 'keep');
  });
});
