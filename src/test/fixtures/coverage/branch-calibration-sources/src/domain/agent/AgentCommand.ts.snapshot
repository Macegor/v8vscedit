export type AgentConfigurationTargetKind = 'cf' | 'cfe';

export interface AgentConfigurationTarget {
  readonly kind: AgentConfigurationTargetKind;
  readonly extensionName?: string;
}

export interface AgentCommandOptions {
  readonly format?: 'hierarchical' | 'plain';
  readonly extensionName?: string;
  readonly allExtensions?: boolean;
  readonly update?: boolean;
  readonly force?: boolean;
  readonly listFile?: string;
  readonly partial?: boolean;
  readonly updateConfigDumpInfo?: boolean;
  readonly noCheck?: boolean;
  readonly threads?: string;
}

export function buildAgentCommand(command: string, options: Record<string, string | boolean | undefined> = {}): string {
  const parts = [command];
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (value === true) {
      parts.push(`--${name}`);
      continue;
    }
    parts.push(`--${name}=${quoteAgentArgument(value)}`);
  }
  return parts.join(' ');
}

export function buildDumpConfigToFilesCommand(dirPath: string, options: AgentCommandOptions = {}): string {
  return buildAgentCommand('config dump-config-to-files', {
    dir: dirPath,
    extension: options.extensionName,
    'all-extensions': options.allExtensions,
    format: options.format ?? 'hierarchical',
    update: options.update,
    force: options.force,
    'list-file': options.listFile,
  });
}

export function buildLoadConfigFromFilesCommand(dirPath: string, options: AgentCommandOptions = {}): string {
  return buildAgentCommand('config load-config-from-files', {
    dir: dirPath,
    extension: options.extensionName,
    'all-extensions': options.allExtensions,
    format: options.format ?? 'hierarchical',
    'list-file': options.listFile,
    partial: options.partial,
    'update-config-dump-info': options.updateConfigDumpInfo,
    'no-check': options.noCheck,
    threads: options.threads,
  });
}

export function buildUpdateDbCfgCommand(options: AgentCommandOptions = {}): string {
  return buildAgentCommand('config update-db-cfg', {
    extension: options.extensionName,
  });
}

export function quoteAgentArgument(value: string): string {
  if (/^[^\s"']+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
