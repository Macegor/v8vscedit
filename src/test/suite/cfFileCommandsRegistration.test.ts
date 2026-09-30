/**
 * Тесты регистрации команд `v8vscedit.dumpConfigurationToCf` /
 * `v8vscedit.loadConfigurationFromCf` (`src/ui/commands/ext/CfFileCommands.ts`)
 * и их паритета с `package.json → contributes.commands`.
 *
 * ВАЖНО про окружение теста: реальное расширение (`src/extension.ts`) в
 * тестовом Extension Host НЕ активируется — `activate()` возвращает
 * `undefined` сразу же, если нет открытой рабочей папки
 * (`vscode.workspace.workspaceFolders` пуст, а `src/test/runTests.ts` не
 * передаёт папку в `launchArgs`), и `Container.bootstrap` (а значит и
 * реальная регистрация всех `v8vscedit.*` команд) не вызывается. Поэтому
 * вызов `registerCfFileCommands` здесь напрямую с фейковым контекстом НЕ
 * конфликтует с реальной регистрацией той же команды — это тот же приём,
 * которым в этом проекте ещё никто не пользовался (см. обоснование в
 * `extensionListParser.test.ts`, почему обычно строят только чистые функции),
 * но здесь он безопасен именно из-за пустого workspace в тестовом хосте.
 *
 * Тела команд `v8vscedit.dumpConfigurationToCf`/`v8vscedit.loadConfigurationFromCf`
 * по контракту ОБЯЗАНЫ проверять общий замок
 * (`ui/commands/ext/configurationOperationLock.ts`) ПЕРВЫМ действием и
 * возвращаться раньше, чем произойдёт обращение к `services` (диалоги
 * выбора файла и т.п.) — именно поэтому в тестах ниже, где замок
 * предварительно занят, достаточно совсем пустого `services`-заглушки: если
 * бы guard не сработал первым, попытка обратиться к отсутствующим полям
 * заглушки бросила бы исключение, и `executeCommand` отклонился бы.
 *
 * `CfFileCommands.ts` и `configurationOperationLock.ts` на фазе «красный»
 * ещё не существуют — лениво грузятся через `tryRequireProductionModule`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CommandServices } from '../../ui/commands/_shared';
// registerCommands — единственная точка проводки ВСЕХ v8vscedit.*-команд
// (Container.bootstrap её не вызывает в тестовом Extension Host — см. шапку
// файла), поэтому файл существует всегда (не «красный» модуль задания) и
// импортируется статически.
import { registerCommands } from '../../ui/commands/CommandRegistry';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

const ROOT = path.resolve(__dirname, '../../..');

interface CfFileCommandsModule {
  registerCfFileCommands(context: vscode.ExtensionContext, services: CommandServices): void;
}

interface ConfigurationOperationLockModule {
  tryBeginConfigurationOperation(): Promise<boolean>;
  endConfigurationOperation(): Promise<void>;
  isConfigurationOperationRunning(): boolean;
}

const DUMP_COMMAND_ID = 'v8vscedit.dumpConfigurationToCf';
const LOAD_COMMAND_ID = 'v8vscedit.loadConfigurationFromCf';

/** Минимальный реальный `ExtensionContext`-дубль: единственное, что использует `registerCommand`, — массив подписок. */
function createFakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

function disposeAll(context: vscode.ExtensionContext): void {
  for (const disposable of context.subscriptions) {
    disposable.dispose();
  }
}

function readDeclaredCommands(): { command?: string; title?: string; enablement?: string }[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as {
    contributes?: { commands?: { command?: string; title?: string; enablement?: string }[] };
  };
  return manifest.contributes?.commands ?? [];
}

