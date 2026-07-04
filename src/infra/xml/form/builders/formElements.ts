/**
 * Эмиттеры элементов управляемой формы: диспетчер `emitElement`, главная
 * авто-командная панель и все конкретные эмиттеры (группы/поля/таблицы/
 * страницы/декорации/попапы) вместе с общими для элементов хелперами
 * (title/flags/companion/events). Состояния нет — id берутся из IdAllocator,
 * предупреждения уходят в общий WARN_SINK из formBuilderShared.
 */
import { buildLocalizedTag, type IdAllocator } from '../FormShared';
import type { FormDefinition, FormElementDefinition } from '../types';
import {
  type EmitContext,
  escapeXml,
  ENUM_VALUE_SYNONYMS,
  getHandlerName,
  isPlainObject,
  KNOWN_EVENTS,
  REF_ROOT_SYNONYMS,
  titleFromName,
  warn,
  xmlStr,
} from './formBuilderShared';

// Силентная замена: модель часто пишет XML-имя или русское имя — приводим к DSL-ключу
const ELEMENT_TYPE_SYNONYMS: Record<string, string> = {
  commandBar: 'cmdBar',
  autoCommandBar: 'autoCmdBar',
  КоманднаяПанель: 'cmdBar',
  InputField: 'input',
  ПолеВвода: 'input',
  CheckBoxField: 'check',
  ПолеФлажка: 'check',
  RadioButtonField: 'radio',
  ПолеПереключателя: 'radio',
  radioButton: 'radio',
  PictureField: 'picField',
  ПолеКартинки: 'picField',
  LabelField: 'labelField',
  ПолеНадписи: 'labelField',
  CalendarField: 'calendar',
  ПолеКалендаря: 'calendar',
  LabelDecoration: 'label',
  Надпись: 'label',
  PictureDecoration: 'picture',
  Картинка: 'picture',
  UsualGroup: 'group',
  Группа: 'group',
  ОбычнаяГруппа: 'group',
  ColumnGroup: 'columnGroup',
  ГруппаКолонок: 'columnGroup',
  Pages: 'pages',
  ГруппаСтраниц: 'pages',
  Page: 'page',
  Страница: 'page',
  Table: 'table',
  Таблица: 'table',
  Button: 'button',
  Кнопка: 'button',
  Popup: 'popup',
  ВсплывающееМеню: 'popup',
};

const TYPE_KEYS = [
  'columnGroup', 'group', 'input', 'check', 'radio', 'label', 'labelField',
  'table', 'pages', 'page', 'button', 'picture', 'picField', 'calendar',
  'cmdBar', 'popup',
] as const;

export interface NormalizedDefinition extends FormDefinition {
  readonly mainAutoCmdBar?: FormElementDefinition;
}

export function emitMainAutoCommandBar(lines: string[], defn: NormalizedDefinition, id: IdAllocator): void {
  const main = defn.mainAutoCmdBar;
  let acbName = 'ФормаКоманднаяПанель';
  let acbHorizontalAlign: string | undefined;
  let acbAutofill = true;

  if (main) {
    const autoCmdBarValue = (main as Record<string, unknown>).autoCmdBar;
    if (autoCmdBarValue) {
      acbName = xmlStr(autoCmdBarValue);
    }
    const mainName = (main as Record<string, unknown>).name;
    if (typeof mainName === 'string') {
      acbName = mainName;
    }
    const horizontalAlign = (main as Record<string, unknown>).horizontalAlign;
    if (typeof horizontalAlign === 'string') {
      acbHorizontalAlign = horizontalAlign;
    }
    if ('autofill' in main) {
      acbAutofill = Boolean((main as Record<string, unknown>).autofill);
    }
  } else if (Array.isArray(defn.elements) && defn.elements.some(hasCmdBarRecursive)) {
    acbAutofill = false;
  }

  const children = main && Array.isArray((main as Record<string, unknown>).children)
    ? (main as { children: unknown[] }).children
    : [];
  const hasInner = Boolean(acbHorizontalAlign) || !acbAutofill || children.length > 0;
  if (!hasInner) {
    lines.push(`\t<AutoCommandBar name="${escapeXml(acbName)}" id="-1"/>`);
    return;
  }
  lines.push(`\t<AutoCommandBar name="${escapeXml(acbName)}" id="-1">`);
  if (acbHorizontalAlign) {
    lines.push(`\t\t<HorizontalAlign>${escapeXml(acbHorizontalAlign)}</HorizontalAlign>`);
  }
  if (!acbAutofill) {
    lines.push('\t\t<Autofill>false</Autofill>');
  }
  if (children.length > 0) {
    lines.push('\t\t<ChildItems>');
    for (const child of children) {
      emitElement(lines, child as FormElementDefinition, '\t\t\t', id, { inCmdBar: true });
    }
    lines.push('\t\t</ChildItems>');
  }
  lines.push('\t</AutoCommandBar>');
}

