import { getVscodeApi } from './vscodeApi';

let requestCounter = 0;
const pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();

/**
 * Отправить запрос к host и дождаться ответа.
 * Если ответ не пришёл за 30 секунд — промис отклоняется с таймаутом.
 */
export function sendRequest(name: string, payload?: unknown): Promise<unknown> {
  const requestId = `req_${++requestCounter}`;
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    getVscodeApi().postMessage({ type: 'request', requestId, name, payload });
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error(`Request "${name}" timed out`));
      }
    }, 30000);
  });
}

/**
 * Обработать входящий ответ на ранее отправленный запрос.
 * Вызывать из обработчика window.addEventListener('message') ДО dispatch в MessageBus.
 * Возвращает true, если сообщение было ответом на запрос и обработано.
 */
export function handleRequestReply(data: { type: string; requestId?: string; payload?: unknown }): boolean {
  if (data.type === 'reply' && data.requestId && pendingRequests.has(data.requestId)) {
    const pending = pendingRequests.get(data.requestId)!;
    pendingRequests.delete(data.requestId);
    pending.resolve(data.payload);
    return true;
  }
  if (data.type === 'error' && data.requestId && pendingRequests.has(data.requestId)) {
    const pending = pendingRequests.get(data.requestId)!;
    pendingRequests.delete(data.requestId);
    pending.reject(new Error(typeof data.payload === 'string' ? data.payload : 'Unknown error'));
    return true;
  }
  return false;
}
