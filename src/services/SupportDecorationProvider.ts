import * as vscode from 'vscode';
import { SupportMode } from './SupportInfoService';

export const SUPPORT_SCHEME = 'onec-support';

/**
 * Поставщик файловых украшений для дерева метаданных.
 * Управляет отображением состояния поддержки объектов:
 * цветом метки и значком-бейджем на иконке.
 *
 * Узлы дерева получают resourceUri вида `onec-support:///<mode>`.
 */
export class SupportDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  /** Уведомляет VS Code об обновлении всех декораций (например, после перезагрузки кэша) */
  fireRefresh(): void {
    this._onDidChange.fire([
      SupportDecorationProvider.makeUri(SupportMode.None),
      SupportDecorationProvider.makeUri(SupportMode.Editable),
      SupportDecorationProvider.makeUri(SupportMode.Locked),
    ]);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SUPPORT_SCHEME) { return undefined; }

    const mode = parseInt(uri.path.replace(/^\//, ''), 10) as SupportMode;

    switch (mode) {
      case SupportMode.None:
        // Объект не на поддержке — нейтральный индикатор без цвета
        return {
          tooltip: 'Не на поддержке',
        };

      case SupportMode.Locked:
        return {
          badge: 'ПЗ',
          color: new vscode.ThemeColor('list.errorForeground'),
          tooltip: 'На поддержке, редактирование запрещено',
        };

      case SupportMode.Editable:
        return {
          badge: 'П',
          color: new vscode.ThemeColor('charts.yellow'),
          tooltip: 'На поддержке, редактирование разрешено',
        };

      default:
        return undefined;
    }
  }

  /** Создаёт URI, кодирующий режим поддержки для использования в resourceUri узла дерева */
  static makeUri(mode: SupportMode): vscode.Uri {
    return vscode.Uri.parse(`${SUPPORT_SCHEME}:///${mode}`);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
