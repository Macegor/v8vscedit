import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { Logger } from '../../infra/support/Logger';
import {
  type AiMcpProfile,
  type AiMcpSettings,
  buildBslAnalyzerMcpArgs,
  buildBslAnalyzerMcpEnv,
  getEnabledBslAnalyzerProfiles,
} from '../../infra/ai/AiMcpConfiguration';

export interface BslAnalyzerMcpProfileStatus {
  readonly profile: AiMcpProfile;
  readonly enabled: boolean;
  readonly running: boolean;
  readonly pid: number | null;
  readonly commandLine: string;
  readonly lastError: string | null;
}

export interface BslAnalyzerMcpStatus {
  readonly profiles: readonly BslAnalyzerMcpProfileStatus[];
}

interface RunningProcess {
  readonly profile: AiMcpProfile;
  readonly child: ChildProcessWithoutNullStreams;
  readonly commandLine: string;
  lastError: string | null;
}

export class BslAnalyzerMcpService {
  private readonly processes = new Map<AiMcpProfile, RunningProcess>();

  constructor(
    private readonly logger: Logger,
    private readonly ensureExecutable: () => Promise<boolean>,
    private readonly getExecutablePath: () => string
  ) {}

  getStatus(settings: AiMcpSettings): BslAnalyzerMcpStatus {
    const enabled = new Set(getEnabledBslAnalyzerProfiles(settings));
    return {
      profiles: (['reference', 'workspace'] as const).map((profile) => {
        const args = buildBslAnalyzerMcpArgs(profile, settings);
        const running = this.processes.get(profile);
        return {
          profile,
          enabled: enabled.has(profile),
          running: Boolean(running),
          pid: running?.child.pid ?? null,
          commandLine: running?.commandLine ?? `${this.getExecutablePath()} ${args.join(' ')}`,
          lastError: running?.lastError ?? null,
        };
      }),
    };
  }

  async applyAutoStart(settings: AiMcpSettings): Promise<void> {
    if (!settings.bslAnalyzerAutoStart) {
      await this.stopAll();
      return;
    }
    await this.startEnabled(settings);
  }

  async startEnabled(settings: AiMcpSettings): Promise<void> {
    const enabledProfiles = getEnabledBslAnalyzerProfiles(settings);
    for (const profile of enabledProfiles) {
      await this.startProfile(profile, settings);
    }
    for (const profile of ['reference', 'workspace'] as const) {
      if (!enabledProfiles.includes(profile)) {
        await this.stopProfile(profile);
      }
    }
  }

  async startProfile(profile: AiMcpProfile, settings: AiMcpSettings): Promise<void> {
    if (this.processes.has(profile)) {
      return;
    }

    const ready = await this.ensureExecutable();
    if (!ready) {
      throw new Error('bsl-analyzer не установлен или недоступен.');
    }

    const command = this.getExecutablePath();
    const args = buildBslAnalyzerMcpArgs(profile, settings);
    const commandLine = `${command} ${args.join(' ')}`;
    const child = spawn(command, args, {
      cwd: settings.bslAnalyzerWorkspaceSourceDir,
      shell: false,
      env: buildBslAnalyzerMcpEnv(settings, process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const item: RunningProcess = {
      profile,
      child,
      commandLine,
      lastError: null,
    };
    this.processes.set(profile, item);
    this.logger.appendLine(`[bsl-mcp] Запуск ${profile}: ${commandLine}`);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        this.logger.appendLine(`[bsl-mcp][${profile}][stdout] ${text}`);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        item.lastError = text;
        this.logger.appendLine(`[bsl-mcp][${profile}][stderr] ${text}`);
      }
    });
    child.once('error', (error) => {
      item.lastError = error.message;
      this.processes.delete(profile);
      this.logger.appendLine(`[bsl-mcp][${profile}][error] ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      this.processes.delete(profile);
      const suffix = code === null ? `signal=${signal ?? '-'}` : `code=${String(code)}`;
      this.logger.appendLine(`[bsl-mcp] ${profile} завершён: ${suffix}`);
    });
  }

  async stopProfile(profile: AiMcpProfile): Promise<void> {
    const running = this.processes.get(profile);
    if (!running) {
      return;
    }

    this.processes.delete(profile);
    this.logger.appendLine(`[bsl-mcp] Остановка ${profile}, pid=${String(running.child.pid ?? '-')}`);
    running.child.stdin.end();
    running.child.kill('SIGTERM');
    await waitForExit(running.child, 3_000);
  }

  async stopAll(): Promise<void> {
    await Promise.all((['reference', 'workspace'] as const).map((profile) => this.stopProfile(profile)));
  }

  dispose(): void {
    void this.stopAll();
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
      finish();
    }, timeoutMs);
    child.once('exit', finish);
  });
}
