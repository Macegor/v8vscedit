import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { writeTextFilePreservingBomAndEol } from './XmlUtils';

export type FormPurpose = 'Object' | 'List' | 'Choice' | 'Record';

export interface AddFormOptions {
  readonly objectPath: string;
  readonly formName: string;
  readonly purpose?: FormPurpose | string;
  readonly synonym?: string;
  readonly setDefault?: boolean;
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

const MD_XMLNS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const FORM_XMLNS = 'xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const FORM_NS = 'http://v8.1c.ru/8.3/xcf/logform';
const GUID_PATTERN = /^[0-9a-fA-F-]{36}$/;
const IDENT_PATTERN = /^[A-Za-zА-ЯЁа-яё_][A-Za-z0-9А-ЯЁа-яё_]*$/;
const VALID_CALL_TYPES = new Set(['Before', 'After', 'Override']);

export class FormToolsService {
  addForm(options: AddFormOptions): FormMutationResult {
    validateName(options.formName, 'Имя формы');
    const loc = resolveObjectLocation(options.objectPath);
    const purpose = normalizePurpose(options.purpose ?? 'Object');
    validatePurpose(loc.kind, purpose);
    const synonym = options.synonym ?? options.formName;
    const formatVersion = detectFormatVersion(loc.xmlPath);
    const formsDir = path.join(loc.objectDir, 'Forms');
    const formMetaPath = path.join(formsDir, `${options.formName}.xml`);
    const formXmlPath = path.join(formsDir, options.formName, 'Ext', 'Form.xml');
    const modulePath = path.join(formsDir, options.formName, 'Ext', 'Form', 'Module.bsl');
    if (fs.existsSync(formMetaPath)) {
      throw new Error(`Форма уже существует: ${formMetaPath}`);
    }

    writeNewTextFile(formMetaPath, buildFormDescriptorXml(options.formName, synonym, formatVersion, isProcessorLike(loc.kind)));
    writeNewTextFile(formXmlPath, buildInitialFormXml({
      objectKind: loc.kind,
      objectName: loc.name,
      purpose,
      formatVersion,
    }));
    writeNewTextFile(modulePath, buildFormModule(purpose !== 'Object' || !isExternalKind(loc.kind)));

    const original = fs.readFileSync(loc.xmlPath, 'utf-8');
    const defaultProp = defaultFormProperty(loc.kind, purpose);
    const formRef = `${loc.kind}.${loc.name}.Form.${options.formName}`;
    const registered = registerFormInObjectXml(original, options.formName);
    const shouldSetDefault = options.setDefault === true || isEmptyTagValue(registered, defaultProp);
    const next = shouldSetDefault ? setTagValue(registered, defaultProp, formRef, true) : registered;
    writeTextFilePreservingBomAndEol(loc.xmlPath, original, next);

    return { changedFiles: [formMetaPath, formXmlPath, modulePath, loc.xmlPath], warnings: [] };
  }

