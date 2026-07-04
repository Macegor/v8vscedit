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
import { describeProcessInterruption, runProcess } from '../../infra/process/ProcessRunner';

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
      onStdout: (line) => stdoutChunks.push(line.trim()),
      onStderr: (line) => stderrChunks.push(line.trim()),
    });

    assert.strictEqual(result.exitCode, 3);
    assert.strictEqual(result.lastStdout, 'out');
    assert.strictEqual(result.lastStderr, 'err');
    assert.deepStrictEqual(stdoutChunks, ['out']);
    assert.deepStrictEqual(stderrChunks, ['err']);
  });

  // Волна 2 (C1): runProcess должен уметь принудительно завершать зависшие
  // процессы по таймауту и по внешней отмене, не оставляя их работать вечно
  // (частый источник зависших conhost/1cv8 в интеграциях с 1С).
  test('завершает зависший процесс по таймауту через SIGTERM/SIGKILL', async () => {
    const startedAt = Date.now();
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      timeoutMs: 300,
      killGraceMs: 200,
    });
    const elapsedMs = Date.now() - startedAt;

    // Промис должен РЕЗОЛВИТЬСЯ с флагом, а не зареджектиться —
    // вызывающий код (CLI/агент) не должен ловить исключение на таймауте.
    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.canceled, undefined, 'canceled не должен выставляться при таймауте без токена');
    // SIGTERM ждём killGraceMs, затем SIGKILL — суммарно укладываемся в 1500мс,
    // иначе процесс завис и не был реально убит.
    assert.ok(elapsedMs < 1500, `процесс убит слишком долго: ${String(elapsedMs)}мс`);
  });

  test('отменяет зависший процесс через CancellationLike-токен', async () => {
    let cancelListener: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested(listener: () => void) {
        cancelListener = listener;
        return { dispose: () => { cancelListener = undefined; } };
      },
    };

    const resultPromise = runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      cancellationToken,
      killGraceMs: 200,
    });

    // Эмулируем отмену пользователем спустя короткое время после старта —
    // токен-заглушка эмитит отмену через setTimeout, как это делает VS Code.
    setTimeout(() => {
      cancellationToken.isCancellationRequested = true;
      cancelListener?.();
    }, 150);

    const startedAt = Date.now();
    const result = await resultPromise;
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(result.canceled, true);
    assert.strictEqual(result.timedOut, undefined, 'timedOut не должен выставляться при отмене токеном');
    assert.ok(elapsedMs < 1500, `отмена сработала слишком долго: ${String(elapsedMs)}мс`);
  });

  test('процесс, корректно обрабатывающий SIGTERM, завершается без ожидания SIGKILL', async () => {
    const startedAt = Date.now();
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"],
      timeoutMs: 300,
      killGraceMs: 5000,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(result.timedOut, true);
    // Если процесс сам вышел по SIGTERM, ждать полный killGraceMs (5с) не нужно —
    // иначе грациозное завершение не даёт никакого выигрыша по времени.
    assert.ok(elapsedMs < 1500, `не дождались грациозного SIGTERM-выхода, заняло ${String(elapsedMs)}мс`);
  });

  test('короткий процесс без timeoutMs завершается как раньше, без лишних флагов', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'console.log("ok"); process.exit(0);'],
    });

    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.lastStdout, 'ok');
    // Поля должны отсутствовать (undefined), а не false — контракт различает
    // "таймаута не было" от "explicit false", чтобы не плодить лишние ветки у потребителей.
    assert.strictEqual(result.timedOut, undefined);
    assert.strictEqual(result.canceled, undefined);
  });

  // Волна 2 (C1): если токен отменён ещё ДО запуска (пользователь успел нажать
  // "отмена" в progress-нотификации раньше, чем стартовал процесс), runProcess
  // не должен порождать дочерний процесс вовсе.
  test('уже отменённый на входе токен — процесс не запускается, промис резолвится canceled', async () => {
    const cancellationToken = {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose: () => undefined }),
    };

    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'console.log("не должно быть выполнено");'],
      cancellationToken,
    });

    assert.strictEqual(result.canceled, true);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.lastStdout, '');
  });

  // Волна 2 (C1): таймаут и внешняя отмена могут сработать почти одновременно
  // (пользователь жмёт "отмена" в момент срабатывания таймаута) — forceKill()
  // вызывается дважды, и повторный вызов должен молча выйти по уже
  // установленному killTimer, а не поставить второй SIGKILL-таймер поверх первого.
  // Процесс сам игнорирует SIGTERM, чтобы дожить до обоих срабатываний и реально
  // проверить повторный вызов forceKill(), а не просто закрыться по первому SIGTERM.
  test('гонка таймаута и отмены: повторный forceKill не ставит второй SIGKILL-таймер', async () => {
    let cancelListener: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested(listener: () => void) {
        cancelListener = listener;
        return { dispose: () => { cancelListener = undefined; } };
      },
    };

    const resultPromise = runProcess({
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      timeoutMs: 100,
      killGraceMs: 300,
      cancellationToken,
    });

    // Отмена приходит вскоре после таймаута, пока killTimer (SIGKILL через 300мс) ещё не
    // сработал — именно это и вызывает повторный forceKill() с уже выставленным killTimer.
    setTimeout(() => {
      cancellationToken.isCancellationRequested = true;
      cancelListener?.();
    }, 150);

    const startedAt = Date.now();
    const result = await resultPromise;
    const elapsedMs = Date.now() - startedAt;

    // Оба флага корректны: таймаут сработал первым, отмена подтвердилась следом,
    // а фактическое завершение произошло по исходному SIGKILL-таймеру (не позже ~300мс).
    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.canceled, true);
    assert.ok(elapsedMs < 1500, `гонка не должна была продлить принудительное завершение: ${String(elapsedMs)}мс`);
  });

  // Волна 2 (C1): decodeProcessOutput в flush() не вызывается, если после
  // последнего '\n' не осталось незавершённого хвоста — ветка "нет хвоста"
  // (flush() возвращает undefined) отдельно от кейса непустого хвоста.
  test('процесс, выводящий строки строго с завершающим \\n, не создаёт хвост при close', async () => {
    const stdoutLines: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("строка1\\nстрока2\\n"); process.exit(0);'],
      onStdout: (line) => stdoutLines.push(line),
    });

    assert.strictEqual(result.exitCode, 0);
    assert.deepStrictEqual(stdoutLines, ['строка1', 'строка2']);
  });

  // Волна 2 (C1): обратный случай — процесс завершается, не дописав последний '\n'
  // ни в stdout, ни в stderr (типично для 1С/vrunner, которые вываливаются посреди
  // вывода). onStdout/onStderr должны получить именно этот незавершённый хвост
  // через flush() при close, а не потерять его.
  test('незавершённый хвост stdout/stderr (без \\n) передаётся через onStdout/onStderr при close', async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const result = await runProcess({
      command: process.execPath,
      args: [
        '-e',
        'process.stdout.write("готовая строка\\nхвост-без-переноса"); '
          + 'process.stderr.write("хвост-ошибки-без-переноса"); process.exit(2);',
      ],
      onStdout: (line) => stdoutLines.push(line),
      onStderr: (line) => stderrLines.push(line),
    });

    assert.strictEqual(result.exitCode, 2);
    assert.deepStrictEqual(stdoutLines, ['готовая строка', 'хвост-без-переноса']);
    assert.deepStrictEqual(stderrLines, ['хвост-ошибки-без-переноса']);
  });

  // Волна 2 (C1): killGraceMs не указан явно — должен применяться DEFAULT_KILL_GRACE_MS.
  // Ждать полные 5с в тесте нельзя, но процесс, который сам выходит по SIGTERM,
  // проверяет именно факт вычисления дефолтной паузы (грациозный путь), а не таймер SIGKILL.
  test('таймаут без явного killGraceMs использует значение по умолчанию (грациозный SIGTERM)', async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"],
      timeoutMs: 200,
    });

    assert.strictEqual(result.timedOut, true);
    assert.strictEqual(result.exitCode, 0);
  });
});

