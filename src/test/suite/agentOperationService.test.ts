import * as assert from 'assert';
import {
  AgentOperationService,
  isInfoBaseAlreadyConnectedMessage,
  type DesignerAgentTransport,
  type DesignerAgentTransportFactory,
  type AgentCommandHooks,
  type AgentCommandResult,
} from '../../infra/agent';

class FakeTransport implements DesignerAgentTransport {
  readonly commands: string[] = [];

  constructor(private readonly connectError?: Error) {}

  async execute(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult> {
    this.commands.push(command);
    if (command === 'common connect-ib' && this.connectError) {
      throw this.connectError;
    }
    hooks?.onMessage?.({ type: 'log', message: `выполнено: ${command}` });
    return { messages: [] };
  }

  async dispose(): Promise<void> {
    return undefined;
  }
}

class FakeTransportFactory implements DesignerAgentTransportFactory {
  constructor(readonly transport: FakeTransport) {}

  async create(_sessionKey: string): Promise<DesignerAgentTransport> {
    return this.transport;
  }
}

suite('AgentOperationService', () => {
  test('распознаёт русское сообщение агента о уже установленном соединении с переносами строк', () => {
    assert.strictEqual(
      isInfoBaseAlreadyConnectedMessage('Соединение с информационной базой уже\nустановлено'),
      true
    );
  });

  test('считает уже подключенную базу успешным connect-ib и выполняет команду операции', async () => {
    const transport = new FakeTransport(new Error('Соединение с информационной базой уже\nустановлено'));
    const service = new AgentOperationService('/tmp/v8vscedit-test-project', new FakeTransportFactory(transport));
    const messages: string[] = [];

    await service.updateDatabaseConfiguration({
      kind: 'cf',
      name: 'Основная',
      rootPath: '/tmp/v8vscedit-test-project/src/cf',
    }, {
      onMessage: (message) => messages.push(message),
    });

    assert.strictEqual(service.isInfoBaseConnected(), true);
    assert.strictEqual(transport.commands[0], 'common connect-ib');
    assert.match(transport.commands[1], /^config update-db-cfg/);
    assert.match(messages.at(-1) ?? '', /^выполнено: config update-db-cfg/);
  });
});
