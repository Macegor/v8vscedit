import * as vscode from 'vscode';
import * as fs from 'fs';
import type {
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

interface SubsystemContentItemDto {
  readonly id: string;
  readonly label: string;
  readonly included: boolean;
  readonly kind?: string;
}

interface SubsystemChildDto {
  readonly id: string;
  readonly name: string;
  readonly label: string;
}

/** Состояние для Vue-приложения (зеркалит SubsystemState из src-ui/apps/subsystem/main.ts). */
interface SubsystemInitialState {
  readonly initialized: boolean;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly locked: boolean;
  readonly properties: Record<string, unknown>;
  readonly content: readonly SubsystemContentItemDto[];
  readonly children: readonly SubsystemChildDto[];
  readonly activeTab: 'properties' | 'content' | 'children' | 'commandInterface';
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
      this.renderHtml();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      SubsystemEditorViewProvider.viewType,
      this.buildTitle(nodeLabel),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui')],
      }
    );

    this.panel.webview.onDidReceiveMessage((message: SubsystemMessage) => {
      void this.handleMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentNodeLabel = undefined;
      this.currentXmlPath = undefined;
    });

    this.renderHtml();
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

  /** Строит состояние для Vue-приложения в формате SubsystemState. */
  private buildState(activeTab: SubsystemInitialState['activeTab'] = 'properties'): SubsystemInitialState | { error: string } {
    const xmlPath = this.currentXmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return { error: 'XML-файл подсистемы не найден.' };
    }

    const snapshot = this.xmlService.readSnapshot(xmlPath);
    const locked = this.isEditLocked();
    const subsystemName = this.currentNodeLabel ?? snapshot.subsystem.name;
    const includedRefs = new Set(snapshot.subsystem.contentRefs);

    const content: SubsystemContentItemDto[] = [];
    for (const group of snapshot.availableGroups) {
      for (const item of group.items) {
        content.push({
          id: item.ref,
          label: item.label,
          included: includedRefs.has(item.ref),
          kind: group.label,
        });
      }
    }

    const children: SubsystemChildDto[] = snapshot.subsystem.childSubsystems.map((name) => ({
      id: name,
      name,
      label: name,
    }));

    return {
      initialized: true,
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
      content,
      children,
      activeTab,
    };
  }

  /** Полная перерисовка HTML (при первом показе или смене подсистемы). */
  private renderHtml(): void {
    if (!this.panel) {
      return;
    }
    try {
      const state = this.buildState();
      const title = 'error' in state ? 'Подсистема' : this.buildTitle(state.subsystemName);
      this.panel.webview.html = this.htmlFactory.renderVueWebviewHtml({
        webview: this.panel.webview,
        title,
        entry: 'subsystem',
        viewKind: 'subsystem',
        initialState: state,
        csp: { allowStyles: true, allowImages: true },
      });
    } catch (error) {
      this.outputChannel.appendLine(`[SubsystemEditor] Ошибка в renderHtml: ${String(error)}`);
    }
  }

  /** Обновляет состояние без перерисовки HTML — сохраняет активную вкладку. */
  private postState(): void {
    if (!this.panel) {
      return;
    }
    try {
      const state = this.buildState();
      if ('error' in state) {
        return;
      }
      void this.panel.webview.postMessage({ type: 'state', state });
    } catch (error) {
      this.outputChannel.appendLine(`[SubsystemEditor] Ошибка в postState: ${String(error)}`);
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
              this.postState();
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
              this.postState();
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
