/** Функция проверки сочетания клавиш */
export type KeyMatcher = (event: KeyboardEvent) => boolean;

/** Создать матчер для конкретного сочетания клавиш */
export function matchKey(key: string, ctrl?: boolean, shift?: boolean, alt?: boolean): KeyMatcher {
  return (event: KeyboardEvent) => {
    if (event.key !== key) return false;
    if (ctrl !== undefined && event.ctrlKey !== ctrl) return false;
    if (shift !== undefined && event.shiftKey !== shift) return false;
    if (alt !== undefined && event.altKey !== alt) return false;
    return true;
  };
}

/** Проверить, что нажата Enter */
export function isEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter';
}

/** Проверить, что нажата Escape */
export function isEscape(event: KeyboardEvent): boolean {
  return event.key === 'Escape';
}

/** Проверить, что нажата стрелка вверх */
export function isArrowUp(event: KeyboardEvent): boolean {
  return event.key === 'ArrowUp';
}

/** Проверить, что нажата стрелка вниз */
export function isArrowDown(event: KeyboardEvent): boolean {
  return event.key === 'ArrowDown';
}

/** Проверить, что нажата стрелка влево */
export function isArrowLeft(event: KeyboardEvent): boolean {
  return event.key === 'ArrowLeft';
}

/** Проверить, что нажата стрелка вправо */
export function isArrowRight(event: KeyboardEvent): boolean {
  return event.key === 'ArrowRight';
}