  removeForm(options: RemoveFormOptions): FormMutationResult {
    validateName(options.formName, 'Имя формы');
    const loc = resolveObjectLocation(options.objectPath);
    const formsDir = path.join(loc.objectDir, 'Forms');
    const formMetaPath = path.join(formsDir, `${options.formName}.xml`);
    const formDir = path.join(formsDir, options.formName);
    if (!fs.existsSync(formMetaPath)) {
      throw new Error(`Метаданные формы не найдены: ${formMetaPath}`);
    }
    const changedFiles = [formMetaPath, loc.xmlPath];
    if (fs.existsSync(formDir)) {
      fs.rmSync(formDir, { recursive: true, force: true });
      changedFiles.push(formDir);
    }
    fs.rmSync(formMetaPath, { force: true });

    const original = fs.readFileSync(loc.xmlPath, 'utf-8');
    let next = removeFormFromObjectXml(original, options.formName);
    for (const prop of ['DefaultForm', 'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'DefaultRecordForm']) {
      const value = extractTag(next, prop) ?? '';
      if (new RegExp(`\\.Form\\.${escapeRegExp(options.formName)}$`).test(value)) {
        next = setTagValue(next, prop, '');
      }
    }
    writeTextFilePreservingBomAndEol(loc.xmlPath, original, next);
    return { changedFiles, warnings: [] };
  }

  compile(options: CompileFormOptions): FormMutationResult {
    const formPath = resolveFormXmlPathForWrite(options.outputPath);
    const formatVersion = detectFormatVersion(formPath);
    const definition = options.fromObject === true && !options.definition
      ? inferDefinitionFromOutputPath(formPath)
      : options.definition ?? {};
    const compiled = buildFormXmlFromDefinition(definition, formatVersion);
    const original = fs.existsSync(formPath) ? fs.readFileSync(formPath, 'utf-8') : '';
    fs.mkdirSync(path.dirname(formPath), { recursive: true });
    writeTextFilePreservingBomAndEol(formPath, original, compiled);
    const changedFiles = [formPath];
    changedFiles.push(...ensureDescriptorAndRegistrationForCompiledForm(formPath, definition.title));
    return { changedFiles: unique(changedFiles), warnings: [] };
  }

  edit(options: EditFormOptions): FormMutationResult {
    const formPath = resolveFormXmlPath(options.formPath);
    const original = fs.readFileSync(formPath, 'utf-8');
    let next = original;
    const id = createIdAllocator(original);
    if (options.definition.attributes?.length) {
      next = appendIntoContainer(next, 'Attributes', options.definition.attributes.map((attr) => buildAttributeXml(attr, '\t\t', id.nextAttribute())).join('\n'));
    }
    if (options.definition.commands?.length) {
      next = appendIntoContainer(next, 'Commands', options.definition.commands.map((cmd) => buildCommandXml(cmd, '\t\t', id.nextCommand())).join('\n'));
    }
    if (options.definition.elements?.length) {
      const elementXml = options.definition.elements.map((el) => buildElementXml(el, '\t\t', id)).join('\n');
      next = options.definition.into
        ? appendIntoNamedElementChildItems(next, options.definition.into, elementXml)
        : appendIntoContainer(next, 'ChildItems', elementXml);
    }
    if (options.definition.formEvents?.length) {
      next = appendFormEvents(next, options.definition.formEvents);
    }
    if (options.definition.elementEvents?.length) {
      for (const event of options.definition.elementEvents) {
        next = appendElementEvent(next, event);
      }
    }
    writeTextFilePreservingBomAndEol(formPath, original, next);
    return { changedFiles: [formPath], warnings: [] };
  }

  info(options: FormInfoOptions): FormInfoResult {
    const formPath = resolveFormXmlPath(options.formPath);
    const xml = fs.readFileSync(formPath, 'utf-8');
    const elements = collectElements(xml);
    const attributes = collectAttributes(xml);
    const commands = collectCommands(xml);
    const events = collectEvents(xml);
    const title = extractLocalizedContent(extractBlock(xml, 'Title') ?? '') ?? extractTag(xml, 'Title') ?? path.basename(path.dirname(path.dirname(formPath)));
    const baseForm = extractBlock(xml, 'BaseForm') ? 'present' : undefined;
    const allLines = buildInfoLines({ title, elements, attributes, commands, events, baseForm });
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 150;
    return { formPath, title, elements, attributes, commands, events, baseForm, lines: allLines.slice(offset, offset + limit) };
  }

  validate(options: ValidateFormOptions): FormValidationResult {
    const formPath = resolveFormXmlPath(options.formPath);
    const maxErrors = options.maxErrors ?? 30;
    const detailed = options.detailed === true;
    const lines: string[] = [`=== Validation: Form.${path.basename(path.dirname(path.dirname(formPath)))} ===`, ''];
    let errors = 0;
    let warnings = 0;
    let ok = 0;
    const reportOk = (message: string) => {
      ok++;
      if (detailed) {
        lines.push(`[OK]    ${message}`);
      }
    };
    const reportWarn = (message: string) => {
      warnings++;
      lines.push(`[WARN]  ${message}`);
    };
    const reportError = (message: string) => {
      errors++;
      lines.push(`[ERROR] ${message}`);
    };
    const canContinue = () => errors < maxErrors;
    const xml = fs.readFileSync(formPath, 'utf-8');

    if (!/<Form\b/.test(xml)) {
      reportError('Root element is not Form.');
      return finalizeFormValidation(formPath, errors, warnings, ok, lines);
    }
    const version = /<Form\b[^>]*version="([^"]+)"/.exec(xml)?.[1] ?? '';
    if (!version) {
      reportWarn('Form version attribute missing.');
    } else {
      reportOk(`Root element: Form version=${version}`);
    }
    const autoCommandBar = /<AutoCommandBar\b[^>]*id="([^"]+)"/.exec(xml);
    if (!autoCommandBar) {
      reportError('AutoCommandBar element missing.');
    } else if (autoCommandBar[1] !== '-1') {
      reportError(`AutoCommandBar id="${autoCommandBar[1]}", expected "-1".`);
    } else {
      reportOk('AutoCommandBar id=-1.');
    }

    const elements = collectElements(xml);
    if (canContinue()) {
      validateUniqueIds(elements.map((el) => ({ kind: 'element', name: el.name, id: el.id })), reportError, () => reportOk(`Unique element IDs: ${elements.length} elements`));
    }
    const attributes = collectAttributes(xml);
    if (canContinue()) {
      validateUniqueIds(attributes.map((attr) => ({ kind: 'attribute', name: attr.name, id: attr.id })), reportError, () => reportOk(`Unique attribute IDs: ${attributes.length} entries`));
    }
    const commands = collectCommands(xml);
    if (canContinue()) {
      validateUniqueIds(commands.map((cmd) => ({ kind: 'command', name: cmd.name, id: cmd.id })), reportError, () => commands.length ? reportOk(`Unique command IDs: ${commands.length} entries`) : undefined);
    }
    if (canContinue()) {
      validateDataPaths(elements, attributes, reportError, reportOk);
    }
    if (canContinue()) {
      validateCommandRefs(elements, commands, reportError, reportOk);
    }
    if (canContinue()) {
      validateEventHandlers(xml, reportError, reportOk);
    }
    if (canContinue()) {
      validateTypes(xml, reportError, reportWarn, reportOk);
    }
    if (canContinue()) {
      validateCallTypes(xml, reportError, reportWarn, reportOk);
    }
    const mainCount = attributes.filter((attr) => attr.main).length;
    if (mainCount > 1) {
      reportError(`Multiple MainAttribute=true (${mainCount} found, expected 0 or 1).`);
    } else {
      reportOk(`MainAttribute: ${mainCount === 1 ? '1 main attribute' : 'no main attribute'}`);
    }
    return finalizeFormValidation(formPath, errors, warnings, ok, lines);
  }
}

