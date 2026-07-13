# Жизненный цикл встроенного MCP-сервера

Документ описывает **не бизнес-контракт MCP-инструментов** (это [mcp-paths.md](./mcp-paths.md) — канон
путей/типов), а инфраструктуру вокруг самого HTTP-сервера: старт, обнаружение конфликта порта,
переиспользование, принудительное закрытие и гарантированное освобождение порта при остановке.
`V8McpServer` (`src/ui/mcp/V8McpServer.ts`) остаётся единственным транспортным фасадом; вся логика
принятия решений вынесена в чистый слой `src/infra/mcp/` (без `vscode`).

## Проблема, которую решает этот слой

1. **Порт не освобождался при остановке.** MCP-клиенты держат долгоживущие SSE-соединения
   (Streamable HTTP). `httpServer.close()` лишь перестаёт принимать новые соединения и ждёт, пока
   существующие завершатся сами — с открытым SSE-потоком это может не произойти никогда, и повторный
   старт (reload окна, переактивация) видит порт как занятый спустя долгое время после `stop()`.
2. **Расширение молча занимало соседний порт.** Старая версия `V8McpServer.start()` при `EADDRINUSE`
   инкрементировала порт и пробовала следующий — агент подключался не туда, куда указывала настройка
   `v8vscedit.mcp.port`, без предупреждения. Ситуация особенно опасна, если порт занят MCP-сервером
   **другого** проекта v8vscedit: агент получил бы доступ к чужой конфигурации 1С.

## Архитектура по слоям

### `infra/mcp/` — чистая логика, без `vscode`

| Модуль | Ответственность |
|---|---|
| `McpServerIdentity.ts` | Форма идентичности `{ product, protocol, pid, projectRoot, version, endpoint }`, публикуемая на `/identity`. `PRODUCT_ID = 'v8vscedit-mcp'`, `IDENTITY_PROTOCOL = 1` (инкрементируется при несовместимом изменении формы). `serializeIdentity`/`parseIdentity` — сериализация и **строгая** валидация: любое несовпадающее поле, неверный тип или не-JSON-объект даёт `undefined`, а не «похоже на наш сервер». |
| `McpStartDecision.ts` | `decideMcpStart(probe, currentProjectRoot) → 'reuse' \| 'conflict-foreign' \| 'conflict-unknown'`. Чужой `product` → `conflict-unknown`; свой `product`, но другой `projectRoot` (после нормализации хвостового разделителя пути) → `conflict-foreign` с занявшим `occupant`; тот же `projectRoot` → `reuse` с его `endpoint`. |
| `McpPortProbe.ts` | Реальный сетевой I/O: `probeIdentity(host, port)` — `GET /identity` с таймаутом, `requestShutdown(host, port)` — `POST /shutdown`, `waitForPortRelease(host, port)` — поллинг реального `bind` до освобождения порта, `reclaimPort(host, port)` = `requestShutdown` → `waitForPortRelease`. Единственная «внешняя система» этого модуля — сам порт ОС, поэтому он законно живёт в `infra/` с `http`/`net`, но без `vscode`. |
| `McpConflictPrompt.ts` | Чистое построение текста/действий диалога конфликта (`buildMcpConflictPrompt`) и разбор выбора пользователя (`resolveMcpConflictAction`) — вынесено из `Container`, чтобы соответствие «тип конфликта → текст/кнопки» проверялось unit-тестом без реального `vscode.window.showWarningMessage`. |
| `McpHost.ts` | `formatHostForUrl(host)` — единственное место, оборачивающее IPv6-адрес в скобки (`::1` → `[::1]`) для authority-части URL и заголовка `Host`. Используется и при построении `endpoint`/`allowedHosts` в `V8McpServer`, и в `McpPortProbe` — если формат разойдётся, собственный зонд получит 403 от своей же DNS-rebinding-защиты. |

### `ui/mcp/V8McpServer.ts` — тонкий транспортный фасад

Хранит `http.Server`, HTTP-роутинг (`/mcp`, `/identity`, `/shutdown`), сессии MCP SDK и
`allowedHosts` (тот же набор, что уже использовался для Host/Origin-защиты MCP-трафика — см.
`isLoopbackRequest`/`isAllowedHostAndOrigin`). Публичный контракт:

```typescript
type McpStartResult =
  | { kind: 'started'; endpoint: string }
  | { kind: 'reuse'; endpoint: string }
  | { kind: 'conflict-foreign'; occupant: McpServerIdentity }
  | { kind: 'conflict-unknown' };

start(options: V8McpServerOptions): Promise<McpStartResult>;
forceRestart(options: V8McpServerOptions): Promise<McpStartResult>;
stop(): Promise<void>;
```

`start()` делает **одну** попытку `bind` preferred-порта (`tryBind`, без цикла инкремента). При
`EADDRINUSE` вызывает `probeIdentity` и `decideMcpStart` и возвращает исход без исключения — решение,
что делать дальше (диалог, рестарт), принимает вызывающий код (`Container`), а не сам сервер.

`adopted` — флаг «сервер лишь переиспользовал чужой (свой же) endpoint и не владеет `http.Server` на
этом порту»: его `stop()` в этом случае — no-op по факту закрытия сокета (не гасит владельца), только
сбрасывает локальное состояние.

### Служебные эндпоинты `/identity` и `/shutdown` — не MCP-инструменты