/**
 * describeProcessInterruption — чистая логика без побочных эффектов, отвечающая
 * за нейтральный (не error) текст при штатном прерывании процесса. Используется
 * в ExtensionCommandRunner/RepositoryCommandRunner, чтобы отмена/таймаут не
 * показывались пользователю как сбой команды.
 */
suite('describeProcessInterruption', () => {
  test('canceled=true — сообщение об отмене пользователем', () => {
    assert.strictEqual(
      describeProcessInterruption({ exitCode: 1, lastStdout: '', lastStderr: '', canceled: true }),
      'Операция отменена пользователем.'
    );
  });

  test('timedOut=true — сообщение о прерывании по таймауту', () => {
    assert.strictEqual(
      describeProcessInterruption({ exitCode: 1, lastStdout: '', lastStderr: '', timedOut: true }),
      'Операция прервана по таймауту.'
    );
  });

  test('canceled имеет приоритет над timedOut, если оба флага выставлены', () => {
    assert.strictEqual(
      describeProcessInterruption({ exitCode: 1, lastStdout: '', lastStderr: '', timedOut: true, canceled: true }),
      'Операция отменена пользователем.'
    );
  });

  test('ни один флаг не выставлен — undefined (штатное завершение/ошибка)', () => {
    assert.strictEqual(
      describeProcessInterruption({ exitCode: 0, lastStdout: 'ok', lastStderr: '' }),
      undefined
    );
  });
});
