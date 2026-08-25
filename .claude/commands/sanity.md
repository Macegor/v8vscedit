---
description: Механические sanity-чеки из CLAUDE.md — compile, lint и 6 rg-проверок архитектурных инвариантов. Без запуска тестов.
allowed-tools: Bash
---

Запусти sanity-чеки из раздела «Sanity-чек после изменений» корневого `CLAUDE.md`. Выполняй ровно эти проверки и сообщай результат каждой:

```bash
npm run compile                                                        # 0 ошибок
npm run lint                                                           # 0 ошибок и предупреждений
rg "typeToFolder\s*:" src                                             # ожидается 0
rg "import .* from 'vscode'" src/domain src/infra                     # ожидается 0
rg "from ['\"].*cli|from ['\"].*/cli" src/domain src/infra            # ожидается 0
rg "require\(|readFileSync" src/domain                                # ожидается 0
rg "FOLDER_MAP|FOLDER_RU" src                                         # ожидается 0
```

Верни сводку: каждая проверка — PASS/FAIL с количеством совпадений. Если что-то не 0 — это нарушение архитектурного инварианта, укажи где. Не исправляй сам — это задача `/review`/разработчика.
