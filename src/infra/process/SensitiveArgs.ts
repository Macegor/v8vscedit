/**
 * Маскирование секретов в векторе аргументов перед записью в журнал.
 *
 * `buildConnectionCliArgs` кладёт в аргументы внутреннего CLI пару
 * `-Password <пароль базы>`, а логирование пишет вектор целиком — без
 * маскирования пароль базы попадал бы в OutputChannel «1С Редактор» открытым
 * текстом при каждом импорте/обновлении/выгрузке.
 */

/** Ключи, значение СЛЕДУЮЩЕГО за ними аргумента является секретом. */
const SECRET_VALUE_KEYS = new Set(['-Password']);

const MASK = '********';

/**
 * Возвращает КОПИЮ вектора, в которой значения секретных ключей заменены
 * маской. Исходный массив не мутируется: тот же вектор уходит в процесс.
 */
export function maskSensitiveCliArgs(args: string[]): string[] {
  const masked = [...args];
  for (let index = 0; index < masked.length - 1; index += 1) {
    if (SECRET_VALUE_KEYS.has(masked[index])) {
      masked[index + 1] = MASK;
    }
  }
  return masked;
}
