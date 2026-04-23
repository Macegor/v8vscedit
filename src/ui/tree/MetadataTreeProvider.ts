import * as vscode from 'vscode';
import * as path from 'path';
import { MetadataNode, NodeKind } from './TreeNode';
import { getIconUris } from './presentation/icon';
import { COMMON_SUBGROUPS, TOP_GROUPS } from './MetadataGroups';
import { ConfigInfo, parseConfigXml } from '../../infra/xml';
import { ConfigEntry } from '../../infra/fs/ConfigLocator';
import { buildNode } from './nodes/_base';
import { getNodeDescriptor } from './nodes/index';
import { getObjectHandler } from './nodeBuilders/index';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';

export class MetadataTreeProvider implements vscode.TreeDataProvider<MetadataNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MetadataNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private roots: MetadataNode[] = [];

  constructor(
    private entries: ConfigEntry[],
    private readonly extensionUri: vscode.Uri,
    private readonly supportService?: SupportInfoService
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
    this.applySupportDecoration(element);
    return element;
  }

  /**
   * Добавляет к contextValue суффикс `-support{N}` (для inline-иконки при наведении)
   * и метку режима поддержки в description (всегда видима).
   * Вызывается только для узлов с xmlPath и только если для конфигурации
   * загружены данные поддержки.
   */
  private applySupportDecoration(element: MetadataNode): void {
    if (!element.xmlPath || !this.supportService) { return; }
    if (!this.supportService.hasConfigData(element.xmlPath)) { return; }

    const mode = this.supportService.getSupportMode(element.xmlPath);

    // Суффикс contextValue для показа inline-иконки при наведении
    const baseCtx = (element.contextValue ?? '').replace(/-support\d$/, '');
    element.contextValue = `${baseCtx}-support${mode}`;
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
    // Предзагружаем данные поддержки для каждой найденной конфигурации
    if (this.supportService) {
      for (const entry of this.entries) {
        this.supportService.loadConfig(entry.rootPath);
      }
    }
    this.roots = this.entries.map((entry) => this.buildConfigNode(entry));
  }

  /** Строит корневой узел конфигурации или расширения */
  private buildConfigNode(entry: ConfigEntry): MetadataNode {
    const configXmlPath = path.join(entry.rootPath, 'Configuration.xml');
    const info = parseConfigXml(configXmlPath);

    // Для корневого узла показываем только имя, без префикса "Конфигурация".
    const label = info.name;

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
      const mergeTypes = Boolean(group.mergeTypes && group.types.length > 1);

      let mergedChildren: MetadataNode[] | undefined;
      const handler = mergeTypes ? undefined : getObjectHandler(group.types[0]);
      const names = !mergeTypes && handler ? this.collectNames(info, group.types) : [];

      if (mergeTypes) {
        if (group.kind === 'Document') {
          // Как в конфигураторе: сначала ветка «Нумераторы», затем «Последовательности», потом документы
          mergedChildren = this.buildDocumentsBranchChildren(entry, info);
        } else {
          const parts: MetadataNode[] = [];
          for (const t of group.types) {
            const h = getObjectHandler(t);
            const typeNames = info.childObjects.get(t) ?? [];
            if (h && typeNames.length > 0) {
              parts.push(
                ...h.buildTreeNodes({
                  configRoot: entry.rootPath,
                  configKind: entry.kind,
                  namePrefix: info.namePrefix,
                  names: typeNames,
                })
              );
            }
          }
          mergedChildren = parts;
        }
      }

      const hasChildren = mergeTypes
        ? Boolean(mergedChildren && mergedChildren.length > 0)
        : Boolean(handler && names.length > 0);

      result.push(
        buildNode(descriptor, {
          label: group.label,
          kind: group.kind,
          collapsibleState: hasChildren
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
          xmlPath: undefined,
          childrenLoader: hasChildren
            ? () =>
                mergeTypes && mergedChildren
                  ? mergedChildren
                  : handler!.buildTreeNodes({
                      configRoot: entry.rootPath,
                      configKind: entry.kind,
                      namePrefix: info.namePrefix,
                      names,
                    })
            : undefined,
          ownershipTag: undefined,
        })
      );
    }

    return result;
  }

  /**
   * Дочерние узлы группы «Документы»: подветки нумераторов и последовательностей,
   * затем объекты документов (плоский merge давал неверный вид без промежуточных папок).
   */
  private buildDocumentsBranchChildren(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    const children: MetadataNode[] = [];
    const numNames = info.childObjects.get('DocumentNumerator') ?? [];
    const seqNames = info.childObjects.get('Sequence') ?? [];
    const docNames = info.childObjects.get('Document') ?? [];

    const numHandler = getObjectHandler('DocumentNumerator');
    const numDesc = getNodeDescriptor('NumeratorsBranch')!;
    const hasNum = Boolean(numHandler && numNames.length > 0);
    children.push(
      buildNode(numDesc, {
        label: 'Нумераторы',
        kind: 'NumeratorsBranch',
        collapsibleState: hasNum
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath: undefined,
        childrenLoader: hasNum
          ? () =>
              numHandler!.buildTreeNodes({
                configRoot: entry.rootPath,
                configKind: entry.kind,
                namePrefix: info.namePrefix,
                names: numNames,
              })
          : undefined,
        ownershipTag: undefined,
        hidePropertiesCommand: true,
      })
    );

    const seqHandler = getObjectHandler('Sequence');
    const seqDesc = getNodeDescriptor('SequencesBranch')!;
    const hasSeq = Boolean(seqHandler && seqNames.length > 0);
    children.push(
      buildNode(seqDesc, {
        label: 'Последовательности',
        kind: 'SequencesBranch',
        collapsibleState: hasSeq
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath: undefined,
        childrenLoader: hasSeq
          ? () =>
              seqHandler!.buildTreeNodes({
                configRoot: entry.rootPath,
                configKind: entry.kind,
                namePrefix: info.namePrefix,
                names: seqNames,
              })
          : undefined,
        ownershipTag: undefined,
        hidePropertiesCommand: true,
      })
    );

    const docHandler = getObjectHandler('Document');
    if (docHandler && docNames.length > 0) {
      children.push(
        ...docHandler.buildTreeNodes({
          configRoot: entry.rootPath,
          configKind: entry.kind,
          namePrefix: info.namePrefix,
          names: docNames,
        })
      );
    }

    return children;
  }

  /** Строит полный набор подгрупп внутри «Общие» */
  private buildCommonSubgroups(entry: ConfigEntry, info: ConfigInfo): MetadataNode[] {
    return COMMON_SUBGROUPS.map((sg) => {
      const descriptor = getNodeDescriptor(sg.kind);
      const handler = getObjectHandler(sg.types[0]);
      const names = handler ? this.collectNames(info, sg.types) : [];
      const hasChildren = Boolean(handler && names.length > 0);

      return buildNode(descriptor, {
        label: sg.label,
        kind: sg.kind,
        collapsibleState: hasChildren
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath: undefined,
        childrenLoader: hasChildren
          ? () =>
              handler!.buildTreeNodes({
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