export function hasCmdBarRecursive(el: unknown): boolean {
  if (!isPlainObject(el)) {
    return false;
  }
  if (el.cmdBar !== undefined) {
    return true;
  }
  if (Array.isArray(el.children) && el.children.some(hasCmdBarRecursive)) {
    return true;
  }
  if (Array.isArray(el.columns) && el.columns.some(hasCmdBarRecursive)) {
    return true;
  }
  return false;
}

// ─── Element dispatch ───────────────────────────────────────────────────────

export function emitElement(lines: string[], raw: FormElementDefinition, indent: string, id: IdAllocator, ctx: EmitContext = {}): void {
  if (!isPlainObject(raw)) {
    return;
  }
  // Перестраиваем объект, переименовывая ключи-синонимы: динамический delete
  // запрещён линтером, поэтому собираем новый объект из исходных пар.
  const rawObj = raw as Record<string, unknown>;
  const el: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawObj)) {
    if (key in ELEMENT_TYPE_SYNONYMS) {
      const dst = ELEMENT_TYPE_SYNONYMS[key];
      if (!(dst in rawObj)) {
        el[dst] = value;
        continue;
      }
    }
    el[key] = value;
  }

  let typeKey: string | undefined;
  for (const key of TYPE_KEYS) {
    if (el[key] !== undefined && el[key] !== null) {
      typeKey = key;
      break;
    }
  }
  if (!typeKey) {
    warn('[WARN] Unknown element type, skipping');
    return;
  }

  const name = xmlStr(el.name ?? el[typeKey]);
  const eid = id.nextElement();
  switch (typeKey) {
    case 'group': emitGroup(lines, el, name, eid, indent, id); break;
    case 'columnGroup': emitColumnGroup(lines, el, name, eid, indent, id); break;
    case 'input': emitInput(lines, el, name, eid, indent, id); break;
    case 'check': emitCheck(lines, el, name, eid, indent, id); break;
    case 'radio': emitRadioButtonField(lines, el, name, eid, indent, id); break;
    case 'label': emitLabel(lines, el, name, eid, indent, id); break;
    case 'labelField': emitLabelField(lines, el, name, eid, indent, id); break;
    case 'table': emitTable(lines, el, name, eid, indent, id); break;
    case 'pages': emitPages(lines, el, name, eid, indent, id); break;
    case 'page': emitPage(lines, el, name, eid, indent, id); break;
    case 'button': emitButton(lines, el, name, eid, indent, id, ctx.inCmdBar === true); break;
    case 'picture': emitPictureDecoration(lines, el, name, eid, indent, id); break;
    case 'picField': emitPictureField(lines, el, name, eid, indent, id); break;
    case 'calendar': emitCalendar(lines, el, name, eid, indent, id); break;
    case 'cmdBar': emitCommandBar(lines, el, name, eid, indent, id); break;
    case 'popup': emitPopup(lines, el, name, eid, indent, id); break;
  }
}

// ─── Element emitters ───────────────────────────────────────────────────────

