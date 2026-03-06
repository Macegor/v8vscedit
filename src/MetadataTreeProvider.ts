import * as vscode from 'vscode';
import * as path from 'path';
import { MetadataNode, NodeKind } from './MetadataNode';
import { getIconPath } from './IconProvider';
import { COMMON_SUBGROUPS, TOP_GROUPS, MetaGroup } from './MetadataGroups';
import { ConfigInfo, parseConfigXml, parseObjectXml } from './ConfigParser';
import { ConfigEntry } from './ConfigFinder';
import { resolveObjectXmlPath } from './ModulePathResolver';

// ---------------------------------------------------------------------------
// Группы как в конфигураторе 1С
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TreeDataProvider
// ---------------------------------------------------------------------------

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
    element.iconPath = getIconPath(element.nodeKind, element.ownershipTag, this.extensionUri);
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
    const configXmlPath = `${entry.rootPath}/Configuration.xml`.replace(/\\/g, '/');
    const info = parseConfigXml(configXmlPath.replace(/\//g, '\\'));

    const label =
      entry.kind === 'cf'
        ? `Конфигурация: ${info.name}${info.version ? ` v${info.version}` : ''}`
        : info.name;

    const nodeKind: NodeKind = entry.kind === 'cf' ? 'configuration' : 'extension';

    const node = new MetadataNode(
      label,
      nodeKind,
      vscode.TreeItemCollapsibleState.Collapsed,
      configXmlPath.replace(/\//g, '\\'),
      () => this.buildConfigChildren(entry, info),
      undefined
    );

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
      const commonNode = new MetadataNode(
        'Общие',
        'group-common',
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        () => this.buildCommonSubgroups(entry, info)
      );
      result.push(commonNode);
    }

    // Остальные группы
    for (const group of TOP_GROUPS) {
      const names = this.collectNames(info, group.types);
      if (names.length === 0) {
        continue;
      }
      const groupNode = new MetadataNode(
        group.label,
        group.kind,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        () => this.buildObjectNodes(entry, info, group.types[0] as NodeKind, names)
      );
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
        return new MetadataNode(
          sg.label,
          sg.kind,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          () => this.buildObjectNodes(entry, info, sg.kind, names)
        );
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

      const node = new MetadataNode(
        name,
        kind,
        vscode.TreeItemCollapsibleState.Collapsed,
        xmlPath,
        xmlPath ? () => this.buildChildNodes(xmlPath, objectType ?? '') : undefined,
        ownershipTag
      );

      if (kind === 'CommonModule' && xmlPath) {
        node.command = {
          command: '1cNavigator.openCommonModuleCode',
          title: 'Открыть модуль общего модуля',
          arguments: [node],
        };
      }

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
  private buildChildNodes(xmlPath: string, _objectType: string): MetadataNode[] {
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

    const tagConfig: Array<{ tag: string; label: string; kind: NodeKind }> = [
      { tag: 'Attribute', label: 'Реквизиты', kind: 'Attribute' },
      { tag: 'TabularSection', label: 'Табличные части', kind: 'TabularSection' },
      { tag: 'Form', label: 'Формы', kind: 'Form' },
      { tag: 'Command', label: 'Команды', kind: 'Command' },
      { tag: 'Template', label: 'Макеты', kind: 'Template' },
      { tag: 'Dimension', label: 'Измерения', kind: 'Dimension' },
      { tag: 'Resource', label: 'Ресурсы', kind: 'Resource' },
      { tag: 'EnumValue', label: 'Значения', kind: 'EnumValue' },
    ];

    for (const cfg of tagConfig) {
      const items = byTag.get(cfg.tag);
      if (!items || items.length === 0) {
        continue;
      }

      if (items.length === 1) {
        // Одиночный элемент — показываем без подгруппы
        result.push(this.buildLeafNode(items[0], cfg.kind, xmlPath));
      } else {
        // Несколько элементов — группируем
        const groupNode = new MetadataNode(
          cfg.label,
          'group-type',
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          () => items.map((item) => this.buildLeafNode(item, cfg.kind, xmlPath))
        );
        result.push(groupNode);
      }
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

    const node = new MetadataNode(
      child.name,
      kind,
      hasColumns
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      parentXmlPath,
      hasColumns
        ? () =>
            child.columns!.map((col) =>
              new MetadataNode(
                col.name,
                'Column',
                vscode.TreeItemCollapsibleState.None,
                parentXmlPath,
                undefined,
                undefined
              )
            )
        : undefined,
      undefined
    );

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
