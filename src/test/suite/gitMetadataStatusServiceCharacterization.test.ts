import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitMetadataStatusService } from '../../infra/git/GitMetadataStatusService';

/**
 * ХАРАКТЕРИЗАЦИОННЫЙ тест (ВЕХА 1 «Изменения метаданных», компонент №2 плана).
 *
 * Фиксирует ТЕКУЩЕЕ поведение `GitMetadataStatusService` (декорации бейджей
 * A/M/D для файлов, вложенных XML-элементов и агрегатов каталога) ДО того,
 * как парсинг `git status --porcelain` вынесут в общий `GitPorcelainReader`.
 * Тест ОБЯЗАН проходить уже сейчас, на текущей реализации — он служит защитой
 * от регресса поведения при последующем рефакторе на общий парсер.
 *
 * Реальный временный git-репозиторий с реальными XML-фикстурами из
 * `example/2.21/src/cf/Catalogs` — никаких моков git-процесса.
 */

const FIXTURES_DIR = path.resolve(__dirname, '../../../example/2.21/src/cf/Catalogs');

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

suite('GitMetadataStatusService — характеризация текущего поведения (до рефакторинга на GitPorcelainReader)', () => {
  let repo: string;
  let catalogsDir: string;
  let modifiedXmlPath: string;
  let deletedXmlPath: string;
  let addedXmlPath: string;
  let service: GitMetadataStatusService;

  suiteSetup(() => {
    // realpathSync обязателен: на macOS os.tmpdir() отдаёт путь через симлинк
    // /var → /private/var, а `git rev-parse --show-toplevel` резолвит симлинк.
    // Без этого все абсолютные пути ниже разойдутся с git-root и статус
    // всегда будет undefined.
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-git-status-char-')));
    catalogsDir = path.join(repo, 'Catalogs');
    fs.mkdirSync(catalogsDir, { recursive: true });

    modifiedXmlPath = path.join(catalogsDir, 'РолиКонтактныхЛиц.xml');
    deletedXmlPath = path.join(catalogsDir, 'ПричиныВозврата.xml');
    addedXmlPath = path.join(catalogsDir, 'УдалитьСотрудникиДляИнтеграцииБЗКБУНФ.xml');

    fs.copyFileSync(path.join(FIXTURES_DIR, 'РолиКонтактныхЛиц.xml'), modifiedXmlPath);
    fs.copyFileSync(path.join(FIXTURES_DIR, 'ПричиныВозврата.xml'), deletedXmlPath);

    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'test@test.local']);
    git(repo, ['config', 'user.name', 'test']);
    // Реальные XML-фикстуры хранятся с CRLF — фиксируем autocrlf=false, чтобы
    // тест не зависел от глобального git-конфига разработчика.
    git(repo, ['config', 'core.autocrlf', 'false']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'baseline']);

    // Модифицируем реальный реквизит «Описание» внутри уже закоммиченного XML —
    // рабочая копия расходится с HEAD только в этом блоке.
    const original = fs.readFileSync(modifiedXmlPath, 'utf-8');
    assert.ok(original.includes('<MultiLine>true</MultiLine>'), 'фикстура должна содержать правимое свойство');
    fs.writeFileSync(modifiedXmlPath, original.replace('<MultiLine>true</MultiLine>', '<MultiLine>false</MultiLine>'), 'utf-8');

    // Удаляем закоммиченный файл из рабочего дерева, не индексируя удаление.
    fs.rmSync(deletedXmlPath);

    // Добавляем новый, никогда не коммиченный файл (untracked).
    fs.copyFileSync(path.join(FIXTURES_DIR, 'УдалитьСотрудникиДляИнтеграцииБЗКБУНФ.xml'), addedXmlPath);

    service = new GitMetadataStatusService(repo);
  });

  suiteTeardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('модифицированный файл объекта получает статус modified', () => {
    const status = service.getStatus({ kind: 'paths', ownerXmlPath: modifiedXmlPath, childKind: 'Attribute', paths: [modifiedXmlPath] });
    assert.strictEqual(status, 'modified');
  });

  test('удалённый файл объекта получает статус deleted', () => {
    const status = service.getStatus({ kind: 'paths', ownerXmlPath: deletedXmlPath, childKind: 'Attribute', paths: [deletedXmlPath] });
    assert.strictEqual(status, 'deleted');
  });

  test('новый (untracked) файл объекта получает статус added', () => {
    const status = service.getStatus({ kind: 'paths', ownerXmlPath: addedXmlPath, childKind: 'Attribute', paths: [addedXmlPath] });
    assert.strictEqual(status, 'added');
  });

  test('агрегат каталога отражает наличие изменений внутри (modified доминирует)', () => {
    const status = service.getStatus({ kind: 'paths', ownerXmlPath: catalogsDir, childKind: 'Attribute', paths: [catalogsDir] });
    assert.strictEqual(status, 'modified');
  });

  test('статус вложенного реквизита вычисляется через block-diff содержимого XML', () => {
    const status = service.getStatus({
      kind: 'child',
      ownerXmlPath: modifiedXmlPath,
      childKind: 'Attribute',
      name: 'Описание',
    });
    assert.strictEqual(status, 'modified');
  });

  test('невтронутый реквизит того же файла остаётся без статуса', () => {
    // В файле нет другого реквизита с таким именем — извлечение вернёт null
    // для обеих версий (текущей и HEAD), поэтому статус не выставляется.
    const status = service.getStatus({
      kind: 'child',
      ownerXmlPath: modifiedXmlPath,
      childKind: 'Attribute',
      name: 'НесуществующийРеквизит',
    });
    assert.strictEqual(status, undefined);
  });
});
