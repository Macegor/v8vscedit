import { ref, readonly, type Ref } from 'vue';
import type { HostStatusKind } from '../protocol/hostMessages';

/** Реактивный store состояния статуса webview */
export interface StatusStore {
  readonly kind: Readonly<Ref<HostStatusKind>>;
  readonly message: Readonly<Ref<string>>;
  setStatus: (kind: HostStatusKind, message: string) => void;
  setLoading: (message?: string) => void;
  setSuccess: (message?: string) => void;
  setError: (message: string) => void;
  setIdle: () => void;
}

/** Создать реактивный store статуса */
export function createStatusStore(): StatusStore {
  const kind = ref<HostStatusKind>('idle');
  const message = ref('');

  function setStatus(newKind: HostStatusKind, newMessage: string): void {
    kind.value = newKind;
    message.value = newMessage;
  }

  return {
    kind: readonly(kind),
    message: readonly(message),
    setStatus,
    setLoading: (msg?: string) => setStatus('loading', msg ?? ''),
    setSuccess: (msg?: string) => setStatus('success', msg ?? ''),
    setError: (msg: string) => setStatus('error', msg),
    setIdle: () => setStatus('idle', ''),
  };
}
