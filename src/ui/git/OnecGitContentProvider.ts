import * as path from 'path';
import * as vscode from 'vscode';
import { readBlobAtHead, readBlobAtIndex } from '../../infra/git/GitBlobReader';

/**
 * Левая сторона diff «Изменения метаданных»: содержимое файла из HEAD или
 * индекса. URI самодостаточен — кодирует gitRoot + ref в query, поэтому
 * `provideTextDocumentContent` не зависит от глобального состояния провайдера.
 */

export const ONEC_GIT_SCHEME = 'onec-git';

/** Опорная версия blob-а: последний коммит или индекс. */
export type OnecGitRef = 'HEAD' | 'index';

/** Строит `onec-git`-URI для файла и опорной версии (HEAD/index). */
export function buildOnecGitUri(gitRoot: string, absFilePath: string, ref: OnecGitRef): vscode.Uri {
  const relPath = path.relative(gitRoot, absFilePath).split(path.sep).join('/');
  const query = new URLSearchParams({ gitRoot, ref }).toString();
  return vscode.Uri.from({ scheme: ONEC_GIT_SCHEME, path: `/${relPath}`, query });
}

export class OnecGitContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query);
    const gitRoot = params.get('gitRoot');
    if (!gitRoot) {
      return '';
    }
    const relPath = uri.path.replace(/^\//, '');
    const absFilePath = path.join(gitRoot, relPath);
    const content = params.get('ref') === 'index'
      ? readBlobAtIndex(gitRoot, absFilePath)
      : readBlobAtHead(gitRoot, absFilePath);
    return content ?? '';
  }
}
