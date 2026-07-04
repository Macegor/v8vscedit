import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ClientChannel, ConnectConfig } from 'ssh2';
import {
  AgentCommandError,
  buildSshConnectConfig,
  ProcessDesignerAgentTransport,
  type DesignerAgentSshClient,
} from '../../infra/agent';
import { isEmptyUnknownAgentMessage } from '../../domain/agent';

suite('ProcessDesignerAgentTransport', () => {
  test('строит параметры подключения без системного ssh', () => {
    const config = buildSshConnectConfig({
      host: 'localhost',
      port: 1543,
      user: 'Администратор',
      password: '',
      connectTimeoutSeconds: 3,
    });

    assert.strictEqual(config.host, 'localhost');
    assert.strictEqual(config.port, 1543);
    assert.strictEqual(config.username, 'Администратор');
    assert.strictEqual(config.password, '');
    assert.strictEqual(config.readyTimeout, 3000);
  });

  test('читает приватный ключ из файла настроек', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-agent-key-'));
    const keyPath = path.join(dir, 'id_rsa');
    fs.writeFileSync(keyPath, 'test-key', 'utf-8');

    const config = buildSshConnectConfig({
      host: '127.0.0.1',
      port: 1543,
      user: 'admin',
      privateKeyPath: keyPath,
    });

    assert.strictEqual(config.privateKey, 'test-key');
  });

  test('выполняет команду через интерактивный shell и читает JSON-ответ', async () => {
    const fake = new FakeSshClient();
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);
    const messages: string[] = [];

    const result = await transport.execute('config dump-config-to-files --dir=workspace/test', {
      onMessage: (message) => {
        if (message.message) {
          messages.push(message.message);
        }
      },
    });

    assert.deepStrictEqual(fake.channel.writes, ['config dump-config-to-files --dir=workspace/test\n']);
    assert.deepStrictEqual(messages, ['diagnostic', 'step', 'ok']);
    assert.strictEqual(result.messages.at(-1)?.type, 'success');
  });

  test('отвечает на интерактивный вопрос агента', async () => {
    const fake = new FakeSshClient();
    fake.channel.replyMode = 'question';
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    const result = await transport.execute('config load-config-from-files --dir=workspace/test', {
      onQuestion: () => Promise.resolve('yes'),
    });

    assert.deepStrictEqual(fake.channel.writes, ['config load-config-from-files --dir=workspace/test\n', 'yes\n']);
    assert.strictEqual(result.messages.at(-1)?.type, 'success');
  });

  test('возвращает ошибку агента как rejected promise', async () => {
    const fake = new FakeSshClient();
    fake.channel.replyMode = 'error';
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    await assert.rejects(
      transport.execute('config load-config-from-files --dir=workspace/test'),
      /Ошибка загрузки/
    );
  });

  test('после ошибки выполняет следующую команду в той же сессии', async () => {
    const fake = new FakeSshClient();
    fake.channel.replyMode = 'error-once';
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    await assert.rejects(
      transport.execute('config load-config-from-files --dir=workspace/test'),
      /Ошибка загрузки/
    );
    const result = await transport.execute('config update-db-cfg');

    assert.deepStrictEqual(fake.channel.writes, [
      'config load-config-from-files --dir=workspace/test\n',
      'config update-db-cfg\n',
    ]);
    assert.strictEqual(result.messages.at(-1)?.type, 'success');
  });

  test('завершает выполнение при закрытии SSH-канала', async () => {
    const fake = new FakeSshClient();
    fake.channel.replyMode = 'close';
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    await assert.rejects(
      transport.execute('config dump-config-to-files --dir=workspace/test'),
      /SSH-соединение с агентом закрыто с кодом 255/
    );
  });

  test('закрывает агент командой shutdown', async () => {
    const fake = new FakeSshClient();
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);
    await transport.connect();

    await transport.dispose();

    assert.ok(fake.channel.writes.includes('common shutdown\n'));
    assert.strictEqual(fake.channel.ended, true);
    assert.strictEqual(fake.ended, true);
  });

  test('сбрасывает SSH-сессию без остановки агента', async () => {
    const fake = new FakeSshClient();
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);
    await transport.connect();

    await transport.reset();

    assert.ok(!fake.channel.writes.includes('common shutdown\n'));
    assert.strictEqual(fake.channel.ended, true);
    assert.strictEqual(fake.ended, true);
  });

  test('пробрасывает ошибку открытия shell-канала', async () => {
    const fake = new FakeSshClient();
    fake.shellError = new Error('shell denied');
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    await assert.rejects(transport.connect(), /shell denied/);
  });

  // Волна 2 (M7, регресс): если hooks.onQuestion возвращает отклонённый promise,
  // execute() не должен зависать навечно — ошибка обязана долететь до вызывающего
  // кода, а подписки на output (messages/stderr/error/close) должны быть сняты
  // (проверяем через второй вызов execute на том же транспорте: очередь не должна
  // оставаться заблокированной старыми слушателями).
  test('reject из hooks.onQuestion не теряется и не подвешивает execute', async () => {
    const fake = new FakeSshClient();
    fake.channel.replyMode = 'question';
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    await assert.rejects(
      transport.execute('config load-config-from-files --dir=workspace/test', {
        onQuestion: () => Promise.reject(new Error('boom')),
      }),
      /boom/
    );

    // Очередь команд не должна быть заблокирована зависшим предыдущим вызовом —
    // следующая команда в той же сессии обязана выполниться штатно.
    fake.channel.replyMode = 'success';
    const result = await transport.execute('config update-db-cfg');
    assert.strictEqual(result.messages.at(-1)?.type, 'success');
  });

  test('ошибка содержит команду и финальное сообщение конфигуратора', async () => {
    const fake = new FakeSshClient();
    fake.channel.replyMode = 'empty-unknown';
    const transport = new ProcessDesignerAgentTransport(baseOptions(), () => fake);

    const command = 'config load-config-from-files --dir=workspace/test --partial';
    let captured: unknown;
    try {
      await transport.execute(command);
    } catch (error) {
      captured = error;
    }

    assert.ok(captured instanceof AgentCommandError, 'ожидается AgentCommandError');
    assert.strictEqual(captured.command, command);
    const finalMessage = captured.finalMessage;
    assert.ok(finalMessage, 'финальное сообщение должно быть установлено');
    assert.strictEqual(isEmptyUnknownAgentMessage(finalMessage), true);
  });
});

