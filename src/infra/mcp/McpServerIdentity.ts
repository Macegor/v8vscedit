/**
 * Идентичность MCP-сервера расширения, публикуемая на `GET /identity`.
 *
 * Занятый preferred-порт может держать: наш же сервер того же проекта (можно
 * переиспользовать), наш сервер другого проекта (конфликт) либо вообще чужой
 * процесс. Чтобы надёжно различать эти случаи, сервер отдаёт машинно-читаемую
 * форму со строгой валидацией: любой чужой/битый ответ обязан отвергаться,
 * иначе расширение примет чужой процесс на порту за свой сервер.
 *
 * Модуль относится к `infra/**`, но не касается ФС/сети — это чистая
 * сериализация/валидация формы (сеть — в `McpPortProbe`).
 */

/** Стабильный маркер продукта: отличает наш `/identity` от любого чужого. */
export const PRODUCT_ID = 'v8vscedit-mcp';

/**
 * Версия формы ответа `/identity`. Инкрементируется при несовместимом
 * изменении набора полей — несовпадение отвергается как потенциально
 * несовместимый (будущий/чужой) формат.
 */
export const IDENTITY_PROTOCOL = 1;

export interface McpServerIdentity {
  readonly product: string;
  readonly protocol: number;
  readonly pid: number;
  readonly projectRoot: string;
  readonly version: string;
  readonly endpoint: string;
}

/** Сериализует identity в JSON-строку для тела ответа `/identity`. */
export function serializeIdentity(identity: McpServerIdentity): string {
  const payload: McpServerIdentity = {
    product: identity.product,
    protocol: identity.protocol,
    pid: identity.pid,
    projectRoot: identity.projectRoot,
    version: identity.version,
    endpoint: identity.endpoint,
  };
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Строго валидирует произвольный разобранный JSON как identity нашего сервера.
 * Возвращает `undefined` при чужом product, несовпадающем protocol, отсутствии
 * любого обязательного поля, неверном типе поля или не-объекте на входе.
 */
export function parseIdentity(raw: unknown): McpServerIdentity | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const { product, protocol, pid, projectRoot, version, endpoint } = raw;
  if (product !== PRODUCT_ID) {
    return undefined;
  }
  if (protocol !== IDENTITY_PROTOCOL) {
    return undefined;
  }
  if (typeof pid !== 'number') {
    return undefined;
  }
  if (typeof projectRoot !== 'string') {
    return undefined;
  }
  if (typeof version !== 'string') {
    return undefined;
  }
  if (typeof endpoint !== 'string') {
    return undefined;
  }
  return { product, protocol, pid, projectRoot, version, endpoint };
}
