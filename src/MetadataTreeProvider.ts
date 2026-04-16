import * as vscode from 'vscode';
import * as path from 'path';
import { MetadataNode, NodeKind } from './MetadataNode';
import { getIconUris } from './nodes/presentation/icon';
import { COMMON_SUBGROUPS, TOP_GROUPS } from './MetadataGroups';
import { ConfigInfo, parseConfigXml } from './ConfigParser';
import { ConfigEntry } from './ConfigFinder';
import { buildNode } from './nodes/_base';
import { getNodeDescriptor } from './nodes';
import { getObjectHandler } from './handlers';

export class MetadataTreeProvider implements vscode.TreeDataProvider<MetadataNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MetadataNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: MetadataNode[] = [];

  constructor(
    private entries: ConfigEntry[],
    private readonly extensionUri: vscode.Uri
  ) {
    this.buildRoots();
  }

  /** Пересобирает корневые узлы */
  refresh(): void {
    this.buildRoots();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Обновляет список конфигураций и пересобирает дерево */
  updateEntries(entries: ConfigEntry[]): void {
    this.entries = entries;
    this.refresh();
  }

  getTreeItem(element: MetadataNode): vscode.TreeItem {
    element.iconPath = getIconUris(element.nodeKind, element.ownershipTag, this.extensionUri);
    return element;
  }

  getChildren(element?: MetadataNode): MetadataNode[] {
    if (!element) {
      if (this.roots.length === 0) {
        return [
          new MetadataNode(
            'Загрузка...',
            'group-type',
            vscode.TreeItemCollapsibleState.None,
            undefined,
            undefined,
            undefined,
            true
          ),
        ];
      }
      return this.roots;
    }
    if (element.childrenLoader) {
      return element.childrenLoader();
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Построение дерева
  // ---------------------------------------------------------------------------

  private buildRoots(): void {
    this.roots = this.entries.map((entry) => this.buildConfigNode(entry));
  }

  /** Строит корневой узел конфигурации или расширения */
  private buildConfigNode(entry: ConfigEntry): MetadataNode {
    const configXmlPath = path.join(entry.rootPath, 'Configuration.xml');
    const info = parseConfigXml(configXmlPath);

    const label =
      entry.kind === 'cf'
        ? `Конфигурация: ${info.name}${info.version ? ` v${info.version}` : ''}`
        : info.name;

    const nodeKind: NodeKind = entry.kind === 'cf' ? 'configuration' : 'extension';

    const descriptor = getNodeDescriptor(nodeKind);
    const node = buildNode(descriptor, {
      label,
      kind: nodeKind,
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      xmlPath: configXmlPath,
      childrenLoader: () => this.buildConfigChildren(entry, info),
      ownershipTag: undefined,
    });

    if (info.synonym) {
      node.tooltip = info.synonym;
    }

    return node;
  }

  /**
   * Строит полный набор корневых групп: «Общие» + остальные.
   * Группы создаются безусловно — наполнение реализуется через обработчики.
   */
  private buildConfigChildren(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    const result: MetadataNode[] = [];

    const commonDescriptor = getNodeDescriptor('group-common');
    result.push(
      buildNode(commonDescriptor, {
        label: 'Общие',
        kind: 'group-common',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        xmlPath: undefined,
        childrenLoader: () => this.buildCommonSubgroups(entry, info),
        ownershipTag: undefined,
      })
    );

    for (const group of TOP_GROUPS) {
      const descriptor = getNodeDescriptor(group.kind);
      result.push(
        buildNode(descriptor, {
          label: group.label,
          kind: group.kind,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          xmlPath: undefined,
          childrenLoader: undefined,
          ownershipTag: undefined,
        })
      );
    }

    return result;
  }

  /** Строит полный набор подгрупп внутри «Общие» */
  private buildCommonSubgroups(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    return COMMON_SUBGROUPS.map((sg) => {
      const descriptor = getNodeDescriptor(sg.kind);
      const handler = getObjectHandler(sg.types[0]);
      const names = handler ? this.collectNames(info, sg.types) : [];
      const hasChildren = handler && names.length > 0;

      return buildNode(descriptor, {
        label: sg.label,
        kind: sg.kind,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        xmlPath: undefined,
        childrenLoader: hasChildren
          ? () => handler.buildTreeNodes({
              configRoot: entry.rootPath,
              configKind: entry.kind,
              namePrefix: info.namePrefix,
              names,
            })
          : undefined,
        ownershipTag: undefined,
      });
    });
  }

  /** Собирает имена объектов по нескольким типам из ChildObjects */
  private collectNames(info: ConfigInfo, types: string[]): string[] {
    const result: string[] = [];
    for (const t of types) {
      result.push(...(info.childObjects.get(t) ?? []));
    }
    return result;
  }
}
