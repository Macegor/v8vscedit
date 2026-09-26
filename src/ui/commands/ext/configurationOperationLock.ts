/**
 * Общий взаимный замок операций над конфигурацией/расширением.
 *
 * Извлечён из `ExtensionCommands.ts`, где модульный флаг
 * `isUpdatingConfigurations` был развёрнут вручную трижды (импорт конфигураций,
 * обновление изменённых, общий `runExclusiveConfigurationOperation`). Замок
 * ОБЩИЙ (module-level singleton) сознательно: импорт из базы, обновление базы
 * и загрузка CF-файла работают с одной и той же базой и выгрузкой, поэтому
 * параллельный запуск любой пары из них повредил бы данные.
 *
 * `setContext v8vscedit.isUpdatingConfigurations` переключается здесь же —
 * это тот же ключ, что стоит в `enablement` команд `package.json`, и он не
 * должен расходиться с реальным состоянием замка.
 */
import * as vscode from 'vscode';

const BUSY_CONTEXT_KEY = 'v8vscedit.isUpdatingConfigurations';

let operationRunning = false;

/** Идёт ли сейчас эксклюзивная операция над конфигурацией. */
export function isConfigurationOperationRunning(): boolean {
  return operationRunning;
}

/**
 * Пытается занять замок. Возвращает `false`, если операция уже идёт, — тогда
 * вызывающий обязан просто выйти, НЕ освобождая чужой замок.
 */
export async function tryBeginConfigurationOperation(): Promise<boolean> {
  if (operationRunning) {
    return false;
  }
  operationRunning = true;
  await vscode.commands.executeCommand('setContext', BUSY_CONTEXT_KEY, true);
  return true;
}

/** Освобождает замок. Вызывается только тем, кто его занял (обычно в `finally`). */
export async function endConfigurationOperation(): Promise<void> {
  operationRunning = false;
  await vscode.commands.executeCommand('setContext', BUSY_CONTEXT_KEY, false);
}
