/**
 * S2: webview не должен иметь возможность инициировать исполнение произвольной
 * VS Code-команды. Единственный безопасный путь — команды с префиксом
 * `v8vscedit.`, которые реально зарегистрированы в системе (а не любая строка,
 * "угаданная" вредоносным/скомпрометированным контентом webview).
 *
 * Функция чистая (список зарегистрированных команд передаётся параметром),
 * поэтому тестируется юнитом без обращения к реальному
 * `vscode.commands.getCommands()` — это позволяет детерминированно проверить
 * все комбинации префикса/регистрации.
 *
 * Модуль `webviewCommandGuard.ts` ещё не существует — тест обязан падать на
 * импорте до реализации (fastest correct red по TDD).
 */
import * as assert from 'assert';
import { isWebviewCommandAllowed } from '../../ui/views/webview/webviewCommandGuard';

suite('webviewCommandGuard', () => {
  test('команда без префикса v8vscedit. не разрешена ни при каком списке зарегистрированных', () => {
    // workbench.action.terminal.new — типичный пример произвольной системной
    // команды, которую webview не должен иметь возможности вызвать напрямую.
    const registered = ['workbench.action.terminal.new', 'v8vscedit.refresh'];
    assert.strictEqual(isWebviewCommandAllowed('workbench.action.terminal.new', registered), false);
  });

  test('команда с префиксом v8vscedit., отсутствующая в списке зарегистрированных, не разрешена', () => {
    // Префикс сам по себе не даёт доверия — команда должна реально существовать
    // в системе (иначе allowlist по префиксу можно обойти опечаткой/подделкой имени).
    const registered = ['v8vscedit.refresh', 'v8vscedit.showProperties'];
    assert.strictEqual(isWebviewCommandAllowed('v8vscedit.doesNotExist', registered), false);
  });

  test('команда v8vscedit.*, присутствующая в списке зарегистрированных, разрешена', () => {
    const registered = ['v8vscedit.refresh', 'v8vscedit.showProperties'];
    assert.strictEqual(isWebviewCommandAllowed('v8vscedit.showProperties', registered), true);
  });

  test('пустая строка команды не разрешена', () => {
    const registered = ['v8vscedit.refresh'];
    assert.strictEqual(isWebviewCommandAllowed('', registered), false);
  });

  test('строка, состоящая только из префикса без имени команды, не разрешена', () => {
    // 'v8vscedit.' формально "начинается с префикса", но не является
    // осмысленным идентификатором команды и не может быть зарегистрирована.
    const registered = ['v8vscedit.'];
    assert.strictEqual(isWebviewCommandAllowed('v8vscedit.', registered), false);
  });

  test('регистр команды учитывается строго (case-sensitive), совпадение только по точному имени', () => {
    // VS Code различает регистр идентификаторов команд; ослабление до
    // case-insensitive сравнения расширило бы поверхность атаки.
    const registered = ['v8vscedit.refresh'];
    assert.strictEqual(isWebviewCommandAllowed('V8VSCEDIT.REFRESH', registered), false);
  });

  test('пустой список зарегистрированных команд не разрешает ни одну команду с валидным префиксом', () => {
    assert.strictEqual(isWebviewCommandAllowed('v8vscedit.refresh', []), false);
  });
});
