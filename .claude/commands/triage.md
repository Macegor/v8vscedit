---
description: Только триаж — определить FAST vs FULL трек для задачи по критериям docs/agentic-pipeline.md и объяснить почему. Ничего не меняет, кода не пишет.
argument-hint: [описание задачи]
allowed-tools: Read, Glob, Grep
---

Определи трек для задачи:

$ARGUMENTS

1. Прочитай `docs/agentic-pipeline.md` (раздел «Триаж: FAST vs FULL») и корневой `CLAUDE.md` («Инвариант изменений»).
2. Проверь критерии FULL: правит ли задача центральные контракты (`META_TYPES`, `MetaPathResolver`, `PropertySchema`, ruleset формата), добавляет тип метаданных/слот/тег/схему/MCP-инструмент/команду, меняет контракт webview↔расширение, затрагивает >2–3 файлов или пересекает границы слоёв (domain/infra/ui/lsp/cli).
3. Если да — **FULL-трек** (architect → test-writer → developer → qa-e2e → reviewer → documenter). Если нет — **FAST-трек** (оркестратор реализует сам → qa-e2e → reviewer → documenter). При сомнении — FULL.

Верни: выбранный трек, краткое обоснование по пунктам критериев, какие файлы/слои предположительно затрагиваются, какие агенты будут задействованы. Ничего не редактируй и не запускай.