function buildFormXmlFromDefinition(definition: FormDefinition, formatVersion: string): string {
  const id = createIdAllocator('');
  const title = definition.title ? buildLocalizedTag('\t', 'Title', definition.title) : '';
  const formEvents = definition.events ? buildEventsXml(definition.events, '\t') : '';
  const childItems = definition.elements?.length
    ? `\t<ChildItems>\n${definition.elements.map((el) => buildElementXml(el, '\t\t', id)).join('\n')}\n\t</ChildItems>`
    : '\t<ChildItems/>';
  const attrs = definition.attributes?.length
    ? `\t<Attributes>\n${definition.attributes.map((attr) => buildAttributeXml(attr, '\t\t', id.nextAttribute())).join('\n')}\n\t</Attributes>`
    : '\t<Attributes/>';
  const commands = definition.commands?.length
    ? `\t<Commands>\n${definition.commands.map((cmd) => buildCommandXml(cmd, '\t\t', id.nextCommand())).join('\n')}\n\t</Commands>`
    : '';
  const excluded = definition.excludedCommands?.length
    ? `\t<ExcludedCommands>\n${definition.excludedCommands.map((cmd) => `\t\t<Command>${escapeXml(cmd)}</Command>`).join('\n')}\n\t</ExcludedCommands>`
    : '';
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Form ${FORM_XMLNS} version="${formatVersion}">`,
    title,
    excluded,
    '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1">',
    '\t\t<Autofill>true</Autofill>',
    '\t</AutoCommandBar>',
    formEvents,
    childItems,
    attrs,
    commands,
    '</Form>',
    '',
  ].filter((line) => line !== '').join('\n');
}

function buildInitialFormXml(options: {
  readonly objectKind: string;
  readonly objectName: string;
  readonly purpose: FormPurpose;
  readonly formatVersion: string;
}): string {
  const attr = mainAttributeForPurpose(options.objectKind, options.objectName, options.purpose);
  return buildFormXmlFromDefinition({
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    attributes: [attr],
  }, options.formatVersion);
}

function buildElementXml(raw: FormElementDefinition, indent: string, id: IdAllocator): string {
  const kind = detectElementKind(raw);
  const name = String(raw.name ?? raw[kind.dslKey] ?? kind.defaultName);
  const title = raw.title ? String(raw.title) : '';
  const childIndent = `${indent}\t`;
  const lines = [`${indent}<${kind.tag} name="${escapeXml(name)}" id="${id.nextElement()}">`];
  if (title) {
    lines.push(buildLocalizedTag(childIndent, 'Title', title));
  }
  if (raw.path) {
    lines.push(`${childIndent}<DataPath>${escapeXml(String(raw.path))}</DataPath>`);
  }
  if (raw.command) {
    lines.push(`${childIndent}<CommandName>Form.Command.${escapeXml(String(raw.command))}</CommandName>`);
  }
  if (raw.stdCommand) {
    const value = String(raw.stdCommand).includes('.')
      ? `Form.Item.${raw.stdCommand}.StandardCommand`
      : `Form.StandardCommand.${raw.stdCommand}`;
    lines.push(`${childIndent}<CommandName>${escapeXml(value)}</CommandName>`);
  }
  appendBoolean(lines, childIndent, 'Visible', raw.visible === false || raw.hidden === true ? false : undefined);
  appendBoolean(lines, childIndent, 'Enabled', raw.enabled === false || raw.disabled === true ? false : undefined);
  appendBoolean(lines, childIndent, 'ReadOnly', raw.readOnly === true ? true : undefined);
  appendScalar(lines, childIndent, 'TitleLocation', raw.titleLocation);
  appendScalar(lines, childIndent, 'Representation', raw.representation);
  appendScalar(lines, childIndent, 'PagesRepresentation', raw.pagesRepresentation);
  appendScalar(lines, childIndent, 'CommandBarLocation', raw.commandBarLocation);
  appendScalar(lines, childIndent, 'SearchStringLocation', raw.searchStringLocation);
  appendScalar(lines, childIndent, 'Height', raw.height);
  appendScalar(lines, childIndent, 'Width', raw.width);
  appendEvents(lines, raw, name, childIndent);
  appendCompanions(lines, kind.tag, name, childIndent, id);
  const children = (raw.children as readonly FormElementDefinition[] | undefined)
    ?? (raw.columns as readonly FormElementDefinition[] | undefined);
  if (children?.length) {
    lines.push(`${childIndent}<ChildItems>`);
    for (const child of children) {
      lines.push(buildElementXml(child, `${childIndent}\t`, id));
    }
    lines.push(`${childIndent}</ChildItems>`);
  }
  lines.push(`${indent}</${kind.tag}>`);
  return lines.join('\n');
}

function detectElementKind(raw: FormElementDefinition): { tag: string; dslKey: string; defaultName: string } {
  const map: Record<string, string> = {
    group: 'UsualGroup',
    input: 'InputField',
    check: 'CheckBoxField',
    label: 'LabelDecoration',
    labelField: 'LabelField',
    table: 'Table',
    pages: 'Pages',
    page: 'Page',
    button: 'Button',
    picture: 'PictureDecoration',
    picField: 'PictureField',
    calendar: 'CalendarField',
    cmdBar: 'CommandBar',
    popup: 'Popup',
  };
  for (const [dslKey, tag] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(raw, dslKey)) {
      return { tag, dslKey, defaultName: dslKey };
    }
  }
  return { tag: 'InputField', dslKey: 'input', defaultName: String(raw.name ?? 'Поле') };
}

function buildAttributeXml(attr: FormAttributeDefinition, indent: string, id: number): string {
  validateName(attr.name, 'Имя реквизита формы');
  const type = attr.type ?? 'string';
  const lines = [
    `${indent}<Attribute name="${escapeXml(attr.name)}" id="${id}">`,
    buildTypeXml(type, `${indent}\t`),
  ];
  if (attr.main === true) {
    lines.push(`${indent}\t<MainAttribute>true</MainAttribute>`);
  }
  if (attr.savedData === true) {
    lines.push(`${indent}\t<SavedData>true</SavedData>`);
  }
  if (attr.columns?.length) {
    lines.push(`${indent}\t<Columns>`);
    let columnId = 1;
    for (const col of attr.columns) {
      lines.push(`${indent}\t\t<Column name="${escapeXml(col.name)}" id="${columnId++}">`);
      lines.push(buildTypeXml(col.type ?? 'string', `${indent}\t\t\t`));
      lines.push(`${indent}\t\t</Column>`);
    }
    lines.push(`${indent}\t</Columns>`);
  }
  if (attr.settings?.mainTable) {
    lines.push(`${indent}\t<Settings xsi:type="DynamicList">`);
    lines.push(`${indent}\t\t<MainTable>${escapeXml(String(attr.settings.mainTable))}</MainTable>`);
    if (attr.settings.dynamicDataRead === true) {
      lines.push(`${indent}\t\t<DynamicDataRead>true</DynamicDataRead>`);
    }
    lines.push(`${indent}\t</Settings>`);
  }
  lines.push(`${indent}</Attribute>`);
  return lines.join('\n');
}

function buildCommandXml(cmd: FormCommandDefinition, indent: string, id: number): string {
  validateName(cmd.name, 'Имя команды формы');
  const lines = [`${indent}<Command name="${escapeXml(cmd.name)}" id="${id}">`];
  if (cmd.title) {
    lines.push(buildLocalizedTag(`${indent}\t`, 'Title', cmd.title));
  }
  if (cmd.shortcut) {
    lines.push(`${indent}\t<Shortcut>${escapeXml(cmd.shortcut)}</Shortcut>`);
  }
  if (cmd.actions?.length) {
    for (const action of cmd.actions) {
      lines.push(`${indent}\t<Action${action.callType ? ` callType="${escapeXml(action.callType)}"` : ''}>${escapeXml(action.handler)}</Action>`);
    }
  } else {
    lines.push(`${indent}\t<Action${cmd.callType ? ` callType="${escapeXml(cmd.callType)}"` : ''}>${escapeXml(cmd.action ?? `${cmd.name}Обработка`)}</Action>`);
  }
  lines.push(`${indent}</Command>`);
  return lines.join('\n');
}

function buildTypeXml(typeDsl: string, indent: string): string {
  const types = typeDsl.split('|').map((item) => item.trim()).filter(Boolean);
  const lines = [`${indent}<Type>`];
  for (const type of types.length ? types : ['string']) {
    lines.push(`${indent}\t<v8:Type>${escapeXml(toXmlType(type))}</v8:Type>`);
  }
  const first = types[0] ?? typeDsl;
  const stringMatch = /^string(?:\((\d+)\))?$/i.exec(first);
  if (stringMatch) {
    lines.push(`${indent}\t<v8:StringQualifiers>`);
    lines.push(`${indent}\t\t<v8:Length>${stringMatch[1] ?? '0'}</v8:Length>`);
    lines.push(`${indent}\t\t<v8:AllowedLength>Variable</v8:AllowedLength>`);
    lines.push(`${indent}\t</v8:StringQualifiers>`);
  }
  const decimalMatch = /^decimal\((\d+),(\d+)(?:,(nonneg))?\)$/i.exec(first);
  if (decimalMatch) {
    lines.push(`${indent}\t<v8:NumberQualifiers>`);
    lines.push(`${indent}\t\t<v8:Digits>${decimalMatch[1]}</v8:Digits>`);
    lines.push(`${indent}\t\t<v8:FractionDigits>${decimalMatch[2]}</v8:FractionDigits>`);
    lines.push(`${indent}\t\t<v8:AllowedSign>${decimalMatch[3] ? 'Nonnegative' : 'Any'}</v8:AllowedSign>`);
    lines.push(`${indent}\t</v8:NumberQualifiers>`);
  }
  if (/^(date|datetime|time)$/i.test(first)) {
    lines.push(`${indent}\t<v8:DateQualifiers>`);
    lines.push(`${indent}\t\t<v8:DateFractions>${/^date$/i.test(first) ? 'Date' : /^time$/i.test(first) ? 'Time' : 'DateTime'}</v8:DateFractions>`);
    lines.push(`${indent}\t</v8:DateQualifiers>`);
  }
  lines.push(`${indent}</Type>`);
  return lines.join('\n');
}

function toXmlType(type: string): string {
  const normalized = type.trim();
  if (/^string/i.test(normalized)) {
    return 'xs:string';
  }
  if (/^decimal/i.test(normalized)) {
    return 'xs:decimal';
  }
  if (/^boolean$/i.test(normalized)) {
    return 'xs:boolean';
  }
  if (/^(date|datetime|time)$/i.test(normalized)) {
    return 'xs:dateTime';
  }
  const platform: Record<string, string> = {
    ValueTable: 'v8:ValueTable',
    ValueTree: 'v8:ValueTree',
    ValueList: 'v8:ValueListType',
    TypeDescription: 'v8:TypeDescription',
    UUID: 'v8:UUID',
    FormattedString: 'v8ui:FormattedString',
    Picture: 'v8ui:Picture',
    Color: 'v8ui:Color',
    Font: 'v8ui:Font',
    DataCompositionSettings: 'dcsset:DataCompositionSettings',
    DynamicList: 'cfg:DynamicList',
  };
  return platform[normalized] ?? (normalized.includes(':') ? normalized : `cfg:${normalized}`);
}

interface IdAllocator {
  nextElement(): number;
  nextAttribute(): number;
  nextCommand(): number;
}

function createIdAllocator(xml: string): IdAllocator {
  const max = (re: RegExp, min: number) => {
    let result = min;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > result) {
        result = value;
      }
    }
    return result;
  };
  let elementId = max(/\b(?:InputField|CheckBoxField|LabelDecoration|LabelField|Table|UsualGroup|Pages|Page|Button|PictureDecoration|PictureField|CalendarField|CommandBar|Popup|ContextMenu|ExtendedTooltip|AutoCommandBar|SearchStringAddition|ViewStatusAddition|SearchControlAddition)\b[^>]*\bid="(\d+)"/g, 0);
  let attrId = max(/<Attribute\b[^>]*\bid="(\d+)"/g, 0);
  let commandId = max(/<Command\b[^>]*\bid="(\d+)"/g, 0);
  const extension = /<BaseForm\b/.test(xml);
  if (extension) {
    elementId = Math.max(elementId, 999999);
    attrId = Math.max(attrId, 999999);
    commandId = Math.max(commandId, 999999);
  }
  return {
    nextElement: () => ++elementId,
    nextAttribute: () => ++attrId,
    nextCommand: () => ++commandId,
  };
}

function resolveObjectLocation(inputPath: string): { xmlPath: string; objectDir: string; kind: string; name: string } {
  const xmlPath = resolveObjectXmlPath(inputPath);
  if (!xmlPath) {
    throw new Error(`XML объекта не найден: ${inputPath}`);
  }
  const xml = fs.readFileSync(xmlPath, 'utf-8');
  const rootMatch = /<MetaDataObject\b[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\b/.exec(xml);
  const kind = rootMatch?.[1];
  const name = extractTag(extractBlock(xml, 'Properties') ?? xml, 'Name') ?? path.basename(xmlPath, '.xml');
  if (!kind) {
    throw new Error(`Не удалось определить тип объекта: ${xmlPath}`);
  }
  return {
    xmlPath,
    objectDir: path.join(path.dirname(xmlPath), path.basename(xmlPath, '.xml')),
    kind,
    name,
  };
}

function resolveObjectXmlPath(inputPath: string): string | null {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const dirName = path.basename(resolved);
    const inside = path.join(resolved, `${dirName}.xml`);
    const sibling = path.join(path.dirname(resolved), `${dirName}.xml`);
    if (fs.existsSync(inside)) {
      return inside;
    }
    if (fs.existsSync(sibling)) {
      return sibling;
    }
    return null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

function resolveFormXmlPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, 'Ext', 'Form.xml');
  }
  if (fs.existsSync(resolved)) {
    if (path.basename(resolved) === 'Form.xml') {
      return resolved;
    }
    if (resolved.endsWith('.xml')) {
      const formName = path.basename(resolved, '.xml');
      const body = path.join(path.dirname(resolved), formName, 'Ext', 'Form.xml');
      if (fs.existsSync(body)) {
        return body;
      }
    }
  }
  if (path.basename(resolved) === 'Form.xml') {
    const candidate = path.join(path.dirname(resolved), 'Ext', 'Form.xml');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`Form.xml не найден: ${inputPath}`);
  }
  return resolved;
}

function resolveFormXmlPathForWrite(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (path.basename(resolved) === 'Form.xml') {
    return resolved;
  }
  return path.join(resolved, 'Ext', 'Form.xml');
}

function normalizePurpose(value: string): FormPurpose {
  const normalized = `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}`;
  if (['Object', 'List', 'Choice', 'Record'].includes(normalized)) {
    return normalized as FormPurpose;
  }
  throw new Error(`Недопустимое назначение формы: ${value}`);
}

function validatePurpose(objectKind: string, purpose: FormPurpose): void {
  const processorLike = ['DataProcessor', 'Report', 'ExternalDataProcessor', 'ExternalReport'];
  if (purpose === 'Choice' && (processorLike.includes(objectKind) || objectKind === 'InformationRegister')) {
    throw new Error(`Purpose=Choice недопустим для ${objectKind}`);
  }
  if (purpose === 'Record' && objectKind !== 'InformationRegister') {
    throw new Error('Purpose=Record допустим только для InformationRegister');
  }
}

function isProcessorLike(kind: string): boolean {
  return ['DataProcessor', 'Report', 'ExternalDataProcessor', 'ExternalReport'].includes(kind);
}

function isExternalKind(kind: string): boolean {
  return kind === 'ExternalDataProcessor' || kind === 'ExternalReport';
}

function defaultFormProperty(kind: string, purpose: FormPurpose): string {
  if (purpose === 'Object') {
    return isProcessorLike(kind) ? 'DefaultForm' : 'DefaultObjectForm';
  }
  if (purpose === 'List') {
    return 'DefaultListForm';
  }
  if (purpose === 'Choice') {
    return 'DefaultChoiceForm';
  }
  return 'DefaultRecordForm';
}

function mainAttributeForPurpose(kind: string, name: string, purpose: FormPurpose): FormAttributeDefinition {
  if (purpose === 'List' || purpose === 'Choice') {
    return { name: 'Список', type: 'DynamicList', main: true, settings: { mainTable: `${kind}.${name}` } };
  }
  if (purpose === 'Record') {
    return { name: 'Запись', type: `InformationRegisterRecordManager.${name}`, main: true, savedData: true };
  }
  const prefix: Record<string, string> = {
    Document: 'DocumentObject',
    Catalog: 'CatalogObject',
    DataProcessor: 'DataProcessorObject',
    Report: 'ReportObject',
    ExternalDataProcessor: 'ExternalDataProcessorObject',
    ExternalReport: 'ExternalReportObject',
    ChartOfAccounts: 'ChartOfAccountsObject',
    ChartOfCharacteristicTypes: 'ChartOfCharacteristicTypesObject',
    ChartOfCalculationTypes: 'ChartOfCalculationTypesObject',
    ExchangePlan: 'ExchangePlanObject',
    BusinessProcess: 'BusinessProcessObject',
    Task: 'TaskObject',
    InformationRegister: 'InformationRegisterRecordManager',
    AccumulationRegister: 'AccumulationRegisterRecordSet',
  };
  return { name: 'Объект', type: `${prefix[kind] ?? `${kind}Object`}.${name}`, main: true, savedData: !isExternalKind(kind) };
}

function buildFormDescriptorXml(name: string, synonym: string, formatVersion: string, extendedPresentation: boolean): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${MD_XMLNS} version="${formatVersion}">`,
    `\t<Form uuid="${crypto.randomUUID()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', synonym),
    '\t\t\t<Comment/>',
    '\t\t\t<FormType>Managed</FormType>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<UsePurposes>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">MobilePlatformApplication</v8:Value>',
    '\t\t\t</UsePurposes>',
    ...(extendedPresentation ? ['\t\t\t<ExtendedPresentation/>'] : []),
    '\t\t</Properties>',
    '\t</Form>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildFormModule(withCreateAtServer: boolean): string {
  const createHandler = withCreateAtServer
    ? ['&НаСервере', 'Процедура ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)', '', 'КонецПроцедуры', '']
    : [];
  return [
    '#Область ОбработчикиСобытийФормы',
    '',
    ...createHandler,
    '#КонецОбласти',
    '',
    '#Область ОбработчикиСобытийЭлементовФормы',
    '',
    '#КонецОбласти',
    '',
    '#Область ОбработчикиКомандФормы',
    '',
    '#КонецОбласти',
    '',
    '#Область ОбработчикиОповещений',
    '',
    '#КонецОбласти',
    '',
    '#Область СлужебныеПроцедурыИФункции',
    '',
    '#КонецОбласти',
    '',
  ].join('\n');
}

function registerFormInObjectXml(xml: string, formName: string): string {
  if (new RegExp(`<Form>\\s*${escapeRegExp(formName)}\\s*<\\/Form>`).test(xml)) {
    return xml;
  }
  const formLine = `\t\t\t<Form>${escapeXml(formName)}</Form>`;
  if (/<ChildObjects\s*\/>/.test(xml)) {
    return xml.replace(/<ChildObjects\s*\/>/, `<ChildObjects>\n${formLine}\n\t\t</ChildObjects>`);
  }
  const childObjects = /<ChildObjects>([\s\S]*?)<\/ChildObjects>/.exec(xml);
  if (!childObjects) {
    throw new Error('Не найден ChildObjects в XML объекта.');
  }
  const inner = childObjects[1];
  const insertBefore = /(\n\s*<(?:Template|TabularSection)>)/.exec(inner);
  const nextInner = insertBefore
    ? `${inner.slice(0, insertBefore.index)}\n${formLine}${inner.slice(insertBefore.index)}`
    : `${inner.trimEnd()}\n${formLine}\n\t\t`;
  return xml.slice(0, childObjects.index) + `<ChildObjects>${nextInner}</ChildObjects>` + xml.slice(childObjects.index + childObjects[0].length);
}

function removeFormFromObjectXml(xml: string, formName: string): string {
  return xml.replace(new RegExp(`\\n?\\s*<Form>\\s*${escapeRegExp(formName)}\\s*<\\/Form>`, 'g'), '');
}

function ensureDescriptorAndRegistrationForCompiledForm(formPath: string, title: string | undefined): string[] {
  const parts = formPath.split(path.sep);
  const formsIndex = parts.lastIndexOf('Forms');
  if (formsIndex < 2) {
    return [];
  }
  const formName = parts[formsIndex + 1];
  const objectDir = parts.slice(0, formsIndex).join(path.sep);
  const objectXml = `${objectDir}.xml`;
  if (!formName || !fs.existsSync(objectXml)) {
    return [];
  }
  const changed: string[] = [];
  const descriptor = path.join(objectDir, 'Forms', `${formName}.xml`);
  if (!fs.existsSync(descriptor)) {
    writeNewTextFile(descriptor, buildFormDescriptorXml(formName, title ?? formName, detectFormatVersion(objectXml), true));
    changed.push(descriptor);
  }
  const original = fs.readFileSync(objectXml, 'utf-8');
  const next = registerFormInObjectXml(original, formName);
  if (next !== original) {
    writeTextFilePreservingBomAndEol(objectXml, original, next);
    changed.push(objectXml);
  }
  const modulePath = path.join(objectDir, 'Forms', formName, 'Ext', 'Form', 'Module.bsl');
  if (!fs.existsSync(modulePath)) {
    writeNewTextFile(modulePath, buildFormModule(false));
    changed.push(modulePath);
  }
  return changed;
}

function inferDefinitionFromOutputPath(formPath: string): FormDefinition {
  const parts = formPath.split(path.sep);
  const formsIndex = parts.lastIndexOf('Forms');
  const formName = formsIndex >= 0 ? parts[formsIndex + 1] : 'Форма';
  const objectDir = formsIndex >= 1 ? parts.slice(0, formsIndex).join(path.sep) : '';
  const objectXml = `${objectDir}.xml`;
  if (!fs.existsSync(objectXml)) {
    return { title: formName };
  }
  const loc = resolveObjectLocation(objectXml);
  return {
    title: formName,
    events: { OnCreateAtServer: 'ПриСозданииНаСервере' },
    attributes: [mainAttributeForPurpose(loc.kind, loc.name, 'Object')],
  };
}

function appendIntoContainer(xml: string, containerTag: string, content: string): string {
  if (!content.trim()) {
    return xml;
  }
  const selfClosing = new RegExp(`<${containerTag}\\s*\\/>`);
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, `<${containerTag}>\n${content}\n\t</${containerTag}>`);
  }
  const re = new RegExp(`(<${containerTag}>)([\\s\\S]*?)(<\\/${containerTag}>)`);
  if (re.test(xml)) {
    return xml.replace(re, (_, open: string, inner: string, close: string) => `${open}${inner.trimEnd()}\n${content}\n\t${close}`);
  }
  const before = /<\/Form>\s*$/.exec(xml);
  if (!before) {
    return `${xml}\n<${containerTag}>\n${content}\n</${containerTag}>\n`;
  }
  return `${xml.slice(0, before.index)}\t<${containerTag}>\n${content}\n\t</${containerTag}>\n${xml.slice(before.index)}`;
}

function appendIntoNamedElementChildItems(xml: string, elementName: string, content: string): string {
  const re = new RegExp(`(<[A-Za-z]+\\b[^>]*name="${escapeRegExp(elementName)}"[^>]*>[\\s\\S]*?)(<ChildItems>)([\\s\\S]*?)(<\\/ChildItems>)`);
  if (re.test(xml)) {
    return xml.replace(re, (_, prefix: string, open: string, inner: string, close: string) => `${prefix}${open}${inner.trimEnd()}\n${content}\n\t\t${close}`);
  }
  return appendIntoContainer(xml, 'ChildItems', content);
}

function appendFormEvents(xml: string, events: readonly FormEventPatch[]): string {
  const content = events.map((event) => `\t\t<Event name="${escapeXml(event.name)}"${event.callType ? ` callType="${escapeXml(event.callType)}"` : ''}>${escapeXml(event.handler)}</Event>`).join('\n');
  return appendIntoContainer(xml, 'Events', content);
}

function appendElementEvent(xml: string, event: ElementEventPatch): string {
  const block = `\t\t<Event name="${escapeXml(event.name)}"${event.callType ? ` callType="${escapeXml(event.callType)}"` : ''}>${escapeXml(event.handler)}</Event>`;
  const re = new RegExp(`(<[A-Za-z]+\\b[^>]*name="${escapeRegExp(event.element)}"[^>]*>[\\s\\S]*?)(<Events>)([\\s\\S]*?)(<\\/Events>)`);
  if (re.test(xml)) {
    return xml.replace(re, (_, prefix: string, open: string, inner: string, close: string) => `${prefix}${open}${inner.trimEnd()}\n${block}\n\t\t${close}`);
  }
  const elementOpen = new RegExp(`(<[A-Za-z]+\\b[^>]*name="${escapeRegExp(event.element)}"[^>]*>)`);
  return xml.replace(elementOpen, `$1\n\t\t<Events>\n${block}\n\t\t</Events>`);
}

function collectElements(xml: string): FormElementInfo[] {
  const result: FormElementInfo[] = [];
  const elementTags = 'InputField|CheckBoxField|LabelDecoration|LabelField|Table|UsualGroup|Pages|Page|Button|PictureDecoration|PictureField|CalendarField|CommandBar|Popup';
  const re = new RegExp(`<(${elementTags})\\b([^>]*)(\\/?)>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const tag = match[1];
    const attrs = match[2] ?? '';
    const body = match[3] === '/' ? '' : xml.slice(match.index + match[0].length, findElementClose(xml, tag, re.lastIndex));
    result.push({
      tag,
      name: attr(attrs, 'name') ?? '',
      id: attr(attrs, 'id') ?? '',
      dataPath: extractTag(body, 'DataPath'),
      commandName: extractTag(body, 'CommandName'),
    });
  }
  return result;
}

