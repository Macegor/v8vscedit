import { spawn } from 'node:child_process';

/* global process */

const commands = [
  ['npm', ['run', 'watch:node']],
  ['npm', ['run', 'watch:webview']],
];

const children = commands.map(([command, args]) =>
  spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
);

function stop() {
  for (const child of children) {
    child.kill('SIGTERM');
  }
}

process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

process.on('SIGTERM', () => {
  stop();
  process.exit(143);
});
