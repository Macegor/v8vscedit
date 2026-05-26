import * as vscode from 'vscode';
import type { MetadataNode } from '../../tree/TreeNode';
import type { PropertiesViewController } from '../properties/PropertiesViewController';
import { ModuleStructureContextHandler } from './contexts/ModuleStructureContextHandler';
import type { ActiveDocumentInfo, DynamicPanelState, ModuleSymbolDto, RangeDto } from './_types';

export interface DynamicPanelHost {
  postState(state: DynamicPanelState): void;
}

/**
 * Маршрутизатор контекста для динамической панели.
 * Решает, что показывать — структуру модуля или свойства объекта, — и эмитит state хосту.
 * Последнее действие пользователя выигрывает.
 */
export class DynamicPanelController implements vscode.Disposable {
  private host: DynamicPanelHost | undefined;
  private currentState: DynamicPanelState = { kind: 'empty' };
  private activeNode: MetadataNode | undefined;
  private activeDocumentUri: string | undefined;
  private readonly moduleHandler: ModuleStructureContextHandler;
  private readonly editorSubscription: vscode.Disposable;
  private readonly textChangeSubscription: vscode.Disposable;

  constructor(private readonly propertiesController: PropertiesViewController) {
    this.moduleHandler = new ModuleStructureContextHandler(
      (info, symbols) => this.applyModuleSymbols(info, symbols),
      (info) => this.applyModuleLoading(info)
    );

    this.editorSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.onActiveEditorChanged(editor);
    });

    this.textChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (this.currentState.kind === 'module-structure'
        && event.document.uri.toString() === this.activeDocumentUri) {
        this.moduleHandler.schedule(event.document);
      }
    });

    this.evaluateInitialState();
  }

  attachHost(host: DynamicPanelHost): void {
    this.host = host;
    this.host.postState(this.currentState);
  }

  detachHost(): void {
    this.host = undefined;
  }

  getCurrentState(): DynamicPanelState {
    return this.currentState;
  }

  /** Показать свойства выбранного узла. Последний сигнал выигрывает. */
  showProperties(node: MetadataNode): void {
    this.activeNode = node;
    this.activeDocumentUri = undefined;
    this.moduleHandler.cancel();
    this.propertiesController.setActiveNode(node);
    this.refreshProperties();
  }

  /** Обновить состояние свойств (после редактирования) — переотправить текущему хосту. */
  refreshProperties(): void {
    const node = this.activeNode;
    if (!node) {
      return;
    }
    const view = this.propertiesController.getViewState();
    if (!view) {
      this.setState({ kind: 'empty', message: 'Для выбранного объекта свойства недоступны.' });
      return;
    }
    this.setState({ kind: 'properties', view });
  }

  /** Применить переименование объекта, обновить активный узел и состояние. */
  replaceActiveNode(node: MetadataNode): void {
    this.activeNode = node;
    if (this.currentState.kind === 'properties') {
      this.refreshProperties();
    }
  }

  /** Сбросить активный объект. */
  clearActive(): void {
    this.activeNode = undefined;
    this.activeDocumentUri = undefined;
    this.propertiesController.clearActiveNode();
    this.setState({ kind: 'empty' });
  }

  /** Получить активный узел (для команд, которые работают с текущим объектом). */
  getActiveNode(): MetadataNode | undefined {
    return this.activeNode;
  }

  /** Обработка команд из webview (свойства, навигация по символам). */
  async handleWebviewCommand(command: string, payload: unknown): Promise<void> {
    if (command === 'revealSymbol') {
      await this.revealSymbol(payload as { range?: RangeDto } | undefined);
      return;
    }
    if (command === 'propertyChanged') {
      const p = payload as { key?: string; controlId?: string; value: unknown };
      this.propertiesController.handlePropertyChange(p.key ?? p.controlId ?? '', p.value);
      return;
    }
    await this.propertiesController.handleWebviewMessage({
      type: command,
      ...(typeof payload === 'object' && payload !== null ? payload : {}),
    });
  }

  dispose(): void {
    this.host = undefined;
    this.editorSubscription.dispose();
    this.textChangeSubscription.dispose();
    this.moduleHandler.dispose();
  }

  private evaluateInitialState(): void {
    const editor = vscode.window.activeTextEditor;
    if (ModuleStructureContextHandler.isSupported(editor?.document)) {
      this.onActiveEditorChanged(editor);
    }
  }

  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (!ModuleStructureContextHandler.isSupported(editor?.document)) {
      // Если динамическая панель сейчас показывает структуру модуля, а активный редактор
      // переключился на нерелевантный документ — оставим последнее состояние,
      // чтобы пользователь не терял контекст после перехода в Output/настройки.
      return;
    }
    if (!editor) {
      return;
    }
    this.activeDocumentUri = editor.document.uri.toString();
    this.activeNode = undefined;
    this.moduleHandler.schedule(editor.document, true);
  }

  private applyModuleLoading(info: ActiveDocumentInfo): void {
    if (this.activeDocumentUri !== info.uri) {
      this.activeDocumentUri = info.uri;
    }
    this.setState({
      kind: 'module-structure',
      document: info,
      symbols: this.currentState.kind === 'module-structure' && this.currentState.document.uri === info.uri
        ? this.currentState.symbols
        : [],
      loading: true,
    });
  }

  private applyModuleSymbols(info: ActiveDocumentInfo, symbols: ModuleSymbolDto[]): void {
    if (this.activeDocumentUri !== info.uri) {
      return;
    }
    this.setState({ kind: 'module-structure', document: info, symbols, loading: false });
  }

  private async revealSymbol(payload: { range?: RangeDto } | undefined): Promise<void> {
    if (!payload?.range || !this.activeDocumentUri) {
      return;
    }
    try {
      const uri = vscode.Uri.parse(this.activeDocumentUri);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, { preserveFocus: false });
      const range = new vscode.Range(
        new vscode.Position(payload.range.start.line, payload.range.start.character),
        new vscode.Position(payload.range.end.line, payload.range.end.character)
      );
      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      editor.selection = new vscode.Selection(range.start, range.start);
    } catch {
      // Если документ закрыт или перемещён — игнорируем.
    }
  }

  private setState(next: DynamicPanelState): void {
    this.currentState = next;
    this.host?.postState(next);
  }
}
