export type FormPurpose = 'Object' | 'List' | 'Choice' | 'Record';

export interface AddFormOptions {
  readonly objectPath: string;
  readonly formName: string;
  readonly purpose?: FormPurpose | string;
  readonly synonym?: string;
  readonly setDefault?: boolean;
  /**
   * Если true (по умолчанию), Form.xml будет наполнен элементами по метаданным
   * объекта: для каталогов — Код/Наименование/реквизиты/табличные части,
   * для документов — Номер/Дата/реквизиты/табличные части, для регистров —
   * измерения/ресурсы, и т.п. Если false — генерируется пустой каркас
   * (старое поведение).
   */
  readonly autoFill?: boolean;
}

export interface RemoveFormOptions {
  readonly objectPath: string;
  readonly formName: string;
}

export interface CompileFormOptions {
  readonly outputPath: string;
  readonly definition?: FormDefinition;
  readonly fromObject?: boolean;
}

export interface EditFormOptions {
  readonly formPath: string;
  readonly definition: FormEditDefinition;
}

export interface FormInfoOptions {
  readonly formPath: string;
  readonly expand?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ValidateFormOptions {
  readonly formPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface FormMutationResult {
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

export interface FormInfoResult {
  readonly formPath: string;
  readonly title: string;
  readonly elements: readonly FormElementInfo[];
  readonly attributes: readonly FormAttributeInfo[];
  readonly commands: readonly FormCommandInfo[];
  readonly events: readonly string[];
  readonly baseForm?: string;
  readonly lines: readonly string[];
}

export interface FormValidationResult {
  readonly formPath: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly lines: readonly string[];
}

export interface FormElementInfo {
  readonly tag: string;
  readonly name: string;
  readonly id: string;
  readonly dataPath?: string;
  readonly commandName?: string;
  readonly parent?: string;
}

export interface FormAttributeInfo {
  readonly name: string;
  readonly id: string;
  readonly types: readonly string[];
  readonly main: boolean;
}

export interface FormCommandInfo {
  readonly name: string;
  readonly id: string;
  readonly actions: readonly string[];
}

export interface FormDefinition {
  readonly title?: string;
  readonly properties?: Record<string, unknown>;
  readonly events?: Record<string, string>;
  readonly excludedCommands?: readonly string[];
  readonly elements?: readonly FormElementDefinition[];
  readonly attributes?: readonly FormAttributeDefinition[];
  readonly commands?: readonly FormCommandDefinition[];
  readonly parameters?: readonly Record<string, unknown>[];
}

export interface FormEditDefinition extends FormDefinition {
  readonly into?: string;
  readonly after?: string;
  readonly formEvents?: readonly FormEventPatch[];
  readonly elementEvents?: readonly ElementEventPatch[];
}

export interface FormAttributeDefinition {
  readonly name: string;
  readonly type?: string;
  readonly main?: boolean;
  readonly savedData?: boolean;
  readonly columns?: readonly FormAttributeDefinition[];
  readonly settings?: Record<string, unknown>;
}

export interface FormCommandDefinition {
  readonly name: string;
  readonly title?: string;
  readonly action?: string;
  readonly shortcut?: string;
  readonly picture?: string;
  readonly callType?: string;
  readonly actions?: readonly { readonly handler: string; readonly callType?: string }[];
}

export interface FormEventPatch {
  readonly name: string;
  readonly handler: string;
  readonly callType?: string;
}

export interface ElementEventPatch extends FormEventPatch {
  readonly element: string;
}

export type FormElementDefinition = Record<string, unknown>;