function findElementClose(xml: string, tag: string, from: number): number {
  const close = xml.indexOf(`</${tag}>`, from);
  return close >= 0 ? close : from;
}

function collectAttributes(xml: string): FormAttributeInfo[] {
  const attrsBlock = extractBlock(xml, 'Attributes') ?? '';
  const result: FormAttributeInfo[] = [];
  const re = /<Attribute\b([^>]*)>([\s\S]*?)<\/Attribute>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrsBlock)) !== null) {
    const body = match[2] ?? '';
    result.push({
      name: attr(match[1] ?? '', 'name') ?? '',
      id: attr(match[1] ?? '', 'id') ?? '',
      types: [...body.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((item) => item[1]),
      main: /<MainAttribute>\s*true\s*<\/MainAttribute>/.test(body),
    });
  }
  return result;
}

function collectCommands(xml: string): FormCommandInfo[] {
  const cmdsBlock = extractBlock(xml, 'Commands') ?? '';
  const result: FormCommandInfo[] = [];
  const re = /<Command\b([^>]*)>([\s\S]*?)<\/Command>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cmdsBlock)) !== null) {
    const body = match[2] ?? '';
    result.push({
      name: attr(match[1] ?? '', 'name') ?? '',
      id: attr(match[1] ?? '', 'id') ?? '',
      actions: [...body.matchAll(/<Action(?:\s[^>]*)?>([^<]+)<\/Action>/g)].map((item) => item[1]),
    });
  }
  return result;
}

