import { CLI_COMMANDS } from './commands';
import { parseArgs } from './core/args';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    printUsage();
    process.exit(1);
  }

  try {
    const handler = CLI_COMMANDS[command];
    if (!handler) {
      console.error(`Error: unknown command "${command}"`);
      printUsage();
      process.exit(1);
    }

    const options = parseArgs(rest, new Set(['AllExtensions', 'DryRun']));
    process.exit(await handler(options));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

function printUsage(): void {
  console.log('Usage: node dist/cli/onec-tools.js <command>');
  console.log('Commands: export-configuration, import-configuration, sync-configuration-partial, sync-configuration-full, update-configuration, import-git-changes, refresh-hash-cache');
  console.log('Aliases: db-dump-xml, db-load-xml, db-load-git, db-update, update-partial, update-full');
}

void main();
