import * as fs from 'fs';
import * as vscode from 'vscode';
import { RepositoryService } from '../../infra/repository/RepositoryService';
import { SupportInfoService } from '../../infra/support/SupportInfoService';

export const ONEC_SCHEME = 'onec';

/**
 * Виртуальная файловая система для BSL-модулей 1С.
 * Сопоставляет читаемые пути вида onec://cf/Общие модули/Имя
 * с реальными файлами на диске.
 *
 * Readonly для заблокированных объектов обеспечивается тремя механизмами:
 * 1. stat() -> permissions: Readonly
 * 2. setActiveEditorReadonlyInSession для уже открытого редактора
 * 3. writeFile() как последний барьер
 */
export class OnecFileSystemProvider implements vscode.FileSystemProvider {
  /** virtualUri.toString() -> абсолютный путь реального BSL-файла */
  private readonly realPaths = new Map<string, string>();
  /** virtualUri.toString() -> абсолютный путь XML-файла объекта-владельца */
  private readonly ownerXmlPaths = new Map<string, string>();

  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  private supportService: SupportInfoService | undefined;
  private repositoryService: RepositoryService | undefined;
  private log: vscode.OutputChannel | undefined;
  private onDidWriteRealFile: ((realPath: string) => void) | undefined;

  setSupportService(service: SupportInfoService): void {
    this.supportService = service;
  }

  setRepositoryService(service: RepositoryService): void {
    this.repositoryService = service;
  }

  setOutputChannel(channel: vscode.OutputChannel): void {
    this.log = channel;
  }

  setOnDidWriteRealFile(handler: (realPath: string) => void): void {
    this.onDidWriteRealFile = handler;
  }

  /** Регистрирует виртуальный URI для реального BSL-файла */
  register(virtualUri: vscode.Uri, realPath: string): void {
    this.realPaths.set(virtualUri.toString(), realPath);
  }

  /** Регистрирует XML объекта-владельца для проверки readonly через stat() */
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
    const checkPath = this.ownerXmlPaths.get(uri.toString()) ?? realPath;
    const locked = this.isReadonlyPath(checkPath);

    if (locked) {
      this.log?.appendLine(`[vfs] stat ${uri.path} -> READONLY (${checkPath})`);
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
    const checkPath = this.ownerXmlPaths.get(uri.toString()) ?? realPath;
    const supportLocked = this.supportService?.isLocked(checkPath) ?? false;
    const repositoryLocked = this.repositoryService?.isEditRestricted(checkPath) ?? false;
    if (supportLocked || repositoryLocked) {
      throw vscode.FileSystemError.NoPermissions(
        supportLocked
          ? 'Объект на поддержке без права изменения. Редактирование запрещено.'
          : 'Объект не захвачен в хранилище. Редактирование запрещено.'
      );
    }

    fs.writeFileSync(realPath, content);
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    this.onDidWriteRealFile?.(realPath);
  }

  delete(): void {}

  rename(): void {}

  private isReadonlyPath(filePath: string): boolean {
    const supportLocked = this.supportService?.isLocked(filePath) ?? false;
    const repositoryLocked = this.repositoryService?.isEditRestricted(filePath) ?? false;
    return supportLocked || repositoryLocked;
  }
}
