// Ядро гейта patch-покрытия: разбор lcov, метрика достоверности данных о
// ветках и сам вердикт. Чистые функции без I/O и без спавнов — оркестратор
// (scripts/patch-coverage.mjs) только подаёт сюда данные.
//
// Три кода возврата вместо двух: 0 — зелёный, 1 — покрытие РЕАЛЬНО неполное,
// 2 — данным нельзя верить (нет lcov, нечего проверять, у найденных ветвлений
// нет ни одной записи BRDA, доля таких файлов выше порога). Разделение
// принципиально: молчаливый «зелёный по отсутствию данных» — тот самый дефект,
// ради которого гейт и переделывался.

/**
 * Разбор lcov в карту: ключ — строка SF КАК ЕСТЬ (без резолва путей: тем же
 * ключом потом ищется изменённый файл, нормализацию делает вызывающий).
 */
export function parseLcov(text) {
  const files = new Map();
  let current;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      current = { da: new Map(), brda: new Map() };
      files.set(line.slice(3), current);
      continue;
    }
    if (current === undefined) {
      continue;
    }
    if (line.startsWith('DA:')) {
      const [ln, hits] = line.slice(3).split(',');
      current.da.set(Number(ln), Number(hits));
    } else if (line.startsWith('BRDA:')) {
      const [ln, , , taken] = line.slice(5).split(',');
      const atLine = current.brda.get(Number(ln)) ?? [];
      atLine.push(taken);
      current.brda.set(Number(ln), atLine);
    } else if (line === 'end_of_record') {
      current = undefined;
    }
  }
  return files;
}

/**
 * Канарейка достоверности: доля файлов, у которых детектор нашёл ветвления, а
 * lcov не дал по ним НИ ОДНОЙ записи BRDA. Высокая доля означает, что прогон
 * потерял поблочную детализацию (замерено: долгоживущий процесс тестов даёт
 * 0 блочных покрытий из 615 скриптов) и «зелёный по веткам» ничего не значит.
 *
 * `branchRangesOf` возвращает null для файла, исходник которого прочитать не
 * удалось: такой файл исключается из расчёта целиком, иначе он попал бы в
 * знаменатель как «файл без ветвлений» и занизил бы долю деградации.
 */
export function summarizeBranchCoverage({ lcov, branchRangesOf }) {
  let totalFiles = 0;
  let filesWithBranches = 0;
  let filesWithoutBranchData = 0;
  for (const [rel, entry] of lcov) {
    const ranges = branchRangesOf(rel);
    if (ranges === null) {
      continue;
    }
    totalFiles += 1;
    if (ranges.length === 0) {
      continue;
    }
    filesWithBranches += 1;
    if (entry.brda.size === 0) {
      filesWithoutBranchData += 1;
    }
  }
  return {
    totalFiles,
    filesWithBranches,
    filesWithoutBranchData,
    share: filesWithBranches === 0 ? 0 : filesWithoutBranchData / filesWithBranches,
  };
}

/**
 * Вердикт по патчу: offenders в порядке `changed` + итоговый код (максимум по
 * приоритету 2 > 1 > 0 среди всех источников).
 */
