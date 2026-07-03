import type { MetaKind } from '../../../domain/MetaTypes';
import type { TypeAwarePropertyOwnerKind } from '../TypedFieldPropertyRules';

/** Описание сгенерированного типа объекта (xr:GeneratedType) — префикс + категория. */
export interface GeneratedTypeDef {
  readonly prefix: string;
  readonly category: string;
}

/** Готовая ссылка на сгенерированный тип: полное имя + категория. */
export interface GeneratedTypeRef {
  readonly name: string;
  readonly category: string;
}

/**
 * Правила генерации XML для одного поколения формата сериализации 1С.
 *
 * Версии формата (`version="2.18"`, `"2.21"`, …) привязываются к ruleset в
 * `formatRegistry`. Пока генерация между версиями совпадает — несколько версий
 * ссылаются на один и тот же ruleset. Как только 1С в новом релизе меняет
 * формат, по донору заводится новый ruleset (обычно как дельта от baseline:
 * `{ ...BASELINE_RULESET, ...изменившиеся поля }`) и привязывается к новым
 * версиям. Так знание о формате живёт здесь, а не размазано по императивным
 * `build*`-функциям.
 *
 * Ruleset — это стратегия формата: и данные (namespace, таблицы типов), и
 * формат-зависимые куски генерации (форма `<Type>`, свойства типизированных
 * полей, generated-types табличных частей). Вся генерация — и корневой объект,
 * и вложенные элементы — проходит через один ruleset.
 */
export interface FormatRuleset {
  /** Технический идентификатор ruleset (например, `baseline`). */
  readonly id: string;

  /**
   * Строка xmlns-объявлений корневого `<MetaDataObject …>` (без `version`).
   * Используется и для объектов, и для отдельных файлов макетов.
   */
  readonly metaDataObjectXmlns: string;

  /** Таблица сгенерированных типов (`xr:GeneratedType`) по виду метаданных. */
  readonly generatedTypes: Partial<Record<MetaKind, readonly GeneratedTypeDef[]>>;

  /**
   * Нужно ли выпускать свойство `<AuxiliaryVariantForm/>` у отчёта. В формате
   * 2.21 оно присутствует, в 2.20 — отсутствует (свойство появилось позже).
   */
  readonly includeReportAuxiliaryVariantForm: boolean;

  /**
   * Готовый блок `<StandardAttributes>…</StandardAttributes>` для свежего
   * объекта вида (отступ — 3 таба, как в `<Properties>`), либо пустая строка,
   * если у объектов этого вида в дефолтной конфигурации стандартных реквизитов
   * нет (например, независимый непериодический регистр сведений). Наполнение —
   * формат-зависимое, поэтому владеет им ruleset.
   */
  standardAttributes(kind: MetaKind): string;

  /**
   * Готовый блок `<StandardTabularSections>…</StandardTabularSections>` (только
   * план счетов — стандартная ТЧ `ExtDimensionTypes`), либо пустая строка.
   */
  standardTabularSections(kind: MetaKind): string;

  /**
   * Блок `<Type>…</Type>` нового типизированного поля по умолчанию
   * (строка(10), переменной длины). `indent` — отступ открывающего `<Type>`.
   */
  buildDefaultTypeBlock(indent: string): string;

  /**
   * Дополнительные блоки свойств нового типизированного поля, зависящие от его
   * типа (`<Type>`-состав определяет, какие свойства уместны). `typeInnerXml` —
   * XML блока типа для определения категории, `indent` — отступ свойств.
   */
  buildTypedFieldProperties(kind: TypeAwarePropertyOwnerKind, typeInnerXml: string, indent: string): readonly string[];

  /**
   * Сгенерированные типы (`xr:GeneratedType`) табличной части и её строки.
   * Возвращает готовые ссылки в порядке записи в `<InternalInfo>`.
   */
  tabularSectionGeneratedTypes(ownerKind: string, ownerName: string, sectionName: string): readonly GeneratedTypeRef[];
}
