import * as vscode from 'vscode';
import * as fs from 'fs';
import { getNodeKindLabel, MetadataNode } from '../tree/TreeNode';
import {
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataTypeValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from '../tree/nodeBuilders/_types';
import { getHandlerForNode } from '../tree/nodeBuilders/index';
import { TypeRegistryService } from './properties/TypeRegistryService';
import { buildMetadataTypeInnerXml, ensureDefaultQualifiers } from './properties/MetadataTypeService';
import { updateObjectTypeProperty } from '../../infra/xml';
import { extractChildMetaElementXml, extractColumnXmlFromTabularSection } from '../../infra/xml';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';

/** Управляет вкладкой свойств объекта метаданных (singleton WebviewPanel) */
export class PropertiesViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private activeNode: MetadataNode | undefined;
  private activeProperties: ObjectPropertiesCollection = [];
  private editSession = new Map<string, unknown>();
  private readonly typeRegistry = new TypeRegistryService();
  constructor(private readonly supportService?: SupportInfoService) {}

  /**
   * Открывает вкладку свойств для узла.
   * Если вкладка уже открыта — заменяет содержимое и переключается на неё,
   * новую группу редактора не создаёт.
   */
  show(node: MetadataNode): void {
    this.activeNode = node;
    if (this.panel) {
      this.panel.title = this.buildTitle(node);
      this.panel.webview.html = this.renderHtml(node);
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        '1cPropertiesView',
        this.buildTitle(node),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.webview.html = this.renderHtml(node);
      this.panel.webview.onDidReceiveMessage((msg) => this.handleWebviewMessage(msg));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.activeNode = undefined;
        this.editSession.clear();
      });
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  /** Формирует заголовок вкладки */
  private buildTitle(node: MetadataNode): string {
    return `${node.label} — Свойства`;
  }

  /** Формирует HTML страницы */
  private renderHtml(node: MetadataNode): string {
    const content = this.renderBody(node);

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0 20px 20px;
      max-width: 800px;
    }
    .header {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      padding: 16px 0 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 16px;
    }
    .title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 4px;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin: 0;
    }
    .message {
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
      padding: 8px 0;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(160px, 35%) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    .label {
      padding-top: 7px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    .control {
      min-width: 0;
    }
    .input,
    .textarea,
    .select {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 2px;
      padding: 6px 8px;
      font: inherit;
    }
    .textarea {
      min-height: 56px;
      resize: vertical;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      min-height: 32px;
    }
    .checkbox {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--vscode-checkbox-selectBackground);
    }
    .static-text {
      padding: 7px 0;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
    }
    .property-note {
      margin-top: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }
    .localized-item {
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--vscode-panel-border);
    }
    .actions {
      margin-top: 12px;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 2px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .type-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
    }
    .qual-row {
      margin-top: 8px;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      align-items: center;
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  /** Формирует содержимое страницы */
  private renderBody(node: MetadataNode): string {
    const handler = getHandlerForNode(node);
    const canShowProperties = handler?.canShowProperties?.(node) ?? false;

    if (!handler || !handler.getProperties || !canShowProperties) {
      return this.renderState(
        node.label,
        'Для выбранного объекта отсутствуют свойства',
        getNodeKindLabel(node.nodeKind)
      );
    }

    const properties = handler.getProperties(node);
    this.activeProperties = properties;
    const isDirty = this.editSession.size > 0;
    const isEditLockedBySupport = this.isEditLockedBySupport(node);
    if (properties.length === 0) {
      return this.renderState(
        node.label,
        'Для выбранного объекта отсутствуют свойства',
        getNodeKindLabel(node.nodeKind)
      );
    }

    return `
      <div class="header">
        <div class="title">${escapeHtml(node.label)}</div>
        <p class="subtitle">${escapeHtml(getNodeKindLabel(node.nodeKind))}</p>
        ${isEditLockedBySupport ? '<p class="subtitle">Редактирование запрещено поддержкой</p>' : ''}
      </div>
      <div class="form">
        ${properties.map((property) => this.renderProperty(property, isEditLockedBySupport)).join('')}
        <div class="actions">
          <button class="btn" id="saveBtn" ${(isDirty && !isEditLockedBySupport) ? '' : 'disabled'}>Сохранить</button>
          <button class="btn" id="cancelBtn" ${(isDirty && !isEditLockedBySupport) ? '' : 'disabled'}>Отмена</button>
        </div>
      </div>
      <script>${this.renderScript(isEditLockedBySupport)}</script>
    `;
  }

  /** Формирует шаблон пустого/ошибочного состояния */
  private renderState(title: string, message: string, subtitle?: string): string {
    return `
      <div class="header">
        <div class="title">${escapeHtml(title)}</div>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      <div class="message">${escapeHtml(message)}</div>
    `;
  }

  /** Формирует строку свойства */
  private renderProperty(property: ObjectPropertyItem, isEditLockedBySupport: boolean): string {
    const valueHtml = this.renderPropertyValue(property, isEditLockedBySupport);
    return `
      <div class="row">
        <label class="label" title="${escapeHtml(property.key)}">${escapeHtml(property.title)}</label>
        <div class="control">${valueHtml}</div>
      </div>
    `;
  }

  /** Формирует HTML значения свойства */
  private renderPropertyValue(property: ObjectPropertyItem, isEditLockedBySupport: boolean): string {
    switch (property.kind) {
      case 'boolean':
        return `<div class="checkbox-row"><input class="checkbox" type="checkbox" ${property.value === true ? 'checked' : ''} disabled /></div>`;
      case 'enum': {
        const enumValue = property.value as EnumPropertyValue;
        const options = enumValue.allowedValues
          .map((option) => {
            return `<option value="${escapeHtml(option.value)}" ${option.value === enumValue.current ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
          })
          .join('');
        return `<select class="select" disabled>${options}</select>`;
      }
      case 'localizedString': {
        const localized = property.value as LocalizedStringValue;
        const items = localized.values
          .map((item) => {
            return `<div class="localized-item"><strong>${escapeHtml(item.lang)}:</strong> ${escapeHtml(item.content)}</div>`;
          })
          .join('');

        return `
          <input class="input" type="text" value="${escapeHtml(localized.presentation)}" readonly />
          ${items ? `<div class="property-note">Локализации:</div>${items}` : ''}
        `;
      }
      case 'string':
      default:
        if (property.kind === 'metadataType') {
          return this.renderMetadataTypeControl(property, isEditLockedBySupport);
        }
        return `<input class="input" type="text" value="${escapeHtml(String(property.value ?? ''))}" readonly />`;
    }
  }

  private renderMetadataTypeControl(property: ObjectPropertyItem, isEditLockedBySupport: boolean): string {
    const value = this.getRenderTypeValue(property);
    const disabledAttr = isEditLockedBySupport ? 'disabled' : '';
    return `
      <div class="type-control">
        <div class="type-row">
          <input class="input" id="typePresentation" type="text" value="${escapeHtml(value.presentation)}" readonly />
          <button class="btn" id="pickTypeBtn" ${disabledAttr}>Выбрать</button>
        </div>
        ${this.renderTypeQualifiers(value, isEditLockedBySupport)}
      </div>
    `;
  }

  private renderTypeQualifiers(value: MetadataTypeValue, isEditLockedBySupport: boolean): string {
    const disabledAttr = isEditLockedBySupport ? 'disabled' : '';
    const blocks: string[] = [];
    if (value.stringQualifiers) {
      blocks.push(`
        <div class="qual-row">
          <label>Длина</label>
          <input class="input" id="qStringLength" type="number" value="${value.stringQualifiers.length ?? ''}" ${disabledAttr} />
          <label>Допустимая длина</label>
          <select class="select" id="qStringAllowedLength" ${disabledAttr}>
            <option value="Variable" ${value.stringQualifiers.allowedLength !== 'Fixed' ? 'selected' : ''}>Переменная</option>
            <option value="Fixed" ${value.stringQualifiers.allowedLength === 'Fixed' ? 'selected' : ''}>Фиксированная</option>
          </select>
        </div>
      `);
    }
    if (value.numberQualifiers) {
      blocks.push(`
        <div class="qual-row">
          <label>Разрядов</label>
          <input class="input" id="qNumberDigits" type="number" value="${value.numberQualifiers.digits ?? ''}" ${disabledAttr} />
          <label>Дробных</label>
          <input class="input" id="qNumberFractionDigits" type="number" value="${value.numberQualifiers.fractionDigits ?? ''}" ${disabledAttr} />
          <label>Знак</label>
          <select class="select" id="qNumberAllowedSign" ${disabledAttr}>
            <option value="Any" ${value.numberQualifiers.allowedSign !== 'Nonnegative' ? 'selected' : ''}>Любой</option>
            <option value="Nonnegative" ${value.numberQualifiers.allowedSign === 'Nonnegative' ? 'selected' : ''}>Неотрицательный</option>
          </select>
        </div>
      `);
    }
    if (value.dateQualifiers) {
      blocks.push(`
        <div class="qual-row">
          <label>Состав даты</label>
          <select class="select" id="qDateFractions" ${disabledAttr}>
            <option value="Date" ${value.dateQualifiers.dateFractions === 'Date' ? 'selected' : ''}>Дата</option>
            <option value="DateTime" ${value.dateQualifiers.dateFractions !== 'Date' ? 'selected' : ''}>ДатаВремя</option>
          </select>
        </div>
      `);
    }
    return blocks.join('');
  }

  private renderScript(isEditLockedBySupport: boolean): string {
    return `
      const vscode = acquireVsCodeApi();
      const typeBtn = document.getElementById('pickTypeBtn');
      const saveBtn = document.getElementById('saveBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      const typePresentation = document.getElementById('typePresentation');
      const isEditLockedBySupport = ${isEditLockedBySupport ? 'true' : 'false'};
      let isDirty = false;
      const setDirty = (dirty) => {
        isDirty = dirty;
        if (saveBtn) saveBtn.disabled = !dirty || isEditLockedBySupport;
        if (cancelBtn) cancelBtn.disabled = !dirty || isEditLockedBySupport;
      };
      const collectQualifiers = () => ({
        stringLength: document.getElementById('qStringLength')?.value,
        stringAllowedLength: document.getElementById('qStringAllowedLength')?.value,
        numberDigits: document.getElementById('qNumberDigits')?.value,
        numberFractionDigits: document.getElementById('qNumberFractionDigits')?.value,
        numberAllowedSign: document.getElementById('qNumberAllowedSign')?.value,
        dateFractions: document.getElementById('qDateFractions')?.value,
      });
      if (typeBtn) {
        typeBtn.addEventListener('click', () => {
          if (isEditLockedBySupport) return;
          vscode.postMessage({ type: 'openTypePicker', qualifiers: collectQualifiers() });
        });
      }
      for (const id of ['qStringLength','qStringAllowedLength','qNumberDigits','qNumberFractionDigits','qNumberAllowedSign','qDateFractions']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('change', () => {
          if (isEditLockedBySupport) return;
          setDirty(true);
          vscode.postMessage({ type: 'updateTypeQualifiers', qualifiers: collectQualifiers() });
        });
      }
      if (saveBtn) saveBtn.addEventListener('click', () => {
        if (isEditLockedBySupport) return;
        vscode.postMessage({ type: 'saveType' });
      });
      if (cancelBtn) cancelBtn.addEventListener('click', () => {
        if (isEditLockedBySupport) return;
        vscode.postMessage({ type: 'cancelTypeChanges' });
      });
      setDirty(${this.editSession.size > 0 ? 'true' : 'false'});
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg?.type === 'typeChanged') {
          if (typePresentation) typePresentation.value = msg.presentation ?? '';
          setDirty(true);
        }
        if (msg?.type === 'resetDirty') {
          setDirty(false);
        }
      });
    `;
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    const msg = message as { type?: string; qualifiers?: Record<string, string>; presentation?: string };
    if (!this.activeNode || !this.panel) {
      return;
    }
    if (this.isEditLockedBySupport(this.activeNode)) {
      if (msg.type === 'openTypePicker' || msg.type === 'updateTypeQualifiers' || msg.type === 'saveType' || msg.type === 'cancelTypeChanges') {
        void vscode.window.showWarningMessage('Редактирование свойств запрещено поддержкой для этого объекта.');
      }
      return;
    }
    if (msg.type === 'openTypePicker') {
      await this.handleOpenTypePicker();
      return;
    }
    if (msg.type === 'updateTypeQualifiers') {
      this.applyQualifierChanges(msg.qualifiers ?? {});
      return;
    }
    if (msg.type === 'saveType') {
      await this.saveTypeChanges();
      return;
    }
    if (msg.type === 'cancelTypeChanges') {
      this.editSession.clear();
      this.panel.webview.html = this.renderHtml(this.activeNode);
      this.panel.webview.postMessage({ type: 'resetDirty' });
    }
  }

  private async handleOpenTypePicker(): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    const current = this.getCurrentTypeValue();
    if (!current) {
      return;
    }
    const groups = this.typeRegistry.getAvailableTypes(this.activeNode.xmlPath);
    const items: Array<vscode.QuickPickItem & { canonical?: string }> = [];
    for (const group of groups) {
      items.push({ label: group.title, kind: vscode.QuickPickItemKind.Separator });
      for (const type of group.items) {
        items.push({
          label: type.display,
          description: type.canonical,
          picked: current.items.some((item) => item.canonical === type.canonical),
          canonical: type.canonical,
        });
      }
    }
    const selected = await vscode.window.showQuickPick(items, {
      title: 'Выбор типа',
      canPickMany: true,
      matchOnDescription: true,
    });
    if (!selected || selected.length === 0) {
      return;
    }
    const nextItems = selected
      .filter((item) => item.canonical)
      .map((item) => ({
        canonical: String(item.canonical),
        display: item.label,
        group: String(item.canonical).startsWith('DefinedType.')
          ? 'defined'
          : String(item.canonical).includes('Ref.')
          ? 'reference'
          : 'primitive',
      })) as MetadataTypeValue['items'];
    const nextType: MetadataTypeValue = ensureDefaultQualifiers({
      ...current,
      items: nextItems,
      presentation: nextItems.map((item) => item.display).join(', '),
    });
    this.editSession.set('Type', nextType);
    if (this.panel && this.activeNode) {
      this.panel.webview.html = this.renderHtml(this.activeNode);
    }
  }

  private applyQualifierChanges(qualifiers: Record<string, string>): void {
    const current = this.getCurrentTypeValue();
    if (!current) {
      return;
    }
    const next: MetadataTypeValue = ensureDefaultQualifiers({
      ...current,
      stringQualifiers: current.stringQualifiers
        ? {
            length: toNumberOrUndefined(qualifiers.stringLength),
            allowedLength: qualifiers.stringAllowedLength === 'Fixed' ? 'Fixed' : 'Variable',
          }
        : undefined,
      numberQualifiers: current.numberQualifiers
        ? {
            digits: toNumberOrUndefined(qualifiers.numberDigits),
            fractionDigits: toNumberOrUndefined(qualifiers.numberFractionDigits),
            allowedSign: qualifiers.numberAllowedSign === 'Nonnegative' ? 'Nonnegative' : 'Any',
          }
        : undefined,
      dateQualifiers: current.dateQualifiers
        ? {
            dateFractions: qualifiers.dateFractions === 'Date' ? 'Date' : 'DateTime',
          }
        : undefined,
    });
    this.editSession.set('Type', next);
    if (this.panel && this.activeNode) {
      this.panel.webview.html = this.renderHtml(this.activeNode);
    }
  }

  private getCurrentTypeValue(): MetadataTypeValue | null {
    const edited = this.editSession.get('Type') as MetadataTypeValue | undefined;
    if (edited) {
      return edited;
    }
    const original = this.activeProperties.find((item) => item.key === 'Type');
    if (!original || original.kind !== 'metadataType') {
      return null;
    }
    return ensureDefaultQualifiers(original.value as MetadataTypeValue);
  }

  private getRenderTypeValue(property: ObjectPropertyItem): MetadataTypeValue {
    const edited = this.editSession.get('Type') as MetadataTypeValue | undefined;
    if (edited) {
      return ensureDefaultQualifiers(edited);
    }
    return ensureDefaultQualifiers(property.value as MetadataTypeValue);
  }

  private async saveTypeChanges(): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    const typeValue = this.editSession.get('Type') as MetadataTypeValue | undefined;
    if (!typeValue) {
      return;
    }
    const target = resolveTypeTarget(this.activeNode);
    if (!target) {
      vscode.window.showWarningMessage('Для выбранного узла сохранение типа пока не поддерживается.');
      return;
    }
    const saved = updateObjectTypeProperty(target.xmlPath, {
      targetKind: target.targetKind,
      targetName: target.targetName,
      tabularSectionName: target.tabularSectionName,
      typeInnerXml: buildMetadataTypeInnerXml(typeValue),
    });
    if (!saved) {
      vscode.window.showErrorMessage('Не удалось сохранить изменение типа.');
      return;
    }
    this.editSession.clear();
    this.activeProperties = [];
    this.panel?.webview.postMessage({ type: 'resetDirty' });
    this.panel!.webview.html = this.renderHtml(this.activeNode);
    vscode.window.showInformationMessage('Тип успешно изменён.');
  }

  private isEditLockedBySupport(node: MetadataNode): boolean {
    if (!this.supportService) {
      return false;
    }
    const lockMode = this.resolveNodeSupportMode(node);
    return lockMode === SupportMode.Locked;
  }

  private resolveNodeSupportMode(node: MetadataNode): SupportMode {
    if (!this.supportService) {
      return SupportMode.None;
    }
    const xmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return SupportMode.None;
    }

    const childTagMap: Partial<Record<string, 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource'>> = {
      Attribute: 'Attribute',
      AddressingAttribute: 'AddressingAttribute',
      Dimension: 'Dimension',
      Resource: 'Resource',
    };
    const childTag = childTagMap[node.nodeKind];
    if (childTag) {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const childXml = extractChildMetaElementXml(xml, childTag, node.label);
      const uuid = extractUuidFromXml(childXml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (node.nodeKind === 'Column') {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const columnXml = extractColumnXmlFromTabularSection(xml, node.metaContext?.tabularSectionName ?? '', node.label);
      const uuid = extractUuidFromXml(columnXml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (node.nodeKind === 'SessionParameter' || node.nodeKind === 'CommonAttribute') {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const uuid = extractUuidFromXml(xml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (!xmlPath) {
      return SupportMode.None;
    }
    return this.supportService.getSupportMode(xmlPath);
  }
}

/** Экранирует строку для безопасной вставки в HTML */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNumberOrUndefined(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function resolveTypeTarget(node: MetadataNode): {
  xmlPath: string;
  targetKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'SessionParameter' | 'CommonAttribute';
  targetName: string;
  tabularSectionName?: string;
} | null {
  if (!node.xmlPath) {
    return null;
  }
  if (node.nodeKind === 'SessionParameter' || node.nodeKind === 'CommonAttribute') {
    return {
      xmlPath: node.xmlPath,
      targetKind: node.nodeKind,
      targetName: node.label,
    };
  }
  const supported: Record<string, 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column'> = {
    Attribute: 'Attribute',
    AddressingAttribute: 'AddressingAttribute',
    Dimension: 'Dimension',
    Resource: 'Resource',
    Column: 'Column',
  };
  const targetKind = supported[node.nodeKind];
  if (!targetKind) {
    return null;
  }
  return {
    xmlPath: node.metaContext?.ownerObjectXmlPath ?? node.xmlPath,
    targetKind,
    targetName: node.label,
    tabularSectionName: node.metaContext?.tabularSectionName,
  };
}

function extractUuidFromXml(xml: string | null): string | null {
  if (!xml) {
    return null;
  }
  const match = /uuid="([0-9a-fA-F-]{36})"/.exec(xml);
  return match?.[1]?.toLowerCase() ?? null;
}