export function buildVerdict({
  changed,
  targetLinesOf,
  lcov,
  branchRangesOf,
  isTypeOnly,
  degradedShare,
  degradedMaxShare,
  allowEmptyChanged = false,
}) {
  if (lcov === null) {
    return {
      offenders: ['Отчёт coverage/lcov.info не сформирован — проверять нечего'],
      summary: 'Нет данных: c8 не сформировал lcov.info',
      exitCode: 2,
    };
  }
  if (changed.length === 0) {
    // Пустой набор почти всегда значит неверно выбранную базу диффа, а не
    // «нечего проверять»: гейт, ничего не проверивший, зелёным быть не должен.
    return allowEmptyChanged
      ? { offenders: [], summary: 'Изменённых production-файлов нет, пустой патч подтверждён явно', exitCode: 0 }
      : {
          offenders: ['Изменённых production-файлов относительно базы НЕ НАЙДЕНО — гейт ничего не проверил'],
          summary: 'Нет данных: пустой набор изменённых файлов',
          exitCode: 2,
        };
  }

  const offenders = [];
  let exitCode = 0;
  const raise = (code) => {
    exitCode = Math.max(exitCode, code);
  };

  for (const { rel, isNew } of changed) {
    const entry = lcov.get(rel);
    if (entry === undefined) {
      if (!isTypeOnly(rel)) {
        offenders.push(`${rel}: НЕТ данных покрытия (не загружен тестами) — нужен тест`);
        raise(1);
      }
      continue;
    }
    const target = targetLinesOf(rel, isNew);
    const uncoveredLines = [...target].filter((ln) => entry.da.get(ln) === 0).sort((a, b) => a - b);
    if (uncoveredLines.length > 0) {
      offenders.push(`${rel}: не покрыто — строки ${uncoveredLines.join(',')}`);
      raise(1);
    }
    const branchProblem = checkBranches({ entry, target, ranges: branchRangesOf(rel) });
    if (branchProblem !== undefined) {
      offenders.push(`${rel}: ${branchProblem.message}`);
      raise(branchProblem.code);
    }
  }

  // Граница включительная: доля РОВНО на пороге — ещё норма, красным делает
  // только превышение.
  if (degradedShare > degradedMaxShare) {
    offenders.push(
      `ДЕГРАДАЦИЯ ПОКРЫТИЯ: доля файлов с ветвлениями, но без единой записи BRDA — ${degradedShare.toFixed(3)} при пороге ${degradedMaxShare.toFixed(3)}`
    );
    raise(2);
  }

  return {
    offenders,
    summary: `Проверено файлов: ${changed.length}; замечаний: ${offenders.length}; доля деградации ветвей ${degradedShare.toFixed(3)} при пороге ${degradedMaxShare.toFixed(3)}`,
    exitCode,
  };
}

/**
 * Сверка ветвлений идёт по ДИАПАЗОНУ строк конструкции, а не по строке-в-строку:
 * у многострочных `a &&\n b` и тернарника запись BRDA стоит на строке оператора
 * (`?`), а диффом изменённой числится строка условия. Построчная сверка сделала
 * бы честную проверку генератором ложных красных.
 */
function checkBranches({ entry, target, ranges }) {
  const relevant = ranges.filter((range) => intersects(range, target));
  if (relevant.length === 0) {
    // Ветвлений в затронутых строках нет — линейный патч, ветки не проверяем.
    return undefined;
  }
  const brdaLines = [...entry.brda.keys()]
    .filter((ln) => relevant.some((range) => ln >= range.startLine && ln <= range.endLine))
    .sort((a, b) => a - b);
  if (brdaLines.length === 0) {
    // Различаем две РАЗНЫЕ причины отсутствия записи в диапазоне — иначе гейт
    // маскирует настоящий пробел покрытия под «инструменту нельзя верить», и
    // его начинают обходить вместо написания теста. Замер ревьюера: у
    // if-диапазонов 495 промахов BRDA из 2696, и это в основном штатное
    // поведение V8 — он не создаёт блок для ветви, которая всегда берётся.
    // Признак доверия — есть ли у файла записи BRDA ХОТЬ ГДЕ-ТО: если есть,
    // измерение по файлу состоялось, и пустой диапазон означает, что
    // противоположная ветвь ни разу не исполнялась.
    if (entry.brda.size > 0) {
      return {
        message: `не покрыто — ветки на строках ${startLinesOf(relevant)} (противоположная ветвь ни разу не исполнялась — допишите тест на неё)`,
        code: 1,
      };
    }
    return {
      message: `НЕТ ДАННЫХ О ВЕТКАХ — детектор нашёл ветвления (${describe(relevant)}), но lcov не дал по файлу ни одной записи BRDA; покрытие веток НЕ проверено`,
      code: 2,
    };
  }
  const uncovered = brdaLines.filter((ln) => entry.brda.get(ln).some((taken) => taken === '-' || taken === '0'));
  if (uncovered.length === 0) {
    return undefined;
  }
  return { message: `не покрыто — ветки на строках ${uncovered.join(',')}`, code: 1 };
}

function intersects(range, target) {
  for (let ln = range.startLine; ln <= range.endLine; ln += 1) {
    if (target.has(ln)) {
      return true;
    }
  }
  return false;
}

function startLinesOf(ranges) {
  return [...new Set(ranges.map((range) => range.startLine))].sort((a, b) => a - b).join(',');
}

function describe(ranges) {
  return ranges.map((range) => `${range.kind} ${range.startLine}-${range.endLine}`).join(', ');
}