function collectEvents(xml: string): string[] {
  return [...xml.matchAll(/<Event\b([^>]*)>([^<]*)<\/Event>/g)]
    .map((match) => `${attr(match[1], 'name') ?? ''}${attr(match[1], 'callType') ? `[${attr(match[1], 'callType')}]` : ''} -> ${(match[2] ?? '').trim()}`)
    .filter((line) => !line.startsWith(' ->'));
}

function buildInfoLines(info: {
  readonly title: string;
  readonly elements: readonly FormElementInfo[];
  readonly attributes: readonly FormAttributeInfo[];
  readonly commands: readonly FormCommandInfo[];
  readonly events: readonly string[];
  readonly baseForm?: string;
}): string[] {
  const lines = [`Form: ${info.title}`];
  if (info.baseForm) {
    lines.push('BaseForm: present');
  }
  lines.push(`Elements: ${info.elements.length}`);
  for (const el of info.elements) {
    const detail = [el.dataPath ? `path=${el.dataPath}` : '', el.commandName ? `command=${el.commandName}` : ''].filter(Boolean).join(' ');
    lines.push(`  [${el.tag}] ${el.name} id=${el.id}${detail ? ` ${detail}` : ''}`);
  }
  lines.push(`Attributes: ${info.attributes.length}`);
  for (const attrInfo of info.attributes) {
    lines.push(`  ${attrInfo.name} id=${attrInfo.id} type=${attrInfo.types.join(' | ') || '(empty)'}${attrInfo.main ? ' main' : ''}`);
  }
  if (info.commands.length) {
    lines.push('Commands:');
    for (const cmd of info.commands) {
      lines.push(`  ${cmd.name} id=${cmd.id} -> ${cmd.actions.join(', ')}`);
    }
  }
  if (info.events.length) {
    lines.push('Events:');
    lines.push(...info.events.map((event) => `  ${event}`));
  }
  return lines;
}

