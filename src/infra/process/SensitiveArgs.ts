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
 * Ключи, значение которых склеено с самим ключом. Отсекает ложные срабатывания
 * ОДИН признак: остаток после ключа не содержит разделителей пути. Иначе под
 * правило попадали обычные пути (`/private/...`, `/Path/To/File`, `/proc/self`),
 * а испорченный журнал — это тоже дефект, просто не такой громкий.
 *
 * Сравнение при этом РЕГИСТРОНЕЗАВИСИМОЕ, как и все ключи конфигуратора. Ставить
 * сюда ещё и регистрозависимость нельзя, хотя соблазн есть: проект сам пишет
 * только заглавную `/P`, но вектор может прийти и не от нас, а цена ошибок
 * несимметрична — замаскированный лишний аргумент портит строку журнала,
 * пропущенный `/p<пароль>` печатает пароль. Пароль СО СЛЕШЕМ эвристика не ловит
 * по построению; его закрывает список `secrets`.
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
        && sameKey(current.slice(0, key.length), key)
        && !/[\\/]/.test(current.slice(key.length))
    );
    if (prefix) {
      // Регистр берём из САМОГО аргумента, а не из списка ключей: в журнале
      // должна остаться та запись, которую видел процесс.
      masked[index] = `${current.slice(0, prefix.length)}${MASK}`;
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
