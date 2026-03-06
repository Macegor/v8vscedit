import * as vscode from 'vscode';

/**
 * Декоратор для пометки заимствованных объектов расширения
 * жёлтой точкой поверх иконки.
 */
export class BorrowedDecorationProvider implements vscode.FileDecorationProvider {
  private readonly emitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();

  readonly onDidChangeFileDecorations: vscode.Event<
    vscode.Uri | vscode.Uri[] | undefined
  > = this.emitter.event;

  // В текущей версии декоратор статичен, поэтому событий обновления не генерируем.

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== '1c-metadata') {
      return;
    }

    const encoded = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    const decoded = decodeURIComponent(encoded);

    if (!decoded.endsWith('|BORROWED')) {
      return;
    }

    return {
      badge: '●',
      tooltip: 'Заимствованный объект основной конфигурации',
      color: new vscode.ThemeColor('charts.yellow'),
    };
  }
}

