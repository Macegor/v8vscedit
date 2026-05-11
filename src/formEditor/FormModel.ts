/**
 * Типизированная модель управляемой формы 1С.
 * Описывает иерархию элементов, реквизиты и команды формы.
 */

/** Тип элемента формы */
export type FormElementType =
  | 'UsualGroup'
  | 'InputField'
  | 'LabelField'
  | 'LabelDecoration'
  | 'Button'
  | 'Table'
  | 'Pages'
  | 'Page'
  | 'CheckBoxField'
  | 'RadioButtonField'
  | 'PictureField'
  | 'PictureDecoration'
  | 'SpreadSheetDocumentField'
  | 'HTMLDocumentField'
  | 'TextDocumentField'
  | 'PlannerField'
  | 'ProgressBarField'
  | 'CalendarField'
  | 'ChartField'
  | 'GanttChartField'
  | 'PeriodField'
  | 'DendrogramField'
  | 'Popup'
  | 'ColumnGroup'
  | 'SearchStringAddition'
  | 'ViewStatusAddition'
  | 'SearchControlAddition'
  | 'AutoCommandBar'
  | 'CommandBar'
  | 'CommandBarButton'
  | 'Separator'
  | 'Navigator'
  | 'ContextMenu';

/** Направление группы */
export type GroupDirection = 'Vertical' | 'Horizontal' | 'AlwaysHorizontal';

/** Элемент формы */
export interface FormElement {
  /** Уникальный id элемента в форме */
  id: number;
  /** Имя элемента */
  name: string;
  /** Тип элемента */
  type: FormElementType | string;
  /** Направление компоновки (для групп) */
  group?: GroupDirection;
  /** Путь к данным */
  dataPath?: string;
  /** Заголовок */
  title?: string;
  /** Показывать заголовок */
  showTitle?: boolean;
  /** Растягивание по горизонтали */
  horizontalStretch?: boolean;
  /** Растягивание по вертикали */
  verticalStretch?: boolean;
  /** Ширина */
  width?: number;
  /** Высота */
  height?: number;
  /** Только чтение */
  readOnly?: boolean;
  /** Видимость */
  visible?: boolean;
  /** Дочерние элементы */
  children: FormElement[];
  /** Все прочие свойства из XML (ключ → строковое значение) */
  rawProperties: Record<string, string>;
}

/** Реквизит формы */
export interface FormAttribute {
  id: number;
  name: string;
  valueType: string;
  isMain?: boolean;
  savedData?: boolean;
  columns?: FormAttributeColumn[];
}

/** Колонка реквизита-таблицы */
export interface FormAttributeColumn {
  id: number;
  name: string;
  valueType: string;
}

/** Команда формы */
export interface FormCommand {
  id: number;
  name: string;
  title?: string;
  action?: string;
  representation?: string;
}

/** Обработчик события формы */
export interface FormEvent {
  name: string;
  handler: string;
}

/** Полная модель формы */
export interface FormModel {
  /** Корневой контейнер элементов (виртуальный узел, children = top-level ChildItems) */
  root: FormElement;
  /** Реквизиты формы */
  attributes: FormAttribute[];
  /** Команды формы */
  commands: FormCommand[];
  /** Обработчики событий формы */
  events: FormEvent[];
}
