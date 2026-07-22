import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationCleanWindow } from '../../infra/fs/ConfigurationCleanWindow';

suite('ConfigurationCleanWindow', () => {
  const root = path.join(os.tmpdir(), 'v8vscedit-clean-window', 'src', 'cf');
  const insideFile = path.join(root, 'Catalogs', 'Товары.xml');
  const otherRoot = path.join(os.tmpdir(), 'v8vscedit-clean-window', 'src', 'cfe', 'EVOLC');

  test('без открытого окна события файлов обрабатываются как обычно', () => {
    const window = new ConfigurationCleanWindow();
    assert.strictEqual(window.isOpenFor(insideFile), false);
  });

  test('после открытия окна файлы корня игнорируются, чужие — нет', () => {
    const now = 1_000;
    const window = new ConfigurationCleanWindow(5_000, () => now);
    window.open([root]);

    assert.strictEqual(window.isOpenFor(insideFile), true);
    assert.strictEqual(window.isOpenFor(path.join(otherRoot, 'Configuration.xml')), false);
    // Сам корень окном не покрывается: относительный путь пуст.
    assert.strictEqual(window.isOpenFor(root), false);
  });

  test('регистр и форма записи пути не влияют на попадание в окно', () => {
    const now = 0;
    const window = new ConfigurationCleanWindow(5_000, () => now);
    window.open([root.toUpperCase()]);
    assert.strictEqual(window.isOpenFor(path.join(root, '.', 'Catalogs', 'Товары.xml')), true);
  });

  test('по истечении срока окно закрывается', () => {
    let now = 1_000;
    const window = new ConfigurationCleanWindow(5_000, () => now);
    window.open([root]);

    now = 6_000;
    assert.strictEqual(window.isOpenFor(insideFile), true, 'на границе окно ещё открыто');

    now = 6_001;
    assert.strictEqual(window.isOpenFor(insideFile), false);
    // Повторный вызов идёт уже по очищенной карте корней.
    assert.strictEqual(window.isOpenFor(insideFile), false);
  });

  test('повторное открытие продлевает окно', () => {
    let now = 0;
    const window = new ConfigurationCleanWindow(1_000, () => now);
    window.open([root]);
    now = 900;
    window.open([root]);
    now = 1_500;
    assert.strictEqual(window.isOpenFor(insideFile), true);
  });

  test('срок по умолчанию задан явной константой и используется по умолчанию', () => {
    // Container планирует единственный авторитетный пересчёт состояния по
    // окончании окна и берёт длительность отсюда же — значения обязаны совпадать.
    assert.strictEqual(ConfigurationCleanWindow.defaultDurationMs, 15_000);

    let now = 0;
    const window = new ConfigurationCleanWindow(undefined, () => now);
    window.open([root]);
    now = ConfigurationCleanWindow.defaultDurationMs;
    assert.strictEqual(window.isOpenFor(insideFile), true);
    now = ConfigurationCleanWindow.defaultDurationMs + 1;
    assert.strictEqual(window.isOpenFor(insideFile), false);
  });
});
