import * as path from 'path';
import * as vscode from 'vscode';
import { readBlobAtIndex, readBlobAtRef } from '../../infra/git/GitBlobReader';

/**
 * Левая/правая сторона diff «Изменения метаданных» и графа истории: содержимое
 * файла из индекса или произвольного коммита (commit-ish: `HEAD`, `HEAD^`,
 * короткий/полный хеш, имя ветки/тега). URI самодостаточен — кодирует
 * gitRoot + ref в query, поэтому `provideTextDocumentContent` не зависит от
 * глобального состояния провайдера.
 */

export const ONEC_GIT_SCHEME = 'onec-git';

/**
 * Опорная версия blob-а. Особое значение `index` читается из staging area
 * (`git show :<path>`); любой другой ref трактуется как commit-ish и читается
 * через `git show <ref>:<path>` — так панель истории diff-ит произвольные
 * коммиты, а панель изменений по-прежнему передаёт `HEAD`/`index`.
 */
export type OnecGitRef = string;

/** Строит `onec-git`-URI для файла и опорной версии (`index` или любой commit-ish). */
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
    // Пустой/отсутствующий ref трактуем как HEAD — обратная совместимость с
    // ранними URI и защита от «висящего» родителя корневого коммита (`HEAD^`
    // не существует → readBlobAtRef вернёт null → пустая сторона diff).
    const ref = params.get('ref') ?? 'HEAD';
    const content = ref === 'index'
      ? readBlobAtIndex(gitRoot, absFilePath)
      : readBlobAtRef(gitRoot, ref, absFilePath);
    return content ?? '';
  }
}
