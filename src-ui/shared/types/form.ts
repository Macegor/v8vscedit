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

export type GroupDirection = 'Vertical' | 'Horizontal' | 'AlwaysHorizontal';

export interface FormElement {
  id: number;
  name: string;
  type: string;
  group?: GroupDirection;
  dataPath?: string;
  title?: string;
  showTitle?: boolean;
  horizontalStretch?: boolean;
  verticalStretch?: boolean;
  width?: number;
  height?: number;
  readOnly?: boolean;
  visible?: boolean;
  children: FormElement[];
  rawProperties: Record<string, string>;
}

export interface FormAttribute {
  id: number;
  name: string;
  valueType: string;
  isMain?: boolean;
  savedData?: boolean;
  columns?: FormAttributeColumn[];
}

export interface FormAttributeColumn {
  id: number;
  name: string;
  valueType: string;
}

export interface FormCommand {
  id: number;
  name: string;
  title?: string;
  action?: string;
  representation?: string;
}

export interface FormEvent {
  name: string;
  handler: string;
}

export interface FormModel {
  root: FormElement;
  attributes: FormAttribute[];
  commands: FormCommand[];
  events: FormEvent[];
}
