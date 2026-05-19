import * as vscode from 'vscode';
import type { MetaTreeNodeContext, NodeKind, TreeNodeModel } from './TreeNodeModel';

export { getNodeKindLabel } from './TreeNodeModel';
export type { AddMetadataTarget, MetaTreeNodeContext, NodeKind, TreeNodeModel } from './TreeNodeModel';

/**
 * Тонкая vscode-обёртка над `TreeNodeModel`.
 * Вся предметная информация живёт в `model`, а класс отвечает только за
 * интеграцию с `TreeItem`.
 */
export class MetadataNode extends vscode.TreeItem {
  constructor(
    public readonly model: TreeNodeModel,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(model.label, collapsibleState);
    this.applyModelPresentation();
  }

  refreshFromModel(collapsibleState?: vscode.TreeItemCollapsibleState): void {
    this.label = this.model.label;
    if (collapsibleState !== undefined) {
      this.collapsibleState = collapsibleState;
    }
    this.applyModelPresentation();
  }

  private applyModelPresentation(): void {
    const baseContextValue = this.model.xmlPath ? `${this.model.nodeKind}-hasXml` : this.model.nodeKind;
    this.contextValue = this.model.hidePropertiesCommand
      ? `${baseContextValue}-propertiesHidden`
      : baseContextValue;
    if (this.model.addMetadataTarget) {
      this.contextValue = `${this.contextValue}-canAdd`;
    }
    if (this.model.canRemoveMetadata) {
      this.contextValue = `${this.contextValue}-canRemove`;
    }

    if (this.model.ownershipTag) {
      this.description = this.model.ownershipTag === 'OWN' ? '[свой]' : '[заим.]';
      // Суффикс для фильтрации команд, работающих только с объектами CF
      this.contextValue = `${this.contextValue}-fromCfe`;
    } else {
      this.description = undefined;
    }
  }

  get textLabel(): string {
    return this.model.label;
  }

  get nodeKind(): NodeKind {
    return this.model.nodeKind;
  }

  get xmlPath(): string | undefined {
    return this.model.xmlPath;
  }

  get childrenLoader(): (() => MetadataNode[]) | undefined {
    return this.model.childrenLoader;
  }

  get ownershipTag(): 'OWN' | 'BORROWED' | undefined {
    return this.model.ownershipTag;
  }

  get hidePropertiesCommand(): boolean | undefined {
    return this.model.hidePropertiesCommand;
  }

  get metaContext(): MetaTreeNodeContext | undefined {
    return this.model.metaContext;
  }

  get addMetadataTarget() {
    return this.model.addMetadataTarget;
  }

  get canRemoveMetadata() {
    return this.model.canRemoveMetadata;
  }

  replaceChildren(children: MetadataNode[], collapsibleState: vscode.TreeItemCollapsibleState): void {
    this.model.childrenLoader = children.length > 0 ? () => children : undefined;
    this.collapsibleState = collapsibleState;
  }
}