function validateUniqueIds(
  items: readonly { readonly kind: string; readonly name: string; readonly id: string }[],
  reportError: (message: string) => void,
  reportOk: () => void
): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.id || item.id === '-1') {
      continue;
    }
    const previous = seen.get(item.id);
    if (previous) {
      reportError(`Duplicate ${item.kind} id=${item.id}: "${item.name}" and "${previous}".`);
      return;
    }
    seen.set(item.id, item.name);
  }
  reportOk();
}

function validateDataPaths(
  elements: readonly FormElementInfo[],
  attributes: readonly FormAttributeInfo[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const attrNames = new Set(attributes.map((attrInfo) => attrInfo.name));
  let checked = 0;
  for (const el of elements) {
    if (!el.dataPath) {
      continue;
    }
    checked++;
    const root = el.dataPath.replace(/\[\d+\]/g, '').split('.')[0];
    if (!attrNames.has(root)) {
      reportError(`[${el.tag}] "${el.name}": DataPath="${el.dataPath}" — attribute "${root}" not found.`);
      return;
    }
  }
  if (checked > 0) {
    reportOk(`DataPath references: ${checked} paths checked.`);
  }
}

function validateCommandRefs(
  elements: readonly FormElementInfo[],
  commands: readonly FormCommandInfo[],
  reportError: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const commandNames = new Set(commands.map((cmd) => cmd.name));
  let checked = 0;
  for (const el of elements) {
    if (!el.commandName?.startsWith('Form.Command.')) {
      continue;
    }
    checked++;
    const commandName = el.commandName.slice('Form.Command.'.length);
    if (!commandNames.has(commandName)) {
      reportError(`[Button] "${el.name}": CommandName="${el.commandName}" — command "${commandName}" not found.`);
      return;
    }
  }
  if (checked > 0) {
    reportOk(`Command references: ${checked} buttons checked.`);
  }
}

function validateEventHandlers(xml: string, reportError: (message: string) => void, reportOk: (message: string) => void): void {
  let checked = 0;
  for (const match of xml.matchAll(/<Event\b([^>]*)>([^<]*)<\/Event>/g)) {
    checked++;
    if (!(match[2] ?? '').trim()) {
      reportError(`Event "${attr(match[1], 'name') ?? ''}": empty handler name.`);
      return;
    }
  }
  if (checked > 0) {
    reportOk(`Event handlers: ${checked} events checked.`);
  }
}

function validateTypes(
  xml: string,
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  const invalid = new Set(['FormDataStructure', 'FormDataCollection', 'FormDataTree', 'FormGroup', 'FormField', 'FormButton']);
  const values = [...xml.matchAll(/<v8:Type>([^<]+)<\/v8:Type>/g)].map((match) => match[1]);
  for (const value of values) {
    if (invalid.has(value)) {
      reportError(`Type "${value}": invalid runtime/UI type.`);
      return;
    }
    if (!value.includes(':')) {
      reportWarn(`Type "${value}": bare type without namespace prefix.`);
    }
  }
  reportOk(values.length ? `Types: ${values.length} values checked.` : 'Types: no type values to check.');
}

function validateCallTypes(
  xml: string,
  reportError: (message: string) => void,
  reportWarn: (message: string) => void,
  reportOk: (message: string) => void
): void {
  let checked = 0;
  for (const match of xml.matchAll(/\bcallType="([^"]+)"/g)) {
    checked++;
    if (!VALID_CALL_TYPES.has(match[1])) {
      reportError(`Invalid callType="${match[1]}".`);
      return;
    }
  }
  if (checked > 0 && !/<BaseForm\b/.test(xml)) {
    reportWarn('callType attributes found but no BaseForm — possible incorrect structure.');
    return;
  }
  if (checked > 0) {
    reportOk(`callType values: ${checked} checked.`);
  }
}