function emitGroup(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<UsualGroup name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner);
  const groupVal = xmlStr(el.group ?? '');
  const orientationMap: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', alwaysHorizontal: 'AlwaysHorizontal', alwaysVertical: 'AlwaysVertical' };
  const orientation = orientationMap[groupVal];
  if (orientation) {
    lines.push(`${inner}<Group>${orientation}</Group>`);
  }
  if (groupVal === 'collapsible') {
    lines.push(`${inner}<Group>Vertical</Group>`);
    lines.push(`${inner}<Behavior>Collapsible</Behavior>`);
    if (el.collapsed === true) {
      lines.push(`${inner}<Collapsed>true</Collapsed>`);
    }
  }
  if (el.representation) {
    const reprMap: Record<string, string> = { none: 'None', normal: 'NormalSeparation', weak: 'WeakSeparation', strong: 'StrongSeparation' };
    const reprVal = reprMap[xmlStr(el.representation)] ?? xmlStr(el.representation);
    lines.push(`${inner}<Representation>${escapeXml(reprVal)}</Representation>`);
  }
  if (el.showTitle === false) {
    lines.push(`${inner}<ShowTitle>false</ShowTitle>`);
  }
  if (el.united === false) {
    lines.push(`${inner}<United>false</United>`);
  }
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</UsualGroup>`);
}

function emitColumnGroup(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<ColumnGroup name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner);
  const groupVal = xmlStr(el.columnGroup ?? '');
  const orientationMap: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', inCell: 'InCell' };
  const orientation = orientationMap[groupVal];
  if (orientation) {
    lines.push(`${inner}<Group>${orientation}</Group>`);
  }
  if (el.showTitle === false) {
    lines.push(`${inner}<ShowTitle>false</ShowTitle>`);
  }
  if (el.showInHeader !== undefined && el.showInHeader !== null) {
    lines.push(`${inner}<ShowInHeader>${el.showInHeader === true ? 'true' : 'false'}</ShowInHeader>`);
  }
  if (el.width) {
    lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);
  }
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</ColumnGroup>`);
}

function emitInput(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<InputField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  if (el.titleLocation) {
    const locMap: Record<string, string> = { none: 'None', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };
    lines.push(`${inner}<TitleLocation>${escapeXml(locMap[xmlStr(el.titleLocation)] ?? xmlStr(el.titleLocation))}</TitleLocation>`);
  }
  if (el.multiLine === true) {lines.push(`${inner}<MultiLine>true</MultiLine>`);}
  if (el.passwordMode === true) {lines.push(`${inner}<PasswordMode>true</PasswordMode>`);}
  if (el.choiceButton === false) {lines.push(`${inner}<ChoiceButton>false</ChoiceButton>`);}
  if (el.clearButton === true) {lines.push(`${inner}<ClearButton>true</ClearButton>`);}
  if (el.spinButton === true) {lines.push(`${inner}<SpinButton>true</SpinButton>`);}
  if (el.dropListButton === true) {lines.push(`${inner}<DropListButton>true</DropListButton>`);}
  if (el.markIncomplete === true) {lines.push(`${inner}<AutoMarkIncomplete>true</AutoMarkIncomplete>`);}
  if (el.textEdit === false) {lines.push(`${inner}<TextEdit>false</TextEdit>`);}
  if (el.skipOnInput === true) {lines.push(`${inner}<SkipOnInput>true</SkipOnInput>`);}
  if ('autoMaxWidth' in el) {
    if (el.autoMaxWidth === false) {lines.push(`${inner}<AutoMaxWidth>false</AutoMaxWidth>`);}
  } else if (el.multiLine === true) {
    lines.push(`${inner}<AutoMaxWidth>false</AutoMaxWidth>`);
  }
  if (el.maxWidth !== undefined && el.maxWidth !== null) {lines.push(`${inner}<MaxWidth>${escapeXml(xmlStr(el.maxWidth))}</MaxWidth>`);}
  if (el.autoMaxHeight === false) {lines.push(`${inner}<AutoMaxHeight>false</AutoMaxHeight>`);}
  if (el.maxHeight !== undefined && el.maxHeight !== null) {lines.push(`${inner}<MaxHeight>${escapeXml(xmlStr(el.maxHeight))}</MaxHeight>`);}
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  if (el.horizontalStretch === true) {lines.push(`${inner}<HorizontalStretch>true</HorizontalStretch>`);}
  if (el.verticalStretch === true) {lines.push(`${inner}<VerticalStretch>true</VerticalStretch>`);}
  if (el.inputHint) {
    lines.push(...buildLocalizedTag(inner, 'InputHint', xmlStr(el.inputHint)).split('\n'));
  }
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'input');
  lines.push(`${indent}</InputField>`);
}

