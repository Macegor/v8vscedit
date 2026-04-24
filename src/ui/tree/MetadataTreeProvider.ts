import * as path from 'path';
import * as vscode from 'vscode';
import { getMetaTypesByGroup } from '../../domain/MetaTypes';
import { ConfigEntry } from '../../infra/fs/ConfigLocator';
import { ConfigInfo, parseConfigXml } from '../../infra/xml';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import { getObjectHandler } from './nodeBuilders/index';
import { buildNode } from './nodes/_base';
import { getNodeDescriptor } from './nodes/index';
import { getIconUris } from './presentation/icon';
import { MetadataNode, NodeKind } from './TreeNode';

interface RootGroupDef {
  label: string;
  kind: NodeKind;
  types: NodeKind[];
  mergeTypes?: boolean;
}

export class MetadataTreeProvider implements vscode.TreeDataProvider<MetadataNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MetadataNode | undefined | null>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private roots: MetadataNode[] = [];

  constructor(
    private entries: ConfigEntry[],
    private readonly extensionUri: vscode.Uri,
    private readonly supportService?: SupportInfoService
  ) {
    this.buildRoots();
  }

  /** Перестраивает корневые узлы дерева */
  refresh(): void {
    this.buildRoots();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /** Обновляет найденные конфигурации и перестраивает дерево */
  updateEntries(entries: ConfigEntry[]): void {
    this.entries = entries;
    this.refresh();
  }

  /** Возвращает найденные корни конфигураций для команд уровня рабочей области. */
  getEntries(): ConfigEntry[] {
    return [...this.entries];
  }

  getTreeItem(element: MetadataNode): vscode.TreeItem {
    element.iconPath = getIconUris(element.nodeKind, element.ownershipTag, this.extensionUri);
    this.applySupportDecoration(element);
    return element;
  }

  getChildren(element?: MetadataNode): MetadataNode[] {
    if (!element) {
      if (this.roots.length === 0) {
        return [
          new MetadataNode({
            label: 'Загрузка...',
            nodeKind: 'group-type',
            hidePropertiesCommand: true,
          }, vscode.TreeItemCollapsibleState.None),
        ];
      }
      return this.roots;
    }

    return element.childrenLoader ? element.childrenLoader() : [];
  }

  /**
   * Добавляет к `contextValue` суффикс режима поддержки для inline-индикаторов.
   */
  private applySupportDecoration(element: MetadataNode): void {
    if (!element.xmlPath || !this.supportService) {
      return;
    }
    if (!this.supportService.hasConfigData(element.xmlPath)) {
      return;
    }

    const mode = this.supportService.getSupportMode(element.xmlPath);
    const baseContextValue = (element.contextValue ?? '').replace(/-support\d$/, '');
    element.contextValue = `${baseContextValue}-support${mode}`;
  }

  private buildRoots(): void {
    if (this.supportService) {
      for (const entry of this.entries) {
        this.supportService.loadConfig(entry.rootPath);
      }
    }

    this.roots = this.entries.map((entry) => this.buildConfigNode(entry));
  }

  private buildConfigNode(entry: ConfigEntry): MetadataNode {
    const configXmlPath = path.join(entry.rootPath, 'Configuration.xml');
    const info = parseConfigXml(configXmlPath);
    const nodeKind: NodeKind = entry.kind === 'cf' ? 'configuration' : 'extension';
    const descriptor = getNodeDescriptor(nodeKind);

    const node = buildNode(descriptor, {
      label: info.name,
      kind: nodeKind,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      xmlPath: configXmlPath,
      childrenLoader: () => this.buildConfigChildren(entry, info),
    });

    if (info.synonym) {
      node.tooltip = info.synonym;
    }

    return node;
  }

  private buildConfigChildren(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    const result: MetadataNode[] = [
      buildNode(getNodeDescriptor('group-common'), {
        label: 'Общие',
        kind: 'group-common',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        childrenLoader: () => this.buildCommonSubgroups(entry, info),
      }),
    ];

    for (const group of this.getTopGroups()) {
      const descriptor = getNodeDescriptor(group.kind);
      const mergeTypes = Boolean(group.mergeTypes && group.types.length > 1);
      const handler = mergeTypes ? undefined : getObjectHandler(group.types[0]);
      const names = !mergeTypes && handler ? this.collectNames(info, group.types) : [];

      let mergedChildren: MetadataNode[] | undefined;
      if (mergeTypes) {
        mergedChildren = group.kind === 'Document'
          ? this.buildDocumentsBranchChildren(entry, info)
          : this.buildMergedTypeChildren(entry, info, group.types);
      }

      const hasChildren = mergeTypes
        ? Boolean(mergedChildren?.length)
        : Boolean(handler && names.length > 0);

      result.push(
        buildNode(descriptor, {
          label: group.label,
          kind: group.kind,
          collapsibleState: hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          childrenLoader: hasChildren
            ? () => mergeTypes
              ? (mergedChildren ?? [])
              : handler!.buildTreeNodes({
                  configRoot: entry.rootPath,
                  configKind: entry.kind,
                  namePrefix: info.namePrefix,
                  names,
                })
            : undefined,
        })
      );
    }

    return result;
  }

  private buildDocumentsBranchChildren(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    const children: MetadataNode[] = [];

    const numeratorNames = info.childObjects.get('DocumentNumerator') ?? [];
    const numeratorHandler = getObjectHandler('DocumentNumerator');
    const hasNumerators = Boolean(numeratorHandler && numeratorNames.length > 0);
    children.push(
      buildNode(getNodeDescriptor('NumeratorsBranch'), {
        label: 'Нумераторы',
        kind: 'NumeratorsBranch',
        collapsibleState: hasNumerators
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        childrenLoader: hasNumerators
          ? () => numeratorHandler!.buildTreeNodes({
              configRoot: entry.rootPath,
              configKind: entry.kind,
              namePrefix: info.namePrefix,
              names: numeratorNames,
            })
          : undefined,
        hidePropertiesCommand: true,
      })
    );

    const sequenceNames = info.childObjects.get('Sequence') ?? [];
    const sequenceHandler = getObjectHandler('Sequence');
    const hasSequences = Boolean(sequenceHandler && sequenceNames.length > 0);
    children.push(
      buildNode(getNodeDescriptor('SequencesBranch'), {
        label: 'Последовательности',
        kind: 'SequencesBranch',
        collapsibleState: hasSequences
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        childrenLoader: hasSequences
          ? () => sequenceHandler!.buildTreeNodes({
              configRoot: entry.rootPath,
              configKind: entry.kind,
              namePrefix: info.namePrefix,
              names: sequenceNames,
            })
          : undefined,
        hidePropertiesCommand: true,
      })
    );

    const documentHandler = getObjectHandler('Document');
    const documentNames = info.childObjects.get('Document') ?? [];
    if (documentHandler && documentNames.length > 0) {
      children.push(
        ...documentHandler.buildTreeNodes({
          configRoot: entry.rootPath,
          configKind: entry.kind,
          namePrefix: info.namePrefix,
          names: documentNames,
        })
      );
    }

    return children;
  }

  private buildCommonSubgroups(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    return this.getCommonSubgroups().map((group) => {
      const handler = getObjectHandler(group.types[0]);
      const names = handler ? this.collectNames(info, group.types) : [];
      const hasChildren = Boolean(handler && names.length > 0);

      return buildNode(getNodeDescriptor(group.kind), {
        label: group.label,
        kind: group.kind,
        collapsibleState: hasChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        childrenLoader: hasChildren
          ? () => handler!.buildTreeNodes({
              configRoot: entry.rootPath,
              configKind: entry.kind,
              namePrefix: info.namePrefix,
              names,
            })
          : undefined,
      });
    });
  }

  private buildMergedTypeChildren(entry: ConfigEntry, info: ConfigInfo, types: NodeKind[]): MetadataNode[] {
    const result: MetadataNode[] = [];

    for (const type of types) {
      const handler = getObjectHandler(type);
      const names = info.childObjects.get(type) ?? [];
      if (!handler || names.length === 0) {
        continue;
      }

      result.push(
        ...handler.buildTreeNodes({
          configRoot: entry.rootPath,
          configKind: entry.kind,
          namePrefix: info.namePrefix,
          names,
        })
      );
    }

    return result;
  }

  private collectNames(info: ConfigInfo, types: string[]): string[] {
    const result: string[] = [];
    for (const type of types) {
      result.push(...(info.childObjects.get(type) ?? []));
    }
    return result;
  }

  private getTopGroups(): RootGroupDef[] {
    const result: RootGroupDef[] = [];

    for (const def of getMetaTypesByGroup('top')) {
      if (def.kind === 'DocumentNumerator' || def.kind === 'Sequence') {
        continue;
      }

      if (def.kind === 'Document') {
        result.push({
          label: def.pluralLabel,
          kind: def.kind,
          types: ['DocumentNumerator', 'Sequence', 'Document'],
          mergeTypes: true,
        });
        continue;
      }

      result.push({
        label: def.pluralLabel,
        kind: def.kind,
        types: [def.kind],
      });
    }

    return result;
  }

  private getCommonSubgroups(): RootGroupDef[] {
    return getMetaTypesByGroup('common').map((def) => ({
      label: def.pluralLabel,
      kind: def.kind,
      types: [def.kind],
    }));
  }
}
