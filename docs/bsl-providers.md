# Провайдеры языка BSL

Детали реализации каждого из шести языковых провайдеров. Все провайдеры принимают `BslParserService` в конструктор и вызывают `parse(document)` для получения AST.

Общий контекст — [bsl-language-support.md](./bsl-language-support.md).

---

## SemanticTokensProvider

Файл: `src/language/providers/SemanticTokensProvider.ts`

Полностью заменяет TextMate-грамматику для открытых документов — нет мерцания при загрузке WASM.

### Типы токенов (BSL_TOKEN_TYPES)

```
comment, string, keyword, number, operator,
function, method, variable, parameter, property,
class, annotation, preprocessor
```

Тип модификатора — один: `declaration`.

### Алгоритм walkNode()

Рекурсивный обход AST с `emitted: Set<number>` для дедупликации по `node.id`.

**Листовые узлы** — эмитируются и рекурсия останавливается:

| Тип AST-узла | Токен VSCode |
|---|---|
| `line_comment` | `comment` |
| `string` | `string` |
| `string_content` внутри `multiline_string` | `string` (каждый отдельно) |
| `number`, `date` | `number` |
| Любой из `KEYWORD_TYPES` (35 типов) | `keyword` |
| Любой из `PREPROC_TYPES` | `preprocessor` |
| `annotation` | `annotation` |
| `operator` | `operator` |
| `property` | `property` |
| `identifier` (не захваченный выше) | `variable` |

**Структурные узлы** — именуют поля, затем рекурсируют в дочерние:

| Тип AST-узла | Именованное поле | Токен |
|---|---|---|
| `procedure_definition` / `function_definition` | `name` | `function` + `declaration` |
| `method_call` | `name` | `method` |
| `parameter` | `name` | `parameter` + `declaration` |
| `var_definition` / `var_statement` | `var_name` (множество) | `variable` + `declaration` |
| `new_expression` | `type` | `class` |

### Многострочные строки

`multiline_string` в tree-sitter-bsl содержит дочерние `string_content` узлы — каждый из них эмитируется отдельно, так как VS Code Semantic Tokens не поддерживают многострочные диапазоны.

---

## DocumentSymbolProvider

Файл: `src/language/providers/DocumentSymbolProvider.ts`

Отображает процедуры и функции в панели **Outline** и **хлебных крошках** редактора.

### Алгоритм extractSymbols()

Проходит по `root.namedChildren` (только верхний уровень):
1. Отбирает `procedure_definition` и `function_definition`
2. Для каждой функции извлекает `name` (поле `name`) → `nameRange`
3. Проверяет предыдущий sibling — если `annotation`, использует его текст как `detail`
4. Строит `DocumentSymbol` с `SymbolKind.Function`
5. Добавляет дочерние символы — локальные переменные из `var_statement` / `var_definition`

---

## FoldingRangeProvider

Файл: `src/language/providers/FoldingRangeProvider.ts`

Два прохода по AST:

### collectBlockRanges() — структурные блоки

Рекурсивный обход, добавляет `FoldingRange` для узлов из `BLOCK_TYPES`:

```
procedure_definition, function_definition, try_statement,
if_statement, while_statement, for_statement, for_each_statement
```

### collectRegionRanges() — препроцессорные области

Стековый алгоритм для пар `#Область` / `#КонецОбласти`:
- При `#область` или `#region` (case-insensitive) — пушит строку начала в стек
- При `#конецобласти` или `#endregion` — попит из стека и создаёт `FoldingRange`

Поддерживает вложенные области.

---

## CompletionProvider

Файл: `src/language/providers/CompletionProvider.ts`

Триггеры: `&`, `#`. Также активируется при обычном вводе.

### Режим `&` — директивы компиляции

20 вариантов аннотаций (двуязычные):
`&НаКлиенте`, `&AtClient`, `&НаСервере`, `&AtServer`, `&Перед`, `&Before`, `&После`, `&After`, `&Вместо`, `&Instead`, ...

### Режим `#` — директивы препроцессора

14 вариантов (двуязычные):
`#Область`, `#Region`, `#КонецОбласти`, `#EndRegion`, `#Если`, `#If`, `#Вставка`, `#Insert`, `#Удаление`, `#Delete`, ...

`insertText` = значение без символа `#` (символ уже введён как триггер).

### Обычный ввод — три источника

**1. Ключевые слова BSL** — 32 слова (двуязычные): `Если`, `If`, `Тогда`, `Then`, ...

**2. Локальные символы из AST** — `extractLocalSymbols(document)`:
- `procedure_definition` / `function_definition` → `CompletionItemKind.Function` с деталью `Процедура (param1, param2)`
- `var_definition` / `var_statement` / `var_name` → `CompletionItemKind.Variable`

**3. Объекты метаданных** — `buildMetaItems()` с кэшем `metaCache: Map<rootPath, items[]>`:
- Читает `Configuration.xml` каждой конфигурации из `getEntries()`
- Для каждого типа из `META_PREFIXES` (18 типов) ищет `<TypeName>...</TypeName>` через регулярное выражение
- Генерирует два варианта: `Справочники.Имя` (RU) и `Catalogs.Имя` (EN)

**META_PREFIXES** — 18 типов: `Catalog`, `Document`, `Enum`, `InformationRegister`, `AccumulationRegister`, `AccountingRegister`, `CalculationRegister`, `Report`, `DataProcessor`, `BusinessProcess`, `Task`, `ExchangePlan`, `ChartOfCharacteristicTypes`, `ChartOfAccounts`, `ChartOfCalculationTypes`, `DocumentJournal`, `Constant`, `CommonModule`.

---

## HoverProvider

Файл: `src/language/providers/HoverProvider.ts`

Показывает сигнатуру процедуры/функции при наведении курсора на её имя.

### Алгоритм

1. `getWordRangeAtPosition` с паттерном `[\wа-яА-ЯёЁ_]+` — извлекает слово под курсором
2. Ищет в `root.namedChildren` процедуру/функцию с таким именем (case-insensitive) через `findDefinition()`
3. Строит `MarkdownString` с `appendCodeblock(..., 'bsl')`:
   - `Процедура/Функция Имя(Знач Параметр1 = Дефолт, Параметр2)`
   - Если предыдущий sibling — `annotation`, добавляет его текст в конце блока

---

## DefinitionProvider

Файл: `src/language/providers/DefinitionProvider.ts`

Переход к определению процедуры/функции (F12 / Ctrl+Click).

### Трёхступенчатый поиск

1. **Текущий документ** — `findInDocument(document, word)` → обходит `root.namedChildren`
2. **Кэш** — `cache: Map<name.toLowerCase(), Location>` — результаты предыдущих поисков по воркспейсу
3. **Все BSL-файлы воркспейса** — `vscode.workspace.findFiles('**/*.bsl', '**/node_modules/**')`, для каждого файла вызывает `findInDocument`

При нахождении через файловый поиск результат помещается в кэш.

### Инвалидация кэша

`FileSystemWatcher` на `**/*.bsl` — при создании, изменении или удалении любого BSL-файла кэш полностью очищается.

Поиск ведётся только по `procedure_definition` и `function_definition` — `namedChildren` корня AST (не рекурсивно).
