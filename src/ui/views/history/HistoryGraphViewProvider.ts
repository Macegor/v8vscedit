import * as path from 'path';
import * as vscode from 'vscode';
import type { ConfigEntry } from '../../../domain/Configuration';
import type { MetaKind } from '../../../domain/MetaTypes';
import type { ChangesModel } from '../../../infra/git/MetadataChangeAggregator';
import { buildOnecGitUri } from '../../git/OnecGitContentProvider';
import { getIconUris } from '../../tree/presentation/icon';
import type { IconDto } from '../changes/changesDtoBuilder';
import { WebviewHtmlFactory } from '../webview/WebviewHtmlFactory';
import { buildCommitChangesSection } from './historyGraphDtoBuilder';
import { loadCommitChanges, loadHistoryState, resolveCommitDiff } from './historyGraphController';

/** Внешние зависимости панели: корень git и корни выгрузки 1С. */
export interface HistoryGraphViewServices {
  readonly gitRoot: string;
  readonly getConfigRoots: () => readonly ConfigEntry[];
}

/** Сообщение ui → host: команда над графом/коммитом (`selectCommit`/`openDiff`/`loadMore`/`refresh`). */
interface HistoryCommandMessage {
  readonly type?: string;
  readonly command?: string;
  readonly payload?: { readonly hash?: string; readonly nodeId?: string };
}

const PAGE_SIZE_STEP = 200;

/**
 * Тонкая vscode-оболочка панели «История» (граф истории git) над чистым
 * {@link loadHistoryState}/{@link loadCommitChanges}/{@link resolveCommitDiff}.
 * Самостоятельный singleton-{@link vscode.WebviewPanel} (в отличие от нативного
 * `WebviewView` панели изменений): повторный {@link open} лишь раскрывает уже
 * созданную панель.
 *
 * Модель `git log` читается ЛЕНИВО — только при открытой панели ({@link refresh}
 * при закрытой панели no-op, запрет №11) и по явным командам протокола.
 */
export class HistoryGraphViewProvider implements vscode.Disposable {
  static readonly viewType = 'v8vsceditHistory';

  private panel: vscode.WebviewPanel | undefined;
  private readonly htmlFactory: WebviewHtmlFactory;
  private pageSize = PAGE_SIZE_STEP;
  private selectedHash: string | undefined;
  private selectedModel: ChangesModel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly services: HistoryGraphViewServices,
  ) {
    this.htmlFactory = new WebviewHtmlFactory(extensionUri);
  }

  /** Открывает панель истории (singleton) и отправляет начальный граф. */
  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      HistoryGraphViewProvider.viewType,
      'История изменений',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'ui'),
          vscode.Uri.joinPath(this.extensionUri, 'src', 'icons'),
        ],
      },
    );

    this.panel.webview.onDidReceiveMessage(
      /* c8 ignore next 3 -- колбэк webview-сообщений; тесты вызывают handleMessage напрямую, а не через событие */
      (message: HistoryCommandMessage) => {
        void this.handleMessage(message);
      },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.selectedHash = undefined;
      this.selectedModel = undefined;
      this.pageSize = PAGE_SIZE_STEP;
    });

    this.renderHtml(this.panel);
    this.postGraph();
  }

  /** Пересчёт графа при открытой панели; при закрытой — no-op (git не читается). */
  refresh(): void {
    if (!this.panel) {
      return;
    }
    this.postGraph();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.selectedHash = undefined;
    this.selectedModel = undefined;
    this.pageSize = PAGE_SIZE_STEP;
  }

  /** Обрабатывает команду протокола webview. Публичный — вызывается тестами оболочки напрямую. */
  async handleMessage(message: HistoryCommandMessage): Promise<void> {
    switch (message.command) {
      case 'selectCommit':
        this.selectCommit(message.payload?.hash);
        return;
      case 'openDiff':
        await this.openDiff(message.payload?.nodeId);
        return;
      case 'loadMore':
        this.pageSize += PAGE_SIZE_STEP;
        this.postGraph();
        return;
      case 'refresh':
        this.refresh();
        return;
      default:
        return;
    }
  }

  private selectCommit(hash: string | undefined): void {
    if (!hash) {
      return;
    }
    const state = loadHistoryState(this.services.gitRoot, this.pageSize, nowSec(), this.selectedHash);
    const row = state.rows.find((candidate) => candidate.hash === hash);
    const isRoot = row ? row.parents.length === 0 : false;
    const model = loadCommitChanges(this.services.gitRoot, this.services.getConfigRoots(), hash, isRoot);
    this.selectedHash = hash;
    this.selectedModel = model;
    const section = buildCommitChangesSection(model, (kind) => this.buildIcon(kind));
    void this.panel?.webview.postMessage({ type: 'commitChanges', hash, section });
  }

  private async openDiff(nodeId: string | undefined): Promise<void> {
    if (!nodeId || !this.selectedModel || !this.selectedHash) {
      return;
    }
    const diff = resolveCommitDiff(this.selectedModel, this.selectedHash, nodeId);
    if (!diff) {
      return;
    }
    const abs = path.resolve(this.services.gitRoot, diff.relFile);
    const left = buildOnecGitUri(this.services.gitRoot, abs, diff.leftRef);
    const right = buildOnecGitUri(this.services.gitRoot, abs, diff.rightRef);
    await vscode.commands.executeCommand('vscode.diff', left, right, diff.title);
  }

  private postGraph(): void {
    const state = loadHistoryState(this.services.gitRoot, this.pageSize, nowSec(), this.selectedHash);
    void this.panel?.webview.postMessage({ type: 'graph', state });
  }

  /**
   * Иконка объекта — тот же источник, что у навигатора: `getIconUris` по
   * `META_TYPES`, доведённая до webview-URI. При отсутствии панели/ошибке — `none`.
   */
  private buildIcon(kind: MetaKind): IconDto {
    try {
      const uris = getIconUris(kind, undefined, this.extensionUri);
      const lightUri = this.panel?.webview.asWebviewUri(uris.light).toString();
      const darkUri = this.panel?.webview.asWebviewUri(uris.dark).toString();
      if (!lightUri || !darkUri) {
        return { kind: 'none' };
      }
      return { kind: 'asset', lightUri, darkUri };
    /* c8 ignore start -- getIconUris бросает только на неизвестном kind; iconResolver
       зовётся лишь с валидными MetaKind из агрегатора/синтеза, ветвь недостижима */
    } catch {
      return { kind: 'none' };
    }
    /* c8 ignore stop */
  }

  /**
   * Полная перерисовка HTML. Манифест `history` webview появляется в Слое 4 —
   * до него `getEntry` бросает, поэтому рендер обёрнут в try/catch (как у
   * `SubsystemEditorViewProvider`): открытие панели не должно падать.
   */
  private renderHtml(panel: vscode.WebviewPanel): void {
    try {
      panel.webview.html = this.htmlFactory.renderVueWebviewHtml({
        webview: panel.webview,
        title: 'История изменений',
        entry: 'history',
        viewKind: 'history',
        initialState: null,
        csp: { allowStyles: true, allowImages: true },
      });
    } catch {
      // Манифест `history` ещё не собран (Слой 4) — панель остаётся пустой, но не падает.
    }
  }
}

/** Текущее время в секундах Unix (для относительных дат графа). */
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
