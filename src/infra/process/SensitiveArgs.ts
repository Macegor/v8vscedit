/**
 * Маскирование секретов в векторе аргументов перед записью в журнал.
 *
 * Пароль попадает в аргументы процесса в двух разных формах, и обе встречаются
 * в этом проекте:
 *  - ОТДЕЛЬНЫМ аргументом следом за ключом (`-Password <пароль>` внутреннего CLI,
 *    `-Pwd <пароль>` хранилища, `/ConfigurationRepositoryP <пароль>` конфигуратора,
 *    `--onec-password <пароль>` анализатора);
 *  - СЛИТНО с ключом (`/P<пароль>` конфигуратора — у платформы это один аргумент).
 *
 * Логирование пишет вектор целиком, поэтому без маскирования пароль базы и
 * хранилища попадал в OutputChannel открытым текстом при каждом запуске. Секреты
 * при этом хранятся правильно (SecretStorage, запрет №9) — утечка была именно
 * в журнале.
 */

/** Ключи, значение СЛЕДУЮЩЕГО за ними аргумента является секретом. */
const SECRET_VALUE_KEYS = [
  '-Password',
  '-Pwd',
  '/ConfigurationRepositoryP',
  '--onec-password',
];

/**
 * Ключи, значение которых склеено с самим ключом. Список намеренно короткий:
 * правило «аргумент начинается с `/P`» широкое, и любой новый ключ конфигуратора
 * с таким началом маскировался бы целиком. Ни один из используемых в проекте
 * ключей с `/P` не начинается, кроме самого `/P` (`/ConfigurationRepositoryP`
 * начинается с `/C` и разбирается парой выше).
 */
const SECRET_PREFIX_KEYS = ['/P'];

const MASK = '********';

/** Ключи конфигуратора регистронезависимы, поэтому сравниваем в нижнем регистре. */
function sameKey(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Возвращает КОПИЮ вектора, в которой значения секретных ключей заменены
 * маской. Исходный массив не мутируется: тот же вектор уходит в процесс.
 */
export function maskSensitiveCliArgs(args: readonly string[]): string[] {
  const masked = [...args];
  for (let index = 0; index < masked.length; index += 1) {
    const current = masked[index];
    if (index < masked.length - 1 && SECRET_VALUE_KEYS.some((key) => sameKey(current, key))) {
      masked[index + 1] = MASK;
      continue;
    }
    const prefix = SECRET_PREFIX_KEYS.find(
      (key) => current.length > key.length && sameKey(current.slice(0, key.length), key)
    );
    if (prefix) {
      masked[index] = `${prefix}${MASK}`;
    }
  }
  return masked;
}

/** Готовая строка запуска для журнала: исполняемый файл + вектор с маской. */
export function formatCommandLineForLog(executable: string, args: readonly string[]): string {
  return `${executable} ${maskSensitiveCliArgs(args).join(' ')}`;
}