function emitCheck(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<CheckBoxField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  const tl = el.titleLocation ? xmlStr(el.titleLocation) : 'Right';
  lines.push(`${inner}<TitleLocation>${escapeXml(tl)}</TitleLocation>`);
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'check');
  lines.push(`${indent}</CheckBoxField>`);
}

function emitRadioButtonField(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<RadioButtonField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  let tl: string;
  if (el.titleLocation) {
    const locMap: Record<string, string> = { none: 'None', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };
    tl = locMap[xmlStr(el.titleLocation)] ?? xmlStr(el.titleLocation);
  } else {
    tl = 'None';
  }
  lines.push(`${inner}<TitleLocation>${escapeXml(tl)}</TitleLocation>`);
  lines.push(`${inner}<RadioButtonType>${escapeXml(normalizeRadioButtonType(el.radioButtonType))}</RadioButtonType>`);
  if (el.columnsCount !== undefined && el.columnsCount !== null) {
    lines.push(`${inner}<ColumnsCount>${escapeXml(xmlStr(el.columnsCount))}</ColumnsCount>`);
  }
  const choiceList = Array.isArray(el.choiceList) ? el.choiceList : [];
  if (choiceList.length > 0) {
    lines.push(`${inner}<ChoiceList>`);
    const itemIndent = `${inner}\t`;
    for (const item of choiceList) {
      if (!isPlainObject(item)) {continue;}
      const valRaw = item.value ?? item['значение'];
      const hasPres = 'presentation' in item || 'представление' in item || 'title' in item;
      let presRaw: unknown = item.presentation ?? item['представление'] ?? item.title;
      const norm = normalizeChoiceValue(valRaw);
      if (!hasPres) {
        if (norm.xsiType === 'xr:DesignTimeRef') {
          const tail = norm.text.split('.').pop() ?? norm.text;
          presRaw = titleFromName(tail);
        } else {
          presRaw = norm.text;
        }
      }
      lines.push(`${itemIndent}<xr:Item>`);
      const valIndent = `${itemIndent}\t`;
      lines.push(`${valIndent}<xr:Presentation/>`);
      lines.push(`${valIndent}<xr:CheckState>0</xr:CheckState>`);
      lines.push(`${valIndent}<xr:Value xsi:type="FormChoiceListDesTimeValue">`);
      emitChoicePresentation(lines, presRaw, `${valIndent}\t`);
      lines.push(`${valIndent}\t<Value xsi:type="${norm.xsiType}">${escapeXml(norm.text)}</Value>`);
      lines.push(`${valIndent}</xr:Value>`);
      lines.push(`${itemIndent}</xr:Item>`);
    }
    lines.push(`${inner}</ChoiceList>`);
  }
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'radio');
  lines.push(`${indent}</RadioButtonField>`);
}

function emitLabel(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<LabelDecoration name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  const labelTitle = xmlStr(el.title ?? titleFromName(name));
  if (labelTitle.length > 0) {
    const formatted = el.hyperlink === true ? 'true' : 'false';
    lines.push(`${inner}<Title formatted="${formatted}">`);
    lines.push(`${inner}\t<v8:item>`);
    lines.push(`${inner}\t\t<v8:lang>ru</v8:lang>`);
    lines.push(`${inner}\t\t<v8:content>${escapeXml(labelTitle)}</v8:content>`);
    lines.push(`${inner}\t</v8:item>`);
    lines.push(`${inner}</Title>`);
  }
  emitCommonFlags(lines, el, inner);
  if (el.hyperlink === true) {lines.push(`${inner}<Hyperlink>true</Hyperlink>`);}
  if (el.autoMaxWidth === false) {lines.push(`${inner}<AutoMaxWidth>false</AutoMaxWidth>`);}
  if (el.maxWidth !== undefined && el.maxWidth !== null) {lines.push(`${inner}<MaxWidth>${escapeXml(xmlStr(el.maxWidth))}</MaxWidth>`);}
  if (el.autoMaxHeight === false) {lines.push(`${inner}<AutoMaxHeight>false</AutoMaxHeight>`);}
  if (el.maxHeight !== undefined && el.maxHeight !== null) {lines.push(`${inner}<MaxHeight>${escapeXml(xmlStr(el.maxHeight))}</MaxHeight>`);}
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'label');
  lines.push(`${indent}</LabelDecoration>`);
}

