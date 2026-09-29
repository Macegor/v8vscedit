/**
 * Варианты выбора формы для свойств вида `DefaultForm`/`DefaultListForm`/… .
 *
 * Модуль чистый: ни `vscode`, ни файловой системы, ни разбора XML — на вход
 * приходят уже прочитанные имена форм, на выходе готовый список вариантов и
 * каноничные ссылки для записи в XML. Живёт рядом с остальными чистыми
 * помощниками панели свойств (`propertyKeyOrder`, `propertyExtractors`,
 * `PropertiesViewUtils`), потому что это логика ОТБОРА вариантов для UI,
 * а не реестр свойств и не знание о структуре файла выгрузки.
 *
 * Канон ссылки снят с эталона `example/` (2.20 + 2.21, cf и cfe): среди 3 446
 * заполненных значений свойств выбора формы встречаются РОВНО две формы записи,
 * без единого исключения —
 *   - собственная форма объекта: `<АнглВидВладельца>.<ИмяВладельца>.Form.<ИмяФормы>`
 *     (3 163 значения, третий сегмент всегда буквально `Form`);
 *   - общая форма конфигурации: `CommonForm.<ИмяФормы>` (283 значения).
 *
 * Общие формы обязаны быть в списке: у отчёта 202 из 265 основных форм, все 34
 * формы варианта и 35 из 37 форм настроек — общие, а у константы общие все 7.
 * Пикер, знающий только собственные формы объекта, для этих видов пуст всегда.
 */

/** Источник формы: собственная форма объекта или общая форма конфигурации. */
export type FormPickerOptionSource = 'own' | 'common';

export interface FormPickerOption {
  /** Имя формы — то, что читает человек. */
  label: string;
  /** Каноничная ссылка; она же уточнение в списке, когда имена совпали. */
  reference: string;
  source: FormPickerOptionSource;
}

export interface FormPickerInput {
  /** Английский вид объекта-владельца (`Report`, `Catalog`, …). */
  ownerKind: string;
  ownerName: string;
  /** Имена собственных форм объекта. */
  ownForms: readonly string[];
  /** Имена общих форм конфигурации. */
  commonForms: readonly string[];
}

/** Ссылка на собственную форму объекта. */
export function buildOwnFormReference(ownerKind: string, ownerName: string, formName: string): string {
  return `${ownerKind}.${ownerName}.Form.${formName}`;
}

/** Ссылка на общую форму конфигурации. */
export function buildCommonFormReference(formName: string): string {
  return `CommonForm.${formName}`;
}

/**
 * Список вариантов выбора формы: сначала собственные формы объекта, затем общие
 * формы конфигурации, внутри каждой группы — по алфавиту.
 *
 * Собственные идут первыми не по вкусу, а по частоте: в эталоне 3 163 значения
 * ссылаются на форму самого объекта против 283 на общую.
 *
 * Совпадение имён между своей и общей формой не схлопывается: это две разные
 * формы и две разные ссылки, различить их человек может по `reference`.
 */
export function buildFormPickerOptions(input: FormPickerInput): FormPickerOption[] {
  const own = sortFormNames(input.ownForms).map((name) => ({
    label: name,
    reference: buildOwnFormReference(input.ownerKind, input.ownerName, name),
    source: 'own' as const,
  }));
  const common = sortFormNames(input.commonForms).map((name) => ({
    label: name,
    reference: buildCommonFormReference(name),
    source: 'common' as const,
  }));
  return [...own, ...common];
}

/**
 * Сообщение, когда выбирать нечего. Называет обе причины сразу: список пуст
 * только когда у объекта нет собственных форм И в выгрузке нет общих форм,
 * поэтому подсказка обязана указать оба места, а не одно из них.
 */
export function getEmptyFormPickerMessage(): string {
  return 'Выбирать нечего: у объекта нет собственных форм, а в выгрузке нет общих форм конфигурации.';
}

function sortFormNames(names: readonly string[]): string[] {
  return [...names]
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right, 'ru'));
}
