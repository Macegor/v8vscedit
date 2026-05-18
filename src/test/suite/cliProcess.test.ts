import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encode } from 'iconv-lite';
import { parseArgs, getBool, getRequiredString, getString } from '../../cli/core/args';
import { resolveConnection } from '../../cli/core/connection';
import {
  appendConnectionArgs,
  appendRepositoryArgs,
  createTempDir,
  printLogFile,
  safeRemoveDir,
  writeUtf8BomLines,
} from '../../cli/core/onecCommon';
import { resolveConfigDir } from '../../cli/core/projectLayout';
import { decodeProcessOutput, pickMostReadableText } from '../../infra/process/OutputDecoder';
import { runProcess } from '../../infra/process/ProcessRunner';

suite('CLI и запуск процессов', () => {
  test('разбирает аргументы CLI, переключатели и обязательные значения', () => {
    const args = parseArgs([
      '-ProjectRoot', '/tmp/project',
      '--DryRun',
      '-Extension', 'EVOLC',
    ], new Set(['DryRun']));

    assert.strictEqual(getString(args, 'ProjectRoot'), '/tmp/project');
    assert.strictEqual(getString(args, 'Missing', 'fallback'), 'fallback');
    assert.strictEqual(getRequiredString(args, 'Extension'), 'EVOLC');
    assert.strictEqual(getBool(args, 'DryRun'), true);

    assert.throws(() => parseArgs(['positional'], new Set()), /unsupported positional argument/);
    assert.throws(() => parseArgs(['-ProjectRoot'], new Set()), /value required/);
    assert.throws(() => getRequiredString({}, 'ProjectRoot'), /ProjectRoot is required/);
  });

  test('формирует пути проекта и параметры подключения 1С', () => {
    const projectRoot = path.join(os.tmpdir(), 'v8vscedit-project');
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-v8path-'));
    const v8Path = path.join(binDir, process.platform === 'win32' ? '1cv8.exe' : '1cv8');
    fs.writeFileSync(v8Path, '', 'utf-8');
    fs.chmodSync(v8Path, 0o755);

    assert.strictEqual(resolveConfigDir(projectRoot, 'cf'), path.join(projectRoot, 'src', 'cf'));
    assert.strictEqual(resolveConfigDir(projectRoot, 'cfe', 'EVOLC'), path.join(projectRoot, 'src', 'cfe', 'EVOLC'));
    assert.throws(() => resolveConfigDir(projectRoot, 'cfe'), /Extension is required/);

    const connection = resolveConnection({
      InfoBaseServer: 'server',
      InfoBaseRef: 'base',
      UserName: 'tester',
      Password: 'secret',
      V8Path: v8Path,
    });
    assert.strictEqual(connection.infoBasePath, '');
    assert.strictEqual(connection.v8Path, v8Path);

    const designerArgs: string[] = [];
    appendConnectionArgs(designerArgs, connection);
    assert.deepStrictEqual(designerArgs, ['/S', 'server/base', '/Ntester', '/Psecret']);

    const fileArgs: string[] = [];
    appendConnectionArgs(fileArgs, {
      infoBasePath: '/tmp/base',
      infoBaseServer: '',
      infoBaseRef: '',
      userName: '',
      password: '',
      v8Path,
    });
    assert.deepStrictEqual(fileArgs, ['/F', '/tmp/base']);

    const repoArgs: string[] = [];
    appendRepositoryArgs(repoArgs, { repoPath: '/repo', repoUser: 'dev', repoPassword: 'pwd' });
    assert.deepStrictEqual(repoArgs, ['/ConfigurationRepositoryF', '/repo', '/ConfigurationRepositoryN', 'dev', '/ConfigurationRepositoryP', 'pwd']);
    assert.throws(() => resolveConnection({ V8Path: v8Path }), /specify -InfoBasePath/);
    safeRemoveDir(binDir);
  });

  test('работает с реальными временными файлами CLI', () => {
    const dir = createTempDir('v8vscedit-cli-');
    const listPath = path.join(dir, 'list.txt');
    writeUtf8BomLines(listPath, ['Первая', 'Вторая']);

    const content = fs.readFileSync(listPath, 'utf-8');
    assert.strictEqual(content.charCodeAt(0), 0xfeff);
    assert.ok(content.includes('Первая\nВторая'));

    const logPath = path.join(dir, 'log.txt');
    fs.writeFileSync(logPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Лог', 'utf-8')]));
    printLogFile(logPath);
    safeRemoveDir(dir);
    assert.strictEqual(fs.existsSync(dir), false);
  });

  test('декодирует вывод и выбирает наиболее читаемую кириллицу', () => {
    assert.strictEqual(decodeProcessOutput(Buffer.from('plain utf8', 'utf-8')), 'plain utf8');
    assert.strictEqual(
      pickMostReadableText(['����', 'Привет', 'Privet']),
      'Привет'
    );

    const cp866 = encode('Привет', 'cp866');
    assert.strictEqual(pickMostReadableText([cp866.toString('utf-8'), 'Привет']), 'Привет');
  });

  test('запускает реальный процесс и возвращает stdout/stderr', async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'console.log("out"); console.error("err"); process.exit(3);'],
      onStdout: (chunk) => stdoutChunks.push(chunk.toString('utf-8').trim()),
      onStderr: (chunk) => stderrChunks.push(chunk.toString('utf-8').trim()),
    });

    assert.strictEqual(result.exitCode, 3);
    assert.strictEqual(result.lastStdout, 'out');
    assert.strictEqual(result.lastStderr, 'err');
    assert.deepStrictEqual(stdoutChunks, ['out']);
    assert.deepStrictEqual(stderrChunks, ['err']);
  });
});
