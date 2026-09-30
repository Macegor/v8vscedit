import { findDirectElementEntries } from '../XmlUtils';
import { childTagRank } from './ChildObjectsOrder';

/**
 * Куда вставить НОВЫЙ элемент внутри содержимого `<ChildObjects>`, чтобы файл
 * соответствовал канону порядка владельца ({@link childTagRank}).
 *
 * Возвращает смещение в `inner` — позицию начала СТРОКИ первого прямого
 * ребёнка со строго большим рангом (т.е. сразу после предшествующего перевода
 * строки, перед отступом этого ребёнка). Вызывающий вставляет туда свой
 * фрагмент и один перевод строки: отступ ребёнка-соседа остаётся на месте и
 * ни одна существующая строка файла не переписывается.
 *
 * `null` означает «правила нет — дописывай в конец, как раньше». Это НЕ ошибка,
 * а консервативный режим: вид владельца или тег вне снятой с эталона таблицы,
 * контейнер вложенный (`container: 'nested'` — у колонок ТЧ и методов
 * URL-шаблона своего канона нет), либо все существующие дети имеют ранг не
 * больше нового.
 *
 * Существующие элементы НИКОГДА не переставляются: правило применяется только
 * к вставке. Иначе первое же добавление реквизита в легаси-файл переписывало бы
 * весь объект целиком в git-диффе, а результат операции зависел бы от истории
 * файла, а не от аргументов.
 *
 * Модуль намеренно не знает ни одного конкретного вида метаданных — все данные
 * приходят из `ChildObjectsOrder.ts`.
 */
export function resolveInsertOffset(
  inner: string,
  ownerKind: string | undefined,
  tag: string,
  container: 'root' | 'nested'
): number | null {
  if (container === 'nested') {
    return null;
  }
  const newRank = childTagRank(ownerKind, tag);
  if (newRank === null) {
    return null;
  }
  for (const entry of findDirectElementEntries(inner)) {
    const existingRank = childTagRank(ownerKind, entry.tag);
    if (existingRank !== null && existingRank > newRank) {
      return lineStartOffset(inner, entry.start);
    }
  }
  return null;
}

/** Начало строки элемента: откат от `<` через отступ (пробелы/табы) до перевода строки. */
function lineStartOffset(inner: string, elementStart: number): number {
  let offset = elementStart;
  while (offset > 0 && (inner[offset - 1] === ' ' || inner[offset - 1] === '\t')) {
    offset -= 1;
  }
  return offset;
}
