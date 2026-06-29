import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

const GITHUB_REPO = 'itrous/bsl-analyzer';
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_REPO}`;

/** Платформенный суффикс имени бинарника */
function platformAssetName(): string {
  switch (process.platform) {
    case 'win32': return 'bsl-analyzer-windows-amd64.exe';
    case 'linux': return 'bsl-analyzer-linux-amd64';
    case 'darwin': return 'bsl-analyzer-darwin-arm64';
    default: throw new Error(`Платформа ${process.platform} не поддерживается bsl-analyzer`);
  }
}

interface ReleaseInfo {
  tag: string;
  downloadUrl: string;
  /** URL ассета с контрольной суммой SHA256, если он опубликован рядом с бинарником */
  sha256Url?: string;
}

export class BslAnalyzerService implements vscode.Disposable {
  private storageDir: string;
  private outputChannel: vscode.OutputChannel;
  private currentVersion: string | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
  ) {
    this.storageDir = path.join(context.globalStorageUri.fsPath, 'bsl-analyzer');
    this.outputChannel = outputChannel;
  }

  dispose(): void { /* noop */ }

  /** Путь к исполняемому файлу (может не существовать) */
  get binaryPath(): string {
    const name = process.platform === 'win32' ? 'bsl-analyzer.exe' : 'bsl-analyzer';
    return path.join(this.storageDir, name);
  }

  /** Текущая закэшированная версия (из файла version.txt) */
  get installedVersion(): string | undefined {
    if (this.currentVersion) {return this.currentVersion;}
    const vFile = path.join(this.storageDir, 'version.txt');
    if (fs.existsSync(vFile)) {
      this.currentVersion = fs.readFileSync(vFile, 'utf-8').trim();
    }
    return this.currentVersion;
  }

  /** Бинарник уже скачан? */
  get isInstalled(): boolean {
    return fs.existsSync(this.binaryPath);
  }

  /**
   * Убедиться, что бинарник существует и актуален.
   * @returns true если бинарник готов
   */
  async ensureBinary(token?: vscode.CancellationToken): Promise<boolean> {
    try { fs.unlinkSync(this.binaryPath + '.old'); } catch { /* noop */ }
    const customPath = this.getConfiguredExecutablePath();
    if (customPath) {
      if (!fs.existsSync(customPath)) {
        vscode.window.showErrorMessage(`bsl-analyzer: указанный путь не найден: ${customPath}`);
        return false;
      }
      return true;
    }

    if (this.isInstalled) {return true;}

    return this.downloadLatest(token);
  }

  /** Получить путь к исполняемому файлу с учётом пользовательского пути */
  getExecutablePath(): string {
    return this.getConfiguredExecutablePath() ?? this.binaryPath;
  }

  /**
   * Путь из настроек, если он задан непустой строкой.
   * В `package.json` default для `path` — `""`; пустое значение означает встроенный кэш, не «запуск без команды».
   */
  private getConfiguredExecutablePath(): string | undefined {
    const raw = vscode.workspace.getConfiguration('v8vscedit.bslAnalyzer').get<string | undefined>('path');
    if (typeof raw !== 'string') {
      return undefined;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /** Проверить наличие обновлений и скачать если есть */
  async checkForUpdate(): Promise<boolean> {
    const latest = await this.fetchLatestRelease();
    if (!latest) {return false;}

    const installed = this.installedVersion;
    if (installed === latest.tag) {
      this.outputChannel.appendLine(`[bsl-analyzer] Версия ${installed} актуальна`);
      return false;
    }

    const action = await vscode.window.showInformationMessage(
      `Доступна новая версия bsl-analyzer: ${latest.tag} (текущая: ${installed ?? 'не установлена'})`,
      'Обновить',
      'Пропустить',
    );
    if (action !== 'Обновить') {return false;}

    return this.downloadLatest();
  }

  /** Коллбэк для остановки LSP перед подменой бинарника (устанавливается из extension.ts) */
  onBeforeSwap: (() => Promise<void>) | undefined;

  /** Скачать последнюю версию */
  async downloadLatest(token?: vscode.CancellationToken): Promise<boolean> {
    const release = await this.fetchLatestRelease();
    if (!release) {return false;}

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `bsl-analyzer ${release.tag}`, cancellable: true },
      async (progress, cancelToken) => {
        const ct = token ?? cancelToken;
        progress.report({ message: 'Загрузка...' });

        const tmpPath = this.binaryPath + '.tmp';

        try {
          fs.mkdirSync(this.storageDir, { recursive: true });
          await this.download(release.downloadUrl, tmpPath, ct);

          if (release.sha256Url) {
            progress.report({ message: 'Проверка контрольной суммы...' });
            await this.verifyChecksum(tmpPath, release.sha256Url, ct);
          }

          progress.report({ message: 'Замена бинарника...' });

          if (this.onBeforeSwap) {
            await this.onBeforeSwap();
            await new Promise((r) => setTimeout(r, 1500));
          }

          const oldPath = this.binaryPath + '.old';
          try { fs.unlinkSync(oldPath); } catch { /* ignore */ }

          if (fs.existsSync(this.binaryPath)) {
            fs.renameSync(this.binaryPath, oldPath);
          }
          fs.renameSync(tmpPath, this.binaryPath);

          try { fs.unlinkSync(oldPath); } catch { /* подчистим при следующем запуске */ }

          if (process.platform !== 'win32') {
            fs.chmodSync(this.binaryPath, 0o755);
          }

          this.currentVersion = release.tag;
          fs.writeFileSync(path.join(this.storageDir, 'version.txt'), release.tag, 'utf-8');

          this.outputChannel.appendLine(`[bsl-analyzer] Установлена версия ${release.tag}`);
          return true;
        } catch (err) {
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
          if (ct.isCancellationRequested) {return false;}
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`bsl-analyzer: ошибка загрузки: ${msg}`);
          return false;
        }
      },
    );
  }

  /** Запрос последнего релиза с GitHub API */
  private async fetchLatestRelease(): Promise<ReleaseInfo | undefined> {
    try {
      const data = await this.httpGetJson(`${GITHUB_API_BASE}/releases/latest`);
      const tag = data.tag_name as string;
      const assetName = platformAssetName();
      const assets = data.assets as { name: string; browser_download_url: string }[];
      const asset = assets.find((a) => a.name === assetName);

      if (!asset) {
        this.outputChannel.appendLine(`[bsl-analyzer] Бинарник для ${process.platform} не найден в релизе ${tag}`);
        return undefined;
      }

      // Контрольная сумма публикуется не всегда — её отсутствие не считаем ошибкой.
      const sha256Asset = assets.find((a) => a.name === `${assetName}.sha256`);

      return { tag, downloadUrl: asset.browser_download_url, sha256Url: sha256Asset?.browser_download_url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`[bsl-analyzer] Ошибка запроса GitHub API: ${msg}`);
      return undefined;
    }
  }

  private static readonly DOWNLOAD_TIMEOUT_MS = 120_000;
  /** Лимит редиректов: защита от бесконечной цепочки location → location */
  private static readonly MAX_REDIRECTS = 5;

  /** Скачать файл по URL с поддержкой редиректов и таймаутом */
  private download(url: string, dest: string, token?: vscode.CancellationToken): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => { if (!settled) { settled = true; reject(err); } };
      const ok = () => { if (!settled) { settled = true; resolve(); } };

      const timer = setTimeout(() => {
        fail(new Error('Таймаут загрузки (120 сек)'));
      }, BslAnalyzerService.DOWNLOAD_TIMEOUT_MS);

      const file = fs.createWriteStream(dest);
      file.on('error', (err) => { clearTimeout(timer); fail(err); });

      // redirects — число уже пройденных редиректов; secure — был ли исходный URL https
      const request = (targetUrl: string, redirects: number, secure: boolean) => {
        const isHttps = targetUrl.startsWith('https');
        // Запрещаем downgrade https→http: после защищённого старта переход на http недопустим.
        if (secure && !isHttps) {
          clearTimeout(timer);
          fail(new Error('Небезопасный редирект: переход с https на http запрещён'));
          return;
        }
        const mod = isHttps ? https : http;
        const req = mod.get(targetUrl, { headers: { 'User-Agent': 'v8vscedit' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects >= BslAnalyzerService.MAX_REDIRECTS) {
              clearTimeout(timer);
              fail(new Error(`Превышен лимит редиректов (${String(BslAnalyzerService.MAX_REDIRECTS)})`));
              return;
            }
            request(res.headers.location, redirects + 1, secure || isHttps);
            return;
          }
          if (res.statusCode !== 200) {
            clearTimeout(timer);
            fail(new Error(`HTTP ${String(res.statusCode)}`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => { clearTimeout(timer); file.close(() => ok()); });
        });
        req.on('error', (err) => { clearTimeout(timer); fail(err); });
        if (token) {
          token.onCancellationRequested(() => {
            req.destroy();
            clearTimeout(timer);
            fail(new Error('Отменено'));
          });
        }
      };
      request(url, 0, url.startsWith('https'));
    });
  }

  /** Скачать текстовый ресурс (например, файл контрольной суммы) в строку */
  private downloadToString(url: string, token?: vscode.CancellationToken): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => { if (!settled) { settled = true; reject(err); } };
      const succeed = (value: string) => { if (!settled) { settled = true; resolve(value); } };

      const timer = setTimeout(() => {
        fail(new Error('Таймаут загрузки контрольной суммы (120 сек)'));
      }, BslAnalyzerService.DOWNLOAD_TIMEOUT_MS);

      const request = (targetUrl: string, redirects: number, secure: boolean) => {
        const isHttps = targetUrl.startsWith('https');
        if (secure && !isHttps) {
          clearTimeout(timer);
          fail(new Error('Небезопасный редирект: переход с https на http запрещён'));
          return;
        }
        const mod = isHttps ? https : http;
        const req = mod.get(targetUrl, { headers: { 'User-Agent': 'v8vscedit' } }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects >= BslAnalyzerService.MAX_REDIRECTS) {
              clearTimeout(timer);
              fail(new Error(`Превышен лимит редиректов (${String(BslAnalyzerService.MAX_REDIRECTS)})`));
              return;
            }
            request(res.headers.location, redirects + 1, secure || isHttps);
            return;
          }
          if (res.statusCode !== 200) {
            clearTimeout(timer);
            fail(new Error(`HTTP ${String(res.statusCode)}`));
            return;
          }
          let body = '';
          res.on('data', (c: Buffer) => { body += c.toString(); });
          res.on('end', () => { clearTimeout(timer); succeed(body); });
        });
        req.on('error', (err) => { clearTimeout(timer); fail(err); });
        if (token) {
          token.onCancellationRequested(() => {
            req.destroy();
            clearTimeout(timer);
            fail(new Error('Отменено'));
          });
        }
      };
      request(url, 0, url.startsWith('https'));
    });
  }

  /**
   * Сверить SHA256 скачанного файла с опубликованной контрольной суммой.
   * Бросает ошибку при несовпадении — установка прерывается.
   */
  private async verifyChecksum(filePath: string, sha256Url: string, token?: vscode.CancellationToken): Promise<void> {
    const checksumBody = await this.downloadToString(sha256Url, token);
    // Формат файла .sha256 обычно «<hex>  <имя_файла>»; берём первый шестнадцатеричный токен.
    const expected = (checksumBody.trim().split(/\s+/)[0] ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      throw new Error('Некорректный формат файла контрольной суммы');
    }

    const actual = await new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });

    if (actual.toLowerCase() !== expected) {
      throw new Error('Контрольная сумма не совпадает: возможно, файл повреждён или подменён');
    }
    this.outputChannel.appendLine('[bsl-analyzer] Контрольная сумма SHA256 подтверждена');
  }

  /** HTTP GET JSON */
  private httpGetJson(url: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => { if (!settled) { settled = true; reject(err); } };
      const succeed = (value: Record<string, unknown>) => { if (!settled) { settled = true; resolve(value); } };

      const req = https.get(url, { headers: { 'User-Agent': 'v8vscedit', Accept: 'application/json' } }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(body);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              succeed(parsed as Record<string, unknown>);
              return;
            }
            fail(new Error('GitHub API вернул JSON не в формате объекта'));
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        });
      });
      req.on('error', fail);
      req.setTimeout(BslAnalyzerService.DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy(new Error('Таймаут запроса к GitHub API (120 сек)'));
      });
    });
  }
}