function emitLabelField(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<LabelField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  if (el.hyperlink === true) {lines.push(`${inner}<Hyperlink>true</Hyperlink>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'labelField');
  lines.push(`${indent}</LabelField>`);
}

function emitTable(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Table name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  if (el.representation) {lines.push(`${inner}<Representation>${escapeXml(xmlStr(el.representation))}</Representation>`);}
  if (el.changeRowSet === true) {lines.push(`${inner}<ChangeRowSet>true</ChangeRowSet>`);}
  if (el.changeRowOrder === true) {lines.push(`${inner}<ChangeRowOrder>true</ChangeRowOrder>`);}
  if (el.height) {lines.push(`${inner}<HeightInTableRows>${escapeXml(xmlStr(el.height))}</HeightInTableRows>`);}
  if (el.header === false) {lines.push(`${inner}<Header>false</Header>`);}
  if (el.footer === true) {lines.push(`${inner}<Footer>true</Footer>`);}
  if (el.commandBarLocation) {lines.push(`${inner}<CommandBarLocation>${escapeXml(xmlStr(el.commandBarLocation))}</CommandBarLocation>`);}
  if (el.searchStringLocation) {lines.push(`${inner}<SearchStringLocation>${escapeXml(xmlStr(el.searchStringLocation))}</SearchStringLocation>`);}
  if (el.choiceMode === true) {lines.push(`${inner}<ChoiceMode>true</ChoiceMode>`);}
  if (el.initialTreeView) {lines.push(`${inner}<InitialTreeView>${escapeXml(xmlStr(el.initialTreeView))}</InitialTreeView>`);}
  if (el.enableStartDrag === true) {lines.push(`${inner}<EnableStartDrag>true</EnableStartDrag>`);}
  if (el.enableDrag === true) {lines.push(`${inner}<EnableDrag>true</EnableDrag>`);}
  if (el.rowPictureDataPath) {lines.push(`${inner}<RowPictureDataPath>${escapeXml(xmlStr(el.rowPictureDataPath))}</RowPictureDataPath>`);}

  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  if (el.tableAutofill !== undefined && el.tableAutofill !== null) {
    const acbId = id.nextElement();
    const acbName = `${name}КоманднаяПанель`;
    const afVal = el.tableAutofill === true ? 'true' : 'false';
    lines.push(`${inner}<AutoCommandBar name="${escapeXml(acbName)}" id="${String(acbId)}">`);
    lines.push(`${inner}\t<Autofill>${afVal}</Autofill>`);
    lines.push(`${inner}</AutoCommandBar>`);
  } else {
    emitCompanion(lines, 'AutoCommandBar', `${name}КоманднаяПанель`, inner, id);
  }
  emitCompanion(lines, 'SearchStringAddition', `${name}СтрокаПоиска`, inner, id);
  emitCompanion(lines, 'ViewStatusAddition', `${name}СостояниеПросмотра`, inner, id);
  emitCompanion(lines, 'SearchControlAddition', `${name}УправлениеПоиском`, inner, id);

  if (Array.isArray(el.columns) && el.columns.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const col of el.columns) {
      emitElement(lines, col as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  emitEvents(lines, el, name, inner, 'table');
  lines.push(`${indent}</Table>`);
}

function emitPages(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Pages name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.pagesRepresentation) {
    lines.push(`${inner}<PagesRepresentation>${escapeXml(xmlStr(el.pagesRepresentation))}</PagesRepresentation>`);
  }
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'pages');
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</Pages>`);
}

function emitPage(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Page name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner, true);
  emitCommonFlags(lines, el, inner);
  if (el.group) {
    const orientationMap: Record<string, string> = { horizontal: 'Horizontal', vertical: 'Vertical', alwaysHorizontal: 'AlwaysHorizontal', alwaysVertical: 'AlwaysVertical' };
    const orientation = orientationMap[xmlStr(el.group)];
    if (orientation) {
      lines.push(`${inner}<Group>${orientation}</Group>`);
    }
  }
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id);
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</Page>`);
}

function emitButton(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator, inCmdBar: boolean): void {
  lines.push(`${indent}<Button name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  let btnType: string | undefined;
  if (el.type) {
    const raw = xmlStr(el.type);
    if (inCmdBar) {
      const cmdBarMap: Record<string, string> = {
        usual: 'CommandBarButton', UsualButton: 'CommandBarButton',
        commandBar: 'CommandBarButton', CommandBarButton: 'CommandBarButton',
        hyperlink: 'CommandBarHyperlink', Hyperlink: 'CommandBarHyperlink',
        CommandBarHyperlink: 'CommandBarHyperlink',
      };
      btnType = cmdBarMap[raw] ?? raw;
    } else {
      const normalMap: Record<string, string> = {
        usual: 'UsualButton', UsualButton: 'UsualButton',
        commandBar: 'UsualButton', CommandBarButton: 'UsualButton',
        hyperlink: 'Hyperlink', Hyperlink: 'Hyperlink',
        CommandBarHyperlink: 'Hyperlink',
      };
      btnType = normalMap[raw] ?? raw;
    }
  } else if (inCmdBar) {
    btnType = 'CommandBarButton';
  }
  if (btnType) {
    lines.push(`${inner}<Type>${escapeXml(btnType)}</Type>`);
  }

  if (el.command) {
    lines.push(`${inner}<CommandName>Form.Command.${escapeXml(xmlStr(el.command))}</CommandName>`);
  }
  if (el.stdCommand) {
    const sc = xmlStr(el.stdCommand);
    const m = /^(.+)\.(.+)$/.exec(sc);
    if (m) {
      lines.push(`${inner}<CommandName>Form.Item.${escapeXml(m[1])}.StandardCommand.${escapeXml(m[2])}</CommandName>`);
    } else {
      lines.push(`${inner}<CommandName>Form.StandardCommand.${escapeXml(sc)}</CommandName>`);
    }
  }
  emitTitle(lines, el, name, inner, !(el.command ?? el.stdCommand));
  emitCommonFlags(lines, el, inner);
  if (el.defaultButton === true) {lines.push(`${inner}<DefaultButton>true</DefaultButton>`);}
  if (el.picture) {
    lines.push(`${inner}<Picture>`);
    lines.push(`${inner}\t<xr:Ref>${escapeXml(xmlStr(el.picture))}</xr:Ref>`);
    lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
    lines.push(`${inner}</Picture>`);
  }
  if (el.representation) {lines.push(`${inner}<Representation>${escapeXml(xmlStr(el.representation))}</Representation>`);}
  if (el.locationInCommandBar) {lines.push(`${inner}<LocationInCommandBar>${escapeXml(xmlStr(el.locationInCommandBar))}</LocationInCommandBar>`);}
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'button');
  lines.push(`${indent}</Button>`);
}

