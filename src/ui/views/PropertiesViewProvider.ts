import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
import { ConfigurationXmlEditor } from '../../infra/xml';
import { extractChildMetaElementXml, extractColumnXmlFromTabularSection, normalizeTypedFieldPropertiesAfterTypeChange } from '../../infra/xml';
import { buildTypedFieldProperties } from './properties/PropertyBuilder';
import { RepositoryService } from '../../infra/repository/RepositoryService';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import { getObjectLocationFromXml } from '../../infra/fs';

/** Управляет вкладкой свойств объекта метаданных (singleton WebviewPanel) */
export class PropertiesViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private activeNode: MetadataNode | undefined;
  private activeProperties: ObjectPropertiesCollection = [];
  private editSession = new Map<string, unknown>();
  private readonly typeRegistry = new TypeRegistryService();
  private readonly xmlEditor = new ConfigurationXmlEditor();
  constructor(
    private readonly supportService?: SupportInfoService,
    private readonly repositoryService?: RepositoryService
  ) {}

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
    return `${node.textLabel} — Свойства`;
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
        node.textLabel,
        'Для выбранного объекта отсутствуют свойства',
        getNodeKindLabel(node.nodeKind)
      );
    }

    let properties = handler.getProperties(node);
    properties = this.applyEditedTypeToRenderedProperties(node, properties);
    this.activeProperties = properties;
    let isDirty = this.editSession.size > 0;
    const editLockReason = this.resolveEditLockReason(node);
    const isEditLocked = editLockReason !== undefined;
    const isEditLockedBySupport = editLockReason === 'support';
    if (isEditLocked) {
      isDirty = false;
    }
    if (properties.length === 0) {
      return this.renderState(
        node.textLabel,
        'Для выбранного объекта отсутствуют свойства',
        getNodeKindLabel(node.nodeKind)
      );
    }

    return `
      <div class="header">
        <div class="title">${escapeHtml(node.textLabel)}</div>
        <p class="subtitle">${escapeHtml(getNodeKindLabel(node.nodeKind))}</p>
        ${isEditLockedBySupport ? '<p class="subtitle">Редактирование запрещено поддержкой</p>' : ''}
      </div>
      <div class="form">
        ${properties.map((property) => this.renderProperty(property, isEditLocked)).join('')}
        <div class="actions">
          <button class="btn" id="saveBtn" ${(isDirty && !isEditLockedBySupport) ? '' : 'disabled'}>Сохранить</button>
          <button class="btn" id="cancelBtn" ${(isDirty && !isEditLockedBySupport) ? '' : 'disabled'}>Отмена</button>
        </div>
      </div>
      <script>${this.renderScript(isEditLocked)}</script>
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
    const editedValue = this.editSession.get(property.key);
    const isEditable = !isEditLockedBySupport && property.key !== '_note';
    const disabledAttr = isEditable ? '' : 'disabled';
    switch (property.kind) {
      case 'boolean':
        return `<div class="checkbox-row"><input class="checkbox" data-prop-key="${escapeHtml(property.key)}" type="checkbox" ${(editedValue ?? property.value) === true ? 'checked' : ''} ${disabledAttr} /></div>`;
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
        const renderValue = String(editedValue ?? localized.presentation);
        const items = localized.values
          .map((item) => {
            return `<div class="localized-item"><strong>${escapeHtml(item.lang)}:</strong> ${escapeHtml(item.content)}</div>`;
          })
          .join('');

        return `
          <input class="input" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="localizedString" type="text" value="${escapeHtml(renderValue)}" ${isEditable ? '' : 'readonly'} />
          ${items ? `<div class="property-note">Локализации:</div>${items}` : ''}
        `;
      }
      case 'string':
      default:
        if (property.kind === 'metadataType') {
          return this.renderMetadataTypeControl(property, isEditLockedBySupport);
        }
        const canRenameFromProperty = property.key === 'Name'
          && this.activeNode
          && (() => {
            const target = resolvePropertyTarget(this.activeNode!);
            return target ? isRootObjectNode(this.activeNode!, target) : false;
          })();
        if (canRenameFromProperty) {
          return `
            <div class="type-row">
              <input class="input" type="text" value="${escapeHtml(String(property.value ?? ''))}" readonly />
              <button class="btn" id="renameObjectBtn" ${isEditLockedBySupport ? 'disabled' : ''}>Переименовать</button>
            </div>
          `;
        }
        return `<input class="input" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="string" type="text" value="${escapeHtml(String(editedValue ?? property.value ?? ''))}" ${isEditable ? '' : 'readonly'} />`;
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
      const isValidMetadataName = (value) => /^[\\p{L}][\\p{L}\\p{Nd}_]*$/u.test(value);
      let isDirty = false;
      const lastValidByKey = new Map();
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
      document.querySelectorAll('[data-prop-key]').forEach((el) => {
        const key = el.getAttribute('data-prop-key');
        const kind = el.getAttribute('data-prop-kind') || (el.type === 'checkbox' ? 'boolean' : 'string');
        if (!key || isEditLockedBySupport) return;
        if (el.type !== 'checkbox') {
          lastValidByKey.set(key, String(el.value ?? ''));
        }
        const eventName = el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(eventName, () => {
          if (key === 'Name' && el.type !== 'checkbox') {
            const current = String(el.value ?? '');
            if (!isValidMetadataName(current)) {
              el.value = String(lastValidByKey.get(key) ?? '');
              return;
            }
            lastValidByKey.set(key, current);
          }
          const value = el.type === 'checkbox' ? Boolean(el.checked) : String(el.value ?? '');
          setDirty(true);
          vscode.postMessage({ type: 'propertyChanged', key, kind, value });
        });
      });
      if (saveBtn) saveBtn.addEventListener('click', () => {
        if (isEditLockedBySupport) return;
        vscode.postMessage({ type: 'saveChanges' });
      });
      const renameObjectBtn = document.getElementById('renameObjectBtn');
      if (renameObjectBtn) {
        renameObjectBtn.addEventListener('click', () => {
          if (isEditLockedBySupport) return;
          vscode.postMessage({ type: 'renameObject' });
        });
      }
      if (cancelBtn) cancelBtn.addEventListener('click', () => {
        if (isEditLockedBySupport) return;
        vscode.postMessage({ type: 'cancelChanges' });
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
    const msg = message as { type?: string; qualifiers?: Record<string, string>; presentation?: string; key?: string; value?: string | boolean; kind?: string };
    if (!this.activeNode || !this.panel) {
      return;
    }
    if (this.isEditLockedBySupport(this.activeNode)) {
      if (msg.type === 'openTypePicker' || msg.type === 'updateTypeQualifiers' || msg.type === 'saveChanges' || msg.type === 'cancelChanges' || msg.type === 'propertyChanged') {
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
    if (msg.type === 'propertyChanged') {
      if (msg.key) {
        this.editSession.set(msg.key, msg.value);
      }
      return;
    }
    if (msg.type === 'saveChanges') {
      await this.saveChanges();
      return;
    }
    if (msg.type === 'renameObject') {
      await this.promptAndRenameObject();
      return;
    }
    if (msg.type === 'cancelChanges') {
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

  private applyEditedTypeToRenderedProperties(node: MetadataNode, properties: ObjectPropertiesCollection): ObjectPropertiesCollection {
    const typeValue = this.editSession.get('Type') as MetadataTypeValue | undefined;
    if (!typeValue) {
      return properties;
    }
    const target = resolveTypeTarget(node);
    if (!target || target.targetKind === 'SessionParameter' || target.targetKind === 'CommonAttribute') {
      return properties;
    }
    let elementXml: string | null = null;
    if (target.targetKind === 'Column') {
      if (!target.tabularSectionName || !fs.existsSync(target.xmlPath)) {
        return properties;
      }
      elementXml = extractColumnXmlFromTabularSection(
        fs.readFileSync(target.xmlPath, 'utf-8'),
        target.tabularSectionName,
        target.targetName
      );
    } else if (fs.existsSync(target.xmlPath)) {
      elementXml = extractChildMetaElementXml(
        fs.readFileSync(target.xmlPath, 'utf-8'),
        target.targetKind,
        target.targetName
      );
    }
    if (!elementXml) {
      return properties;
    }
    const normalized = normalizeTypedFieldPropertiesAfterTypeChange(
      elementXml,
      target.targetKind === 'Column' ? 'Attribute' : target.targetKind,
      buildMetadataTypeInnerXml(typeValue)
    );
    return buildTypedFieldProperties(normalized);
  }

  private async saveChanges(): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    if (this.editSession.size === 0) {
      return;
    }

    const typeValue = this.editSession.get('Type') as MetadataTypeValue | undefined;
    if (typeValue) {
      const typeTarget = resolveTypeTarget(this.activeNode);
      if (!typeTarget) {
        vscode.window.showWarningMessage('Для выбранного узла сохранение типа пока не поддерживается.');
        return;
      }
      const typeSaved = this.xmlEditor.modifyObjectType(typeTarget.xmlPath, {
        targetKind: typeTarget.targetKind,
        targetName: typeTarget.targetName,
        tabularSectionName: typeTarget.tabularSectionName,
        typeInnerXml: buildMetadataTypeInnerXml(typeValue),
      });
      if (!typeSaved.success) {
        vscode.window.showErrorMessage(typeSaved.errors[0] ?? 'Не удалось сохранить изменение типа.');
        return;
      }
    }

    const propertyTarget = resolvePropertyTarget(this.activeNode);
    if (!propertyTarget) {
      vscode.window.showWarningMessage('Для выбранного узла сохранение свойств пока не поддерживается.');
      return;
    }
    let changedCount = 0;
    const currentXmlPath = propertyTarget.xmlPath;
    for (const property of this.activeProperties) {
      if (property.key === 'Type' || property.key === 'Name' || !this.editSession.has(property.key)) {
        continue;
      }
      if (property.kind !== 'string' && property.kind !== 'boolean' && property.kind !== 'localizedString') {
        continue;
      }
      const nextValue = this.editSession.get(property.key);
      const saved = this.xmlEditor.modifyObjectProperty(currentXmlPath, {
        targetKind: propertyTarget.targetKind,
        targetName: propertyTarget.targetName,
        tabularSectionName: propertyTarget.tabularSectionName,
        propertyKey: property.key,
        valueKind: property.kind,
        value: property.kind === 'boolean' ? nextValue === true : String(nextValue ?? ''),
      });
      if (saved.success && saved.changed) {
        changedCount++;
      }
    }

    if (!typeValue && changedCount === 0) {
      vscode.window.showWarningMessage('Изменения свойств не обнаружены.');
      return;
    }

    this.editSession.clear();
    this.activeProperties = [];
    this.panel?.webview.postMessage({ type: 'resetDirty' });
    this.panel!.webview.html = this.renderHtml(this.activeNode);
    vscode.window.showInformationMessage('Свойства успешно изменены.');
  }

  private async promptAndRenameObject(): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    const target = resolvePropertyTarget(this.activeNode);
    if (!target || !isRootObjectNode(this.activeNode, target)) {
      void vscode.window.showWarningMessage('Переименование доступно только для корневого объекта метаданных.');
      return;
    }
    const newName = await vscode.window.showInputBox({
      title: 'Переименование объекта',
      prompt: 'Введите новое имя объекта',
      value: this.activeNode.textLabel,
      validateInput: (value) => {
        if (!value || !value.trim()) {
          return 'Имя не может быть пустым.';
        }
        if (!isValidMetadataName(value.trim())) {
          return 'Имя должно начинаться с буквы и содержать только буквы, цифры и "_".';
        }
        return null;
      },
    });
    if (!newName) {
      return;
    }
    const trimmed = newName.trim();
    const validation = this.xmlEditor.validateRenameMetadataObject(target.xmlPath, this.activeNode.nodeKind, trimmed);
    if (!validation.success) {
      void vscode.window.showErrorMessage(validation.errors[0] ?? 'Переименование не прошло проверку.');
      return;
    }
    const result = this.xmlEditor.renameMetadataObject(target.xmlPath, this.activeNode.nodeKind, trimmed);
    if (!result.success) {
      void vscode.window.showErrorMessage(result.errors[0] ?? 'Не удалось переименовать объект.');
      return;
    }
    const renamedPath = result.changedFiles
      .filter((item) => item.endsWith('.xml'))
      .find((item) => !item.endsWith('Configuration.xml'));
    if (!renamedPath) {
      void vscode.window.showErrorMessage('Переименование выполнено частично: не найден новый XML-файл объекта.');
      return;
    }

    this.activeNode = new MetadataNode({
      label: trimmed,
      nodeKind: this.activeNode.nodeKind,
      xmlPath: renamedPath,
      childrenLoader: this.activeNode.childrenLoader,
      ownershipTag: this.activeNode.ownershipTag,
      hidePropertiesCommand: this.activeNode.hidePropertiesCommand,
      metaContext: this.activeNode.metaContext,
    }, this.activeNode.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.editSession.delete('Name');
    this.activeProperties = [];
    if (this.panel) {
      this.panel.title = this.buildTitle(this.activeNode);
      this.panel.webview.html = this.renderHtml(this.activeNode);
      this.panel.webview.postMessage({ type: 'resetDirty' });
    }
    void vscode.window.showInformationMessage('Объект успешно переименован.');
  }

  private isEditLockedBySupport(node: MetadataNode): boolean {
    if (!this.supportService) {
      return false;
    }
    const lockMode = this.resolveNodeSupportMode(node);
    return lockMode === SupportMode.Locked;
  }

  private isEditLockedByRepository(node: MetadataNode): boolean {
    if (!this.repositoryService) {
      return false;
    }

    const xmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return false;
    }

    return this.repositoryService.isEditRestricted(xmlPath);
  }

  private resolveEditLockReason(node: MetadataNode): 'support' | 'repository' | undefined {
    if (this.isEditLockedBySupport(node)) {
      return 'support';
    }
    if (this.isEditLockedByRepository(node)) {
      return 'repository';
    }
    return undefined;
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
      const childXml = extractChildMetaElementXml(xml, childTag, node.textLabel);
      const uuid = extractUuidFromXml(childXml);
      return uuid ? this.supportService.getSupportModeByUuid(xmlPath, uuid) : this.supportService.getSupportMode(xmlPath);
    }

    if (node.nodeKind === 'Column') {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const columnXml = extractColumnXmlFromTabularSection(xml, node.metaContext?.tabularSectionName ?? '', node.textLabel);
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
      targetName: node.textLabel,
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
    targetName: node.textLabel,
    tabularSectionName: node.metaContext?.tabularSectionName,
  };
}

function resolvePropertyTarget(node: MetadataNode): {
  xmlPath: string;
  targetKind: 'Self' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue';
  targetName: string;
  tabularSectionName?: string;
} | null {
  if (!node.xmlPath) {
    return null;
  }
  const directKinds: Record<string, 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue'> = {
    Attribute: 'Attribute',
    AddressingAttribute: 'AddressingAttribute',
    Dimension: 'Dimension',
    Resource: 'Resource',
    Column: 'Column',
    TabularSection: 'TabularSection',
    EnumValue: 'EnumValue',
  };
  const mapped = directKinds[node.nodeKind];
  if (mapped) {
    return {
      xmlPath: node.metaContext?.ownerObjectXmlPath ?? node.xmlPath,
      targetKind: mapped,
      targetName: node.textLabel,
      tabularSectionName: node.metaContext?.tabularSectionName,
    };
  }
  if (node.nodeKind === 'Form') {
    const filePath = resolveNestedObjectDefinitionPath(node, 'Forms');
    if (!filePath) {
      return null;
    }
    return { xmlPath: filePath, targetKind: 'Self', targetName: node.textLabel };
  }
  if (node.nodeKind === 'Command') {
    const filePath = resolveNestedObjectDefinitionPath(node, 'Commands');
    if (!filePath) {
      return null;
    }
    return { xmlPath: filePath, targetKind: 'Self', targetName: node.textLabel };
  }
  if (node.nodeKind === 'Template') {
    const filePath = resolveNestedObjectDefinitionPath(node, 'Templates');
    if (!filePath) {
      return null;
    }
    return { xmlPath: filePath, targetKind: 'Self', targetName: node.textLabel };
  }
  return { xmlPath: node.xmlPath, targetKind: 'Self', targetName: node.textLabel };
}

function resolveNestedObjectDefinitionPath(
  node: MetadataNode,
  folderName: 'Forms' | 'Commands' | 'Templates'
): string | null {
  const ownerXmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
  if (!ownerXmlPath) {
    return null;
  }
  const location = getObjectLocationFromXml(ownerXmlPath);
  const candidates = [
    path.join(location.objectDir, folderName, node.textLabel, `${node.textLabel}.xml`),
    path.join(location.objectDir, folderName, `${node.textLabel}.xml`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractUuidFromXml(xml: string | null): string | null {
  if (!xml) {
    return null;
  }
  const match = /uuid="([0-9a-fA-F-]{36})"/.exec(xml);
  return match?.[1]?.toLowerCase() ?? null;
}

function isValidMetadataName(value: string): boolean {
  return /^[\p{L}][\p{L}\p{Nd}_]*$/u.test(value);
}

function isRootObjectNode(
  node: MetadataNode,
  target: { targetKind: 'Self' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue' }
): boolean {
  if (target.targetKind !== 'Self') {
    return false;
  }
  if (node.metaContext) {
    return false;
  }
  if (node.nodeKind === 'configuration' || node.nodeKind === 'extension' || node.nodeKind.startsWith('group-')) {
    return false;
  }
  return node.nodeKind !== 'NumeratorsBranch' && node.nodeKind !== 'SequencesBranch';
}

