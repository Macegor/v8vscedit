import * as assert from 'assert';
import {
  launchInteractiveDesignerWithAgentPause,
  ReconnectOnceHandler,
  type DesignerAgentInfoBaseSession,
  type InteractiveDesignerProcess,
} from '../../infra/agent';

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;
type ErrorListener = (error: Error) => void;

class FakeDesignerProcess implements InteractiveDesignerProcess {
  private exitListener: ExitListener | undefined;
  private errorListener: ErrorListener | undefined;

  once(event: 'exit', listener: ExitListener): this;
  once(event: 'error', listener: ErrorListener): this;
  once(event: 'exit' | 'error', listener: ExitListener | ErrorListener): this {
    if (event === 'exit') {
      this.exitListener = listener as ExitListener;
    } else {
      this.errorListener = listener as ErrorListener;
    }
    return this;
  }

  emitExit(): void {
    this.exitListener?.(0, null);
  }

  emitError(error: Error): void {
    this.errorListener?.(error);
  }
}

class FakeAgentSession implements DesignerAgentInfoBaseSession {
  constructor(
    private connected: boolean,
    private readonly events: string[],
    private readonly reconnectError?: Error
  ) {}

  isInfoBaseConnected(): boolean {
    return this.connected;
  }

  disconnectInfoBase(): Promise<boolean> {
    this.events.push('disconnect');
    this.connected = false;
    return Promise.resolve(true);
  }

  reconnectInfoBase(): Promise<void> {
    this.events.push('connect');
    if (this.reconnectError) {
      return Promise.reject(this.reconnectError);
    }
    this.connected = true;
    return Promise.resolve();
  }
}

suite('InteractiveDesignerLauncher', () => {
  test('отключает базу от агента перед запуском и подключает после закрытия конфигуратора', async () => {
    const events: string[] = [];
    const agentSession = new FakeAgentSession(true, events);
    const process = new FakeDesignerProcess();

    await launchInteractiveDesignerWithAgentPause({
      agentSession,
      launch: () => {
        events.push('launch');
        return process;
      },
    });

    assert.deepStrictEqual(events, ['disconnect', 'launch']);

    process.emitExit();
    await flushPromises();

    assert.deepStrictEqual(events, ['disconnect', 'launch', 'connect']);
    assert.strictEqual(agentSession.isInfoBaseConnected(), true);
  });

  test('сразу переподключает агент, если интерактивный конфигуратор не удалось запустить', async () => {
    const events: string[] = [];
    const agentSession = new FakeAgentSession(true, events);

    await assert.rejects(
      launchInteractiveDesignerWithAgentPause({
        agentSession,
        launch: () => {
          events.push('launch');
          throw new Error('нет исполняемого файла 1С');
        },
      }),
      /нет исполняемого файла 1С/
    );

    assert.deepStrictEqual(events, ['disconnect', 'launch', 'connect']);
    assert.strictEqual(agentSession.isInfoBaseConnected(), true);
  });

  test('не трогает агентную сессию, если база уже отключена от агента', async () => {
    const events: string[] = [];
    const agentSession = new FakeAgentSession(false, events);

    await launchInteractiveDesignerWithAgentPause({
      agentSession,
      launch: () => {
        events.push('launch');
        return new FakeDesignerProcess();
      },
    });

    assert.deepStrictEqual(events, ['launch']);
  });

  test('умеет принудительно отключить базу у найденного запущенного агента', async () => {
    const events: string[] = [];
    const agentSession = new FakeAgentSession(false, events);
    const process = new FakeDesignerProcess();

    await launchInteractiveDesignerWithAgentPause({
      agentSession,
      forceAgentDisconnect: true,
      launch: () => {
        events.push('launch');
        return process;
      },
    });

    process.emitExit();
    await flushPromises();

    assert.deepStrictEqual(events, ['disconnect', 'launch', 'connect']);
  });

  test('после ошибки процесса переподключает агент только один раз', async () => {
    const events: string[] = [];
    const agentSession = new FakeAgentSession(true, events);
    const process = new FakeDesignerProcess();

    await launchInteractiveDesignerWithAgentPause({
      agentSession,
      launch: () => {
        events.push('launch');
        return process;
      },
    });

    process.emitError(new Error('процесс не стартовал'));
    process.emitExit();
    await flushPromises();

    assert.deepStrictEqual(events, ['disconnect', 'launch', 'connect']);
  });

  test('передаёт ошибку повторного подключения в обработчик', async () => {
    const events: string[] = [];
    const reconnectErrors: string[] = [];
    const agentSession = new FakeAgentSession(true, events, new Error('агент недоступен'));
    const process = new FakeDesignerProcess();

    await launchInteractiveDesignerWithAgentPause({
      agentSession,
      launch: () => process,
      onReconnectError: (error) => {
        reconnectErrors.push(error instanceof Error ? error.message : String(error));
      },
    });

    process.emitExit();
    await flushPromises();

    assert.deepStrictEqual(events, ['disconnect', 'connect']);
    assert.deepStrictEqual(reconnectErrors, ['агент недоступен']);
  });

  test('обработчик повторного подключения выполняется только при первом вызове', async () => {
    const events: string[] = [];
    const agentSession = new FakeAgentSession(false, events);
    const reconnectHandler = new ReconnectOnceHandler(agentSession, {});

    reconnectHandler.handleTermination();
    reconnectHandler.handleTermination();
    await flushPromises();

    assert.deepStrictEqual(events, ['connect']);
  });
});

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