function emitPictureDecoration(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<PictureDecoration name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner);
  emitCommonFlags(lines, el, inner);
  if (el.picture || el.src) {
    const ref = xmlStr(el.src ?? el.picture);
    lines.push(`${inner}<Picture>`);
    lines.push(`${inner}\t<xr:Ref>${escapeXml(ref)}</xr:Ref>`);
    lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
    lines.push(`${inner}</Picture>`);
  }
  if (el.hyperlink === true) {lines.push(`${inner}<Hyperlink>true</Hyperlink>`);}
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'picture');
  lines.push(`${indent}</PictureDecoration>`);
}

function emitPictureField(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<PictureField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner);
  emitCommonFlags(lines, el, inner);
  if (el.width) {lines.push(`${inner}<Width>${escapeXml(xmlStr(el.width))}</Width>`);}
  if (el.height) {lines.push(`${inner}<Height>${escapeXml(xmlStr(el.height))}</Height>`);}
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'picField');
  lines.push(`${indent}</PictureField>`);
}

function emitCalendar(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<CalendarField name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.path) {
    lines.push(`${inner}<DataPath>${escapeXml(xmlStr(el.path))}</DataPath>`);
  }
  emitTitle(lines, el, name, inner, !el.path);
  emitCommonFlags(lines, el, inner);
  emitCompanion(lines, 'ContextMenu', `${name}КонтекстноеМеню`, inner, id);
  emitCompanion(lines, 'ExtendedTooltip', `${name}РасширеннаяПодсказка`, inner, id);
  emitEvents(lines, el, name, inner, 'calendar');
  lines.push(`${indent}</CalendarField>`);
}

