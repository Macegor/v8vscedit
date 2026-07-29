/**
 * Фикс: панель «Изменения метаданных» должна обновляться на любые git-события
 * через API встроенного Git-расширения VS Code. Первый компонент фикса —
 * чистый (без vscode) селектор: находит индекс репозитория Git Extension API
 * (`repo.rootUri`), чей корень совпадает с рабочим `gitRoot` нашей панели.
 *
 * Сравнение — нормализованное (см. `normalizePath` в `GitMetadataStatusService`,
 * ~строка 404): `path.resolve` → замена `\` на `/` → lower-case → срез
 * хвостового `/`. Точное совпадение без ancestor-fallback: обе стороны —
 * git toplevel, а не произвольный путь внутри репозитория.
 */
import * as assert from 'assert';
import { selectGitRepository } from '../../infra/git/GitRepositorySelector';
import { buildChangesBaselineRepo, removeFixtureRepo, type ChangesFixture } from './support/changesFixtures';

suite('GitRepositorySelector — поиск репозитория Git Extension API по корню', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('пустой список репозиториев → -1', () => {
    // Ранний return: список repoRoots пуст (Git Extension API ещё не открыл
    // ни одного репозитория) — не должно быть ни throw, ни ложного совпадения.
    assert.strictEqual(selectGitRepository([], fixture.gitRoot), -1);
  });

  test('единственный совпадающий репозиторий → индекс 0', () => {
    assert.strictEqual(selectGitRepository([fixture.gitRoot], fixture.gitRoot), 0);
  });

  test('несколько репозиториев, совпадает второй → его индекс', () => {
    const other = fixture.catalogsDir; // заведомо другой (не git toplevel) путь
    const result = selectGitRepository([other, fixture.gitRoot, '/tmp/ещё-один-репозиторий'], fixture.gitRoot);
    assert.strictEqual(result, 1);
  });

  test('несколько репозиториев, ни один не совпадает → -1', () => {
    const result = selectGitRepository(
      [fixture.catalogsDir, '/tmp/другой-репозиторий', '/tmp/третий-репозиторий'],
      fixture.gitRoot
    );
    assert.strictEqual(result, -1);
  });

  test('совпадение через хвостовой слэш в repoRoots (реальный toplevel без слэша)', () => {
    const withTrailingSlash = `${fixture.gitRoot}/`;
    assert.strictEqual(selectGitRepository([withTrailingSlash], fixture.gitRoot), 0);
  });

  test('совпадение через хвостовой слэш в gitRoot (реальный toplevel в repoRoots без слэша)', () => {
    const gitRootWithTrailingSlash = `${fixture.gitRoot}/`;
    assert.strictEqual(selectGitRepository([fixture.gitRoot], gitRootWithTrailingSlash), 0);
  });

  test('совпадение через смешанный регистр в repoRoots', () => {
    // path.resolve/lower-case должны нивелировать регистр — актуально прежде
    // всего для Windows/macOS с нечувствительной к регистру ФС, но нормализация
    // сама по себе платформо-независима и проверяется как чистая функция.
    const upperCased = fixture.gitRoot.toUpperCase();
    assert.strictEqual(selectGitRepository([upperCased], fixture.gitRoot), 0);
  });

  test('совпадение через backslash-разделители при СИНТЕТИЧЕСКОМ Windows-пути (обе стороны в одной форме)', () => {
    // Синтетический путь: реальный git toplevel на macOS/Linux не содержит
    // backslash, а `path.resolve` на POSIX не считает backslash-путь абсолютным
    // (иначе он получил бы cwd-префикс не так, как прямой /-путь, и тест
    // сравнивал бы несопоставимые нормализации). Поэтому обе стороны сравнения
    // конструируются в ОДНОЙ синтетической backslash-форме — так нормализация
    // разделителей всё равно проверяется, но без искажения через `path.resolve`.
    const backslashRoot = 'C:\\Projects\\Repo';
    const backslashRootWithForwardSlashes = 'C:/Projects/Repo';
    assert.strictEqual(selectGitRepository([backslashRoot], backslashRootWithForwardSlashes), 0);
  });

  test('совпадение через смешанные разделители и регистр одновременно (синтетический путь)', () => {
    const mixed = 'c:\\Projects/REPO\\Sub/dir';
    const canonical = 'C:/projects/repo/sub/DIR';
    assert.strictEqual(selectGitRepository([mixed], canonical), 0);
  });

  test('несовпадающие синтетические пути (разные корни) → -1 несмотря на схожую форму', () => {
    assert.strictEqual(
      selectGitRepository(['C:\\Projects\\Other\\'], 'C:\\Projects\\Repo'),
      -1
    );
  });

  test('точное совпадение синтетических путей с разными разделителями и регистром → индекс найден', () => {
    assert.strictEqual(
      selectGitRepository(['c:\\Projects\\Repo\\'], 'C:/Projects/repo'),
      0
    );
  });
});
