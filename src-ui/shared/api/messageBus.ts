import type { HostToUiMessage } from '../protocol/hostMessages';
import type { UiToHostMessage } from '../protocol/uiMessages';
import { getVscodeApi } from './vscodeApi';

/** Обработчик входящего сообщения от host */
export type MessageHandler<T> = (message: T) => void;

/**
 * Типизированная шина сообщений между webview и host.
 * Обёртка над window.addEventListener('message') и vscodeApi.postMessage().
 */
export class MessageBus {
  // any: разные типы сообщений хранятся в одной карте по discriminant `type`.
  private handlers = new Map<string, Set<MessageHandler<any>>>();
  private listener: ((event: MessageEvent) => void) | null = null;

  /** Подписаться на сообщения от host */
  start(): void {
    if (this.listener) return;
    this.listener = (event: MessageEvent<HostToUiMessage>) => {
      const msg = event.data;
      this.dispatch(msg.type, msg);
    };
    window.addEventListener('message', this.listener);
  }

  /** Отписаться от сообщений host */
  stop(): void {
    if (this.listener) {
      window.removeEventListener('message', this.listener);
      this.listener = null;
    }
  }

  /** Подписаться на сообщения конкретного типа */
  on<T extends HostToUiMessage>(type: T['type'], handler: MessageHandler<T>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  /** Отписаться от сообщений конкретного типа */
  off<T extends HostToUiMessage>(type: T['type'], handler: MessageHandler<T>): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Отправить сообщение host */
  send(message: UiToHostMessage): void {
    getVscodeApi().postMessage(message);
  }

  private dispatch(type: string, message: HostToUiMessage): void {
    this.handlers.get(type)?.forEach((handler) => handler(message));
  }
}
