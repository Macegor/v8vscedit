import * as path from 'path';
import * as vscode from 'vscode';
import type { ConfigEntry } from '../../../domain/Configuration';
import { META_TYPES, type MetaKind } from '../../../domain/MetaTypes';
import {
  aggregateMetadataChanges,
  type ChangesModel,
  type ObjectChangeGroup,
} from '../../../infra/git/MetadataChangeAggregator';
import { readPorcelainEntries } from '../../../infra/git/GitStatusReader';
import { commit, discard, stage, unstage, type DiscardEntry } from '../../../infra/git/GitWriteService';
import { buildOnecGitUri } from '../../git/OnecGitContentProvider';
import { getIconUris } from '../../tree/presentation/icon';
import type { MetadataTreeProvider } from '../../tree/MetadataTreeProvider';
import type { MetadataNode, NodeKind } from '../../tree/TreeNode';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';
import { resolveWebviewLocalResourceRoots } from '../webview/webviewResourceRoots';
import {
  buildObjectNode,
  buildOtherSection,
  resolveChangeAddress,
  SECTION_LABELS,
  type ChangeAddress,
  type ChangesSectionDto,
  type ChangesViewState,
  type IconDto,
} from './changesDtoBuilder';
import {
  assembleNavigatorSection,
  type ChangeChain,
  type NavAncestorDto,
} from './changesTreeAssembler';

/** Внешние зависимости провайдера: корень git, корни выгрузки и навигаторное дерево. */
export interface MetadataChangesViewServices {
  readonly gitRoot: string;
  readonly getConfigRoots: () => readonly ConfigEntry[];
  /** Источник навигаторной иерархии, которую повторяет дерево панели изменений. */
  readonly treeProvider: MetadataTreeProvider;
}

/** Сообщение ui → host: команда над узлом либо коммит/refresh. */
interface ChangesCommandMessage {
  readonly type: string;
  readonly command: string;
  readonly payload?: { readonly nodeId?: string; readonly message?: string };
}

const DISCARD_CONFIRM_LABEL = 'Отменить изменения';

/**
 * Webview-презентация представления «Изменения метаданных». Переиспользует
 * Vue-дерево универсальной панели: состояние строит {@link buildChangesState},
 * узлы рисует общий компонент дерева. Движок ВЕХИ 1 (`infra/git/*`,
 * `OnecGitContentProvider`) не меняется — провайдер лишь оборачивает его в
 * протокол webview.
 *
 * Модель `git status` вычисляется ЛЕНИВО (первый `resolveWebviewView`) и далее
 * пересчитывается ТОЛЬКО после мутаций и по явной команде `refresh` (запрет №11).
 */
