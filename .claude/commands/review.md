---
description: Ручной запуск агента reviewer на текущих изменениях. Проверка соответствия ТЗ, конвенциям, SOLID, best-practices, sanity-чеки. Вердикт APPROVE / RETURN.
allowed-tools: Task, Read, Bash
---

Запусти субагента `reviewer` (`.claude/agents/reviewer.md`) на текущих изменениях.

Порядок:
1. Собери, что изменено (`git status --short`, `git diff`).
2. Делегируй в субагента `reviewer` через Task: read-only проверка соответствия ТЗ, «Инварианту изменений» и «Запретам и анти-паттернам» из `CLAUDE.md`, SOLID, `docs/vscode-extension-best-practices.md`. Ревьюер сам запускает sanity-чеки (`npm run compile`, `npm run lint`, rg-проверки).
3. Верни вердикт: **APPROVE** / **RETURN → developer** (дефекты реализации/стиля/SOLID/покрытия, с замечаниями `файл:строка — что — чем чревато`) / **RETURN → architect** (расхождение с ТЗ или архитектурный дефект).

Ревьюер выполняется всегда, в том числе после мелких правок.
