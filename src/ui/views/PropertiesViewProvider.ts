import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getNodeKindLabel, MetadataNode } from '../tree/TreeNode';
import {
  EnumPropertyValue,
  LocalizedStringValue,
  MetadataTypeValue,
  MultiEnumPropertyValue,
  ObjectPropertyItem,
  ObjectPropertiesCollection,
} from '../tree/nodeBuilders/_types';
import { getHandlerForNode } from '../tree/nodeBuilders/index';
import { TypeRegistryService } from './properties/TypeRegistryService';
import { buildMetadataTypeInnerXml, ensureDefaultQualifiers } from './properties/MetadataTypeService';
import { toCanonicalPropertyInput } from './properties/PropertyPresentationRegistry';
import { ConfigurationXmlEditor } from '../../infra/xml';
import { extractChildMetaElementXml, extractColumnXmlFromTabularSection } from '../../infra/xml';
import { RepositoryService } from '../../infra/repository/RepositoryService';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import { getObjectLocationFromXml } from '../../infra/fs';
import { META_TYPES } from '../../domain/MetaTypes';
import {
  SubsystemMembershipSnapshot,
  SubsystemMembershipTreeNode,
  SubsystemXmlService,
} from '../../infra/xml/SubsystemXmlService';

/** Управляет вкладкой свойств объекта метаданных (singleton WebviewPanel) */
export class PropertiesViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private activeNode: MetadataNode | undefined;
  private activeProperties: ObjectPropertiesCollection = [];
  private propertyUpdateQueue: Promise<void> = Promise.resolve();
  private readonly typeRegistry = new TypeRegistryService();
  private readonly xmlEditor = new ConfigurationXmlEditor();
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly subsystemXmlService: SubsystemXmlService,
    private readonly supportService?: SupportInfoService,
    private readonly repositoryService?: RepositoryService,
    /** Вызывается сразу после успешного переименования до срабатывания файлового watcher'а */
    private readonly onAfterRename?: (configRoot: string, oldXmlPath: string, newXmlPath: string) => void,
    private readonly onAfterSubsystemMembershipSave?: () => void
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
      this.panel.webview.html = this.renderHtml(node, this.panel.webview);
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        '1cPropertiesView',
        this.buildTitle(node),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.webview.html = this.renderHtml(node, this.panel.webview);
      this.panel.webview.onDidReceiveMessage((msg) => this.handleWebviewMessage(msg));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.activeNode = undefined;
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
  private renderHtml(node: MetadataNode, webview: vscode.Webview): string {
    const content = this.renderBody(node, webview);

    return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      padding: 16px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .layout {
      max-width: 1040px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 160px minmax(0, 1fr);
      gap: 16px;
    }
    .layout.single {
      grid-template-columns: minmax(0, 1fr);
    }
    .tabs {
      display: grid;
      align-content: start;
      gap: 6px;
    }
    .tab {
      min-height: 34px;
      padding: 0 10px;
      text-align: left;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
      border: 1px solid var(--vscode-button-border, var(--vscode-panel-border, transparent));
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
    }
    .tab.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .panel {
      display: none;
      gap: 16px;
    }
    .panel.active {
      display: grid;
    }
    .card {
      padding: 16px;
      border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, transparent));
      border-radius: 10px;
      background: linear-gradient(180deg, var(--vscode-sideBar-background), var(--vscode-editor-background));
    }
    .header {
      display: grid;
      gap: 6px;
    }
    h1,
    .title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
    }
    .subtitle,
    .message,
    .property-note,
    .counter,
    .save-status {
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }
    .subtitle {
      margin: 0;
    }
    .message {
      padding: 12px;
    }
    .grid,
    .form {
      display: grid;
      gap: 12px;
    }
    .form-row,
    .row {
      display: grid;
      grid-template-columns: minmax(150px, 28%) minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }
    label,
    .label {
      font-weight: 600;
      padding-top: 7px;
    }
    .control {
      min-width: 0;
    }
    .input,
    .textarea,
    .select {
      width: 100%;
      box-sizing: border-box;
      min-height: 34px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 6px;
      padding: 7px 10px;
      font: inherit;
    }
    .textarea {
      min-height: 120px;
      resize: vertical;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      min-height: 32px;
    }
    .checkbox {
      width: auto;
      min-height: 0;
      margin: 3px 0 0;
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
      font-size: 12px;
    }
    .localized-item {
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--vscode-panel-border);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    button,
    .btn {
      min-height: 34px;
      padding: 0 14px;
      border-radius: 6px;
      border: 1px solid var(--vscode-button-border, transparent);
      font: inherit;
      cursor: pointer;
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:disabled,
    .btn:disabled,
    input:disabled,
    textarea:disabled,
    select:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
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
    .subsystem-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .tree-box {
      height: 430px;
      overflow: auto;
      padding: 4px;
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, transparent));
      border-radius: 6px;
      background: var(--vscode-input-background);
    }
    .subsystem-tree,
    .tree-box {
      display: flex;
      flex-direction: column;
    }
    .subsystem-node {
      margin-left: 8px;
    }
    .subsystem-node summary {
      list-style: none;
    }
    .subsystem-node summary::-webkit-details-marker {
      display: none;
    }
    .subsystem-line {
      display: flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 0 4px 0 0;
      border-radius: 6px;
      user-select: none;
    }
    .subsystem-line:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .subsystem-children {
      display: grid;
    }
    .tree-toggle {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .tree-toggle::before {
      content: "";
      width: 5px;
      height: 5px;
      border: solid var(--vscode-descriptionForeground);
      border-width: 0 1.5px 1.5px 0;
      transform: rotate(-45deg);
      transition: transform 80ms ease;
    }
    details[open] > summary .tree-toggle::before {
      transform: rotate(45deg);
    }
    .tree-toggle.empty::before {
      content: "";
      border: 0;
    }
    .tree-icon {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
    }
    .subsystem-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .subsystem-save-row {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      align-items: center;
    }
    .save-status {
      font-size: 12px;
    }
    .empty {
      padding: 12px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border, var(--vscode-input-border, transparent));
      border-radius: 6px;
    }
    @media (max-width: 760px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .tabs {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .form-row,
      .row,
      .qual-row {
        grid-template-columns: 1fr;
      }
      .tree-box {
        height: 360px;
      }
    }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
  }

  /** Формирует содержимое страницы */
  private renderBody(node: MetadataNode, webview: vscode.Webview): string {
    const handler = getHandlerForNode(node);
    const canShowProperties = handler?.canShowProperties?.(node) ?? false;

    if (!handler || !handler.getProperties || !canShowProperties) {
      return this.renderState(
        node.textLabel,
        'Для выбранного объекта отсутствуют свойства',
        getNodeKindLabel(node.nodeKind)
      );
    }

    const properties = handler.getProperties(node);
    this.activeProperties = properties;
    const subsystemSnapshot = this.resolveSubsystemMembershipSnapshot(node);
    const editLockReason = this.resolveEditLockReason(node);
    const isEditLocked = editLockReason !== undefined;
    const isEditLockedBySupport = editLockReason === 'support';
    const isEditLockedByRepository = editLockReason === 'repository';
    if (properties.length === 0 && !subsystemSnapshot) {
      return this.renderState(
        node.textLabel,
        'Для выбранного объекта отсутствуют свойства',
        getNodeKindLabel(node.nodeKind)
      );
    }

    const header = this.renderHeaderCard(node, isEditLockedBySupport, isEditLockedByRepository);
    return `
      <div class="layout ${subsystemSnapshot ? '' : 'single'}">
        ${subsystemSnapshot ? this.renderTabs() : ''}
        <main>
          ${subsystemSnapshot
            ? `
              <section class="panel active" data-panel="properties">
                ${header}
                <section class="card grid">
                  ${this.renderPropertiesComponent(properties, isEditLocked)}
                </section>
              </section>
              <section class="panel" data-panel="subsystems">
                <section class="card header">
                  <h1>Подсистемы</h1>
                  <p class="subtitle">Связь объекта с разделами командного интерфейса</p>
                  ${isEditLocked ? '<p class="subtitle">Редактирование запрещено текущим состоянием поддержки или хранилища.</p>' : ''}
                </section>
                <section class="card grid">
                  ${this.renderSubsystemMembershipComponent(subsystemSnapshot, webview, isEditLocked)}
                </section>
              </section>
            `
            : `
              <section class="panel active" data-panel="properties">
                ${header}
                <section class="card grid">
                  ${this.renderPropertiesComponent(properties, isEditLocked)}
                </section>
              </section>
            `}
        </main>
      </div>
      <script>${this.renderScript(isEditLocked, Boolean(subsystemSnapshot))}</script>
    `;
  }

  private renderHeaderCard(
    node: MetadataNode,
    isEditLockedBySupport: boolean,
    isEditLockedByRepository: boolean
  ): string {
    return `
      <section class="card header">
        <h1>${escapeHtml(node.textLabel)}</h1>
        <p class="subtitle">${escapeHtml(getNodeKindLabel(node.nodeKind))}</p>
        ${isEditLockedBySupport ? '<p class="subtitle">Редактирование запрещено поддержкой</p>' : ''}
        ${isEditLockedByRepository ? '<p class="subtitle">Редактирование запрещено: объект не захвачен в хранилище</p>' : ''}
      </section>
    `;
  }

  private renderTabs(): string {
    return `
      <nav class="tabs" aria-label="Разделы свойств">
        <button class="tab active" type="button" data-tab="properties">Свойства</button>
        <button class="tab" type="button" data-tab="subsystems">Подсистемы</button>
      </nav>
    `;
  }

  private renderPropertiesComponent(properties: ObjectPropertiesCollection, isEditLocked: boolean): string {
    if (properties.length === 0) {
      return '<div class="message">Для выбранного объекта отсутствуют свойства.</div>';
    }
    return `
      <div class="form">
        ${properties.map((property) => this.renderProperty(property, isEditLocked)).join('')}
      </div>
    `;
  }

  private renderSubsystemMembershipComponent(
    snapshot: SubsystemMembershipSnapshot,
    webview: vscode.Webview,
    isEditLocked: boolean
  ): string {
    const selectedCount = snapshot.selectedXmlPaths.length;
    const treeHtml = snapshot.tree.length === 0
      ? '<div class="empty">В конфигурации нет подсистем.</div>'
      : `<div class="tree-box subsystem-tree">${snapshot.tree.map((node) => this.renderSubsystemMembershipNode(node, webview, isEditLocked)).join('')}</div>`;
    const disabledAttr = isEditLocked || snapshot.tree.length === 0 ? 'disabled' : '';

    return `
      <div class="subsystem-toolbar">
        <span>Выбрано подсистем: <span id="selectedSubsystemCount">${selectedCount}</span></span>
      </div>
      ${treeHtml}
      <div class="subsystem-save-row">
        <span class="save-status" id="subsystemSaveStatus"></span>
        <button class="primary" id="saveSubsystemsBtn" type="button" ${disabledAttr}>Сохранить</button>
      </div>
    `;
  }

  private renderSubsystemMembershipNode(
    node: SubsystemMembershipTreeNode,
    webview: vscode.Webview,
    isEditLocked: boolean
  ): string {
    const disabledAttr = isEditLocked ? 'disabled' : '';
    const checkedAttr = node.checked ? 'checked' : '';
    const checkbox = `<input class="checkbox subsystem-checkbox" type="checkbox" data-subsystem-path="${escapeHtml(node.xmlPath)}" ${checkedAttr} ${disabledAttr}>`;
    const line = `
      <span class="subsystem-line">
        <span class="tree-toggle ${node.children.length === 0 ? 'empty' : ''}" aria-hidden="true"></span>
        ${checkbox}
        ${this.renderSubsystemIcon(webview)}
        <span class="subsystem-label" title="${escapeHtml(node.name)}">${escapeHtml(node.label)}</span>
      </span>
    `;

    if (node.children.length === 0) {
      return `<div class="subsystem-node">${line}</div>`;
    }

    return `
      <details class="subsystem-node" open>
        <summary>${line}</summary>
        <div class="subsystem-children">
          ${node.children.map((child) => this.renderSubsystemMembershipNode(child, webview, isEditLocked)).join('')}
        </div>
      </details>
    `;
  }

  private renderSubsystemIcon(webview: vscode.Webview): string {
    const lightUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'light', 'subsystem.svg'));
    const darkUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'icons', 'dark', 'subsystem.svg'));
    return `
      <picture>
        <source srcset="${lightUri}" media="(prefers-color-scheme: light)">
        <img class="tree-icon" src="${darkUri}" alt="">
      </picture>
    `;
  }

  /** Формирует шаблон пустого/ошибочного состояния */
  private renderState(title: string, message: string, subtitle?: string): string {
    return `
      <div class="layout single">
        <main>
          <section class="panel active">
            <section class="card header">
              <h1>${escapeHtml(title)}</h1>
              ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ''}
            </section>
            <section class="card">
              <div class="message">${escapeHtml(message)}</div>
            </section>
          </section>
        </main>
      </div>
    `;
  }

  /** Формирует строку свойства */
  private renderProperty(property: ObjectPropertyItem, isEditLocked: boolean): string {
    const valueHtml = this.renderPropertyValue(property, isEditLocked);
    const noteHtml = this.renderPropertyNote(property);
    return `
      <div class="row">
        <label class="label" title="${escapeHtml(property.key)}">${escapeHtml(property.title)}</label>
        <div class="control">${valueHtml}${noteHtml}</div>
      </div>
    `;
  }

  /** Формирует HTML значения свойства */
  private renderPropertyValue(property: ObjectPropertyItem, isEditLocked: boolean): string {
    if (property.key === '_note') {
      return `<div class="static-text">${escapeHtml(String(property.value ?? ''))}</div>`;
    }

    const isEditable = !isEditLocked && !property.readonly;
    const disabledAttr = isEditable ? '' : 'disabled data-readonly="true"';
    const readonlyAttr = isEditable ? '' : 'readonly data-readonly="true"';
    switch (property.kind) {
      case 'boolean':
        return `<div class="checkbox-row"><input class="checkbox" data-prop-key="${escapeHtml(property.key)}" type="checkbox" ${property.value === true ? 'checked' : ''} ${disabledAttr} /></div>`;
      case 'enum': {
        const enumValue = property.value as EnumPropertyValue;
        const options = enumValue.allowedValues
          .map((option) => {
            return `<option value="${escapeHtml(option.value)}" ${option.value === enumValue.current ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
          })
          .join('');
        return `<select class="select" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="string" ${disabledAttr}>${options}</select>`;
      }
      case 'multiEnum': {
        const multiValue = property.value as MultiEnumPropertyValue;
        const selected = new Set(multiValue.selected);
        const options = multiValue.allowedValues
          .map((option) => {
            return `<option value="${escapeHtml(option.value)}" ${selected.has(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
          })
          .join('');
        const size = Math.min(Math.max(multiValue.allowedValues.length, 2), 8);
        return `<select class="select" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="multiEnum" multiple size="${size}" ${disabledAttr}>${options}</select>`;
      }
      case 'localizedString': {
        const localized = property.value as LocalizedStringValue;
        const renderValue = String(localized.presentation);
        const items = localized.values
          .map((item) => {
            return `<div class="localized-item"><strong>${escapeHtml(item.lang)}:</strong> ${escapeHtml(item.content)}</div>`;
          })
          .join('');

        return `
          <input class="input" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="localizedString" type="text" value="${escapeHtml(renderValue)}" ${readonlyAttr} />
          ${items ? `<div class="property-note">Локализации:</div>${items}` : ''}
        `;
      }
      case 'string':
      default:
        if (property.kind === 'metadataType') {
          return this.renderMetadataTypeControl(property, isEditLocked || property.readonly === true);
        }
        if (String(property.value ?? '').includes('\n')) {
          return `<textarea class="textarea" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="string" ${readonlyAttr}>${escapeHtml(String(property.value ?? ''))}</textarea>`;
        }
        return `<input class="input" data-prop-key="${escapeHtml(property.key)}" data-prop-kind="string" type="text" value="${escapeHtml(String(property.value ?? ''))}" ${readonlyAttr} />`;
    }
  }

  private renderMetadataTypeControl(property: ObjectPropertyItem, isLocked: boolean): string {
    const value = this.getRenderTypeValue(property);
    const disabledAttr = isLocked ? 'disabled' : '';
    return `
      <div class="type-control">
        <div class="type-row">
          <input class="input" id="typePresentation" type="text" value="${escapeHtml(value.presentation)}" readonly />
          <button class="btn" id="pickTypeBtn" ${disabledAttr}>Выбрать</button>
        </div>
        ${this.renderTypeQualifiers(value, isLocked)}
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

  private renderPropertyNote(property: ObjectPropertyItem): string {
    if (property.inherited) {
      return '<div class="property-note">Значение из основной конфигурации. Переопределение через панель свойств пока недоступно.</div>';
    }
    if (property.readonly && property.key !== '_note') {
      return '<div class="property-note">Служебное свойство доступно только для чтения.</div>';
    }
    return '';
  }

  private renderScript(isEditLocked: boolean, hasSubsystemTab: boolean): string {
    return `
      const vscode = acquireVsCodeApi();
      const typeBtn = document.getElementById('pickTypeBtn');
      const isEditLocked = ${isEditLocked ? 'true' : 'false'};
      const hasSubsystemTab = ${hasSubsystemTab ? 'true' : 'false'};
      const isValidMetadataName = (value) => /^[\\p{L}][\\p{L}\\p{Nd}_]*$/u.test(value);
      const lastValidByKey = new Map();
      if (hasSubsystemTab) {
        document.querySelectorAll('.tab').forEach((button) => {
          button.addEventListener('click', () => {
            const tab = button.dataset.tab;
            if (!tab) return;
            document.querySelectorAll('.tab').forEach((item) => {
              const active = item === button;
              item.classList.toggle('active', active);
            });
            document.querySelectorAll('.panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
          });
        });
      }
      const submitOnEnter = (el, key, kind) => {
        if (el.tagName === 'TEXTAREA') return;
        el.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
            return;
          }
          if (key === 'Name' && el.type !== 'checkbox') {
            const current = String(el.value ?? '');
            if (!isValidMetadataName(current)) {
              event.preventDefault();
              el.value = String(lastValidByKey.get(key) ?? '');
              vscode.postMessage({ type: 'invalidName' });
              return;
            }
            lastValidByKey.set(key, current);
          }
          event.preventDefault();
          el.dataset.skipNextBlurSubmit = 'true';
          postPropertyChange(el, key, kind);
          if (typeof el.blur === 'function') {
            el.blur();
          }
        });
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
          if (isEditLocked) return;
          vscode.postMessage({ type: 'openTypePicker', qualifiers: collectQualifiers() });
        });
      }
      for (const id of ['qStringLength','qStringAllowedLength','qNumberDigits','qNumberFractionDigits','qNumberAllowedSign','qDateFractions']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('change', () => {
          if (isEditLocked) return;
          vscode.postMessage({ type: 'updateTypeQualifiers', qualifiers: collectQualifiers() });
        });
      }
      const postPropertyChange = (el, key, kind) => {
        const value = el.multiple
          ? Array.from(el.selectedOptions).map((option) => String(option.value ?? ''))
          : el.type === 'checkbox'
          ? Boolean(el.checked)
          : String(el.value ?? '');
        vscode.postMessage({ type: 'propertyChanged', key, kind, value });
      };
      document.querySelectorAll('[data-prop-key]').forEach((el) => {
        const key = el.getAttribute('data-prop-key');
        const kind = el.getAttribute('data-prop-kind') || (el.type === 'checkbox' ? 'boolean' : 'string');
        if (!key || isEditLocked || el.dataset.readonly === 'true') return;
        if (el.type !== 'checkbox') {
          lastValidByKey.set(key, String(el.value ?? ''));
        }
        if (el.type === 'checkbox' || el.tagName === 'SELECT') {
          el.addEventListener('change', () => {
            postPropertyChange(el, key, kind);
          });
          return;
        }
        submitOnEnter(el, key, kind);
        el.addEventListener('blur', () => {
          if (el.dataset.skipNextBlurSubmit === 'true') {
            delete el.dataset.skipNextBlurSubmit;
            return;
          }
          if (key === 'Name' && el.type !== 'checkbox') {
            const current = String(el.value ?? '');
            if (!isValidMetadataName(current)) {
              el.value = String(lastValidByKey.get(key) ?? '');
              vscode.postMessage({ type: 'invalidName' });
              return;
            }
            lastValidByKey.set(key, current);
          }
          postPropertyChange(el, key, kind);
        });
      });
      if (hasSubsystemTab) {
        const saveSubsystemsBtn = document.getElementById('saveSubsystemsBtn');
        const selectedSubsystemCount = document.getElementById('selectedSubsystemCount');
        const subsystemSaveStatus = document.getElementById('subsystemSaveStatus');
        const subsystemCheckboxes = Array.from(document.querySelectorAll('.subsystem-checkbox'));
        let subsystemDirty = false;
        const updateSubsystemState = () => {
          const selected = subsystemCheckboxes.filter((item) => Boolean(item.checked)).length;
          if (selectedSubsystemCount) selectedSubsystemCount.textContent = String(selected);
          if (saveSubsystemsBtn && !isEditLocked) saveSubsystemsBtn.disabled = subsystemCheckboxes.length === 0 || !subsystemDirty;
          if (subsystemSaveStatus) subsystemSaveStatus.textContent = subsystemDirty ? 'Есть несохраненные изменения' : '';
        };
        subsystemCheckboxes.forEach((checkbox) => {
          checkbox.addEventListener('click', (event) => event.stopPropagation());
          checkbox.addEventListener('change', () => {
            if (isEditLocked) return;
            subsystemDirty = true;
            updateSubsystemState();
          });
        });
        updateSubsystemState();
        saveSubsystemsBtn?.addEventListener('click', () => {
          if (isEditLocked || !subsystemDirty) return;
          const selectedXmlPaths = subsystemCheckboxes
            .filter((item) => Boolean(item.checked))
            .map((item) => String(item.getAttribute('data-subsystem-path') ?? ''))
            .filter(Boolean);
          saveSubsystemsBtn.disabled = true;
          if (subsystemSaveStatus) subsystemSaveStatus.textContent = 'Сохраняю...';
          vscode.postMessage({ type: 'saveSubsystemMembership', selectedXmlPaths });
        });
      }
    `;
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    const msg = message as {
      type?: string;
      qualifiers?: Record<string, string>;
      presentation?: string;
      key?: string;
      value?: string | boolean | string[];
      kind?: string;
      selectedXmlPaths?: string[];
    };
    if (!this.activeNode || !this.panel) {
      return;
    }
    if (this.isEditLockedByRepository(this.activeNode)) {
      if (
        msg.type === 'openTypePicker' ||
        msg.type === 'updateTypeQualifiers' ||
        msg.type === 'propertyChanged' ||
        msg.type === 'saveSubsystemMembership'
      ) {
        void vscode.window.showWarningMessage('Редактирование свойств запрещено: объект не захвачен в хранилище.');
      }
      return;
    }
    if (this.isEditLockedBySupport(this.activeNode)) {
      if (
        msg.type === 'openTypePicker' ||
        msg.type === 'updateTypeQualifiers' ||
        msg.type === 'propertyChanged' ||
        msg.type === 'saveSubsystemMembership'
      ) {
        void vscode.window.showWarningMessage('Редактирование свойств запрещено поддержкой для этого объекта.');
      }
      return;
    }
    if (msg.type === 'openTypePicker') {
      if (this.isCurrentTypeReadonly()) {
        this.showReadonlyPropertyWarning(this.activeProperties.find((item) => item.key === 'Type'));
        return;
      }
      await this.enqueuePropertyOperation(() => this.handleOpenTypePicker());
      return;
    }
    if (msg.type === 'invalidName') {
      void vscode.window.showErrorMessage('Имя должно начинаться с буквы и содержать только буквы, цифры и "_".');
      return;
    }
    if (msg.type === 'updateTypeQualifiers') {
      if (this.isCurrentTypeReadonly()) {
        this.showReadonlyPropertyWarning(this.activeProperties.find((item) => item.key === 'Type'));
        return;
      }
      await this.enqueuePropertyOperation(() => this.applyQualifierChanges(msg.qualifiers ?? {}));
      return;
    }
    if (msg.type === 'propertyChanged') {
      const currentProperty = this.activeProperties.find((item) => item.key === msg.key);
      if (currentProperty?.readonly) {
        this.showReadonlyPropertyWarning(currentProperty);
        return;
      }
      await this.enqueuePropertyOperation(() => this.applyPropertyChange(msg.key, msg.value));
      return;
    }
    if (msg.type === 'saveSubsystemMembership') {
      await this.enqueuePropertyOperation(() => this.applySubsystemMembershipChange(msg.selectedXmlPaths ?? []));
    }
  }

  /**
   * Выполняет изменения свойств последовательно, чтобы не допускать конкурентной записи XML.
   */
  private async enqueuePropertyOperation(operation: () => Promise<void>): Promise<void> {
    const run = this.propertyUpdateQueue.then(async () => {
      await operation();
    });
    this.propertyUpdateQueue = run.catch(() => undefined);
    await run;
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
    await this.applyTypeValue(nextType);
  }

  private async applyQualifierChanges(qualifiers: Record<string, string>): Promise<void> {
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
    await this.applyTypeValue(next);
  }

  private getCurrentTypeValue(): MetadataTypeValue | null {
    const original = this.activeProperties.find((item) => item.key === 'Type');
    if (!original || original.kind !== 'metadataType') {
      return null;
    }
    return ensureDefaultQualifiers(original.value as MetadataTypeValue);
  }

  private async applyTypeValue(typeValue: MetadataTypeValue): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    const typeTarget = resolveTypeTarget(this.activeNode);
    if (!typeTarget) {
      void vscode.window.showWarningMessage('Для выбранного узла изменение типа пока не поддерживается.');
      return;
    }
    const typeSaved = this.xmlEditor.modifyObjectType(typeTarget.xmlPath, {
      targetKind: typeTarget.targetKind,
      targetName: typeTarget.targetName,
      tabularSectionName: typeTarget.tabularSectionName,
      typeInnerXml: buildMetadataTypeInnerXml(typeValue),
    });
    if (!typeSaved.success) {
      void vscode.window.showErrorMessage(typeSaved.errors[0] ?? 'Не удалось применить изменение типа.');
      return;
    }
    if (this.panel && this.activeNode) {
      this.panel.webview.html = this.renderHtml(this.activeNode, this.panel.webview);
    }
  }

  private async applyPropertyChange(key?: string, value?: string | boolean | string[]): Promise<void> {
    if (!this.activeNode || !key) {
      return;
    }
    const currentProperty = this.activeProperties.find((item) => item.key === key);
    if (!currentProperty) {
      return;
    }
    if (currentProperty.readonly) {
      this.showReadonlyPropertyWarning(currentProperty);
      return;
    }
    if (
      currentProperty.kind !== 'string' &&
      currentProperty.kind !== 'boolean' &&
      currentProperty.kind !== 'enum' &&
      currentProperty.kind !== 'multiEnum' &&
      currentProperty.kind !== 'localizedString'
    ) {
      return;
    }
    const nextValue = currentProperty.kind === 'boolean'
      ? value === true
      : currentProperty.kind === 'multiEnum'
      ? Array.isArray(value) ? value : []
      : String(value ?? '');
    const currentValue = currentProperty.kind === 'boolean'
      ? currentProperty.value === true
      : currentProperty.kind === 'localizedString'
      ? (currentProperty.value as LocalizedStringValue).presentation
      : currentProperty.kind === 'enum'
      ? (currentProperty.value as EnumPropertyValue).current
      : currentProperty.kind === 'multiEnum'
      ? (currentProperty.value as MultiEnumPropertyValue).selected
      : String(currentProperty.value ?? '');
    if (arePropertyEditValuesEqual(nextValue, currentValue)) {
      return;
    }
    if (this.isConfigurationRootNode(this.activeNode)) {
      await this.applyConfigurationPropertyChange(key, currentProperty, nextValue);
      return;
    }
    const propertyTarget = resolvePropertyTarget(this.activeNode);
    if (!propertyTarget) {
      void vscode.window.showWarningMessage('Для выбранного узла изменение свойств пока не поддерживается.');
      return;
    }
    if (key === 'Name' && isRootObjectNode(this.activeNode, propertyTarget)) {
      if (typeof nextValue !== 'string') {
        return;
      }
      await this.renameObject(nextValue);
      return;
    }
    if (currentProperty.kind === 'multiEnum') {
      void vscode.window.showWarningMessage('Изменение этого свойства поддержано только для корня конфигурации.');
      return;
    }
    const valueKind: 'string' | 'boolean' | 'localizedString' = currentProperty.kind === 'enum'
      ? 'string'
      : currentProperty.kind;
    const objectValue = Array.isArray(nextValue)
      ? ''
      : currentProperty.kind === 'string'
      ? toCanonicalPropertyInput(String(nextValue ?? ''))
      : nextValue;
    const saved = this.xmlEditor.modifyObjectProperty(propertyTarget.xmlPath, {
      targetKind: propertyTarget.targetKind,
      targetName: propertyTarget.targetName,
      tabularSectionName: propertyTarget.tabularSectionName,
      propertyKey: key,
      valueKind,
      value: objectValue,
    });
    if (!saved.success) {
      void vscode.window.showErrorMessage(saved.errors[0] ?? `Не удалось изменить свойство "${key}".`);
      return;
    }
    if (saved.changed && this.panel && this.activeNode) {
      this.panel.webview.html = this.renderHtml(this.activeNode, this.panel.webview);
    }
  }

  private async applyConfigurationPropertyChange(
    key: string,
    property: ObjectPropertyItem,
    value: string | boolean | string[]
  ): Promise<void> {
    if (!this.activeNode?.xmlPath) {
      return;
    }

    const kind = property.kind === 'localizedString'
      ? 'localized'
      : property.kind === 'boolean'
      ? 'boolean'
      : property.kind === 'multiEnum'
      ? 'multiEnum'
      : key === 'DefaultLanguage'
      ? 'reference'
      : 'scalar';

    const scalarValue = typeof value === 'string' && (kind === 'scalar' || kind === 'reference')
      ? toCanonicalPropertyInput(value)
      : value;
    const saved = key === 'DefaultRoles' && Array.isArray(value)
      ? this.xmlEditor.setDefaultRoles(this.activeNode.xmlPath, value)
      : this.xmlEditor.modifyConfigurationProperty(this.activeNode.xmlPath, key, scalarValue, kind);
    if (!saved.success) {
      void vscode.window.showErrorMessage(saved.errors[0] ?? `Не удалось изменить свойство "${key}".`);
      return;
    }
    if (saved.changed && this.panel && this.activeNode) {
      this.panel.webview.html = this.renderHtml(this.activeNode, this.panel.webview);
    }
  }

  private async applySubsystemMembershipChange(selectedXmlPaths: string[]): Promise<void> {
    if (!this.activeNode?.xmlPath) {
      return;
    }
    if (!this.isSubsystemMembershipNode(this.activeNode)) {
      void vscode.window.showWarningMessage('Связь с подсистемами доступна только для корневых объектов метаданных.');
      return;
    }

    const location = getObjectLocationFromXml(this.activeNode.xmlPath);
    const objectRef = `${this.activeNode.nodeKind}.${this.activeNode.textLabel}`;
    const changed = this.subsystemXmlService.setObjectSubsystemMembership(location.configRoot, objectRef, selectedXmlPaths);
    if (changed) {
      this.onAfterSubsystemMembershipSave?.();
    }
    if (this.panel && this.activeNode) {
      this.panel.webview.html = this.renderHtml(this.activeNode, this.panel.webview);
    }
    void vscode.window.showInformationMessage(changed
      ? 'Состав подсистем для объекта сохранен.'
      : 'Состав подсистем не изменился.');
  }

  private isConfigurationRootNode(node: MetadataNode): boolean {
    return node.nodeKind === 'configuration' || node.nodeKind === 'extension';
  }

  private resolveSubsystemMembershipSnapshot(node: MetadataNode): SubsystemMembershipSnapshot | null {
    if (!this.isSubsystemMembershipNode(node) || !node.xmlPath) {
      return null;
    }
    try {
      const location = getObjectLocationFromXml(node.xmlPath);
      return this.subsystemXmlService.readMembershipSnapshot(
        location.configRoot,
        `${node.nodeKind}.${node.textLabel}`
      );
    } catch {
      return null;
    }
  }

  private isSubsystemMembershipNode(node: MetadataNode): boolean {
    const target = resolvePropertyTarget(node);
    if (!target || !isRootObjectNode(node, target)) {
      return false;
    }
    if (node.nodeKind === 'Subsystem') {
      return false;
    }
    return Boolean(META_TYPES[node.nodeKind]?.folder);
  }

  private getRenderTypeValue(property: ObjectPropertyItem): MetadataTypeValue {
    return ensureDefaultQualifiers(property.value as MetadataTypeValue);
  }

  private isCurrentTypeReadonly(): boolean {
    const original = this.activeProperties.find((item) => item.key === 'Type');
    return original?.readonly === true;
  }

  private showReadonlyPropertyWarning(property: ObjectPropertyItem | undefined): void {
    if (property?.inherited) {
      void vscode.window.showWarningMessage('Свойство получено из основной конфигурации. Переопределение через панель свойств пока недоступно.');
      return;
    }
    void vscode.window.showWarningMessage('Это свойство доступно только для чтения.');
  }

  private async renameObject(nextName: string): Promise<void> {
    if (!this.activeNode) {
      return;
    }
    if (this.isEditLockedByRepository(this.activeNode)) {
      void vscode.window.showWarningMessage('Переименование запрещено: объект не захвачен в хранилище.');
      return;
    }
    const target = resolvePropertyTarget(this.activeNode);
    if (!target || !isRootObjectNode(this.activeNode, target)) {
      void vscode.window.showWarningMessage('Переименование доступно только для корневого объекта метаданных.');
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed || !isValidMetadataName(trimmed)) {
      void vscode.window.showErrorMessage('Имя должно начинаться с буквы и содержать только буквы, цифры и "_".');
      return;
    }
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

    const oldXmlPath = target.xmlPath;
    this.activeNode = new MetadataNode({
      label: trimmed,
      nodeKind: this.activeNode.nodeKind,
      xmlPath: renamedPath,
      childrenLoader: this.activeNode.childrenLoader,
      ownershipTag: this.activeNode.ownershipTag,
      hidePropertiesCommand: this.activeNode.hidePropertiesCommand,
      metaContext: this.activeNode.metaContext,
    }, this.activeNode.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.activeProperties = [];
    if (this.panel) {
      this.panel.title = this.buildTitle(this.activeNode);
      this.panel.webview.html = this.renderHtml(this.activeNode, this.panel.webview);
    }
    void vscode.window.showInformationMessage('Объект успешно переименован.');

    const location = getObjectLocationFromXml(oldXmlPath);
    this.onAfterRename?.(location.configRoot, oldXmlPath, renamedPath);
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

function arePropertyEditValuesEqual(left: string | boolean | string[], right: string | boolean | string[]): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
  }
  return left === right;
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
  const ownerXmlPath = node.metaContext?.ownerObjectXmlPath;
  if (ownerXmlPath && ownerXmlPath !== node.xmlPath) {
    return false;
  }
  if (node.nodeKind === 'configuration' || node.nodeKind === 'extension' || node.nodeKind.startsWith('group-')) {
    return false;
  }
  return node.nodeKind !== 'NumeratorsBranch' && node.nodeKind !== 'SequencesBranch';
}
