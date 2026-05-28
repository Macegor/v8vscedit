import * as vscode from 'vscode';
import * as fs from 'fs';
import type {
  MetadataRefTreeNode,
  SubsystemXmlService,
} from '../../../infra/xml/SubsystemXmlService';
import { type SupportInfoService, SupportMode } from '../../../infra/support/SupportInfoService';
import type { RepositoryService } from '../../../infra/repository/RepositoryService';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';
import type { IconDto } from '../universal/_types';
import { getIconUris } from '../../tree/presentation/icon';
import type { NodeKind } from '../../tree/TreeNode';

/** Сообщения от Vue-приложения редактора подсистем. */
type SubsystemMessage =
  | { readonly type: 'command'; readonly command: 'addContent'; readonly payload: { readonly ref: string } }
  | { readonly type: 'command'; readonly command: 'removeContent'; readonly payload: { readonly ref: string } };

interface TreeNodeActionDto {
  readonly id: string;
  readonly label: string;
  readonly command: string;
}

interface TreeNodeDto {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly icon?: IconDto;
  readonly kind?: string;
  readonly hasChildren: boolean;
  readonly loaded: boolean;
  readonly children?: TreeNodeDto[];
  readonly actions: TreeNodeActionDto[];
  readonly ref?: string;
}

/** Состояние для Vue-приложения (зеркалит SubsystemState из src-ui/apps/subsystem/main.ts). */
interface SubsystemInitialState {
  readonly initialized: boolean;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly locked: boolean;
  readonly availableTree: readonly TreeNodeDto[];
  readonly contentTree: readonly TreeNodeDto[];
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
    private readonly outputChannel: vscode.OutputChannel,
    private readonly afterMutation: (changedFiles: readonly string[]) => void
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
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui'),
          vscode.Uri.joinPath(this.extensionUri, 'src', 'icons'),
        ],
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

  /** Перечитывает деревья состава после внешнего удаления метаданных. */
  handleMetadataRemoved(): void {
    if (!this.panel) {
      return;
    }
    if (!this.currentXmlPath || !fs.existsSync(this.currentXmlPath)) {
      this.dispose();
      return;
    }
    this.postState();
  }

  // --- Внутренние методы ---

  private buildTitle(nodeLabel: string): string {
    return `${nodeLabel} — Подсистема`;
  }

  /** Строит состояние для Vue-приложения в формате SubsystemState. */
  private buildState(): SubsystemInitialState | { error: string } {
    const xmlPath = this.currentXmlPath;
    if (!xmlPath || !fs.existsSync(xmlPath)) {
      return { error: 'XML-файл подсистемы не найден.' };
    }

    const snapshot = this.xmlService.readSnapshot(xmlPath);
    const locked = this.isEditLocked();
    const subsystemName = this.currentNodeLabel ?? snapshot.subsystem.name;
    const includedRefs = new Set(snapshot.subsystem.contentRefs);

    return {
      initialized: true,
      subsystemId: xmlPath,
      subsystemName,
      locked,
      availableTree: this.toTreeDtos(snapshot.contentTree, includedRefs, true),
      contentTree: this.toTreeDtos(this.filterContentTree(snapshot.contentTree, includedRefs), includedRefs, false),
    };
  }

  private filterContentTree(nodes: readonly MetadataRefTreeNode[], includedRefs: ReadonlySet<string>): MetadataRefTreeNode[] {
    const result: MetadataRefTreeNode[] = [];
    for (const node of nodes) {
      const children = this.filterContentTree(node.children, includedRefs);
      if ((node.ref && includedRefs.has(node.ref)) || children.length > 0) {
        result.push({ ...node, children });
      }
    }
    return result;
  }

  private toTreeDtos(
    nodes: readonly MetadataRefTreeNode[],
    includedRefs: ReadonlySet<string>,
    markIncluded: boolean
  ): TreeNodeDto[] {
    return nodes.map((node) => this.toTreeDto(node, includedRefs, markIncluded));
  }

  private toTreeDto(
    node: MetadataRefTreeNode,
    includedRefs: ReadonlySet<string>,
    markIncluded: boolean
  ): TreeNodeDto {
    const hasChildren = node.children.length > 0;
    return {
      id: node.id,
      key: node.id,
      label: node.label,
      description: markIncluded && node.ref && includedRefs.has(node.ref) ? 'в составе' : undefined,
      tooltip: node.ref,
      icon: this.buildIcon(node.kind),
      kind: node.kind,
      hasChildren,
      loaded: true,
      children: hasChildren ? this.toTreeDtos(node.children, includedRefs, markIncluded) : undefined,
      actions: [],
      ref: node.ref,
    };
  }

  private buildIcon(kind: NodeKind | undefined): IconDto {
    if (!kind) {
      return { kind: 'none' };
    }
    try {
      const iconUris = getIconUris(kind, undefined, this.extensionUri);
      const lightUri = this.panel?.webview.asWebviewUri(iconUris.light).toString();
      const darkUri = this.panel?.webview.asWebviewUri(iconUris.dark).toString();
      if (!lightUri || !darkUri) {
        return { kind: 'none' };
      }
      return { kind: 'asset', lightUri, darkUri };
    } catch {
      return { kind: 'none' };
    }
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

  /** Обновляет состояние без перерисовки HTML, чтобы не сбрасывать раскрытие деревьев. */
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

    if (this.isEditLocked()) {
      void vscode.window.showWarningMessage('Редактирование подсистемы запрещено текущим состоянием поддержки или хранилища.');
      return;
    }

    await this.enqueueUpdate(() => {
      try {
        switch (message.command) {
          case 'addContent': {
            const result = this.xmlService.editContentRefs(xmlPath, { add: [message.payload.ref] });
            if (result.changed) {
              this.afterMutation(result.changedFiles);
              this.postState();
            }
            break;
          }
          case 'removeContent': {
            const result = this.xmlService.editContentRefs(xmlPath, { remove: [message.payload.ref] });
            if (result.changed) {
              this.afterMutation(result.changedFiles);
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

  private async enqueueUpdate(operation: () => void | Promise<void>): Promise<void> {
    const run = this.updateQueue.then(operation);
    this.updateQueue = run.catch(() => undefined);
    await run;
  }
}
