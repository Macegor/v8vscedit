import { EventEmitter } from 'events';
import * as fs from 'fs';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import type { AgentMessage } from '../../domain/agent';
import { getAgentMessageText, isTerminalAgentMessage } from '../../domain/agent';
import { DesignerAgentJsonReader } from './DesignerAgentJsonReader';
import type { AgentCommandHooks, AgentCommandResult, DesignerAgentTransport, DesignerAgentTransportFactory } from './AgentTransport';
import { AgentCommandError } from './AgentTransport';

export interface DesignerAgentSshClient {
  on(event: 'ready' | 'close', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  shell(windows: false, callback: (error: Error | undefined, channel: ClientChannel) => void): void;
  connect(config: ConnectConfig): void;
  end(): void;
}

export interface DesignerAgentConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password?: string;
  readonly privateKeyPath?: string;
  readonly connectTimeoutSeconds?: number;
  readonly connectAttempts?: number;
  readonly connectRetryDelayMs?: number;
}

export class ProcessDesignerAgentTransportFactory implements DesignerAgentTransportFactory {
  constructor(private readonly options: DesignerAgentConnectionOptions) {}

  async create(): Promise<DesignerAgentTransport> {
    const attempts = Math.max(1, this.options.connectAttempts ?? 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const transport = new ProcessDesignerAgentTransport(this.options);
        await transport.connect();
        return transport;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          await delay(this.options.connectRetryDelayMs ?? 1000);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export class ProcessDesignerAgentTransport implements DesignerAgentTransport {
  private client: DesignerAgentSshClient | undefined;
  private channel: ClientChannel | undefined;
  private connectPromise: Promise<void> | undefined;
  private readonly output = new EventEmitter();
  private readonly reader = new DesignerAgentJsonReader();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private closeEmitted = false;

  constructor(
    private readonly options: DesignerAgentConnectionOptions,
    private readonly createClient: () => DesignerAgentSshClient = () => new Client()
  ) {}

  async connect(): Promise<void> {
    if (this.channel) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    // disposed не сбрасываем здесь: после reset()/dispose() сессия считается
    // выброшенной, и команда из очереди не должна реанимировать её через connect().
    if (this.disposed) {
      throw new Error('Сессия агента уже закрыта.');
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const client = this.createClient();
      this.client = client;
      let settled = false;

      const settle = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(error);
          return;
        }
        resolve();
      };

      client.on('ready', () => {
        client.shell(false, (error, channel) => {
          if (error) {
            settle(error);
            return;
          }
          this.closeEmitted = false;
          this.channel = channel;
          channel.on('data', (chunk: Buffer) => this.handleStdout(chunk));
          channel.stderr.on('data', (chunk: Buffer) => this.output.emit('stderr', chunk.toString('utf-8')));
          channel.on('close', () => this.handleClose());
          settle();
        });
      });
      client.on('error', (error) => {
        this.output.emit('error', error);
        settle(error);
      });
      client.on('close', () => this.handleClose());
      client.connect(buildSshConnectConfig(this.options));
    });

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async execute(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult> {
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => this.executeQueued(command, hooks));
    return this.queue as Promise<AgentCommandResult>;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    if (!this.client) {
      return Promise.resolve();
    }
    this.channel?.write('common shutdown\n');
    this.channel?.end();
    this.client.end();
    this.channel = undefined;
    this.client = undefined;
    return Promise.resolve();
  }

  reset(): Promise<void> {
    if (!this.client) {
      return Promise.resolve();
    }
    this.disposed = true;
    this.reader.reset();
    this.channel?.end();
    this.client.end();
    this.channel = undefined;
    this.client = undefined;
    return Promise.resolve();
  }

  private async executeQueued(command: string, hooks?: AgentCommandHooks): Promise<AgentCommandResult> {
    if (this.disposed) {
      throw new Error('Сессия агента уже закрыта.');
    }
    await this.connect();
    const channel = this.requireChannel();
    const messages: AgentMessage[] = [];

    return new Promise<AgentCommandResult>((resolve, reject) => {
      const cleanup = () => {
        this.output.off('messages', onMessages);
        this.output.off('stderr', onStderr);
        this.output.off('error', onError);
        this.output.off('close', onClose);
      };

      const onMessages = (batch: AgentMessage[]) => {
        void this.handleMessages(batch, messages, hooks)
          .then((terminal) => {
            if (!terminal) {
              return;
            }
            cleanup();
            const last = messages.at(-1);
            if (last?.type === 'error' || last?.type === 'canceled') {
              reject(new AgentCommandError(getAgentMessageText(last), command, last));
              return;
            }
            resolve({ messages });
          })
          .catch((error: unknown) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      };

      const onStderr = (text: string) => {
        if (text.trim()) {
          hooks?.onMessage?.({ type: 'log', message: text.trim() });
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onClose = (code: number) => {
        cleanup();
        reject(new Error(`SSH-соединение с агентом закрыто с кодом ${String(code)}.`));
      };

      this.output.on('messages', onMessages);
      this.output.on('stderr', onStderr);
      this.output.on('error', onError);
      this.output.on('close', onClose);
      channel.write(`${command}\n`);
    });
  }

  private async handleMessages(
    batch: AgentMessage[],
    target: AgentMessage[],
    hooks?: AgentCommandHooks
  ): Promise<boolean> {
    let terminal = false;
    for (const message of batch) {
      target.push(message);
      hooks?.onMessage?.(message);
      if (message.type === 'question') {
        const answer = await hooks?.onQuestion?.(message);
        if (answer !== undefined) {
          this.requireChannel().write(`${answer}\n`);
        }
      }
      terminal = isTerminalAgentMessage(message) || terminal;
    }
    return terminal;
  }

  private handleStdout(chunk: Buffer): void {
    for (const batch of this.reader.push(chunk)) {
      this.output.emit('messages', batch);
    }
  }

  private handleClose(): void {
    this.channel = undefined;
    this.client = undefined;
    if (!this.disposed && !this.closeEmitted) {
      this.closeEmitted = true;
      this.output.emit('close', 255);
    }
  }

  private requireChannel(): ClientChannel {
    if (!this.channel) {
      throw new Error('SSH-соединение с агентом не установлено.');
    }
    return this.channel;
  }
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

export function buildSshConnectConfig(options: DesignerAgentConnectionOptions): ConnectConfig {
  const config: ConnectConfig = {
    host: options.host,
    port: options.port,
    username: options.user,
    password: options.password ?? '',
    readyTimeout: (options.connectTimeoutSeconds ?? 10) * 1000,
  };
  if (options.privateKeyPath) {
    config.privateKey = fs.readFileSync(options.privateKeyPath, 'utf-8');
  }
  return config;
}