Оба эндпоинта — часть HTTP-роутинга самого `V8McpServer`, а не MCP-протокола (`/mcp`), и не
регистрируются как MCP-tool. Они проходят **те же** проверки безопасности, что основной трафик:
`isLoopbackRequest` (только `127.0.0.1`/`::1`) и `isAllowedHostAndOrigin` (заголовок `Host` обязан
входить в `allowedHosts`, `Origin`, если задан, — тоже). Без этого любой процесс с доступом к порту
мог бы дистанционно опросить идентичность инстанса или потушить чужой MCP-сервер.

- `GET /identity` — отдаёт `serializeIdentity(...)`, используется только зондом (`probeIdentity`).
- `POST /shutdown` — отвечает `200` немедленно, затем (`setImmediate`) вызывает `stop()`: ответ должен
  уйти клиенту ДО того, как `closeAllConnections()` порвёт HTTP-соединения, иначе сам ответ на
  `/shutdown` не долетит.

## Разрешение конфликта порта при старте (`Container`)

`Container.startMcpServer()` вызывает `mcpServer.start(options)` и передаёт результат в
`handleMcpStartResult`:

- `started` / `reuse` — ничего не показываем; `getStatus()` в обоих случаях `running: true` c реальным
  `endpoint` (для `reuse` — endpoint инстанса-владельца, «adopted»).
- `conflict-foreign` — `buildMcpConflictPrompt` формирует сообщение с `projectRoot` занявшего процесса и
  две кнопки: «Принудительно закрыть и запустить» → `mcpServer.forceRestart(options)` (```reclaimPort```
  → повторный `start`), «Сменить порт» → `workbench.action.openSettings` на `v8vscedit.mcp.port`.
- `conflict-unknown` (порт занят процессом, не отвечающим нашим `/identity`) — только кнопка «Сменить
  порт»; принудительно гасить чужой процесс расширение не пытается.

Ветвление «результат → текст/кнопки диалога» вынесено в чистый `McpConflictPrompt` и покрыто
unit-тестом без extension host; в `Container` остаётся только исполнение выбора через
`vscode.window.showWarningMessage`.

Тот же путь (`start` → `handleMcpStartResult`) используется и при рестарте по смене настройки
`v8vscedit.mcp` (`wireMcpConfigurationWatcher`: `stop()` → `startMcpServer()`), и при ручном запуске из
панели AI (`AiMcpViewProvider` → `startMcpServer(true)` с `force=true`, минуя проверку
`mcp.enabled`).

## Гарантированное освобождение порта при остановке

`V8McpServer.stop()` вызывает `httpServer.closeAllConnections()` **до** `httpServer.close()` —
принудительно рвёт все активные соединения (в том числе долгоживущие SSE), иначе `close()` ждёт их
естественного завершения и порт не освобождается вовремя (метод доступен в Node ≥ 18.2, гарантирован
типами `@types/node` проекта). После этого закрываются все MCP-сессии (`transport.close()` +
`server.close()` для каждой).

`stop()` вызывается из `Container.deactivate()` наравне с остановкой `LspManager` и других сервисов
(`Promise.allSettled([...])`), а сам `V8McpServer` зарегистрирован в `context.subscriptions` —
освобождение порта гарантировано и при штатной деактивации, и при закрытии IDE/перезагрузке окна.

## Известные ограничения

- **`conflict-unknown` не различает «порт занят чем-то живым» от «порт временно в TIME_WAIT».**
  Единственный сигнал — неответ/не-JSON на `GET /identity` за таймаут; расширение в обоих случаях
  предлагает только сменить порт, не пытаясь дождаться и переопросить.
- **Пагинации/ретраев на `probeIdentity` нет** — один запрос с фиксированным таймаутом (1 c). На очень
  медленном локальном порту (нетипично для loopback) это теоретически даёт ложный `conflict-unknown`
  вместо `reuse`/`conflict-foreign`.
- **`forceRestart` не спрашивает подтверждения дважды** — если после `reclaimPort` порт всё ещё занят
  (например, чужой процесс не отвечает на `/shutdown` и умер после истечения `waitForPortRelease`),
  `start()` просто вернёт новый `McpStartResult`, и `handleMcpStartResult` покажет диалог заново;
  бесконечного цикла нет, но пользователю придётся нажать «Принудительно закрыть и запустить» столько
  раз, сколько потребуется портy освободиться.
- Описание настройки `v8vscedit.mcp.port` в `package.json` ("Если порт занят, расширение попробует
  следующие порты") **устарело** после отказа от авто-инкремента — актуальное поведение см. выше
  («Разрешение конфликта порта при старте»); правка самого текста настройки вне области ответственности
  этого документа (правка `package.json` — задача разработчика/архитектора, не документатора).

## Связанные документы

- [Канон путей и типов 1С для MCP-инструментов](./mcp-paths.md) — формат аргументов/путей самих
  MCP-инструментов; к жизненному циклу сервера отношения не имеет.
- [Архитектура расширения](./architecture.md) — место `ui/mcp/`/`infra/mcp/` в общей карте слоёв.
- [Лучшие практики разработки расширений VS Code](./vscode-extension-best-practices.md) — раздел
  «Безопасность»: bind только на loopback + валидация `Host`/`Origin` (пункт закрыт, применяется и к
  `/identity`/`/shutdown`); раздел «Управление ресурсами»: `deactivate()` дожидается остановки
  MCP-сервера через `Promise`.
