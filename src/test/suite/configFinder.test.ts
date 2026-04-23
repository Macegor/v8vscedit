import * as assert from 'assert';
import * as path from 'path';
import { findConfigurations } from '../../infra/fs/ConfigLocator';

/** Путь к папке с примерами конфигурации */
const EXAMPLE_PATH = path.resolve(__dirname, '../../../../example');

suite('ConfigFinder', () => {
  test('Находит конфигурацию cf в example/cf', async () => {
    const entries = await findConfigurations(EXAMPLE_PATH);
    const cf = entries.find((e) => e.kind === 'cf');
    assert.ok(cf, 'Конфигурация CF не найдена');
    assert.ok(cf.rootPath.endsWith('cf') || cf.rootPath.includes('cf'), 'Путь не содержит cf');
  });

  test('Находит расширение cfe в example/cfe/EVOLC', async () => {
    const entries = await findConfigurations(EXAMPLE_PATH);
    const cfe = entries.find((e) => e.kind === 'cfe');
    assert.ok(cfe, 'Расширение CFE не найдено');
  });

  test('Определяет корректное количество конфигураций (минимум 2)', async () => {
    const entries = await findConfigurations(EXAMPLE_PATH);
    assert.ok(entries.length >= 2, `Ожидалось минимум 2, найдено ${entries.length}`);
  });
});
