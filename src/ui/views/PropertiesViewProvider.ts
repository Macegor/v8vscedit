import * as vscode from 'vscode';
import { getNodeKindLabel, MetadataNode } from '../tree/TreeNode';
import {
  EnumPropertyValue,
  LocalizedStringValue,
  ObjectPropertyItem,
} from '../tree/nodeBuilders/_types';
import { getHandlerForNode } from '../tree/nodeBuilders/index';

/** Управляет вкладкой свойств объекта метаданных (singleton WebviewPanel) */
export class PropertiesViewProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  /**
   * Открывает вкладку свойств для узла.
   * Если вкладка уже открыта — заменяет содержимое и переключается на неё,
   * новую группу редактора не создаёт.
   */
  show(node: MetadataNode): void {
    if (this.panel) {
      this.panel.title = this.buildTitle(node);
      this.panel.webview.html = this.renderHtml(node);
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        '1cPropertiesView',
        this.buildTitle(node),
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        { enableScripts: false, retainContextWhenHidden: false }
      );
      this.panel.webview.html = this.renderHtml(node);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
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
      </div>
      <div class="form">
        ${properties.map((property) => this.renderProperty(property)).join('')}
      </div>
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
  private renderProperty(property: ObjectPropertyItem): string {
    const valueHtml = this.renderPropertyValue(property);
    return `
      <div class="row">
        <label class="label" title="${escapeHtml(property.key)}">${escapeHtml(property.title)}</label>
        <div class="control">${valueHtml}</div>
      </div>
    `;
  }

  /** Формирует HTML значения свойства */
  private renderPropertyValue(property: ObjectPropertyItem): string {
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
        return `<input class="input" type="text" value="${escapeHtml(String(property.value ?? ''))}" readonly />`;
    }
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
