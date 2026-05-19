import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AgentOperationService,
  isInfoBaseAlreadyConnectedMessage,
  type DesignerAgentTransport,
  type DesignerAgentTransportFactory,
  type AgentCommandHooks,
  type AgentCommandResult,
} from '../../infra/agent';
import { buildHashSnapshot, buildScopeKey, saveHashCache } from '../../infra/cache/HashCache';

class FakeTransport implements DesignerAgentTransport {
  readonly commands: string[] = [];

  constructor(private readonly connectError?: Error) {}

  execute(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult> {
    this.commands.push(command);
    if (command === 'common connect-ib' && this.connectError) {
      return Promise.reject(this.connectError);
    }
    hooks?.onMessage?.({ type: 'log', message: `выполнено: ${command}` });
    return Promise.resolve({ messages: [] });
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeTransportFactory implements DesignerAgentTransportFactory {
  constructor(readonly transport: FakeTransport) {}

  create(): Promise<DesignerAgentTransport> {
    return Promise.resolve(this.transport);
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

  test('частичная загрузка копирует в рабочую папку агента только файлы из списка загрузки', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-agent-partial-'));
    try {
      const configRoot = path.join(tempRoot, 'src', 'cf');
      const changedModule = path.join(configRoot, 'Documents', 'Заказ', 'Ext', 'ObjectModule.bsl');
      const unchangedModule = path.join(configRoot, 'Documents', 'Заказ', 'Ext', 'ManagerModule.bsl');
      fs.mkdirSync(path.dirname(changedModule), { recursive: true });
      fs.writeFileSync(
        path.join(configRoot, 'Configuration.xml'),
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<MetaDataObject>',
          '<Configuration>',
          '<Properties><Name>Основная</Name><Version>1.0</Version></Properties>',
          '</Configuration>',
          '</MetaDataObject>',
        ].join(''),
        'utf-8'
      );
      fs.writeFileSync(path.join(configRoot, 'Documents', 'Заказ.xml'), '<xml/>', 'utf-8');
      fs.writeFileSync(changedModule, 'Процедура Старая() КонецПроцедуры', 'utf-8');
      fs.writeFileSync(unchangedModule, 'Процедура НеМенялась() КонецПроцедуры', 'utf-8');

      const scopeKey = buildScopeKey('cf', configRoot);
      saveHashCache(tempRoot, buildHashSnapshot(scopeKey, configRoot));
      fs.writeFileSync(changedModule, 'Процедура Новая() КонецПроцедуры', 'utf-8');

      const transport = new FakeTransport();
      const service = new AgentOperationService(tempRoot, new FakeTransportFactory(transport));

      await service.loadChangedAndUpdate({ kind: 'cf', name: 'Основная', rootPath: configRoot });

      const agentRoot = path.join(tempRoot, '.v8vscedit', 'agent', '0', 'workspace', 'cf', 'cf');
      assert.strictEqual(fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ', 'Ext', 'ObjectModule.bsl')), true);
      assert.strictEqual(fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ', 'Ext', 'ManagerModule.bsl')), false);

      const loadCommand = transport.commands.find((command) => command.startsWith('config load-config-from-files'));
      assert.ok(loadCommand);
      assert.match(loadCommand, /--partial/);
      assert.match(loadCommand, /--no-check/);
      assert.doesNotMatch(loadCommand, /--extension/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
