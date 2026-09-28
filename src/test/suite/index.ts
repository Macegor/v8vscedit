import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';
import { resolveTestFiles } from './support/testFileSelection';

/**
 * Отчёт шарда для гейта покрытия (`scripts/patch-coverage.mjs`): чем прогон
 * отчитался о себе — какой это шард, сколько файлов видел, какие взял и сколько
 * тестов реально выполнил. Пишется и при успехе, и при провале: отсутствие
 * отчёта само по себе является для гейта проблемой (шард мог упасть до запуска).
 */
function writeShardReport(
  allFilesCount: number,
  selectedFiles: string[],
  stats: Mocha.Stats | undefined
): void {
  const reportPath = process.env.MOCHA_SHARD_REPORT;
  if (reportPath === undefined) {
    return;
  }
  const report = {
    shardIndex: Number(process.env.MOCHA_SHARD_INDEX ?? '0'),
    shardTotal: Number(process.env.MOCHA_SHARD_TOTAL ?? '1'),
    allFilesCount,
    selectedFiles,
    stats: {
      tests: stats?.tests ?? 0,
      passes: stats?.passes ?? 0,
      failures: stats?.failures ?? 0,
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report), 'utf-8');
}

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  // Фильтр одного теста/сьюта без правки кода `.only`: `MOCHA_GREP='<regex>' npm run test:fast`.
  // Нужен для быстрой итерации (developer/test-writer гоняют свой набор, а не всю матрицу
  // из ~1200 тестов через полный бут Electron). Пустая переменная = прогон всех тестов.
  const grep = process.env.MOCHA_GREP;
  if (grep) {
    mocha.grep(new RegExp(grep));
  }
  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    const files = globSync('**/*.test.js', { cwd: testsRoot });
    // Без MOCHA_SHARD_LIST поведение прежнее: весь набор в прежнем порядке.
    // Имена переменных не начинаются с VSCODE_/ELECTRON_ — такие стирает
    // sanitizeInheritedIdeEnv в src/test/runTests.ts, и шард молча прогнал бы всё.
    const selected = resolveTestFiles(files, process.env.MOCHA_SHARD_LIST, (p) =>
      fs.readFileSync(p, 'utf-8')
    );
    selected.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
    try {
      // Статистику колбэк берёт из отдельного держателя, а не из `const runner`,
      // объявленной этим же выражением: чтение `runner` из тела собственного
      // колбэка работает лишь благодаря тому, что Mocha вызывает его асинхронно,
      // и молча сломалось бы (TDZ) при синхронном вызове.
      const run: { stats?: Mocha.Stats } = {};
      const runner = mocha.run((failures: number) => {
        writeShardReport(files.length, selected, run.stats);
        if (failures > 0) {
          reject(new Error(`${String(failures)} тест(ов) провалено`));
        } else {
          resolve();
        }
      });
      run.stats = runner.stats;
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
