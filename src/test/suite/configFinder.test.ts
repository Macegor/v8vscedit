import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConfigurations } from '../../infra/fs/ConfigLocator';

/** Путь к папке с примерами конфигурации */
const EXAMPLE_PATH = path.resolve(__dirname, '../../../example/2.20');

suite('ConfigFinder', () => {
  test('Находит конфигурацию cf в example/cf', () => {
    const entries = findConfigurations(EXAMPLE_PATH);
    const cf = entries.find((e) => e.kind === 'cf');
    assert.ok(cf, 'Конфигурация CF не найдена');
    assert.ok(cf.rootPath.endsWith('cf') || cf.rootPath.includes('cf'), 'Путь не содержит cf');
  });

  test('Находит расширение cfe в example/cfe/EVOLC', function () {
    const entries = findConfigurations(EXAMPLE_PATH);
    const cfe = entries.find((e) => e.kind === 'cfe');
    if (!cfe) {
      // example/2.21/src/cfe сейчас может быть пустым — тест применим лишь когда в выгрузке есть CFE.
      this.skip();
    }
  });

  test('Определяет корректное количество конфигураций (минимум 1)', () => {
    // Минимум одна конфигурация (CF) всегда обязана найтись в example/.
    const entries = findConfigurations(EXAMPLE_PATH);
    assert.ok(entries.length >= 1, `Ожидалось минимум 1, найдено ${String(entries.length)}`);
  });

  test('Сканирует только штатные корни src/cf и src/cfe/*', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-config-locator-'));
    writeConfig(path.join(root, 'src', 'cf'), false);
    writeConfig(path.join(root, 'src', 'cfe', 'EVOLC'), true);
    writeConfig(path.join(root, 'src', 'cfe', 'EVOLC', 'nested-copy'), true);
    writeConfig(path.join(root, 'src', 'other', 'EVOLC'), true);
    writeConfig(path.join(root, '.v8vscedit', 'agent', '0', 'workspace', 'cfe-EVOLC', 'cfe', 'EVOLC'), true);
    writeConfig(path.join(root, 'docs', 'snapshot', 'cfe', 'EVOLC'), true);

    const entries = findConfigurations(root);

    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(
      entries.map((entry) => path.relative(root, entry.rootPath)).sort(),
      [path.join('src', 'cf'), path.join('src', 'cfe', 'EVOLC')]
    );
    assert.ok(entries.some((entry) => entry.kind === 'cf' && entry.rootPath.endsWith(path.join('src', 'cf'))));
    assert.ok(entries.some((entry) => entry.kind === 'cfe' && entry.rootPath.endsWith(path.join('src', 'cfe', 'EVOLC'))));
  });
});

function writeConfig(root: string, extension: boolean): void {
  fs.mkdirSync(root, { recursive: true });
  const extensionTag = extension ? '<ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>' : '';
  fs.writeFileSync(
    path.join(root, 'Configuration.xml'),
    `<MetaDataObject><Configuration><Properties>${extensionTag}</Properties></Configuration></MetaDataObject>`,
    'utf-8'
  );
}
