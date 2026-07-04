/**
 * P1b: `src-ui/apps/tree-search/TreeSearchApp.vue` вызывает `executeCommand(id)`
 * с рядом устаревших идентификаторов команд, которых нет в
 * `package.json contributes.commands` — т.е. `v8vscedit.commands.executeCommand`
 * в `TreeSearchViewProvider.handleMessage` реально их не выполнит: команда не
 * пройдёт allowlist `isWebviewCommandAllowed` (id физически не в списке
 * зарегистрированных, `vscode.commands.getCommands(true)` его не вернёт).
 * Кнопки «Импорт», «Настройки», «Автономный сервер» в панели «Действия»
 * сейчас no-op.
 *
 * Список id извлекается не хардкодом, а реальным парсингом исходника Vue —
 * единственный паттерн вызова команд в этом компоненте: literal-строка внутри
 * `executeCommand('v8vscedit....')`. Так тест не разъезжается с кодом при
 * будущих правках компонента и одновременно детерминирован (в файле нет
 * динамических построений id).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { isWebviewCommandAllowed } from '../../ui/views/webview/webviewCommandGuard';

const ROOT = path.resolve(__dirname, '../../..');
const TREE_SEARCH_VUE = path.join(ROOT, 'src-ui/apps/tree-search/TreeSearchApp.vue');

/** Извлекает литералы id команд из вызовов executeCommand('...') в реальном исходнике. */
function extractExecuteCommandIds(source: string): string[] {
  const pattern = /executeCommand\(\s*'([^']+)'\s*\)/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function readDeclaredCommandIds(): Set<string> {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
    contributes?: { commands?: { command?: string }[] };
  };
  const commands = manifest.contributes?.commands ?? [];
  return new Set(commands.map((item) => item.command).filter((id): id is string => typeof id === 'string'));
}

suite('TreeSearchApp.vue — идентификаторы команд webview (P1b)', () => {
  test('TreeSearchApp.vue реально вызывает executeCommand хотя бы для одного id (парсинг не сломан)', () => {
    const source = fs.readFileSync(TREE_SEARCH_VUE, 'utf-8');
    const ids = extractExecuteCommandIds(source);
    // Явная защита от «тихого» рассинхрона: если разметка компонента изменится
    // так, что регулярка перестанет находить вызовы, тест должен упасть, а не
    // молча пройти по пустому множеству.
    assert.ok(ids.length > 0, 'Не найдено ни одного вызова executeCommand(...) в TreeSearchApp.vue');
  });

  test('каждый id команды, отправляемый TreeSearchApp.vue, объявлен в package.json contributes.commands', () => {
    const source = fs.readFileSync(TREE_SEARCH_VUE, 'utf-8');
    const usedIds = extractExecuteCommandIds(source);
    const declaredIds = readDeclaredCommandIds();

    const missing = usedIds.filter((id) => !declaredIds.has(id));

    // Красный ожидаемо: v8vscedit.decompileExtension, v8vscedit.environmentSettings,
    // v8vscedit.startStandaloneServer, v8vscedit.stopStandaloneServer,
    // v8vscedit.openStandaloneServerLog, v8vscedit.openStandaloneServer
    // отсутствуют в package.json (их заменили другими id в других местах, но
    // TreeSearchApp.vue не обновили).
    assert.deepStrictEqual(
      missing,
      [],
      `TreeSearchApp.vue вызывает команды, не объявленные в package.json: ${missing.join(', ')}`
    );
  });

  test('каждый ожидаемый актуальный id команды панели «Действия» реально объявлен в package.json', () => {
    // Актуальные id (сверены с package.json contributes.commands и
    // src/ui/commands/**) — то, чем TreeSearchApp.vue должен вызывать
    // соответствующие действия после исправления P1b.
    const expectedActualIds = [
      'v8vscedit.importConfigurations',
      'v8vscedit.runThinClient',
      'v8vscedit.runConfigurator',
      'v8vscedit.configureEnvironment',
      'v8vscedit.standalone.start',
      'v8vscedit.standalone.stop',
      'v8vscedit.standalone.showLog',
      'v8vscedit.standalone.openWebClient',
    ];
    const declaredIds = readDeclaredCommandIds();

    for (const id of expectedActualIds) {
      assert.ok(declaredIds.has(id), `Ожидаемый актуальный id команды не найден в package.json: ${id}`);
    }
  });

  test('isWebviewCommandAllowed допускает каждый актуальный id при реальном списке зарегистрированных команд', () => {
    const declaredIds = [...readDeclaredCommandIds()];
    const expectedActualIds = [
      'v8vscedit.importConfigurations',
      'v8vscedit.runThinClient',
      'v8vscedit.runConfigurator',
      'v8vscedit.configureEnvironment',
      'v8vscedit.standalone.start',
      'v8vscedit.standalone.stop',
      'v8vscedit.standalone.showLog',
      'v8vscedit.standalone.openWebClient',
    ];

    for (const id of expectedActualIds) {
      assert.strictEqual(
        isWebviewCommandAllowed(id, declaredIds),
        true,
        `Guard webview не пропускает актуальный id команды: ${id}`
      );
    }
  });

  test('устаревшие id, которые сейчас отправляет TreeSearchApp.vue, guard отклоняет как незарегистрированные', () => {
    // Прямое подтверждение практического следствия бага P1b: даже если бы
    // guard пропустил произвольный v8vscedit.*-префикс, эти id физически не
    // зарегистрированы в системе — команда no-op с точки зрения пользователя.
    const declaredIds = [...readDeclaredCommandIds()];
    const legacyIds = [
      'v8vscedit.decompileExtension',
      'v8vscedit.environmentSettings',
      'v8vscedit.startStandaloneServer',
      'v8vscedit.stopStandaloneServer',
      'v8vscedit.openStandaloneServerLog',
      'v8vscedit.openStandaloneServer',
    ];

    for (const id of legacyIds) {
      assert.strictEqual(
        isWebviewCommandAllowed(id, declaredIds),
        false,
        `Устаревший id неожиданно разрешён guard'ом: ${id}`
      );
    }
  });
});
