import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

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
    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${String(failures)} тест(ов) провалено`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
