import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BslAnalyzerConfigService,
  buildBslAnalyzerSourceConfig,
  upsertSourceSection,
} from '../../infra/environment';

suite('BslAnalyzerConfigService', () => {
  test('Создаёт source без extensions, если расширений нет', () => {
    assert.strictEqual(
      buildBslAnalyzerSourceConfig([]),
      [
        '[source]',
        'root = "src/cf"',
        '',
      ].join('\n')
    );
  });

  test('Создаёт source с extensions для подключенных расширений', () => {
    assert.strictEqual(
      buildBslAnalyzerSourceConfig(['src/cfe/EVOLC']),
      [
        '[source]',
        'root = "src/cf"',
        '',
        'extensions = [',
        '  "src/cfe/EVOLC",',
        ']',
        '',
      ].join('\n')
    );
  });

  test('Обновляет только секцию source', () => {
    const updated = upsertSourceSection(
      [
        '[server]',
        'port = 0',
        '',
        '[source]',
        'root = "old"',
        '',
        '[diagnostics]',
        'enabled = true',
        '',
      ].join('\n'),
      buildBslAnalyzerSourceConfig(['src/cfe/EVOLC'])
    );

    assert.strictEqual(updated, [
      '[server]',
      'port = 0',
      '',
      '[source]',
      'root = "src/cf"',
      '',
      'extensions = [',
      '  "src/cfe/EVOLC",',
      ']',
      '',
      '[diagnostics]',
      'enabled = true',
      '',
    ].join('\n'));
  });

  test('Создаёт файл в корне проекта', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-bsl-analyzer-'));
    try {
      const service = new BslAnalyzerConfigService(root);
      service.ensureExists([path.join(root, 'src', 'cfe', 'EVOLC')]);

      assert.strictEqual(
        fs.readFileSync(path.join(root, 'bsl-analyzer.toml'), 'utf-8'),
        buildBslAnalyzerSourceConfig(['src/cfe/EVOLC'])
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
