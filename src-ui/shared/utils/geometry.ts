/** Точка на плоскости */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Размер */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Прямоугольник */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Ограничить значение диапазоном */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Евклидово расстояние между двумя точками */
export function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Проверить, что точка находится внутри прямоугольника */
export function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}