function finalizeFormValidation(formPath: string, errors: number, warnings: number, ok: number, lines: string[]): FormValidationResult {
  const checks = errors + warnings + ok;
  if (errors === 0 && warnings === 0 && lines.length <= 2) {
    lines.push(`=== Validation OK: ${path.basename(formPath)} (${checks} checks) ===`);
  } else {
    lines.push('');
    lines.push(`=== Result: ${errors} errors, ${warnings} warnings (${checks} checks) ===`);
  }
  return { formPath, errors, warnings, checks, lines };
}

function appendCompanions(lines: string[], tag: string, name: string, indent: string, id: IdAllocator): void {
  const contextMenu = new Set(['InputField', 'CheckBoxField', 'LabelDecoration', 'LabelField', 'PictureDecoration', 'PictureField', 'CalendarField', 'Table']);
  const tooltip = new Set(['InputField', 'CheckBoxField', 'LabelDecoration', 'LabelField', 'PictureDecoration', 'PictureField', 'CalendarField', 'Table', 'UsualGroup', 'Pages', 'Page', 'Button']);
  if (contextMenu.has(tag)) {
    lines.push(`${indent}<ContextMenu name="${escapeXml(name)}КонтекстноеМеню" id="${id.nextElement()}"/>`);
  }
  if (tag === 'Table') {
    lines.push(`${indent}<AutoCommandBar name="${escapeXml(name)}КоманднаяПанель" id="${id.nextElement()}"><Autofill>true</Autofill></AutoCommandBar>`);
    lines.push(`${indent}<SearchStringAddition name="${escapeXml(name)}СтрокаПоиска" id="${id.nextElement()}"/>`);
    lines.push(`${indent}<ViewStatusAddition name="${escapeXml(name)}СостояниеПросмотра" id="${id.nextElement()}"/>`);
    lines.push(`${indent}<SearchControlAddition name="${escapeXml(name)}УправлениеПоиском" id="${id.nextElement()}"/>`);
  }
  if (tooltip.has(tag)) {
    lines.push(`${indent}<ExtendedTooltip name="${escapeXml(name)}РасширеннаяПодсказка" id="${id.nextElement()}"/>`);
  }
}

