import type { CliArgs } from '../core/types';
import { importConfiguration } from './importConfiguration';
import { updateConfiguration } from './updateConfiguration';

export async function syncConfigurationPartial(args: CliArgs): Promise<number> {
  const loadExitCode = await importConfiguration({ ...args, Mode: 'Partial' });
  if (loadExitCode !== 0) {
    return loadExitCode;
  }
  return updateConfiguration(args);
}

export async function syncConfigurationFull(args: CliArgs): Promise<number> {
  const loadExitCode = await importConfiguration({ ...args, Mode: 'Full' });
  if (loadExitCode !== 0) {
    return loadExitCode;
  }
  return updateConfiguration(args);
}
