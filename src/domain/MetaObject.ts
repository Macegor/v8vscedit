import { ChildTag } from './ChildTag';
import { MetaKind } from './MetaTypes';

/**
 * Дочерний элемент объекта метаданных (реквизит, ТЧ, форма, команда, макет, ...).
 * Совпадает со структурой XML-тега внутри `<ChildObjects>`.
 */
export interface MetaChild {
  /** Тег XML — соответствует одному из значений {@link ChildTag}; для обратной совместимости — строка */
  tag: ChildTag | string;
  name: string;
  synonym: string;
  /** Для табличной части — список её колонок (Attribute) */
  columns?: MetaChild[];
}

/**
 * Описание объекта метаданных (справочник, документ, регистр, ...), полученное
 * парсингом `<Тип>/<Имя>/<Имя>.xml` или плоского `<Тип>/<Имя>.xml`.
 */
export interface MetaObject {
  /** Тип объекта, совпадает с тегом корневого элемента XML */
  tag: string;
  /** Ранее могло быть `string`; приводим к {@link MetaKind} там, где это возможно */
  kind?: MetaKind;
  name: string;
  synonym: string;
  children: MetaChild[];
}
