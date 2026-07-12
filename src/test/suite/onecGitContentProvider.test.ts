import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
// ВЕХА 2, компонент №3 плана: TextDocumentContentProvider для левой стороны
// diff (HEAD/index). Модуль ещё не реализован.
import { buildOnecGitUri, OnecGitContentProvider, ONEC_GIT_SCHEME } from '../../ui/git/OnecGitContentProvider';
import {
  buildChangesBaselineRepo,
  git,
  removeFixtureRepo,
  type ChangesFixture,
} from './support/changesFixtures';

/**
 * `OnecGitContentProvider` даёт левую сторону diff — содержимое файла из
 * HEAD или индекса, читаемое реальным `git show` через `GitBlobReader`
 * (ВЕХА 1). URI кодирует gitRoot + rel-путь + ref, чтобы `provideTextDocumentContent`
 * не зависел от глобального состояния.
 */
suite('OnecGitContentProvider — содержимое HEAD/index для diff', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('buildOnecGitUri кодирует scheme onec-git и rel-путь файла', () => {
    const uri = buildOnecGitUri(fixture.gitRoot, fixture.objectModuleBsl, 'HEAD');
    assert.strictEqual(uri.scheme, ONEC_GIT_SCHEME);
    assert.ok(uri.path.endsWith('ObjectModule.bsl'), `путь uri должен оканчиваться именем файла: ${uri.path}`);
  });

  test('HEAD-uri возвращает базовое (закоммиченное) содержимое файла', () => {
    const baseline = fs.readFileSync(fixture.objectModuleBsl, 'utf-8');
    fs.appendFileSync(fixture.objectModuleBsl, '\n// локальная правка, не в HEAD\n', 'utf-8');

    const provider = new OnecGitContentProvider();
    const uri = buildOnecGitUri(fixture.gitRoot, fixture.objectModuleBsl, 'HEAD');
    const content = provider.provideTextDocumentContent(uri);

    assert.strictEqual(content, baseline);
  });

  test('index-uri возвращает застейдженное содержимое, отличное от HEAD', () => {
    const staged = 'застейдженная версия модуля\n';
    fs.writeFileSync(fixture.objectModuleBsl, staged, 'utf-8');
    git(fixture.gitRoot, ['add', '--', fixture.objectModuleBsl]);
    // Правим ЕЩЁ раз поверх индекса — рабочее дерево уходит вперёд индекса,
    // так что index-ref гарантированно отличается и от HEAD, и от текущего файла.
    fs.appendFileSync(fixture.objectModuleBsl, '// unstaged поверх staged\n', 'utf-8');

    const provider = new OnecGitContentProvider();
    const indexUri = buildOnecGitUri(fixture.gitRoot, fixture.objectModuleBsl, 'index');
    const headUri = buildOnecGitUri(fixture.gitRoot, fixture.objectModuleBsl, 'HEAD');

    assert.strictEqual(provider.provideTextDocumentContent(indexUri), staged);
    assert.notStrictEqual(provider.provideTextDocumentContent(headUri), staged);
  });

  test('несуществующий в HEAD blob (новый непроиндексированный файл) — пустое содержимое', () => {
    const untrackedPath = `${fixture.catalogsDir}/never-committed.bsl`;
    fs.writeFileSync(untrackedPath, 'этот файл никогда не коммитился\n', 'utf-8');

    const provider = new OnecGitContentProvider();
    const uri = buildOnecGitUri(fixture.gitRoot, untrackedPath, 'HEAD');

    assert.strictEqual(provider.provideTextDocumentContent(uri), '');
  });

  test('URI без query-параметра gitRoot — пустое содержимое (провайдер не падает)', () => {
    const provider = new OnecGitContentProvider();
    const uri = vscode.Uri.from({ scheme: ONEC_GIT_SCHEME, path: '/ObjectModule.bsl', query: 'ref=HEAD' });

    assert.strictEqual(provider.provideTextDocumentContent(uri), '');
  });
});
