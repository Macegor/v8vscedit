/**
 * Исчерпывающая проверка для discriminated union.
 * Выбрасывает ошибку, если значение не было обработано в switch.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unhandled value: ${JSON.stringify(value)}`);
}