export class MetadataChangesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'v8vsceditChanges';

  private view: vscode.WebviewView | undefined;
  private readonly htmlFactory: WebviewHtmlFactory;
  private model: ChangesModel | undefined;
  private commitMessage = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly services: MetadataChangesViewServices,
  ) {
    this.htmlFactory = new WebviewHtmlFactory(extensionUri);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: resolveWebviewLocalResourceRoots(this.extensionUri, { includeIcons: true }),
    };

    this.model = this.computeModel();
    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: ChangesCommandMessage) => {
      void this.handleMessage(message);
    });
    this.postState();
  }

  /** Пересчитывает `git status` и пере-постит состояние (внешнее обновление/watcher). */
  refresh(): void {
    this.model = this.computeModel();
    this.postState();
  }

  /** Смена состава корней выгрузки — пересчёт с новой моделью. */
  updateConfigRoots(): void {
    this.refresh();
  }

  private computeModel(): ChangesModel {
    return aggregateMetadataChanges(
      readPorcelainEntries(this.services.gitRoot),
      this.services.gitRoot,
      this.services.getConfigRoots(),
    );
  }

  private buildState(): ChangesViewState {
    // Недостижимо: buildState вызывается только из buildHtml/postState, а оба
    // пути (resolveWebviewView, refresh) синхронно присваивают this.model ДО
    // вызова buildState — правая часть `??` здесь чисто защитный резерв.
    /* c8 ignore next */
    const model = this.model ?? (this.model = this.computeModel());
    return {
      staged: this.buildNavigatorSection('staged', model.staged),
      unstaged: this.buildNavigatorSection('unstaged', model.unstaged),
      unresolved: buildOtherSection(model.unresolved),
      canCommit: model.staged.length > 0,
      commitMessage: this.commitMessage,
    };
  }

  /**
   * Собирает секцию, повторяющую навигаторную иерархию основного дерева:
   * для каждой объектной группы строит цепочку предков (реальную из дерева либо
   * синтезированную для удалённого объекта) + лист, затем сворачивает общие
   * ветви через {@link assembleNavigatorSection}. Порядок id листьев — из индекса
   * в модели (не из позиции в лесу), чтобы `resolveChangeAddress` попал в объект.
   */
  private buildNavigatorSection(
    side: 'staged' | 'unstaged',
    groups: readonly ObjectChangeGroup[],
  ): ChangesSectionDto {
    const chains = groups.map((group, index) => this.buildChain(side, group, index));
    return assembleNavigatorSection(side, chains, SECTION_LABELS[side]);
  }

  private buildChain(side: 'staged' | 'unstaged', group: ObjectChangeGroup, index: number): ChangeChain {
    const leaf = buildObjectNode(side, group, index, (kind) => this.buildIcon(kind));
    return { ancestors: this.resolveAncestors(group), leaf };
  }

  /**
   * Цепочка предков объекта: если объект есть в навигаторном дереве — поднимаемся
   * по нему `getParent` до корня конфигурации; если объект удалён и в кэше его
   * нет — синтезируем цепочку из `META_TYPES`.
   */
  private resolveAncestors(group: ObjectChangeGroup): NavAncestorDto[] {
    const objectNode = this.findNavigatorNode(group);
    return objectNode ? this.ancestorsFromTree(objectNode) : this.synthesizeAncestors(group);
  }

  private findNavigatorNode(group: ObjectChangeGroup): MetadataNode | undefined {
    return this.services.treeProvider.findNode(
      (node) =>
        node.nodeKind === group.rootKind &&
        node.textLabel === group.rootName &&
        Boolean(node.xmlPath) &&
        !node.metaContext,
      group.configRoot,
    );
  }

  private ancestorsFromTree(objectNode: MetadataNode): NavAncestorDto[] {
    const chain: MetadataNode[] = [];
    // getParent в нашей реализации синхронен (WeakMap), тип ProviderResult шире —
    // берём только синхронный узел, поднимаясь до корня конфигурации (исключая его).
    let current = this.services.treeProvider.getParent(objectNode) as MetadataNode | undefined;
    while (current && !this.isRootNode(current)) {
      chain.push(current);
      current = this.services.treeProvider.getParent(current) as MetadataNode | undefined;
    }
    chain.reverse();

    const ancestors: NavAncestorDto[] = [];
    let parentKey = '';
    for (const node of chain) {
      const key = this.buildNodeKey(node, parentKey);
      ancestors.push({ key, label: node.textLabel, icon: this.buildAssetIcon(node.nodeKind, node.ownershipTag) });
      parentKey = key;
    }
    return ancestors;
  }

  private synthesizeAncestors(group: ObjectChangeGroup): NavAncestorDto[] {
    const def = META_TYPES[group.rootKind];
    const collection: NavAncestorDto = {
      key: `syn~${group.rootKind}`,
      label: def.pluralLabel,
      icon: this.buildAssetIcon(group.rootKind),
    };
    if (def.group === 'common') {
      return [
        {
          key: 'syn~group-common',
          label: META_TYPES['group-common'].pluralLabel,
          icon: this.buildAssetIcon('group-common'),
        },
        collection,
      ];
    }
    return [collection];
  }

  private isRootNode(node: MetadataNode): boolean {
    return node.nodeKind === 'configuration' || node.nodeKind === 'extension' || node.nodeKind === 'extensions-root';
  }

  /**
   * Ключ дедупа предка — по образцу `UniversalPanelViewProvider.buildNodeKey`.
   *
   * Три fallback-ветки ниже (`?? ''`) недостижимы именно в ЭТОМ вызывающем
   * контексте (не в самой функции вообще — она копирует общий паттерн ради
   * единообразия с `UniversalPanelViewProvider`):
   * `buildNodeKey` вызывается только из {@link ancestorsFromTree} для узлов
   * СТРОГО НАД объектом (группы-коллекции/«Общие»/вложенные подсистемы), а не
   * для самого объекта или его дочерних элементов. Такие узлы-предки всегда
   * получают `decorationPath` из реального пути ФС (`entry.rootPath` для
   * «Общие», `buildRootGroupDecorationPath` с непустой `folder` для
   * top/common-коллекций, `resolveObjectDecorationPath` для вложенных
   * подсистем — см. `infra/cache/MetadataCache.ts`); единственный тип без
   * `folder` (`PaletteColor`) не строит собственных узлов-объектов
   * (`buildObjectNodes` там жёстко возвращает `[]`), поэтому такой узел
   * никогда не попадёт в `findNavigatorNode`/цепочку предков. По той же
   * причине `metaContext` (`ctx`) у узлов-предков всегда `undefined` — он
   * заполняется ТОЛЬКО у дочерних элементов владеющего объекта (реквизиты,
   * колонки ТЧ, URL-шаблоны — `buildLeavesForTag`/`buildTabularSectionNode`/
   * `buildUrlTemplateNode`), которые в цепочку предков объекта попасть не
   * могут. Эмпирически подтверждено логированием реальных вызовов на всём
   * тестовом наборе перед добавлением этих комментариев.
   */
  private buildNodeKey(node: MetadataNode, parentKey: string): string {
    const ctx = node.metaContext;
    const segment = [
      node.nodeKind,
      node.textLabel,
      node.xmlPath ?? '',
      /* c8 ignore next */
      node.model.decorationPath ?? '',
      /* c8 ignore next */
      ctx?.ownerObjectXmlPath ?? '',
      /* c8 ignore next */
      ctx?.tabularSectionName ?? '',
      node.ownershipTag ?? '',
    ].map((part) => encodeURIComponent(part)).join('~');
    return parentKey ? `${parentKey}/${segment}` : segment;
  }

  private buildHtml(webview: vscode.Webview): string {
    return this.htmlFactory.renderVueWebviewHtml({
      webview,
      title: 'Изменения метаданных',
      entry: 'changes',
      viewKind: 'changes',
      initialState: this.buildState(),
      csp: { allowStyles: true, allowImages: true },
    });
  }

  private postState(): void {
    const state = this.buildState();
    this.updateBadge();
    void this.view?.webview.postMessage({ type: 'state', state });
  }

  /**
   * Счётчик изменений на иконке контейнера панели — как у штатного SCM.
   * Считает уникальные изменённые файлы (части объектов + «Прочие»); при
   * отсутствии изменений бейдж снимается (`undefined`).
   */
  private updateBadge(): void {
    if (!this.view) {
      return;
    }
    // this.model установлен buildState() перед updateBadge (единственный вызывающий —
    // postState), поэтому правая часть `??` — недостижимый защитный резерв.
    /* c8 ignore next */
    const model = this.model ?? this.computeModel();
    const count = countChangedFiles(model);
    this.view.badge = count > 0
      ? { value: count, tooltip: `Изменений метаданных: ${String(count)}` }
      : undefined;
  }

  /**
   * Иконка объекта — тот же источник, что у навигатора: `getIconUris` по
   * `META_TYPES`, доведённая до webview-URI (идентична `UniversalPanelViewProvider`).
   */
  private buildIcon(kind: MetaKind): IconDto {
    return this.buildAssetIcon(kind);
  }

  /**
   * Иконка узла (объекта или предка) как asset-URI webview — с учётом
   * заимствования CFE, тем же путём, что навигатор (`getIconUris` + `asWebviewUri`).
   */
  private buildAssetIcon(kind: NodeKind, ownership?: 'OWN' | 'BORROWED'): IconDto {
    try {
      const uris = getIconUris(kind, ownership, this.extensionUri);
      const lightUri = this.view?.webview.asWebviewUri(uris.light).toString();
      const darkUri = this.view?.webview.asWebviewUri(uris.dark).toString();
      if (!lightUri || !darkUri) {
        return { kind: 'none' };
      }
      return { kind: 'asset', lightUri, darkUri };
    } catch {
      return { kind: 'none' };
    }
  }

  private async handleMessage(message: ChangesCommandMessage): Promise<void> {
    if (message.type !== 'command') {
      return;
    }
    switch (message.command) {
      case 'stage':
        this.applyStage(message.payload?.nodeId);
        return;
      case 'unstage':
        this.applyUnstage(message.payload?.nodeId);
        return;
      case 'discard':
        await this.applyDiscard(message.payload?.nodeId);
        return;
      case 'commit':
        this.applyCommit(message.payload?.message);
        return;
      case 'openDiff':
        await this.openDiff(message.payload?.nodeId);
        return;
      case 'refresh':
        this.refresh();
        return;
      default:
        return;
    }
  }

  private applyStage(nodeId: string | undefined): void {
    const address = this.addressOf(nodeId);
    if (!address) {
      return;
    }
    stage(this.services.gitRoot, this.absFiles(address));
    this.refresh();
  }

  private applyUnstage(nodeId: string | undefined): void {
    const address = this.addressOf(nodeId);
    if (!address) {
      return;
    }
    unstage(this.services.gitRoot, this.absFiles(address));
    this.refresh();
  }

  private async applyDiscard(nodeId: string | undefined): Promise<void> {
    const address = this.addressOf(nodeId);
    if (!address || address.discards.length === 0) {
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Отменить локальные изменения (файлов: ${String(address.discards.length)})? Действие необратимо.`,
      { modal: true },
      DISCARD_CONFIRM_LABEL,
    );
    if (confirmed !== DISCARD_CONFIRM_LABEL) {
      return;
    }
    const entries: DiscardEntry[] = address.discards.map((entry) => ({
      absPath: path.resolve(this.services.gitRoot, entry.relPath),
      status: entry.status,
    }));
    discard(this.services.gitRoot, entries);
    this.refresh();
  }

  private applyCommit(message: string | undefined): void {
    const text = (message ?? '').trim();
    if (text.length === 0) {
      return;
    }
    commit(this.services.gitRoot, text);
    this.commitMessage = '';
    this.refresh();
  }

  private async openDiff(nodeId: string | undefined): Promise<void> {
    const address = this.addressOf(nodeId);
    if (!address?.single) {
      return;
    }
    const absFilePath = path.resolve(this.services.gitRoot, address.relFiles[0]);
    const name = path.basename(absFilePath);
    const { left, right, title } =
      address.side === 'staged'
        ? {
            left: buildOnecGitUri(this.services.gitRoot, absFilePath, 'HEAD'),
            right: buildOnecGitUri(this.services.gitRoot, absFilePath, 'index'),
            title: `${name} (HEAD ↔ индекс)`,
          }
        : {
            left: buildOnecGitUri(this.services.gitRoot, absFilePath, 'index'),
            right: vscode.Uri.file(absFilePath),
            title: `${name} (индекс ↔ рабочее дерево)`,
          };
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  private addressOf(nodeId: string | undefined): ChangeAddress | undefined {
    if (!nodeId || !this.model) {
      return undefined;
    }
    return resolveChangeAddress(this.model, nodeId);
  }

  private absFiles(address: ChangeAddress): string[] {
    return address.relFiles.map((rel) => path.resolve(this.services.gitRoot, rel));
  }
}

/** Число уникальных изменённых файлов в модели (части объектов + «Прочие») — для бейджа. */
function countChangedFiles(model: ChangesModel): number {
  const files = new Set<string>();
  for (const group of [...model.staged, ...model.unstaged]) {
    for (const part of group.parts) {
      for (const file of part.files) {
        files.add(file);
      }
    }
  }
  for (const raw of model.unresolved) {
    files.add(raw.relPath);
  }
  return files.size;
}
