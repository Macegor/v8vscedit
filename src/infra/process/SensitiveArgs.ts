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
 *
 * ГЛАВНЫЙ механизм — редактирование по самому ЗНАЧЕНИЮ секрета (`secrets`):
 * вызывающий пароль знает, он же и строил вектор, поэтому точное вхождение
 * найдётся независимо от формы записи ключа. Правила по ключам оставлены
 * страховкой на случай, когда значение забыли передать.
 *
 * Текстовая эвристика «аргумент похож на ключ пароля» точной быть не может:
 * правило «начинается с /P без учёта регистра» съедало `/private/var/...`
 * (на macOS это каждый временный каталог), а всякое его ослабление пропускает
 * пароль со слешем. Поэтому эвристика намеренно узкая, а полнота обеспечивается
 * списком `secrets`.
 */

/** Ключи, значение СЛЕДУЮЩЕГО за ними аргумента является секретом. */
const SECRET_VALUE_KEYS = [
  '-Password',
  '-Pwd',
  '/ConfigurationRepositoryP',
  '--onec-password',
];

/**
 * Ключи, значение которых склеено с самим ключом. Сравнение РЕГИСТРОЗАВИСИМОЕ,
 * и остаток не должен содержать разделителей пути: иначе под правило попадали
 * обычные пути (`/private/...`, `/Path/To/File`, `/proc/self`), а испорченный
 * журнал — это тоже дефект, просто не такой громкий. Все три места, где проект
 * сам пишет этот ключ (`RepositoryCommandRunner`, `DbRunCommandRunner`,
 * `cli/core/onecCommon`), эмитят строго заглавную `/P`, а пароль со слешем
 * ловится уже не эвристикой, а списком `secrets`.
 */
const SECRET_PREFIX_KEYS = ['/P'];

const MASK = '********';

/** Ключи конфигуратора регистронезависимы, поэтому пары сравниваем в нижнем регистре. */
function sameKey(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Возвращает КОПИЮ вектора, в которой значения секретных ключей и любые
 * вхождения переданных `secrets` заменены маской. Исходный массив не
 * мутируется: тот же вектор уходит в процесс.
 */
export function maskSensitiveCliArgs(args: readonly string[], secrets: readonly string[] = []): string[] {
  const masked = [...args];
  for (let index = 0; index < masked.length; index += 1) {
    const current = masked[index];
    if (index < masked.length - 1 && SECRET_VALUE_KEYS.some((key) => sameKey(current, key))) {
      masked[index + 1] = MASK;
      continue;
    }
    const prefix = SECRET_PREFIX_KEYS.find(
      (key) => current.length > key.length
        && current.startsWith(key)
        && !/[\\/]/.test(current.slice(key.length))
    );
    if (prefix) {
      masked[index] = `${prefix}${MASK}`;
    }
  }
  // Точное редактирование по значению — последним шагом, поверх правил по ключам:
  // секрет мог попасть и в аргумент, форму которого правила не описывают.
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    const pattern = new RegExp(escapeForRegExp(secret), 'g');
    for (let index = 0; index < masked.length; index += 1) {
      masked[index] = masked[index].replace(pattern, MASK);
    }
  }
  return masked;
}

/** Готовая строка запуска для журнала: исполняемый файл + вектор с маской. */
export function formatCommandLineForLog(
  executable: string,
  args: readonly string[],
  secrets: readonly string[] = [],
): string {
  return `${executable} ${maskSensitiveCliArgs(args, secrets).join(' ')}`;
}
