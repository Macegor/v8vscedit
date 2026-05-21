import type { DesignerAgentTransport, DesignerAgentTransportFactory, ResettableDesignerAgentTransportFactory } from './AgentTransport';

export interface DesignerAgentSessionManagerOptions {
  readonly notifyProgressInterval?: number;
}

export class DesignerAgentSessionManager implements ResettableDesignerAgentTransportFactory {
  private readonly sessions = new Map<string, Promise<DesignerAgentTransport>>();

  constructor(
    private readonly innerFactory: DesignerAgentTransportFactory,
    private readonly options: DesignerAgentSessionManagerOptions = {}
  ) {}

  async create(sessionKey: string): Promise<DesignerAgentTransport> {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = this.createConfiguredSession(sessionKey).catch((error: unknown) => {
        if (this.sessions.get(sessionKey) === session) {
          this.sessions.delete(sessionKey);
        }
        throw error;
      });
      this.sessions.set(sessionKey, session);
    }
    return session;
  }

  async disposeAll(): Promise<void> {
    const sessions = await Promise.all([...this.sessions.values()]);
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.dispose()));
  }

  async reset(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      return;
    }
    this.sessions.delete(sessionKey);
    const transport = await session;
    if (transport.reset) {
      await transport.reset();
    } else {
      await transport.dispose();
    }
  }

  private async createConfiguredSession(sessionKey: string): Promise<DesignerAgentTransport> {
    const transport = await this.innerFactory.create(sessionKey);
    await transport.execute(
      [
        'options set',
        '--output-format=json',
        '--show-prompt=no',
        '--notify-progress=yes',
        `--notify-progress-interval=${String(this.options.notifyProgressInterval ?? 0.5)}`,
      ].join(' ')
    );
    return transport;
  }
}