function emitCommandBar(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<CommandBar name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  if (el.autofill === true) {lines.push(`${inner}<Autofill>true</Autofill>`);}
  emitCommonFlags(lines, el, inner);
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id, { inCmdBar: true });
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</CommandBar>`);
}

function emitPopup(lines: string[], el: Record<string, unknown>, name: string, eid: number, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<Popup name="${escapeXml(name)}" id="${String(eid)}">`);
  const inner = `${indent}\t`;
  emitTitle(lines, el, name, inner, true);
  emitCommonFlags(lines, el, inner);
  if (el.picture) {
    lines.push(`${inner}<Picture>`);
    lines.push(`${inner}\t<xr:Ref>${escapeXml(xmlStr(el.picture))}</xr:Ref>`);
    lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
    lines.push(`${inner}</Picture>`);
  }
  if (el.representation) {lines.push(`${inner}<Representation>${escapeXml(xmlStr(el.representation))}</Representation>`);}
  if (Array.isArray(el.children) && el.children.length > 0) {
    lines.push(`${inner}<ChildItems>`);
    for (const child of el.children) {
      emitElement(lines, child as FormElementDefinition, `${inner}\t`, id, { inCmdBar: true });
    }
    lines.push(`${inner}</ChildItems>`);
  }
  lines.push(`${indent}</Popup>`);
}

// ─── Common helpers ─────────────────────────────────────────────────────────

function emitCommonFlags(lines: string[], el: Record<string, unknown>, indent: string): void {
  if (el.visible === false || el.hidden === true) {
    lines.push(`${indent}<Visible>false</Visible>`);
  }
  if (el.userVisible === false) {
    lines.push(`${indent}<UserVisible>`);
    lines.push(`${indent}\t<xr:Common>false</xr:Common>`);
    lines.push(`${indent}</UserVisible>`);
  }
  if (el.enabled === false || el.disabled === true) {
    lines.push(`${indent}<Enabled>false</Enabled>`);
  }
  if (el.readOnly === true) {
    lines.push(`${indent}<ReadOnly>true</ReadOnly>`);
  }
}

function emitTitle(lines: string[], el: Record<string, unknown>, name: string, indent: string, auto = false): void {
  let title: unknown = el.title;
  if (!title && auto && name) {
    title = titleFromName(name);
  }
  if (title) {
    lines.push(...buildLocalizedTag(indent, 'Title', xmlStr(title)).split('\n'));
  }
}

function emitCompanion(lines: string[], tag: string, name: string, indent: string, id: IdAllocator): void {
  lines.push(`${indent}<${tag} name="${escapeXml(name)}" id="${String(id.nextElement())}"/>`);
}

function emitEvents(lines: string[], el: Record<string, unknown>, elementName: string, indent: string, typeKey: string): void {
  if (!Array.isArray(el.on) || el.on.length === 0) {
    return;
  }
  const onList = el.on as unknown[];
  if (typeKey in KNOWN_EVENTS) {
    const allowed = KNOWN_EVENTS[typeKey];
    if (allowed.length > 0) {
      for (const evt of onList) {
        const evtName = xmlStr(evt);
        if (!allowed.includes(evtName)) {
          warn(`[WARN] Unknown event '${evtName}' for ${typeKey} '${elementName}'. Known: ${allowed.join(', ')}`);
        }
      }
    }
  }
  lines.push(`${indent}<Events>`);
  const handlers = isPlainObject(el.handlers) ? el.handlers : null;
  for (const evt of onList) {
    const evtName = xmlStr(evt);
    const handlerVal = handlers ? handlers[evtName] : undefined;
    const handler = typeof handlerVal === 'string' && handlerVal
      ? handlerVal
      : getHandlerName(elementName, evtName);
    lines.push(`${indent}\t<Event name="${escapeXml(evtName)}">${escapeXml(handler)}</Event>`);
  }
  lines.push(`${indent}</Events>`);
}