suite('CfFileCommands — регистрация dumpConfigurationToCf/loadConfigurationFromCf', function () {
  // Тесты сьюта ходят в реестр команд Extension Host (`getCommands(true)`,
  // `executeCommand`) — это межпроцессный round-trip, чья задержка зависит от
  // нагрузки на хост, а не от нашей логики. Гейт покрытия гоняет прогон восемью
  // порциями параллельно, и дефолтных 2000 мс там не хватало: сьют дважды падал
  // по таймауту и не воспроизводился при одиночном запуске. Это не маскировка
  // недетерминизма — сама проверка детерминирована, расширяется только бюджет
  // ожидания внешнего вызова. Роняя ПОРЦИЮ, такой флейк обесценивал весь прогон.
  this.timeout(30_000);

  let commandsMod: CfFileCommandsModule | undefined;
  let lockMod: ConfigurationOperationLockModule | undefined;

  suiteSetup(() => {
    commandsMod = tryRequireProductionModule('../../../ui/commands/ext/CfFileCommands') as CfFileCommandsModule | undefined;
    lockMod = tryRequireProductionModule('../../../ui/commands/ext/configurationOperationLock') as ConfigurationOperationLockModule | undefined;
  });

  test('модули CfFileCommands.ts и configurationOperationLock.ts существуют', () => {
    assert.ok(commandsMod, 'src/ui/commands/ext/CfFileCommands.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
    assert.ok(lockMod, 'src/ui/commands/ext/configurationOperationLock.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function commands(): CfFileCommandsModule {
    if (!commandsMod) {
      assert.fail('CfFileCommands.ts не реализован — см. первый тест сьюта');
    }
    return commandsMod;
  }

  function lock(): ConfigurationOperationLockModule {
    if (!lockMod) {
      assert.fail('configurationOperationLock.ts не реализован — см. первый тест сьюта');
    }
    return lockMod;
  }

  // ─── Часть 4, F.22: обе команды реально регистрируются в vscode.commands ───

  test('после registerCfFileCommands обе команды присутствуют в vscode.commands.getCommands(true)', async () => {
    const context = createFakeContext();
    commands().registerCfFileCommands(context, {} as unknown as CommandServices);
    try {
      const registered = await vscode.commands.getCommands(true);
      assert.ok(registered.includes(DUMP_COMMAND_ID), `${DUMP_COMMAND_ID} должна быть зарегистрирована`);
      assert.ok(registered.includes(LOAD_COMMAND_ID), `${LOAD_COMMAND_ID} должна быть зарегистрирована`);
    } finally {
      disposeAll(context);
    }
  });

  // ─── Возврат со стадии qa-e2e: `registerCfFileCommands` реально подключён
  // к общей проводке `CommandRegistry.registerCommands` (а не только вызывается
  // напрямую тестом выше) — `registerCommands()` зовётся только из
  // `Container.bootstrap`, который в тестовом Extension Host не исполняется
  // (см. шапку файла), поэтому опечатка в имени регистратора внутри
  // `registerCommands` осталась бы незамеченной без этого теста. ───

  test('CommandRegistry.registerCommands реально регистрирует dumpConfigurationToCf/loadConfigurationFromCf (доказывает, что registerCfFileCommands подключён в общую проводку, а не только вызывается напрямую)', async () => {
    const context = createFakeContext();
    // Пустая заглушка `services` безопасна: все ~20 регистраторов, которые
    // вызывает `registerCommands`, обращаются к полям `services` только ВНУТРИ
    // тел команд (замыкания `vscode.commands.registerCommand(id, () => {...})`),
    // а не в момент самой регистрации — проверено прогоном этого теста.
    registerCommands(context, {} as unknown as CommandServices);
    try {
      const registered = await vscode.commands.getCommands(true);
      assert.ok(registered.includes(DUMP_COMMAND_ID),
        `${DUMP_COMMAND_ID} должна быть зарегистрирована через CommandRegistry.registerCommands`);
      assert.ok(registered.includes(LOAD_COMMAND_ID),
        `${LOAD_COMMAND_ID} должна быть зарегистрирована через CommandRegistry.registerCommands`);
    } finally {
      disposeAll(context);
    }
  });

  // ─── Часть 4, F.23: паритет с package.json ───

  test('обе команды объявлены в package.json contributes.commands с enablement', () => {
    const declared = readDeclaredCommands();
    for (const id of [DUMP_COMMAND_ID, LOAD_COMMAND_ID]) {
      const entry = declared.find((item) => item.command === id);
      assert.ok(entry, `команда ${id} должна быть объявлена в package.json → contributes.commands`);
      assert.ok(entry.title && entry.title.trim().length > 0, `у команды ${id} должен быть title`);
      assert.ok(entry.enablement?.includes('v8vscedit.isUpdatingConfigurations'),
        `у команды ${id} enablement обязан ссылаться на v8vscedit.isUpdatingConfigurations (защита от параллельного запуска): "${String(entry.enablement)}"`);
    }
  });

  // ─── Часть 4, F.21: интеграция с общим замком ───

  test('loadConfigurationFromCf не запускает операцию, если замок уже занят другой операцией (лок остаётся занятым как был)', async () => {
    const acquired = await lock().tryBeginConfigurationOperation();
    assert.strictEqual(acquired, true, 'подготовка теста: замок обязан быть свободен в начале');

    const context = createFakeContext();
    commands().registerCfFileCommands(context, {} as unknown as CommandServices);
    try {
      // Пустая заглушка `services`: если бы guard'а не было или он не сработал
      // первым, тело команды обратилось бы к отсутствующим полям заглушки и
      // executeCommand отклонился бы с TypeError — этого не происходит.
      await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(LOAD_COMMAND_ID)));
      assert.strictEqual(lock().isConfigurationOperationRunning(), true,
        'команда не должна была трогать состояние чужого замка (ни повторно брать, ни освобождать)');
    } finally {
      disposeAll(context);
      await lock().endConfigurationOperation();
    }
  });

  test('dumpConfigurationToCf не запускает операцию, если замок уже занят другой операцией (лок остаётся занятым как был)', async () => {
    const acquired = await lock().tryBeginConfigurationOperation();
    assert.strictEqual(acquired, true, 'подготовка теста: замок обязан быть свободен в начале');

    const context = createFakeContext();
    commands().registerCfFileCommands(context, {} as unknown as CommandServices);
    try {
      await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(DUMP_COMMAND_ID)));
      assert.strictEqual(lock().isConfigurationOperationRunning(), true,
        'команда не должна была трогать состояние чужого замка (ни повторно брать, ни освобождать)');
    } finally {
      disposeAll(context);
      await lock().endConfigurationOperation();
    }
  });
});
