import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConfigurations } from '../../infra/fs/ConfigLocator';

/** Путь к папке с примерами конфигурации */
const EXAMPLE_PATH = path.resolve(__dirname, '../../../example');

suite('ConfigFinder', () => {
  test('Находит конфигурацию cf в example/cf', () => {
    const entries = findConfigurations(EXAMPLE_PATH);
    const cf = entries.find((e) => e.kind === 'cf');
    assert.ok(cf, 'Конфигурация CF не найдена');
    assert.ok(cf.rootPath.endsWith('cf') || cf.rootPath.includes('cf'), 'Путь не содержит cf');
  });

  test('Находит расширение cfe в example/cfe/EVOLC', () => {
    const entries = findConfigurations(EXAMPLE_PATH);
    const cfe = entries.find((e) => e.kind === 'cfe');
    assert.ok(cfe, 'Расширение CFE не найдено');
  });

  test('Определяет корректное количество конфигураций (минимум 2)', () => {
    const entries = findConfigurations(EXAMPLE_PATH);
    assert.ok(entries.length >= 2, `Ожидалось минимум 2, найдено ${String(entries.length)}`);
  });

  test('Сканирует только src в корне проекта и игнорирует служебные выгрузки агента', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-config-locator-'));
    writeConfig(path.join(root, 'src', 'cf'), false);
    writeConfig(path.join(root, 'src', 'cfe', 'EVOLC'), true);
    writeConfig(path.join(root, '.v8vscedit', 'agent', '0', 'workspace', 'cfe-EVOLC', 'cfe', 'EVOLC'), true);
    writeConfig(path.join(root, 'docs', 'snapshot', 'cfe', 'EVOLC'), true);

    const entries = findConfigurations(root);

    assert.strictEqual(entries.length, 2);
    assert.ok(entries.every((entry) => path.relative(path.join(root, 'src'), entry.rootPath).startsWith('..') === false));
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
