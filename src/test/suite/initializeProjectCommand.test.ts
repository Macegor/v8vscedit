import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureProjectDirectoryIsEmpty } from '../../ui/commands/project/InitializeProjectCommand';

suite('initializeProjectCommand', () => {
  test('разрешает инициализацию только в пустом каталоге', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-init-empty-'));
    assert.doesNotThrow(() => ensureProjectDirectoryIsEmpty(emptyDir));

    const nonEmptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-init-non-empty-'));
    fs.writeFileSync(path.join(nonEmptyDir, 'env.json'), '{}', 'utf-8');

    assert.throws(
      () => ensureProjectDirectoryIsEmpty(nonEmptyDir),
      /Каталог проекта не пуст/
    );
  });
});
