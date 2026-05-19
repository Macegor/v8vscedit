import type { DesignerAgentTransport, DesignerAgentTransportFactory } from './AgentTransport';

export interface DesignerAgentSessionManagerOptions {
  readonly notifyProgressInterval?: number;
}

export class DesignerAgentSessionManager implements DesignerAgentTransportFactory {
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
