import * as vscode from 'vscode';
import * as fs from 'fs';
import type {
  MetadataRefTreeNode,
  SubsystemPropertyKey,
  SubsystemXmlService,
} from '../../../infra/xml/SubsystemXmlService';
import { type SupportInfoService, SupportMode } from '../../../infra/support/SupportInfoService';
import type { RepositoryService } from '../../../infra/repository/RepositoryService';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';

/** Сообщения от Vue-приложения редактора подсистем. */
type SubsystemMessage =
  | { readonly type: 'command'; readonly command: 'toggleContent'; readonly payload: { readonly id: string; readonly included: boolean } }
  | { readonly type: 'command'; readonly command: 'openChild'; readonly payload: { readonly id: string } }
  | { readonly type: 'command'; readonly command: 'propertyChanged'; readonly payload: { readonly key: string; readonly value: unknown } };

/** Начальное состояние для Vue-приложения. */
interface SubsystemInitialState {
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly locked: boolean;
  readonly properties: {
    readonly name: string;
    readonly synonym: string;
    readonly comment: string;
    readonly includeHelpInContents: boolean;
    readonly includeInCommandInterface: boolean;
    readonly useOneCommand: boolean;
    readonly explanation: string;
    readonly pictureRef: string;
    readonly pictureLoadTransparent: boolean;
  };
  readonly content: {
    readonly refs: readonly string[];
    readonly availableCount: number;
    readonly selectedCount: number;
    readonly tree: readonly MetadataRefTreeNode[];
  };
  readonly children: readonly string[];
}

/**
 * Провайдер редактора подсистем на Vue.
 * Отправляет начальное состояние и обрабатывает сообщения через xmlService.
 */
export class SubsystemEditorViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditSubsystemEditor';

  private panel: vscode.WebviewPanel | undefined;
  private htmlFactory: WebviewHtmlFactory;
  private currentNodeLabel: string | undefined;
  private currentXmlPath: string | undefined;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly xmlService: SubsystemXmlService,
    private readonly supportInfoService: SupportInfoService,
    private readonly repositoryService: RepositoryService,
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    this.htmlFactory = new WebviewHtmlFactory(extensionUri);
  }

  /**
   * Открывает редактор подсистемы по пути к XML.
   */
  show(nodeLabel: string, xmlPath: string): void {
    this.currentNodeLabel = nodeLabel;
    this.currentXmlPath = xmlPath;

    if (this.panel) {
      this.panel.title = this.buildTitle(nodeLabel);
      this.panel.reveal(vscode.ViewColumn.Active);
      this.refreshContent();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      SubsystemEditorViewProvider.viewType,
      this.buildTitle(nodeLabel),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.onDidReceiveMessage((message: SubsystemMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentNodeLabel = undefined;
      this.currentXmlPath = undefined;
    });

    this.refreshContent();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.currentNodeLabel = undefined;
    this.currentXmlPath = undefined;
  }

  // --- Внутренние методы ---

  private buildTitle(nodeLabel: string): string {
    return `${nodeLabel} — Подсистема`;
  }

  private refreshContent(): void {
    if (!this.panel || !this.currentXmlPath) {
      return;
    }

    try {
      const xmlPath = this.currentXmlPath;
      if (!fs.existsSync(xmlPath)) {
        this.panel.webview.html = this.htmlFactory.renderVueWebviewHtml({
          webview: this.panel.webview,
          title: 'Подсистема',
          entry: 'subsystem',
          viewKind: SubsystemEditorViewProvider.viewType,
          initialState: { error: 'XML-файл подсистемы не найден.' },
          csp: { allowStyles: true },
        });
        return;
      }

      const snapshot = this.xmlService.readSnapshot(xmlPath);
      const locked = this.isEditLocked();
      const subsystemName = this.currentNodeLabel ?? snapshot.subsystem.name;

      const initialState: SubsystemInitialState = {
        subsystemId: xmlPath,
        subsystemName,
        locked,
        properties: {
          name: snapshot.subsystem.name,
          synonym: snapshot.subsystem.synonym,
          comment: snapshot.subsystem.comment,
          includeHelpInContents: snapshot.subsystem.includeHelpInContents,
          includeInCommandInterface: snapshot.subsystem.includeInCommandInterface,
          useOneCommand: snapshot.subsystem.useOneCommand,
          explanation: snapshot.subsystem.explanation,
          pictureRef: snapshot.subsystem.pictureRef,
          pictureLoadTransparent: snapshot.subsystem.pictureLoadTransparent,
        },
        content: {
          refs: snapshot.subsystem.contentRefs,
          availableCount: countTreeLeaves(snapshot.contentTree),
          selectedCount: snapshot.subsystem.contentRefs.length,
          tree: snapshot.contentTree,
        },
        children: snapshot.subsystem.childSubsystems,
      };

      this.panel.webview.html = this.htmlFactory.renderVueWebviewHtml({
        webview: this.panel.webview,
        title: this.buildTitle(subsystemName),
        entry: 'subsystem',
        viewKind: SubsystemEditorViewProvider.viewType,
        initialState,
        csp: { allowImages: true },
      });
    } catch (error) {
      this.outputChannel.appendLine(`[SubsystemEditor] Ошибка в refreshContent: ${String(error)}`);
    }
  }

  private async handleMessage(message: SubsystemMessage): Promise<void> {
    const xmlPath = this.currentXmlPath;
    if (!xmlPath || !this.panel) {
      return;
    }

    if (this.isEditLocked() && message.command !== 'openChild') {
      void vscode.window.showWarningMessage('Редактирование подсистемы запрещено текущим состоянием поддержки или хранилища.');
      return;
    }

    await this.enqueueUpdate(async () => {
      try {
        switch (message.command) {
          case 'toggleContent': {
            const { id, included } = message.payload;
            const changed = included
              ? this.xmlService.addContentRefs(xmlPath, [id])
              : this.xmlService.removeContentRefs(xmlPath, [id]);
            if (changed) {
              this.refreshContent();
            }
            break;
          }
          case 'openChild': {
            await vscode.commands.executeCommand('v8vscedit.openSubsystemEditor', message.payload.id);
            break;
          }
          case 'propertyChanged': {
            const { key, value } = message.payload;
            const changed = this.xmlService.updateProperty(xmlPath, key as SubsystemPropertyKey, value as string | boolean);
            if (changed) {
              this.refreshContent();
            }
            break;
          }
        }
      } catch (error) {
        this.outputChannel.appendLine(`[SubsystemEditor] Ошибка при обработке сообщения '${message.command}': ${String(error)}`);
      }
    });
  }

  private isEditLocked(): boolean {
    const xmlPath = this.currentXmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return true;
    }
    if (this.supportInfoService.getSupportMode(xmlPath) === SupportMode.Locked) {
      return true;
    }
    return this.repositoryService.isEditRestricted(xmlPath);
  }

  private async enqueueUpdate(operation: () => Promise<void>): Promise<void> {
    const run = this.updateQueue.then(operation);
    this.updateQueue = run.catch(() => undefined);
    await run;
  }
}

function countTreeLeaves(nodes: readonly MetadataRefTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += node.ref ? 1 : countTreeLeaves(node.children);
  }
  return count;
}