function normalizeRadioButtonType(raw: unknown): string {
  if (!raw) {return 'Auto';}
  const rawStr = xmlStr(raw);
  const s = rawStr.trim().toLowerCase();
  if (s === 'auto' || s === 'авто') {return 'Auto';}
  if (['radiobutton', 'radiobuttons', 'переключатель', 'радио'].includes(s)) {return 'RadioButtons';}
  if (['tumbler', 'тумблер'].includes(s)) {return 'Tumbler';}
  return rawStr.trim();
}

interface ChoiceValueShape { xsiType: string; text: string }

function normalizeChoiceValue(value: unknown): ChoiceValueShape {
  if (typeof value === 'boolean') {
    return { xsiType: 'xs:boolean', text: value ? 'true' : 'false' };
  }
  if (typeof value === 'number') {
    return { xsiType: 'xs:decimal', text: String(value) };
  }
  const s = value === null || value === undefined ? '' : xmlStr(value);
  if (!s) {return { xsiType: 'xs:string', text: '' };}
  const parts = s.split('.');
  if (parts.length >= 2) {
    const root = parts[0];
    let canonRoot: string | null = null;
    if (root in REF_ROOT_SYNONYMS) {
      canonRoot = REF_ROOT_SYNONYMS[root];
    } else if (Object.values(REF_ROOT_SYNONYMS).includes(root)) {
      canonRoot = root;
    }
    if (canonRoot) {
      const typeName = parts[1];
      let normalized: string | null = null;
      if (canonRoot === 'Enum') {
        if (parts.length === 3) {
          normalized = `Enum.${typeName}.EnumValue.${parts[2]}`;
        } else if (parts.length >= 4) {
          const member = parts[2];
          const rest = ENUM_VALUE_SYNONYMS.has(member) ? parts.slice(3).join('.') : parts.slice(2).join('.');
          normalized = `Enum.${typeName}.EnumValue.${rest}`;
        }
      } else {
        if (parts.length >= 3) {
          normalized = `${canonRoot}.${parts.slice(1).join('.')}`;
        }
      }
      if (normalized) {
        return { xsiType: 'xr:DesignTimeRef', text: normalized };
      }
    }
  }
  return { xsiType: 'xs:string', text: s };
}

function emitChoicePresentation(lines: string[], pres: unknown, indent: string): void {
  if (pres === null || pres === undefined || pres === '') {
    lines.push(`${indent}<Presentation/>`);
    return;
  }
  let pairs: [string, string][];
  if (typeof pres === 'string') {
    pairs = [['ru', pres]];
  } else if (isPlainObject(pres)) {
    pairs = Object.entries(pres).map(([k, v]) => [k, xmlStr(v)]);
  } else {
    pairs = [['ru', xmlStr(pres)]];
  }
  lines.push(`${indent}<Presentation>`);
  for (const [lang, content] of pairs) {
    lines.push(`${indent}\t<v8:item>`);
    lines.push(`${indent}\t\t<v8:lang>${escapeXml(lang)}</v8:lang>`);
    lines.push(`${indent}\t\t<v8:content>${escapeXml(content)}</v8:content>`);
    lines.push(`${indent}\t</v8:item>`);
  }
  lines.push(`${indent}</Presentation>`);
}

// ─── Legacy edit helper (используется FormEditService) ──────────────────────

export function buildElementXml(raw: FormElementDefinition, indent: string, id: IdAllocator): string {
  const lines: string[] = [];
  emitElement(lines, raw, indent, id);
  return lines.join('\n');
}
