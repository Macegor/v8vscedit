import type { CliArgs } from './types';

export function parseArgs(argv: string[], switches: Set<string>): CliArgs {
  const result: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('-')) {
      throw new Error(`Error: unsupported positional argument "${token}"`);
    }

    const key = token.replace(/^-+/, '');
    if (switches.has(key)) {
      result[key] = true;
      continue;
    }

    const value = argv[i + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`Error: value required for -${key}`);
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

export function getString(args: CliArgs, key: string, fallback = ''): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

export function getRequiredString(args: CliArgs, key: string): string {
  const value = getString(args, key, '');
  if (!value.trim()) {
    throw new Error(`Error: -${key} is required`);
  }
  return value;
}

export function getBool(args: CliArgs, key: string): boolean {
  return args[key] === true;
}
