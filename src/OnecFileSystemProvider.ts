import * as fs from 'fs';
import * as vscode from 'vscode';

export const ONEC_SCHEME = 'onec';

/**
 * Виртуальная файловая система для BSL-модулей 1С.
 * Сопоставляет читаемые пути вида onec://cf/Общие модули/Имя.bsl
 * с реальными файлами на диске, чтобы хлебные крошки редактора
 * отображали структуру метаданных, а не внутренние папки XML-выгрузки.
 */
export class OnecFileSystemProvider implements vscode.FileSystemProvider {
  /** Соответствие virtualUri.toString() → абсолютный путь реального файла */
  private readonly realPaths = new Map<string, string>();

  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  /** Регистрирует виртуальный URI для реального BSL-файла */
  register(virtualUri: vscode.Uri, realPath: string): void {
    this.realPaths.set(virtualUri.toString(), realPath);
  }

  private resolve(uri: vscode.Uri): string {
    const real = this.realPaths.get(uri.toString());
    if (!real) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return real;
  }

  watch(): vscode.Disposable {
    return { dispose: () => {} };
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const s = fs.statSync(this.resolve(uri));
    return {
      type: vscode.FileType.File,
      ctime: s.ctimeMs,
      mtime: s.mtimeMs,
      size: s.size,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {}

  readFile(uri: vscode.Uri): Uint8Array {
    return fs.readFileSync(this.resolve(uri));
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    fs.writeFileSync(this.resolve(uri), content);
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(): void {}

  rename(): void {}
}
