import { spawn, type ChildProcess } from 'child_process';
import { resolveV8ExecutablePath } from '../process';

export interface DesignerAgentInfoBaseConnection {
  readonly infoBasePath: string;
  readonly infoBaseServer?: string;
  readonly infoBaseRef?: string;
  readonly v8Path: string;
}

export interface DesignerAgentProcessOptions {
  readonly connection: DesignerAgentInfoBaseConnection;
  readonly visible?: boolean;
  readonly agentPort?: number;
  readonly agentListenAddress?: string;
  readonly agentBaseDir?: string;
  readonly agentModeArgs?: readonly string[];
  readonly cwd?: string;
  readonly onStdout?: (text: string) => void;
  readonly onStderr?: (text: string) => void;
  readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class DesignerAgentProcess {
  private child: ChildProcess | undefined;
  private exited = false;
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;

  start(options: DesignerAgentProcessOptions): void {
    if (this.child && !this.child.killed) {
      return;
    }

    this.exited = false;
    this.exitCode = null;
    this.exitSignal = null;
    const args = buildDesignerAgentArgs(options);
    this.child = spawn(resolveV8ExecutablePath(options.connection.v8Path), args, {
      cwd: options.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (chunk: Buffer) => options.onStdout?.(chunk.toString('utf-8').trim()));
    this.child.stderr?.on('data', (chunk: Buffer) => options.onStderr?.(chunk.toString('utf-8').trim()));
    this.child.on('exit', (code, signal) => {
      this.exited = true;
      this.exitCode = code;
      this.exitSignal = signal;
      options.onExit?.(code, signal);
    });
    this.child.unref();
  }

  stop(): void {
    this.child?.kill();
    this.child = undefined;
  }

  hasExited(): boolean {
    return this.exited;
  }

  getExitDescription(): string {
    if (!this.exited) {
      return 'процесс ещё работает';
    }
    return `код=${String(this.exitCode ?? '-')}, сигнал=${String(this.exitSignal ?? '-')}`;
  }
}

export function buildDesignerAgentArgs(options: DesignerAgentProcessOptions): string[] {
  const args = ['DESIGNER'];
  if (options.connection.infoBaseServer && options.connection.infoBaseRef) {
    args.push('/S', `${options.connection.infoBaseServer}/${options.connection.infoBaseRef}`);
  } else {
    args.push('/F', options.connection.infoBasePath);
  }

  args.push('/AgentMode');
  args.push(...buildDesignerAgentModeArgs(options));
  if (options.visible) {
    args.push('/Visible');
  }
  return args;
}

export function buildDesignerAgentModeArgs(options: DesignerAgentProcessOptions): string[] {
  const userArgs = [...(options.agentModeArgs ?? [])];
  const args: string[] = [];
  appendSwitchWithValue(args, userArgs, '/AgentPort', options.agentPort === undefined ? undefined : String(options.agentPort));
  appendSwitchWithValue(args, userArgs, '/AgentListenAddress', options.agentListenAddress);
  appendAgentHostKeyArgs(args, userArgs);
  appendSwitchWithValue(args, userArgs, '/AgentBaseDir', options.agentBaseDir);
  args.push(...userArgs);
  return args;
}

function appendSwitchWithValue(
  result: string[],
  userArgs: readonly string[],
  switchName: string,
  value: string | undefined
): void {
  if (!value || hasAgentSwitch(userArgs, switchName)) {
    return;
  }
  result.push(switchName, value);
}

function appendAgentHostKeyArgs(result: string[], userArgs: readonly string[]): void {
  if (hasAgentSwitch(userArgs, '/AgentSSHHostKey') || hasAgentSwitch(userArgs, '/AgentSSHHostKeyAuto')) {
    return;
  }
  result.push('/AgentSSHHostKeyAuto');
}

function hasAgentSwitch(args: readonly string[], switchName: string): boolean {
  const normalizedSwitch = normalizeAgentSwitch(switchName);
  return args.some((arg) => normalizeAgentSwitch(arg) === normalizedSwitch);
}

function normalizeAgentSwitch(value: string): string {
  const withoutValue = value.split('=', 1)[0] ?? value;
  return withoutValue.replace(/^-+|^\/+/, '').toLowerCase();
}
