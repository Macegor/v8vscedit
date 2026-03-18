# Языковая поддержка BSL

## Назначение

Обеспечивает полноценную языковую поддержку для файлов `.bsl` и `.os` в VSCode: семантическую подсветку синтаксиса, навигацию, автодополнение и диагностику ошибок на основе парсера [tree-sitter-bsl](https://github.com/nicotine-plus/tree-sitter-bsl).

Связанные модули: `BslParserService.ts`, `BslLanguageRegistrar.ts`, `BslDiagnosticsProvider.ts`, `providers/`.

## Парсер (BslParserService)

Синглтон-сервис на базе `web-tree-sitter`. Управляет жизненным циклом WASM-модуля и кэшем синтаксических деревьев.

### Инициализация

`ensureInit()` — ленивая инициализация с кэшированным промисом:

```typescript
ensureInit(): Promise<void> {
  if (!this.initPromise) {
    this.initPromise = this.doInit();
  }
  return this.initPromise;
}
```

Повторные вызовы возвращают тот же промис — инициализация происходит ровно один раз. В `extension.ts` `ensureInit()` вызывается **немедленно при активации** расширения (до открытия первого файла), чтобы WASM был загружен заранее.

`doInit()` загружает два WASM-модуля из `dist/`:
1. `tree-sitter.wasm` — рантайм парсера
2. `tree-sitter-bsl.wasm` — грамматика BSL

WASM-файлы копируются в `dist/` через `CopyWebpackPlugin` во время сборки.

### Инкрементальный парсинг

`parse(document)` передаёт предыдущее дерево как `previous` в `parser.parse()`:

```typescript
const previous = this.trees.get(uri) ?? undefined;
const tree = this.parser.parse(document.getText(), previous);
this.trees.set(uri, tree);
```

tree-sitter использует предыдущее дерево для инкрементального обновления — повторный парсинг после небольших изменений выполняется значительно быстрее.

### Кэш и инвалидация

- **`trees: Map<uri, Tree>`** — кэш деревьев по URI документа
- **`invalidate(uri)`** — удаляет дерево из кэша с явным освобождением памяти `tree.delete()`
- **`dispose()`** — освобождает все деревья при деактивации расширения

Инвалидация вызывается при каждом изменении документа (`onDidChangeTextDocument`) и при закрытии (`onDidCloseTextDocument`) — оба обработчика зарегистрированы в `BslLanguageRegistrar`.

## Регистрация провайдеров (BslLanguageRegistrar)

`registerBslLanguage(context, parserService, getEntries)` создаёт и регистрирует все провайдеры. Вызывается **после** `parserService.ensureInit()` — к моменту регистрации WASM уже загружен.

Все провайдеры регистрируются для селектора `{ language: 'bsl', scheme: 'file' }`.

Зарегистрированные провайдеры:

| Провайдер | VSCode API |
|---|---|
| `BslSemanticTokensProvider` | `registerDocumentSemanticTokensProvider` |
| `BslDocumentSymbolProvider` | `registerDocumentSymbolProvider` |
| `BslFoldingRangeProvider` | `registerFoldingRangeProvider` |
| `BslCompletionProvider` | `registerCompletionItemProvider` (триггеры: `&`, `#`) |
| `BslHoverProvider` | `registerHoverProvider` |
| `BslDefinitionProvider` | `registerDefinitionProvider` |
| `BslDiagnosticsProvider` | Управляет своими подписками самостоятельно |

`BslDefinitionProvider` добавляется в `context.subscriptions` напрямую (дополнительно к возврату `registerDefinitionProvider`) — для корректного освобождения внутреннего `FileSystemWatcher`.

## Диагностика (BslDiagnosticsProvider)

Провайдер синтаксических ошибок на основе `ERROR`-узлов tree-sitter.

### Алгоритм

1. При изменении документа запускается **дебаунс 500 мс** через `setTimeout`
2. После дебаунса вызывается `updateDiagnostics(document)` → `parser.parse(document)`
3. `collectErrors(rootNode, ...)` рекурсивно обходит AST в поиске `node.isError === true`
4. При нахождении ERROR-узла **рекурсия внутрь не заходит** — предотвращает каскад ложных ошибок для дочерних токенов
5. Однострочные ERROR-узлы длиной ≤ 1 символ игнорируются (артефакты восстановления парсера)
6. При закрытии документа диагностики очищаются

### Управление дебаунсом

```typescript
private readonly timers = new Map<string, NodeJS.Timeout>();

private scheduleDiagnostics(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const existing = this.timers.get(key);
  if (existing) {
    clearTimeout(existing);   // сброс предыдущего таймера
  }
  const handle = setTimeout(() => this.updateDiagnostics(document), 500);
  this.timers.set(key, handle);
}
```

## Язык BSL (language-configuration.json)

Конфигурация языка BSL:

- Расширения файлов: `.bsl`, `.os`
- Строчный комментарий: `//`
- Автозакрытие: `()`, `[]`, `""`
- Паттерн слова: `[\wа-яА-Я_][\wа-яА-Я_0-9]*` (поддержка кириллицы)
- Увеличение отступа: `Тогда`, `Then`, `Цикл`, `Do`, `Попытка`, `Процедура`, `Функция`
- Уменьшение отступа: `КонецЕсли`, `КонецЦикла`, `Иначе`, `ИначеЕсли` и EN-аналоги

## TextMate-грамматика (syntaxes/bsl.tmLanguage.json)

Резервная (fallback) грамматика — применяется до загрузки WASM. Покрывает базовые конструкции BSL: комментарии `//`, строки `"..."`, аннотации `&`, препроцессор `#`, ключевые слова, константы, числа.

Скоупы намеренно совпадают с `semanticTokenScopes` — не происходит визуального мерцания при переключении с TM- на semantic-подсветку.

## Семантические токены (configurationDefaults)

Дефолтные цвета в `package.json` (совместимы со стилями тёмных тем):

| Тип токена | Цвет | Применение |
|---|---|---|
| `annotation:bsl` | `#C678DD` (фиолетовый) | `&НаКлиенте`, `&Перед`, ... |
| `preprocessor:bsl` | `#A07850` (коричневый) | `#Область`, `#Если`, ... |
| `function:bsl` | `#DCDCAA` (жёлтый) | Имена процедур и функций |
| `parameter:bsl` | `#9CDCFE` (голубой) | Параметры процедур и функций |

## Подробная документация провайдеров

Детали реализации каждого провайдера — в [bsl-providers.md](./bsl-providers.md).
