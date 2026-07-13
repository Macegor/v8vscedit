import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// ВЕХА 1 «Изменения метаданных», компонент №5 плана: тонкий ридер
// `git show HEAD:<rel>` / индекса `:<rel>`. Модуль ещё не реализован.
//
// Граф истории git, Слой 1: сюда же добавляется `readBlobAtRef` — обобщение
// на произвольный ref/commit-ish (`git show <ref>:<rel>`), нужное панели
// графа для чтения содержимого файла на любом коммите истории, не только
// HEAD/индексе. `readBlobAtRef` ещё не реализован — импорт обязан провалиться.
import { readBlobAtHead, readBlobAtIndex, readBlobAtRef } from '../../infra/git/GitBlobReader';

const FIXTURE_BSL = path.resolve(
  __dirname,
  '../../../example/2.21/src/cf/Catalogs/ПричиныВозврата/Commands/ПричиныВозврата/Ext/CommandModule.bsl'
);

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

suite('GitBlobReader — чтение содержимого blob из HEAD и индекса', () => {
  let repo: string;
  let filePath: string;
  let baselineContent: string;

  suiteSetup(() => {
    // realpathSync: см. комментарий в gitPorcelainReader.test.ts.
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-git-blob-reader-')));
    filePath = path.join(repo, 'CommandModule.bsl');
    baselineContent = fs.readFileSync(FIXTURE_BSL, 'utf-8');
    fs.writeFileSync(filePath, baselineContent, 'utf-8');

    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'test@test.local']);
    git(repo, ['config', 'user.name', 'test']);
    // Реальная фикстура CommandModule.bsl хранится с CRLF. Глобальный
    // core.autocrlf разработчика (input/true) иначе нормализовал бы перевод
    // строк при `git add`, и сравнение с исходным содержимым стало бы
    // зависящим от окружения — фиксируем поведение репозитория явно.
    git(repo, ['config', 'core.autocrlf', 'false']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'baseline']);

    // Индексируем одну правку, затем правим рабочее дерево ещё раз —
    // HEAD, индекс и рабочее дерево должны различаться.
    fs.writeFileSync(filePath, `${baselineContent}\n// правка №1 (попадёт в индекс)\n`, 'utf-8');
    git(repo, ['add', 'CommandModule.bsl']);
    fs.writeFileSync(filePath, `${baselineContent}\n// правка №1 (попадёт в индекс)\n// правка №2 (только рабочее дерево)\n`, 'utf-8');
  });

  suiteTeardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('readBlobAtHead возвращает содержимое baseline-коммита, не рабочей копии', () => {
    const content = readBlobAtHead(repo, filePath);
    assert.strictEqual(content, baselineContent);
  });

  test('readBlobAtIndex возвращает застейдженную правку (отличную и от HEAD, и от рабочего дерева)', () => {
    const indexContent = readBlobAtIndex(repo, filePath);
    const headContent = readBlobAtHead(repo, filePath);
    const worktreeContent = fs.readFileSync(filePath, 'utf-8');

    assert.strictEqual(indexContent, `${baselineContent}\n// правка №1 (попадёт в индекс)\n`);
    assert.notStrictEqual(indexContent, headContent);
    assert.notStrictEqual(indexContent, worktreeContent);
  });

  test('readBlobAtHead для файла, никогда не коммиченного, возвращает null', () => {
    const neverCommitted = path.join(repo, 'НикогдаНеКоммиченный.bsl');
    fs.writeFileSync(neverCommitted, 'содержимое, которого нет в HEAD\n', 'utf-8');

    assert.strictEqual(readBlobAtHead(repo, neverCommitted), null);
  });

  test('readBlobAtIndex для файла, который не индексирован, возвращает null', () => {
    const neverStaged = path.join(repo, 'НеЗастейдженный.bsl');
    fs.writeFileSync(neverStaged, 'содержимое вне индекса\n', 'utf-8');

    assert.strictEqual(readBlobAtIndex(repo, neverStaged), null);
  });

  test('отсутствие git-репозитория по указанному пути — мягкий null, без исключения', () => {
    const outsideAnyRepo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-no-git-')));
    try {
      assert.strictEqual(readBlobAtHead(outsideAnyRepo, path.join(outsideAnyRepo, 'файл.bsl')), null);
      assert.strictEqual(readBlobAtIndex(outsideAnyRepo, path.join(outsideAnyRepo, 'файл.bsl')), null);
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });
});

suite('GitBlobReader — readBlobAtRef: чтение содержимого на произвольном ref/commit-ish', () => {
  let repo: string;
  let filePath: string;
  let v1Content: string;
  let v2Content: string;
  let v1Hash: string;

  suiteSetup(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-git-blob-ref-')));
    filePath = path.join(repo, 'файл.bsl');
    v1Content = 'Процедура Тест() КонецПроцедуры // V1\n';
    v2Content = 'Процедура Тест() КонецПроцедуры // V2\n';

    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'test@test.local']);
    git(repo, ['config', 'user.name', 'test']);
    git(repo, ['config', 'core.autocrlf', 'false']);

    fs.writeFileSync(filePath, v1Content, 'utf-8');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'V1']);
    v1Hash = git(repo, ['rev-parse', 'HEAD']).trim();

    fs.writeFileSync(filePath, v2Content, 'utf-8');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'V2']);
  });

  suiteTeardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('по хешу первого коммита возвращает содержимое V1, не текущее HEAD', () => {
    assert.strictEqual(readBlobAtRef(repo, v1Hash, filePath), v1Content);
  });

  test('по ref "HEAD" возвращает содержимое последнего коммита (V2)', () => {
    assert.strictEqual(readBlobAtRef(repo, 'HEAD', filePath), v2Content);
  });

  test('несуществующий ref — мягкий null, без исключения', () => {
    assert.strictEqual(readBlobAtRef(repo, 'несуществующий-ref-абвгд', filePath), null);
  });

  test('существующий ref, но файл в нём отсутствует — мягкий null', () => {
    const neverExisted = path.join(repo, 'никогда-не-существовавший.bsl');
    assert.strictEqual(readBlobAtRef(repo, v1Hash, neverExisted), null);
  });
});
