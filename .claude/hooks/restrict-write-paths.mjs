// PreToolUse-хук конвейера: запрещает субагенту писать за пределы разрешённых ему каталогов.
//
// Мотивация: поле `tools:` в заголовке агента умеет только выдать или отнять инструмент целиком,
// но не сузить его по путям. Ограничения вида «test-writer правит только src/test/» и «documenter
// правит только docs/» до этого держались исключительно на тексте промпта — то есть на согласии
// модели их соблюдать. Хук превращает их в механический барьер: даже если агент решит тронуть
// production-код, вызов Edit/Write будет отклонён.
//
// Использование (в заголовке агента, см. .claude/agents/test-writer.md):
//   hooks:
//     PreToolUse:
//       - matcher: "Edit|Write"
//         hooks:
//           - type: command
//             command: node
//             args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/restrict-write-paths.mjs", "src/test"]
//
// Аргументы — разрешённые каталоги относительно корня проекта. Написан на Node, а не на bash,
// потому что часть команды работает под Windows, где bash-хук не гарантирован, а Node для этого
// репозитория обязателен по определению.

/* global console, process */
import { isAbsolute, relative, resolve, sep } from 'node:path';

const allowedDirs = process.argv.slice(2);

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// Любая неожиданность (пустой stdin, чужой формат, отсутствие пути) — это НЕ повод блокировать
// работу: хук пропускает вызов и оставляет решение штатному механизму разрешений.
function allow() {
  process.exit(0);
}

let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
}

let input;
try {
  input = JSON.parse(raw);
} catch {
  allow();
}

const toolInput = input?.tool_input ?? {};
const target = toolInput.file_path ?? toolInput.notebook_path;

if (!target || allowedDirs.length === 0) {
  allow();
}

const root = input?.cwd ?? process.cwd();
const absoluteTarget = resolve(root, target);

const isInsideAllowed = allowedDirs.some((entry) => {
  const base = resolve(root, entry);
  const rel = relative(base, absoluteTarget);
  // Пустой rel — цель совпала с самим аргументом: так разрешается точечный файл (напр. CLAUDE.md).
  // `..` в начале — выход за пределы каталога; абсолютный rel — другой том (Windows).
  if (isAbsolute(rel)) {
    return false;
  }
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`));
});

if (!isInsideAllowed) {
  deny(
    `Этому агенту разрешена запись только в: ${allowedDirs.join(', ')}. ` +
      `Путь «${target}» вне этих каталогов. Если правка действительно нужна — верни задачу ` +
      `оркестратору, а не обходи ограничение.`,
  );
}

allow();
