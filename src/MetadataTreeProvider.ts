import * as vscode from 'vscode';
import * as path from 'path';
import { MetadataNode, NodeKind } from './MetadataNode';
import { getIconUris } from './nodes/presentation/icon';
import { COMMON_SUBGROUPS, TOP_GROUPS } from './MetadataGroups';
import { ConfigInfo, parseConfigXml, parseObjectXml } from './ConfigParser';
import { ConfigEntry } from './ConfigFinder';
import { resolveObjectXmlPath } from './ModulePathResolver';
import { buildNode } from './nodes/_base';
import { getNodeDescriptor } from './nodes';
import { CHILD_TAG_CONFIG, ChildTag } from './nodes/_types';

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
            vscode.TreeItemCollapsibleState.None
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

    if (entry.kind === 'cfe' && info.synonym) {
      node.tooltip = info.synonym;
    } else if (entry.kind === 'cf' && info.synonym) {
      node.tooltip = info.synonym;
    }

    return node;
  }

  /** Строит дочерние узлы конфигурации: группа "Общие" + остальные группы */
  private buildConfigChildren(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    const result: MetadataNode[] = [];

    // Группа "Общие"
    const commonItems = COMMON_SUBGROUPS.filter((sg) =>
      sg.types.some((t) => (info.childObjects.get(t)?.length ?? 0) > 0)
    );
    if (commonItems.length > 0) {
      const descriptor = getNodeDescriptor('group-common');
      const commonNode = buildNode(descriptor, {
        label: 'Общие',
        kind: 'group-common',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        xmlPath: undefined,
        childrenLoader: () => this.buildCommonSubgroups(entry, info),
        ownershipTag: undefined,
      });
      result.push(commonNode);
    }

    // Остальные группы
    for (const group of TOP_GROUPS) {
      const names = this.collectNames(info, group.types);
      if (names.length === 0) {
        continue;
      }
      const descriptor = getNodeDescriptor(group.kind);
      const groupNode = buildNode(descriptor, {
        label: group.label,
        kind: group.kind,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        xmlPath: undefined,
        childrenLoader: () => this.buildObjectNodes(entry, info, group.types[0] as NodeKind, names),
        ownershipTag: undefined,
      });
      result.push(groupNode);
    }

    return result;
  }

  /** Строит подгруппы внутри "Общие" */
  private buildCommonSubgroups(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    return COMMON_SUBGROUPS
      .filter((sg) => sg.types.some((t) => (info.childObjects.get(t)?.length ?? 0) > 0))
      .map((sg) => {
        const names = this.collectNames(info, sg.types);
        const descriptor = getNodeDescriptor(sg.kind);
        return buildNode(descriptor, {
          label: sg.label,
          kind: sg.kind,
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          xmlPath: undefined,
          childrenLoader: () => this.buildObjectNodes(entry, info, sg.kind, names),
          ownershipTag: undefined,
        });
      });
  }

  /** Собирает имена объектов по нескольким типам */
  private collectNames(info: ConfigInfo, types: string[]): string[] {
    const result: string[] = [];
    for (const t of types) {
      result.push(...(info.childObjects.get(t) ?? []));
    }
    return result;
  }

  /** Строит узлы для конкретных объектов */
  private buildObjectNodes(
    entry: ConfigEntry,
    info: ConfigInfo,
    kind: NodeKind,
    names: string[]
  ): MetadataNode[] {
    return names.map((name) => {
      // Определяем тип объекта по имени (ищем в childObjects)
      const objectType = this.findObjectType(info, name);

      const xmlPath = objectType
        ? resolveObjectXmlPath(entry.rootPath, objectType, name) ?? undefined
        : undefined;

      // Для расширения определяем OWN/BORROWED по наличию NamePrefix
      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (entry.kind === 'cfe' && info.namePrefix) {
        ownershipTag = name.startsWith(info.namePrefix) ? 'OWN' : 'BORROWED';
      }

      // Синоним из XML объекта (загружаем лениво)
      let cachedSynonym: string | undefined;
      const getSynonym = (): string => {
        if (cachedSynonym !== undefined) {
          return cachedSynonym;
        }
        if (xmlPath) {
          const objInfo = parseObjectXml(xmlPath);
          cachedSynonym = objInfo?.synonym ?? '';
        } else {
          cachedSynonym = '';
        }
        return cachedSynonym;
      };

      const descriptor = getNodeDescriptor(kind);
      const node = buildNode(descriptor, {
        label: name,
        kind,
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        xmlPath,
        childrenLoader: xmlPath ? () => this.buildChildNodes(xmlPath, kind) : undefined,
        ownershipTag,
      });

      // Tooltip как синоним — вычисляем лениво
      Object.defineProperty(node, 'tooltip', {
        get: getSynonym,
        enumerable: true,
        configurable: true,
      });

      return node;
    });
  }

  /** Строит дочерние узлы объекта (реквизиты, ТЧ, формы и т.д.) */
  private buildChildNodes(xmlPath: string, objectKind: NodeKind): MetadataNode[] {
    const objInfo = parseObjectXml(xmlPath);
    if (!objInfo) {
      return [];
    }

    const result: MetadataNode[] = [];

    // Группируем дочерние элементы по типу тега
    const byTag = new Map<string, typeof objInfo.children>();
    for (const child of objInfo.children) {
      if (!byTag.has(child.tag)) {
        byTag.set(child.tag, []);
      }
      byTag.get(child.tag)!.push(child);
    }

    const objectDescriptor = getNodeDescriptor(objectKind);
    const allowedTags: ChildTag[] =
      objectDescriptor?.children && objectDescriptor.children.length > 0
        ? [...objectDescriptor.children]
        : (Object.keys(CHILD_TAG_CONFIG) as ChildTag[]);
    for (const tag of allowedTags) {
      const cfg = CHILD_TAG_CONFIG[tag];
      const items = byTag.get(cfg.tag) ?? [];
      const hasItems = items.length > 0;

      const groupDescriptor = getNodeDescriptor('group-type');
      const groupNode = buildNode(groupDescriptor, {
        label: cfg.label,
        kind: 'group-type',
        collapsibleState: hasItems
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath: undefined,
        childrenLoader: hasItems
          ? () => items.map((item) => this.buildLeafNode(item, cfg.kind, xmlPath))
          : undefined,
        ownershipTag: undefined,
      });
      result.push(groupNode);
    }

    return result;
  }

  /** Создаёт листовой узел для реквизита / формы / и т.д. */
  private buildLeafNode(
    child: { tag: string; name: string; synonym: string; columns?: typeof child[] },
    kind: NodeKind,
    parentXmlPath: string
  ): MetadataNode {
    const hasColumns = kind === 'TabularSection' && child.columns && child.columns.length > 0;

    const descriptor = getNodeDescriptor(kind);
    const node = buildNode(descriptor, {
      label: child.name,
      kind,
      collapsibleState: hasColumns
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      xmlPath: parentXmlPath,
      childrenLoader: hasColumns
        ? () =>
            child.columns!.map((col) => {
              const columnDescriptor = getNodeDescriptor('Column');
              return buildNode(columnDescriptor, {
                label: col.name,
                kind: 'Column',
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                xmlPath: parentXmlPath,
                childrenLoader: undefined,
                ownershipTag: undefined,
              });
            })
        : undefined,
      ownershipTag: undefined,
    });

    if (child.synonym) {
      node.tooltip = child.synonym;
    }

    return node;
  }

  /** Ищет тип объекта (тег ChildObjects в Configuration.xml) по имени */
  private findObjectType(info: ConfigInfo, name: string): string | undefined {
    for (const [type, names] of info.childObjects) {
      if (names.includes(name)) {
        return type;
      }
    }
    return undefined;
  }
}