function appendEvents(lines: string[], raw: FormElementDefinition, elementName: string, indent: string): void {
  const events = normalizeEvents(raw.on, raw.handlers, elementName);
  if (!events.length) {
    return;
  }
  lines.push(`${indent}<Events>`);
  for (const event of events) {
    lines.push(`${indent}\t<Event name="${escapeXml(event.name)}"${event.callType ? ` callType="${escapeXml(event.callType)}"` : ''}>${escapeXml(event.handler)}</Event>`);
  }
  lines.push(`${indent}</Events>`);
}

function normalizeEvents(on: unknown, handlers: unknown, elementName: string): FormEventPatch[] {
  const result: FormEventPatch[] = [];
  if (Array.isArray(on)) {
    for (const value of on) {
      if (typeof value === 'string') {
        result.push({ name: value, handler: `${elementName}${eventSuffix(value)}` });
      } else if (value && typeof value === 'object') {
        const item = value as Record<string, unknown>;
        const name = String(item.event ?? item.name ?? '');
        if (name) {
          result.push({ name, handler: String(item.handler ?? `${elementName}${eventSuffix(name)}`), callType: item.callType ? String(item.callType) : undefined });
        }
      }
    }
  }
  if (handlers && typeof handlers === 'object') {
    for (const [name, handler] of Object.entries(handlers as Record<string, unknown>)) {
      result.push({ name, handler: String(handler) });
    }
  }
  return result;
}

function eventSuffix(event: string): string {
  const map: Record<string, string> = {
    OnChange: 'ПриИзменении',
    Click: 'Нажатие',
    StartChoice: 'НачалоВыбора',
    ChoiceProcessing: 'ОбработкаВыбора',
    OnCurrentPageChange: 'ПриСменеСтраницы',
  };
  return map[event] ?? event;
}

function buildEventsXml(events: Record<string, string>, indent: string): string {
  return [
    `${indent}<Events>`,
    ...Object.entries(events).map(([name, handler]) => `${indent}\t<Event name="${escapeXml(name)}">${escapeXml(handler)}</Event>`),
    `${indent}</Events>`,
  ].join('\n');
}

function buildLocalizedTag(indent: string, tag: string, text: string): string {
  return [
    `${indent}<${tag}>`,
    `${indent}\t<v8:item>`,
    `${indent}\t\t<v8:lang>ru</v8:lang>`,
    `${indent}\t\t<v8:content>${escapeXml(text)}</v8:content>`,
    `${indent}\t</v8:item>`,
    `${indent}</${tag}>`,
  ].join('\n');
}

function appendBoolean(lines: string[], indent: string, tag: string, value: boolean | undefined): void {
  if (value !== undefined) {
    lines.push(`${indent}<${tag}>${String(value)}</${tag}>`);
  }
}

function appendScalar(lines: string[], indent: string, tag: string, value: unknown): void {
  if (value !== undefined) {
    lines.push(`${indent}<${tag}>${escapeXml(String(value))}</${tag}>`);
  }
}

function detectFormatVersion(startPath: string): string {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
  while (current && current !== path.dirname(current)) {
    const configXml = path.join(current, 'Configuration.xml');
    if (fs.existsSync(configXml)) {
      const head = fs.readFileSync(configXml, 'utf-8').slice(0, 2000);
      return /<MetaDataObject\b[^>]*version="([^"]+)"/.exec(head)?.[1] ?? '2.17';
    }
    current = path.dirname(current);
  }
  return '2.17';
}

function isEmptyTagValue(xml: string, tag: string): boolean {
  const value = extractTag(xml, tag);
  return value === undefined || value === '';
}

function setTagValue(xml: string, tag: string, value: string, createIfMissing = false): string {
  const escaped = escapeXml(value);
  const selfClosing = new RegExp(`<${tag}\\s*\\/>`);
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, value ? `<${tag}>${escaped}</${tag}>` : `<${tag}/>`);
  }
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`);
  if (re.test(xml)) {
    return xml.replace(re, value ? `<${tag}>${escaped}</${tag}>` : `<${tag}/>`);
  }
  if (createIfMissing) {
    return xml.replace(/<\/Properties>/, `\t\t\t<${tag}>${escaped}</${tag}>\n\t\t</Properties>`);
  }
  return xml;
}

function extractBlock(xml: string, tagName: string): string | null {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1] ?? null;
}

function extractTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`);
  return re.exec(xml)?.[1]?.trim();
}

function extractLocalizedContent(xml: string): string | undefined {
  return /<v8:content>([\s\S]*?)<\/v8:content>/.exec(xml)?.[1]?.trim();
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`${escapeRegExp(name)}="([^"]*)"`).exec(attrs)?.[1];
}

function validateName(value: string, label: string): void {
  if (!IDENT_PATTERN.test(value)) {
    throw new Error(`${label} должно быть идентификатором 1С.`);
  }
}

function writeNewTextFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\ufeff${content}`, 'utf-8');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
