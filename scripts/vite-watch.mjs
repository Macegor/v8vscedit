import { spawn } from 'node:child_process';

/* global console, process */

const commands = [
  ['npm', ['run', 'watch:node']],
  ['npm', ['run', 'watch:webview']],
];

let builtCount = 0;

/**
 * Признак того, что метка "initial build complete" уже выведена.
 * Используется, чтобы не выводить её повторно при последующих пересборках.
 */
let initialComplete = false;

/**
 * Обработчик завершения первой сборки одного из процессов.
 * Когда оба процесса завершили первую сборку, выводит финальную метку.
 */
function onChildBuilt() {
  builtCount += 1;
  if (builtCount === commands.length && !initialComplete) {
    initialComplete = true;
    console.log('[watch] initial build complete');
  }
}

console.log('[watch] starting Vite watchers');

const children = commands.map(([command, args]) => {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });

  /** Накопленный вывод для поиска маркера завершения сборки. */
  let buffer = '';

  function makeHandler(dest) {
    return (chunk) => {
      const text = chunk.toString();

      if (!initialComplete) {
        buffer += text;

        // Отслеживаем первую успешную сборку по характерному маркеру Vite:
        //   "built in <N>ms" (в watch-режиме Vite 8 — без ✓)
        if (/built\s+in\s+\d+\s*ms/.test(buffer)) {
          buffer = '';
          onChildBuilt();
        }
      }

      dest.write(text);
    };
  }

  child.stdout.on('data', makeHandler(process.stdout));
  child.stderr.on('data', makeHandler(process.stderr));

  return child;
});

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
