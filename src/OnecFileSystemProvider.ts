import * as fs from 'fs';
import * as vscode from 'vscode';
import { SupportInfoService } from './services/SupportInfoService';

export const ONEC_SCHEME = 'onec';

/**
 * Виртуальная файловая система для BSL-модулей 1С.
 * Сопоставляет читаемые пути вида onec://cf/Общие модули/Имя
 * с реальными файлами на диске.
 *
 * Readonly для заблокированных объектов обеспечивается двумя механизмами:
 * 1. stat() → permissions: Readonly (новые версии VS Code)
 * 2. setEditorReadonlyInSession (вызывается из CommandRegistry)
 * 3. writeFile() guard — последний барьер
 */
export class OnecFileSystemProvider implements vscode.FileSystemProvider {
  /** virtualUri.toString() → абсолютный путь реального BSL-файла */
  private readonly realPaths = new Map<string, string>();
  /** virtualUri.toString() → абсолютный путь XML-файла объекта-владельца */
  private readonly ownerXmlPaths = new Map<string, string>();

  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  private supportService: SupportInfoService | undefined;
  private log: vscode.OutputChannel | undefined;

  setSupportService(service: SupportInfoService): void {
    this.supportService = service;
  }

  setOutputChannel(channel: vscode.OutputChannel): void {
    this.log = channel;
  }

  /** Регистрирует виртуальный URI для реального BSL-файла */
  register(virtualUri: vscode.Uri, realPath: string): void {
    this.realPaths.set(virtualUri.toString(), realPath);
  }

  /** Регистрирует XML-файл объекта-владельца для проверки поддержки через stat() */
  registerOwnerXml(virtualUri: vscode.Uri, ownerXmlPath: string): void {
    this.ownerXmlPaths.set(virtualUri.toString(), ownerXmlPath);
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
    const realPath = this.resolve(uri);
    const s = fs.statSync(realPath);

    // Проверяем по XML владельца (надёжно), а не по BSL-пути (требует обратного ресолва)
    const ownerXml = this.ownerXmlPaths.get(uri.toString());
    const locked = ownerXml
      ? this.supportService?.isLocked(ownerXml) ?? false
      : this.supportService?.isLocked(realPath) ?? false;

    if (locked) {
      this.log?.appendLine(`[vfs] stat ${uri.path} → READONLY (owner: ${ownerXml ?? realPath})`);
    }

    return {
      type: vscode.FileType.File,
      ctime: s.ctimeMs,
      mtime: s.mtimeMs,
      size: s.size,
      permissions: locked ? vscode.FilePermission.Readonly : undefined,
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
    const realPath = this.resolve(uri);
    const ownerXml = this.ownerXmlPaths.get(uri.toString());
    const checkPath = ownerXml ?? realPath;
    if (this.supportService?.isLocked(checkPath)) {
      throw vscode.FileSystemError.NoPermissions(
        'Объект на поддержке без права изменения. Редактирование запрещено.'
      );
    }
    fs.writeFileSync(realPath, content);
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(): void {}

  rename(): void {}
}
