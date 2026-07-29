import type * as vscode from 'vscode';
import { normalizeGitPath, selectGitRepository } from '../../infra/git/GitRepositorySelector';
import type { GitApiLike, GitApiState, RepositoryLike } from './gitExtensionApi';

/**
 * Наблюдатель за состоянием встроенного Git-расширения VS Code. Подписывает
 * колбэк `onChange` на `repository.state.onDidChange` того репозитория, чей
 * корень совпадает с `gitRoot` панели «Изменения метаданных». Учитывает
 * ленивую инициализацию `vscode.git` (`onDidChangeState`) и позднее открытие
 * репозитория (`onDidOpenRepository`).
 */
export class GitStateObserver implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /** Нормализованный корень уже подписанного репозитория — guard двойной подписки. */
  private subscribedRoot: string | undefined;
  private disposed = false;

  constructor(
    private readonly api: GitApiLike | undefined,
    private readonly gitRoot: string,
    private readonly onChange: () => void
  ) {}

  start(): void {
    const api = this.api;
    if (!api) {
      return;
    }
    if (api.state === 'initialized') {
      this.trySubscribeExisting(api);
      if (this.subscribedRoot === undefined) {
        this.watchOpenRepository(api);
      }
      return;
    }
    // 'uninitialized': репозитории появятся позже — ждём и инициализацию API,
    // и потенциальное открытие репозитория.
    this.disposables.push(
      api.onDidChangeState((state: GitApiState) => {
        /* c8 ignore next 3 */ // недостижимо: dispose() снимает подписку на уровне EventEmitter до следующего fire; guard — защита от реентранси
        if (this.disposed) {
          return;
        }
        if (state === 'initialized') {
          this.trySubscribeExisting(api);
        }
      })
    );
    this.watchOpenRepository(api);
  }

  dispose(): void {
    this.disposed = true;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  /** Ищет совпадающий репозиторий в текущем списке и подписывается на него. */
  private trySubscribeExisting(api: GitApiLike): void {
    const index = selectGitRepository(
      api.repositories.map((r) => r.rootUri.fsPath),
      this.gitRoot
    );
    if (index !== -1) {
      this.subscribeRepository(api.repositories[index]);
    }
  }

  private watchOpenRepository(api: GitApiLike): void {
    this.disposables.push(
      api.onDidOpenRepository((repo: RepositoryLike) => {
        /* c8 ignore next 3 */ // недостижимо: dispose() снимает подписку на уровне EventEmitter до следующего fire; guard — защита от реентранси
        if (this.disposed) {
          return;
        }
        this.subscribeRepository(repo);
      })
    );
  }

  /**
   * Подписывается на `state.onDidChange` репозитория, если его корень совпадает
   * с `gitRoot` и на него ещё нет подписки (guard двойной подписки по
   * нормализованному корню).
   */
  private subscribeRepository(repo: RepositoryLike): void {
    const root = normalizeGitPath(repo.rootUri.fsPath);
    if (root !== normalizeGitPath(this.gitRoot) || this.subscribedRoot === root) {
      return;
    }
    this.subscribedRoot = root;
    this.disposables.push(
      repo.state.onDidChange(() => {
        /* c8 ignore next 3 */ // недостижимо: dispose() снимает подписку на уровне EventEmitter до следующего fire; guard — защита от реентранси
        if (this.disposed) {
          return;
        }
        this.onChange();
      })
    );
  }
}
