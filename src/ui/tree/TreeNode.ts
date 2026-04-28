import * as vscode from 'vscode';
import { AddMetadataTarget, MetaTreeNodeContext, NodeKind, TreeNodeModel, getNodeKindLabel } from './TreeNodeModel';

export { AddMetadataTarget, MetaTreeNodeContext, NodeKind, TreeNodeModel, getNodeKindLabel } from './TreeNodeModel';

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

    const baseContextValue = model.xmlPath ? `${model.nodeKind}-hasXml` : model.nodeKind;
    this.contextValue = model.hidePropertiesCommand
      ? `${baseContextValue}-propertiesHidden`
      : baseContextValue;
    if (model.addMetadataTarget) {
      this.contextValue = `${this.contextValue}-canAdd`;
    }
    if (model.canRemoveMetadata) {
      this.contextValue = `${this.contextValue}-canRemove`;
    }

    if (model.ownershipTag) {
      this.description = model.ownershipTag === 'OWN' ? '[свой]' : '[заим.]';
      // Суффикс для фильтрации команд, работающих только с объектами CF
      this.contextValue = `${this.contextValue}-fromCfe`;
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
