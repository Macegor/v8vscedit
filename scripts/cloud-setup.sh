#!/usr/bin/env bash
# Подготовка окружения для Claude Code Cloud и любого headless-CI.
#
# Мотивация вынести это в репозиторий, а не держать в UI облака: `npm test` здесь запускает
# @vscode/test-electron, то есть НАСТОЯЩИЙ VS Code (Electron), а не headless-Node. Без виртуального
# X-дисплея он падает ещё до старта тестов. Такой нюанс легко теряется при переносе настройки между
# окружениями — поэтому он версионируется вместе с кодом.
#
# В Claude Code Cloud в поле Setup script достаточно одной строки:
#   bash scripts/cloud-setup.sh

set -euo pipefail

echo "==> Установка зависимостей (npm ci по package-lock.json)"
npm ci

# Electron не запускается без X-сервера и набора системных библиотек. Ставим их только если
# xvfb-run отсутствует: повторный запуск setup-скрипта не должен дёргать apt впустую.
if command -v xvfb-run >/dev/null 2>&1; then
  echo "==> xvfb-run уже доступен, установка системных зависимостей пропущена"
elif command -v apt-get >/dev/null 2>&1; then
  echo "==> Установка X-окружения и библиотек Electron"
  sudo apt-get update
  sudo apt-get install -y \
    xvfb \
    libgbm1 \
    libnss3 \
    libxkbfile1 \
    libgtk-3-0 \
    libasound2t64 || sudo apt-get install -y libasound2
else
  echo "==> apt-get недоступен: пропускаю установку X-окружения." >&2
  echo "    Если в этом окружении нет дисплея, 'npm test' работать не будет." >&2
fi

# Прогрев сборки. pretest всё равно выполнит это при первом npm test, но заранее собранные
# dist/ и out/ убирают многоминутную паузу на первой же итерации агента.
echo "==> Прогрев сборки: typecheck + vite + компиляция тестов"
npm run typecheck
npm run build:node
npm run build:webview
npm run test:compile

cat <<'HINT'

==> Готово.

Запуск тестов в headless-окружении — через виртуальный дисплей:

    xvfb-run -a npm test

Прогон под конкретной версией VS Code:

    VSCODE_TEST_VERSION=1.85.0 xvfb-run -a npm test

Если исходящая сеть ограничена allowlist'ом, для скачивания VS Code нужен доступ к
update.code.visualstudio.com и vscode-cdn.azureedge.net. Команды, не требующие сети и дисплея
('npm run compile', 'npm run lint', 'npm run build'), работают в любом случае.
HINT
