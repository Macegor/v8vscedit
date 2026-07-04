import * as path from 'path';
import Mocha from 'mocha';
import { globSync } from 'glob';

/** Mocha-loader E2E-набора: грузит `*.e2e.js` из этого каталога. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true });
  const testsRoot = path.resolve(__dirname, '.');

  return new Promise((resolve, reject) => {
    const files = globSync('**/*.e2e.js', { cwd: testsRoot });
    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${String(failures)} E2E-тест(ов) провалено`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
