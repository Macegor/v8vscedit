/**
 * Форматирование loopback-хоста для URL и заголовка `Host`. IPv6-адрес по
 * RFC 3986 в authority всегда оборачивается в квадратные скобки (`::1` →
 * `[::1]`), иначе разделитель `:port` сливается с самим адресом и даёт
 * мусорную форму `"::1:port"`. IPv4 и `localhost` возвращаются как есть.
 *
 * Общий helper слоя `infra/**` (без `vscode`): им пользуются и endpoint/
 * allowedHosts сервера (`ui/mcp/V8McpServer`), и сетевой зонд порта
 * (`infra/mcp/McpPortProbe`) — форма Host обязана совпадать по обе стороны,
 * иначе собственный зонд ловит 403 от DNS-rebinding-защиты.
 */
export function formatHostForUrl(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}
