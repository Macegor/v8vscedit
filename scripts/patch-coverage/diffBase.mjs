// Выбор базы сравнения для patch-покрытия и разбор добавленных строк.
//
// Логика вынесена из оркестратора в чистый модуль по возврату ревьюера: три из
// четырёх известных дефектов гейта были именно здесь, а покрыть её было нечем —
// она исполнялась как побочный эффект верхнего уровня скрипта (читала
// `process.env`, спавнила `git`). Здесь весь I/O внедряется параметрами.

/**
 * База сравнения патча.
 *
 * Наивное `HEAD` работает, только пока правки НЕ закоммичены. Если разработчик
 * уже закоммитил (штатная ситуация: qa-e2e запускается после его стадии),
 * дифф против HEAD пуст, и гейт «успешно» проходит, не проверив ничего —
 * молчаливый ложный зелёный. Поэтому база расширяется до точки расхождения с
 * веткой интеграции: в патч попадают и коммиты задачи, и рабочее дерево.
 *
 * Критерий принятия upstream учитывает `untracked` НАРАВНЕ с `modifiedAgainst`:
 * задача, добавившая только НОВЫЕ файлы, даёт пустой `git diff --name-only`, и
 * по одному только `modifiedAgainst` база молча уезжала бы на следующий
 * upstream (`origin/main`), вменяя задаче долг покрытия всей ветки.
 *
 * @param {object} args
 * @param {Record<string,string|undefined>} args.env переменные окружения (COVERAGE_BASE)
 * @param {string[]} args.untracked новые (неотслеживаемые) production-файлы
 * @param {string[]} args.upstreams ветки интеграции в порядке предпочтения
 * @param {(upstream: string) => string|undefined} args.mergeBaseOf SHA точки расхождения; undefined — ветка недоступна
 * @param {(base: string) => string[]} args.modifiedAgainst изменённые файлы относительно базы
 */
export function resolveDiffBase({ env, untracked, upstreams, mergeBaseOf, modifiedAgainst }) {
  const explicit = env.COVERAGE_BASE?.trim();
  if (explicit) {
    return { base: explicit, why: 'задана переменной COVERAGE_BASE' };
  }
  for (const upstream of upstreams) {
    const mergeBase = mergeBaseOf(upstream);
    if (mergeBase === undefined) {
      // Ветки интеграции может не быть (нет remote, свежий клон) — пробуем следующую.
      continue;
    }
    if (untracked.length + modifiedAgainst(mergeBase).length > 0) {
      return {
        base: mergeBase,
        why: `точка расхождения с ${upstream}: в патч входят и коммиты задачи, и рабочее дерево`,
      };
    }
  }
  // Ветка интеграции недоступна (или относительно неё патч пуст) — остаётся
  // дифф с последним коммитом; это слабее, но лучше, чем ничего.
  return { base: 'HEAD', why: 'ветка интеграции недоступна, сравниваем с HEAD' };
}

/**
 * Добавленные/изменённые номера строк из `git diff --unified=0`: заголовок
 * ханка `@@ -a[,c] +b[,d] @@` описывает строки `b..b+d-1` новой версии файла
 * (`,d` опущено — одна строка; `,0` — чистое удаление, новых строк нет).
 */
export function addedLines(diffText) {
  const lines = new Set();
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const line of diffText.split('\n')) {
    const m = hunk.exec(line);
    if (!m) {
      continue;
    }
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) {
      lines.add(start + i);
    }
  }
  return lines;
}
