import * as vscode from 'vscode';
import {
  GitMetadataStatusService,
  MetadataGitDecorationStatus,
  MetadataGitDecorationTarget,
} from '../../../infra/git/GitMetadataStatusService';

export const GIT_METADATA_DECORATION_SCHEME = 'onec-meta-git';

/**
 * Декоратор для вложенных XML-элементов: реквизитов, измерений, ресурсов,
 * колонок и других узлов, которые не имеют отдельного файла на диске.
 */
export class GitMetadataDecorationProvider implements vscode.FileDecorationProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;

  constructor(private readonly statusService: GitMetadataStatusService) {}

  refresh(): void {
    this.statusService.clear();
    this.onDidChangeEmitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== GIT_METADATA_DECORATION_SCHEME) {
      return undefined;
    }

    const target = GitMetadataDecorationProvider.parseUri(uri);
    if (!target) {
      return undefined;
    }

    return toDecoration(this.statusService.getStatus(target));
  }

  static makeUri(target: MetadataGitDecorationTarget): vscode.Uri {
    return vscode.Uri.parse(`${GIT_METADATA_DECORATION_SCHEME}:/node?${encodeURIComponent(JSON.stringify(target))}`);
  }

  private static parseUri(uri: vscode.Uri): MetadataGitDecorationTarget | null {
    try {
      return JSON.parse(decodeURIComponent(uri.query)) as MetadataGitDecorationTarget;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

function toDecoration(status: MetadataGitDecorationStatus | undefined): vscode.FileDecoration | undefined {
  switch (status) {
    case 'added':
      return {
        badge: 'A',
        color: new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
        tooltip: 'Добавлено в Git',
      };
    case 'modified':
      return {
        badge: 'M',
        color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
        tooltip: 'Изменено в Git',
      };
    case 'deleted':
      return {
        badge: 'D',
        color: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
        tooltip: 'Удалено в Git',
      };
    default:
      return undefined;
  }
}
