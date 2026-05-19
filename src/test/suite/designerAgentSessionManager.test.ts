import * as assert from 'assert';
import {
  DesignerAgentSessionManager,
  type AgentCommandHooks,
  type AgentCommandResult,
  type DesignerAgentTransport,
  type DesignerAgentTransportFactory,
} from '../../infra/agent';

suite('DesignerAgentSessionManager', () => {
  test('не кеширует упавшее создание сессии и даёт повторить подключение', async () => {
    const factory = new FlakyFactory();
    const manager = new DesignerAgentSessionManager(factory);

    await assert.rejects(manager.create('default'), /нет связи/);
    const session = await manager.create('default');

    assert.strictEqual(factory.attempts, 2);
    assert.deepStrictEqual((session as FakeTransport).commands, [
      'options set --output-format=json --show-prompt=no --notify-progress=yes --notify-progress-interval=0.5',
    ]);
  });
});

class FlakyFactory implements DesignerAgentTransportFactory {
  attempts = 0;

  create(): Promise<DesignerAgentTransport> {
    this.attempts += 1;
    if (this.attempts === 1) {
      return Promise.reject(new Error('нет связи'));
    }
    return Promise.resolve(new FakeTransport());
  }
}

class FakeTransport implements DesignerAgentTransport {
  readonly commands: string[] = [];

  execute(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult> {
    this.commands.push(command);
    hooks?.onMessage?.({ type: 'success', message: command });
    return Promise.resolve({ messages: [] });
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
