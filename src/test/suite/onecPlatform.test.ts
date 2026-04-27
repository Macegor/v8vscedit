import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeInfoBasePath, resolveV8ExecutablePath, resolveV8PathHintFromVersion } from '../../infra/process';

suite('OnecPlatform', () => {
  test('Сохраняет абсолютный путь файловой базы на macOS/Linux', () => {
    assert.strictEqual(
      normalizeInfoBasePath('/Users/test/InfoBases/dev', 'darwin'),
      '/Users/test/InfoBases/dev'
    );
  });

  test('Нормализует Windows-путь файловой базы только на Windows', () => {
    assert.strictEqual(
      normalizeInfoBasePath('C:/InfoBases/dev', 'win32'),
      'C:\\InfoBases\\dev'
    );
  });

  test('Раскрывает домашний каталог на Unix-платформах', () => {
    assert.ok(normalizeInfoBasePath('~/InfoBases/dev', 'linux').endsWith('/InfoBases/dev'));
  });

  test('Берёт бинарник из macOS app, а не ресурс иконки', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-onec-platform-'));
    try {
      const binaryPath = path.join(root, '1cv8.app', 'Contents', 'MacOS', '1cv8');
      const iconPath = path.join(root, '1cv8s.app', 'Contents', 'Resources', '1cv8s.icns');
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
      fs.mkdirSync(path.dirname(iconPath), { recursive: true });
      fs.writeFileSync(binaryPath, '');
      fs.writeFileSync(iconPath, '');
      fs.chmodSync(binaryPath, 0o755);
      fs.chmodSync(iconPath, 0o644);

      assert.strictEqual(resolveV8ExecutablePath(root, 'darwin'), binaryPath);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Предпочитает 1cv8 перед 1cv8c внутри каталога версии', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-onec-priority-'));
    try {
      const thickClient = path.join(root, '1cv8');
      const thinClient = path.join(root, '1cv8c.app', 'Contents', 'MacOS', '1cv8c');
      fs.mkdirSync(path.dirname(thinClient), { recursive: true });
      fs.writeFileSync(thickClient, '');
      fs.writeFileSync(thinClient, '');
      fs.chmodSync(thickClient, 0o755);
      fs.chmodSync(thinClient, 0o755);

      assert.strictEqual(resolveV8ExecutablePath(root, 'darwin'), thickClient);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('Строит macOS-путь к версии платформы из env.json', () => {
    assert.strictEqual(
      resolveV8PathHintFromVersion('8.5.1.1150', 'darwin'),
      '/opt/1cv8/8.5.1.1150'
    );
  });
});
