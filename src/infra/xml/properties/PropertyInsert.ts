import {
  collectPropertyBlocks,
  detectEol,
  insertBlockInCanonicalPosition,
} from '../typedField/PropertyBlockEditor';
import { rootPropertyRank } from './PropertyOrder';

/**
 * Механика вставки НОВОГО свойства в `<Properties>` корневого объекта — БЕЗ
 * знания о видах метаданных: место берётся из {@link rootPropertyRank} по паре
 * «корневой тег XML + ключ». Калька разделения `infra/xml/childObjects/`
 * (данные — `ChildObjectsOrder`, механика — `ChildObjectsEditor`).
 *
 * Существующие блоки не переупорядочиваются никогда: правило применяется только
 * к вставке отсутствующего тега. Нормализация чужого файла превратила бы любую
 * мелкую правку в полную перезапись объекта в git-диффе.
 *
 * Сама вставка выполняется общей `insertBlockInCanonicalPosition` — она уже
 * kind-agnostic и параметризована `orderOf`; второй копии splice-вставки в
 * проекте быть не должно.
 */
export function insertPropertyBlockInOrder(
  propertiesInner: string,
  ownerKind: string | undefined,
  propertyKey: string,
  valueBlock: string
): string {
  const rank = rootPropertyRank(ownerKind, propertyKey);
  const blocks = collectPropertyBlocks(propertiesInner);
  if (rank === null || blocks.length === 0) {
    // Вид без снятого правила, ключ вне строки или испорченный блок без тегов —
    // консервативный фолбэк «в конец», прежнее поведение писателя свойств.
    // Гадать место по соседям нельзя: платформа не примет чужой порядок.
    return appendPropertyAtEnd(propertiesInner, valueBlock);
  }
  return insertBlockInCanonicalPosition(
    propertiesInner,
    blocks,
    (key) => rootPropertyRank(ownerKind, key) ?? undefined,
    rank,
    valueBlock,
    detectEol(propertiesInner)
  );
}

/**
 * Дописывает блок последней строкой `<Properties>`, восстанавливая отступ
 * закрывающего тега. Прежнее поведение `ObjectXmlReader.appendPropertyAtEnd`,
 * перенесённое без изменений.
 */
function appendPropertyAtEnd(propertiesInner: string, valueBlock: string): string {
  // Хвостовой отступ отделяется посимвольно, а не регэкспом `([\t ]*)$`: тот
  // совпадает ВСЕГДА (в пределе — пустой строкой), и проверка его результата на
  // `null` была бы недостижимой веткой.
  let cut = propertiesInner.length;
  while (cut > 0 && (propertiesInner[cut - 1] === '\t' || propertiesInner[cut - 1] === ' ')) {
    cut--;
  }
  const trailingIndent = propertiesInner.slice(cut);
  const innerIndent = trailingIndent ? `${trailingIndent}\t` : '';
  const base = propertiesInner.slice(0, cut).replace(/\n+$/, '');
  return `${base}\n${innerIndent}${valueBlock}\n${trailingIndent}`;
}
