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

  constructor(
    private readonly connectError?: Error,
    private readonly executeHook?: (command: string) => Error | undefined
  ) {}

  execute(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult> {
    this.commands.push(command);
    if (command === 'common connect-ib' && this.connectError) {
      return Promise.reject(this.connectError);
    }
    const error = this.executeHook?.(command);
    if (error) {
      return Promise.reject(error);
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

class ResettableFakeTransportFactory extends FakeTransportFactory {
  resetCount = 0;

  reset(): Promise<void> {
    this.resetCount += 1;
    return Promise.resolve();
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

    assert.strictEqual(service.isInfoBaseConnected(), false);
    assert.strictEqual(transport.commands[0], 'common connect-ib');
    assert.match(transport.commands[1], /^config update-db-cfg/);
    assert.strictEqual(transport.commands[2], 'common disconnect-ib');
    assert.ok(messages.some((message) => message.startsWith('выполнено: config update-db-cfg')));
  });

  test('после обновления БД заново подключается перед следующей частичной загрузкой', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-agent-reconnect-'));
    try {
      const configRoot = path.join(tempRoot, 'src', 'cf');
      const changedModule = path.join(configRoot, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl');
      fs.mkdirSync(path.dirname(changedModule), { recursive: true });
      fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), '<MetaDataObject/>', 'utf-8');
      fs.writeFileSync(path.join(configRoot, 'Catalogs', 'Товары.xml'), '<xml/>', 'utf-8');
      fs.writeFileSync(changedModule, 'Процедура ДоИзменения() КонецПроцедуры', 'utf-8');

      const scopeKey = buildScopeKey('cf', configRoot);
      saveHashCache(tempRoot, buildHashSnapshot(scopeKey, configRoot));

      const transport = new FakeTransport();
      const factory = new ResettableFakeTransportFactory(transport);
      const service = new AgentOperationService(tempRoot, factory);
      const target = { kind: 'cf' as const, name: 'Основная', rootPath: configRoot };

      await service.updateDatabaseConfiguration(target);
      assert.strictEqual(factory.resetCount, 1);
      fs.writeFileSync(changedModule, 'Процедура ПослеИзменения() КонецПроцедуры', 'utf-8');
      await service.loadChangedAndUpdate(target);
      assert.strictEqual(factory.resetCount, 2);

      assert.strictEqual(
        transport.commands.filter((command) => command === 'common connect-ib').length,
        2
      );
      assert.strictEqual(
        transport.commands.filter((command) => command === 'common disconnect-ib').length,
        2
      );
      assert.match(transport.commands[4], /^config load-config-from-files/);
      assert.match(transport.commands[5], /^config update-db-cfg/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('частичная загрузка зеркалит проект в воркспейс и обновляет изменённый файл', async () => {
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
      // Изменённый модуль скопирован.
      assert.strictEqual(fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ', 'Ext', 'ObjectModule.bsl')), true);
      // Раньше тест требовал, чтобы НЕизменённый модуль отсутствовал в воркспейсе — это и приводило
      // к пустому UnknownError, когда конфигуратору в `--dir` не хватало каркаса конфигурации.
      // Теперь воркспейс зеркалит весь проект, поэтому соседние неизменённые файлы присутствуют.
      assert.strictEqual(fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ', 'Ext', 'ManagerModule.bsl')), true);
      assert.strictEqual(fs.existsSync(path.join(agentRoot, 'Configuration.xml')), true);
      assert.strictEqual(
        fs.readFileSync(path.join(agentRoot, 'Documents', 'Заказ', 'Ext', 'ObjectModule.bsl'), 'utf-8'),
        'Процедура Новая() КонецПроцедуры'
      );

      const loadCommand = transport.commands.find((command) => command.startsWith('config load-config-from-files'));
      assert.ok(loadCommand);
      assert.match(loadCommand, /--partial/);
      assert.match(loadCommand, /--no-check/);
      assert.doesNotMatch(loadCommand, /--extension/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('новые XML-элементы загружает частично через list-file', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-agent-structural-partial-'));
    try {
      const configRoot = path.join(tempRoot, 'src', 'cf');
      fs.mkdirSync(path.join(configRoot, 'Catalogs'), { recursive: true });
      fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), '<MetaDataObject/>', 'utf-8');
      const scopeKey = buildScopeKey('cf', configRoot);
      saveHashCache(tempRoot, buildHashSnapshot(scopeKey, configRoot));

      fs.writeFileSync(path.join(configRoot, 'Catalogs', 'Новый.xml'), '<xml/>', 'utf-8');

      const transport = new FakeTransport();
      const service = new AgentOperationService(tempRoot, new FakeTransportFactory(transport));

      await service.loadChangedAndUpdate({ kind: 'cf', name: 'Основная', rootPath: configRoot });

      const loadCommand = transport.commands.find((command) => command.startsWith('config load-config-from-files'));
      assert.ok(loadCommand);
      assert.match(loadCommand, /--partial/);
      assert.match(loadCommand, /--list-file/);
      // На частичной загрузке `--update-config-dump-info` не передаётся: иначе конфигуратор
      // на следующей частичной загрузке падает с пустым UnknownError.
      assert.doesNotMatch(loadCommand, /--update-config-dump-info/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('частичная загрузка восстанавливает каркас в воркспейсе из проекта', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-agent-mirror-'));
    try {
      const configRoot = path.join(tempRoot, 'src', 'cf');
      const changedModule = path.join(configRoot, 'Documents', 'Заказ', 'Forms', 'Форма', 'Ext', 'Form', 'Module.bsl');
      const parentFormXml = path.join(configRoot, 'Documents', 'Заказ', 'Forms', 'Форма.xml');
      const parentObjectXml = path.join(configRoot, 'Documents', 'Заказ.xml');
      fs.mkdirSync(path.dirname(changedModule), { recursive: true });
      fs.writeFileSync(
        path.join(configRoot, 'Configuration.xml'),
        '<?xml version="1.0" encoding="UTF-8"?><MetaDataObject><Configuration><Properties><Name>Основная</Name></Properties></Configuration></MetaDataObject>',
        'utf-8'
      );
      fs.writeFileSync(parentObjectXml, '<xml/>', 'utf-8');
      fs.writeFileSync(parentFormXml, '<xml/>', 'utf-8');
      fs.writeFileSync(changedModule, 'Процедура Старая() КонецПроцедуры', 'utf-8');

      const scopeKey = buildScopeKey('cf', configRoot);
      saveHashCache(tempRoot, buildHashSnapshot(scopeKey, configRoot));
      fs.writeFileSync(changedModule, 'Процедура Новая() КонецПроцедуры', 'utf-8');

      const transport = new FakeTransport();
      const service = new AgentOperationService(tempRoot, new FakeTransportFactory(transport));
      await service.loadChangedAndUpdate({ kind: 'cf', name: 'Основная', rootPath: configRoot });

      const agentRoot = path.join(tempRoot, '.v8vscedit', 'agent', '0', 'workspace', 'cf', 'cf');
      assert.strictEqual(
        fs.existsSync(path.join(agentRoot, 'Configuration.xml')),
        true,
        'воркспейс должен содержать Configuration.xml для контекста частичной загрузки'
      );
      assert.strictEqual(
        fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ.xml')),
        true,
        'воркспейс должен содержать корневой XML объекта формы'
      );
      assert.strictEqual(
        fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ', 'Forms', 'Форма.xml')),
        true,
        'воркспейс должен содержать XML самой формы для модуля формы'
      );
      assert.strictEqual(
        fs.existsSync(path.join(agentRoot, 'Documents', 'Заказ', 'Forms', 'Форма', 'Ext', 'Form', 'Module.bsl')),
        true,
        'актуальный модуль формы должен быть скопирован в воркспейс'
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

});
