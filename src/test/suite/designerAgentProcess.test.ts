import * as assert from 'assert';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  buildDesignerAgentArgs,
  buildDesignerAgentModeArgs,
  DesignerAgentProcess,
  waitForTcpPort,
  type DesignerAgentInfoBaseConnection,
} from '../../infra/agent';
import { splitAgentModeArgs } from '../../ui/commands/ext/ExtensionCommandRunner';

suite('DesignerAgentProcess', () => {
  const connection: DesignerAgentInfoBaseConnection = {
    infoBasePath: '/tmp/base',
    v8Path: '/opt/1cv8/1cv8',
  };

  test('добавляет обязательные параметры режима агента из настроек подключения', () => {
    const args = buildDesignerAgentArgs({
      connection,
      agentPort: 1543,
      agentListenAddress: '127.0.0.1',
      agentBaseDir: '/tmp/project/.v8vscedit/agent/base',
    });

    assert.deepStrictEqual(args, [
      'DESIGNER',
      '/F',
      '/tmp/base',
      '/AgentMode',
      '/AgentPort',
      '1543',
      '/AgentListenAddress',
      '127.0.0.1',
      '/AgentSSHHostKeyAuto',
      '/AgentBaseDir',
      '/tmp/project/.v8vscedit/agent/base',
    ]);
  });

  test('не дублирует параметры, явно указанные пользователем', () => {
    const args = buildDesignerAgentModeArgs({
      connection,
      agentPort: 1543,
      agentListenAddress: '127.0.0.1',
      agentBaseDir: '/tmp/default-base',
      agentModeArgs: [
        '/AgentPort',
        '1601',
        '/AgentSSHHostKey',
        '/tmp/host_id',
        '/AgentBaseDir=/tmp/manual-base',
      ],
    });

    assert.deepStrictEqual(args, [
      '/AgentListenAddress',
      '127.0.0.1',
      '/AgentPort',
      '1601',
      '/AgentSSHHostKey',
      '/tmp/host_id',
      '/AgentBaseDir=/tmp/manual-base',
    ]);
  });

  test('разбирает дополнительные параметры AgentMode с путями в кавычках', () => {
    assert.deepStrictEqual(
      splitAgentModeArgs('/AgentPort 1601 /AgentBaseDir "C:\\Users\\Test User\\agent base" /Visible'),
      ['/AgentPort', '1601', '/AgentBaseDir', 'C:\\Users\\Test User\\agent base', '/Visible']
    );
  });

  // Волна 2 (C2): реальная spawn-ошибка (не синхронная валидация пути в
  // resolveV8ExecutablePath) не должна приводить к необработанному исключению
  // процесса Node (event 'error' без слушателя роняет весь Extension Host).
  // Файл называем "1cv8" и делаем исполняемым, чтобы пройти валидацию
  // resolveV8ExecutablePath и получить именно ошибку spawn() (ENOENT/EACCES/ENOEXEC),
  // а не синхронный throw на этапе резолва пути.
  test('реальная ошибка spawn не бросает необработанное исключение и переводит процесс в exited', async () => {
    const brokenV8Path = createBrokenExecutable();

    const proc = new DesignerAgentProcess();
    const exitEvents: { code: number | null; signal: NodeJS.Signals | null }[] = [];

    await new Promise<void>((resolve) => {
      proc.start({
        connection: { infoBasePath: '/tmp/base', v8Path: brokenV8Path },
        onExit: (code, signal) => {
          exitEvents.push({ code, signal });
          resolve();
        },
      });
    });

    fs.rmSync(path.dirname(brokenV8Path), { recursive: true, force: true });

    assert.strictEqual(proc.hasExited(), true, 'после spawn-ошибки процесс должен считаться завершённым');
    assert.strictEqual(exitEvents.length, 1, 'onExit должен быть вызван ровно один раз при ошибке spawn');
    // getExitDescription() должен явно объяснять причину, а не просто "код=null, сигнал=null" —
    // иначе пользователь не поймёт, что 1С не запустилась именно из-за битого исполняемого файла.
    assert.ok(
      /enoent|eacces|enoexec|не найден|spawn/i.test(proc.getExitDescription()),
      `getExitDescription() должен объяснять причину ошибки spawn, получено: "${proc.getExitDescription()}"`
    );
  });

  // Волна 2 (C2): TcpPortWaiter должен опираться на isAborted() и не ждать
  // полный timeoutMs, если процесс агента уже упал сразу после реальной spawn-ошибки.
  test('waitForTcpPort прерывается по isAborted раньше таймаута после spawn-ошибки', async () => {
    // Резервируем свободный порт и сразу закрываем его — соединение туда не установится,
    // поэтому единственный способ выйти быстро — это isAborted().
    const closedPort = await reserveClosedPort();

    const brokenV8Path = createBrokenExecutable();
    const proc = new DesignerAgentProcess();

    proc.start({ connection: { infoBasePath: '/tmp/base', v8Path: brokenV8Path } });

    // Ждём фактического наступления spawn-ошибки, чтобы isAborted успел стать true.
    await waitUntil(() => proc.hasExited(), 2000);
    fs.rmSync(path.dirname(brokenV8Path), { recursive: true, force: true });

    const startedAt = Date.now();
    const connected = await waitForTcpPort({
      host: '127.0.0.1',
      port: closedPort,
      timeoutMs: 10_000,
      intervalMs: 50,
      isAborted: () => proc.hasExited(),
    });
    const elapsedMs = Date.now() - startedAt;

    assert.strictEqual(connected, false);
    assert.ok(elapsedMs < 1500, `waitForTcpPort должен был прерваться по isAborted, заняло ${String(elapsedMs)}мс`);
  });

  // Волна 2 (C2): describeSpawnError переводит EACCES (запуск файла без прав
  // на выполнение) в понятную причину — самостоятельная ветка switch, не
  // покрытая ENOEXEC-сценарием выше (там файл именно исполняемый, но "битый").
  test('spawn-ошибка EACCES (файл без права на выполнение) отражается в getExitDescription', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-eacces-v8-'));
    const executableName = process.platform === 'win32' ? '1cv8.exe' : '1cv8';
    const noExecPath = path.join(dir, executableName);
    fs.writeFileSync(noExecPath, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(noExecPath, 0o644); // без бита +x — реальный EACCES при spawn()

    const proc = new DesignerAgentProcess();
    const exitEvents: { code: number | null; signal: NodeJS.Signals | null }[] = [];

    await new Promise<void>((resolve) => {
      proc.start({
        connection: { infoBasePath: '/tmp/base', v8Path: noExecPath },
        onExit: (code, signal) => {
          exitEvents.push({ code, signal });
          resolve();
        },
      });
    });

    fs.rmSync(dir, { recursive: true, force: true });

    assert.strictEqual(proc.hasExited(), true);
    assert.strictEqual(exitEvents.length, 1);
    assert.ok(
      /eacces|нет прав/i.test(proc.getExitDescription()),
      `ожидалось объяснение EACCES, получено: "${proc.getExitDescription()}"`
    );
  });

  // Волна 2 (C2): explicit-путь с разделителем каталогов, которого не существует —
  // resolveV8ExecutablePath бросает СВОЙ Error (без .code), это и есть default-ветка
  // describeSpawnError (используется err.message, а не код ошибки ОС).
  test('несуществующий explicit-путь даёт понятную причину без кода ошибки ОС (default-ветка)', async () => {
    const proc = new DesignerAgentProcess();
    const exitEvents: { code: number | null; signal: NodeJS.Signals | null }[] = [];

    await new Promise<void>((resolve) => {
      proc.start({
        connection: { infoBasePath: '/tmp/base', v8Path: '/no/such/directory/1cv8' },
        onExit: (code, signal) => {
          exitEvents.push({ code, signal });
          resolve();
        },
      });
    });

    assert.strictEqual(proc.hasExited(), true);
    assert.strictEqual(exitEvents.length, 1);
    assert.ok(
      /не найден исполняемый файл/i.test(proc.getExitDescription()),
      `ожидалось сообщение resolveV8ExecutablePath как есть, получено: "${proc.getExitDescription()}"`
    );
  });

  // Волна 2 (C2): штатный (успешный) путь запуска и нормального завершения тоже
  // должен пройти через один и тот же exit-обработчик с guard'ом alreadyExited —
  // без этого теста ветка нормального onExit (без предшествующей spawn-ошибки)
  // осталась бы непокрытой.
  test('штатный запуск и нормальное завершение процесса: код/сигнал попадают в getExitDescription', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-real-v8-'));
    const executableName = process.platform === 'win32' ? '1cv8.exe' : '1cv8';
    const scriptPath = path.join(dir, executableName);
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho stdout-строка\necho stderr-строка 1>&2\nexit 7\n');
    fs.chmodSync(scriptPath, 0o755);

    const proc = new DesignerAgentProcess();
    const exitEvents: { code: number | null; signal: NodeJS.Signals | null }[] = [];
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    await new Promise<void>((resolve) => {
      proc.start({
        connection: { infoBasePath: '/tmp/base', v8Path: scriptPath },
        onStdout: (text) => stdoutLines.push(text),
        onStderr: (text) => stderrLines.push(text),
        onExit: (code, signal) => {
          exitEvents.push({ code, signal });
          resolve();
        },
      });
    });

    fs.rmSync(dir, { recursive: true, force: true });

    assert.strictEqual(proc.hasExited(), true);
    assert.strictEqual(exitEvents.length, 1, 'onExit должен быть вызван ровно один раз при нормальном завершении');
    assert.strictEqual(exitEvents[0]?.code, 7);
    assert.ok(stdoutLines.some((line) => line.includes('stdout-строка')));
    assert.ok(stderrLines.some((line) => line.includes('stderr-строка')));
    assert.strictEqual(
      proc.getExitDescription(),
      `код=7, сигнал=${exitEvents[0]?.signal ?? '-'}`
    );
  });
});

/**
 * Создаёт файл "1cv8" с правом на выполнение, но без валидного содержимого
 * исполняемого файла. resolveV8ExecutablePath принимает его по имени/правам,
 * а реальный spawn() на такой "бинарник" падает с ENOEXEC/EACCES — то есть тест
 * бьёт именно по обработчику ошибки spawn, а не по валидации пути.
 */
function createBrokenExecutable(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-broken-v8-'));
  const executableName = process.platform === 'win32' ? '1cv8.exe' : '1cv8';
  const brokenPath = path.join(dir, executableName);
  fs.writeFileSync(brokenPath, '\x00\x00not-a-real-executable\x00\x00');
  fs.chmodSync(brokenPath, 0o755);
  return brokenPath;
}

/** Открывает TCP-сервер на свободном порту и сразу закрывает его, возвращая номер порта. */
function reserveClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (port === undefined) {
          reject(new Error('не удалось определить порт'));
          return;
        }
        resolve(port);
      });
    });
  });
}

/** Ждёт выполнения условия с опросом, чтобы не завязываться на конкретный event-порядок spawn. */
function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('условие не выполнено за отведённое время'));
        return;
      }
      setTimeout(check, 20);
    };
    check();
  });
}