function baseOptions() {
  return {
    host: '127.0.0.1',
    port: 1543,
    user: 'Администратор',
    password: '',
    connectTimeoutSeconds: 1,
  };
}

type FakeReplyMode = 'success' | 'question' | 'error' | 'error-once' | 'close' | 'empty-unknown';

class FakeSshClient extends EventEmitter implements DesignerAgentSshClient {
  readonly channel = new FakeChannel();
  connectedConfig: ConnectConfig | undefined;
  shellError: Error | undefined;
  ended = false;

  shell(windows: false, callback: (error: Error | undefined, channel: ClientChannel) => void): void {
    assert.strictEqual(windows, false);
    queueMicrotask(() => callback(this.shellError, this.channel.asClientChannel()));
  }

  connect(config: ConnectConfig): void {
    this.connectedConfig = config;
    queueMicrotask(() => this.emit('ready'));
  }

  end(): void {
    this.ended = true;
  }
}

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly writes: string[] = [];
  replyMode: FakeReplyMode = 'success';
  ended = false;
  private questionAsked = false;

  write(text: string): boolean {
    this.writes.push(text);
    queueMicrotask(() => this.respond(text));
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  asClientChannel(): ClientChannel {
    return this as unknown as ClientChannel;
  }

  private respond(text: string): void {
    if (text === 'common shutdown\n') {
      return;
    }
    if (this.replyMode === 'close') {
      this.emit('close');
      return;
    }
    if (this.replyMode === 'error') {
      this.emit('data', Buffer.from('[{"type":"error","message":"Ошибка загрузки"}]'));
      return;
    }
    if (this.replyMode === 'empty-unknown') {
      this.emit('data', Buffer.from('[{"type":"error","body":[],"error-type":"UnknownError"}]'));
      return;
    }
    if (this.replyMode === 'error-once') {
      this.replyMode = 'success';
      this.emit('data', Buffer.from('[{"type":"error","message":"Ошибка загрузки"}]'));
      return;
    }
    if (this.replyMode === 'question' && !this.questionAsked) {
      this.questionAsked = true;
      this.emit('data', Buffer.from('[{"type":"question","message":"Продолжить?"}]'));
      return;
    }
    this.stderr.emit('data', Buffer.from('diagnostic\n'));
    this.emit('data', Buffer.from('[{"type":"log","message":"step"},{"type":"success","message":"ok"}]'));
  }
}
