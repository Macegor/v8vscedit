/**
 * Общая тестовая обвязка пакетной выгрузки/загрузки всех расширений базы
 * (`dump-cfe-all`/`load-cfe-all`, MCP `v8vscedit_dump_all_cfe`/`v8vscedit_load_all_cfe`).
 *
 * Единственный мок — POSIX-заглушка вместо `1cv8` (Конфигуратор 1С — внешняя
 * недоступная в CI система; приём уже узаконен в `mcpConfigLifecycleCfTools.test.ts`
 * и `cfFileCommandRunner.test.ts`). Всё остальное — настоящее: реальные временные
 * каталоги, реальный собранный `dist/cli/onec-tools.js` в дочернем node-процессе.
 *
 * Зачем нужен именно argv.log: платформа МОЛЧА принимает неизвестные ключи
 * (проверено на 8.3.27.1989: `/DumpCfg <файл> -AllExtensions` даёт exit 0 и выгрузку
 * ОСНОВНОЙ конфигурации), поэтому ошибку в векторе аргументов нельзя поймать ни
 * кодом возврата, ни логом — единственная защита это точная сверка того, что
 * реально получил «Конфигуратор». Заглушка дословно пишет весь argv каждого
 * запуска.
 *
 * Управление заглушкой — файлами рядом с ней (а не переменными окружения):
 * так поведение одинаково работает и при прямом запуске CLI из теста, и через
 * `runInternalCliCommand` (у `runProcess` нет параметра `env`). Файлы (в каталоге
 * заглушки, по одному имени расширения на строку):
 *  - `db-extensions.txt`   — байты, которые `/DumpDBCfgList` кладёт в `/Out`;
 *  - `list-fails`          — если файл есть, `/DumpDBCfgList` завершается с кодом 1;
 *  - `fail-dump.txt`       — `/DumpCfg -Extension <имя из файла>`: 16 байт мусора в целевой
 *                            путь (как реальная платформа при сбое) и код 1;
 *  - `fail-load.txt`       — `/LoadCfg -Extension <имя из файла>`: код 1;
 *  - `fail-update.txt`     — `/UpdateDBCfg -Extension <имя из файла>`: код 1;
 *  - `sigterm-dump.txt`,
 *    `sigterm-load.txt`    — после успешной обработки этого расширения заглушка шлёт
 *                            SIGTERM родителю (нашему CLI) и ещё полсекунды живёт: сигнал
 *                            гарантированно приходит ДО завершения текущего элемента, так
 *                            что прерывание детерминированно наступает «между итерациями».
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const IS_WINDOWS = process.platform === 'win32';

/** Пароль/пользователь подключения в тестах — чтобы сверять точный вектор `/N…` и `/P…`. */
export const TEST_USER = 'Admin';
export const TEST_PASSWORD = 'Secret';

const CLI_PATH = path.join(__dirname, '..', '..', '..', '..', 'dist', 'cli', 'onec-tools.js');

export function cliPath(): string {
  assertCliBuilt();
  return CLI_PATH;
}

function assertCliBuilt(): void {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(`собранный CLI не найден: ${CLI_PATH} (ожидается build:node из pretest)`);
  }
}

/** Разделитель аргументов в строке argv.log (в именах расширений и путях табуляции не бывает). */
const ARGV_SEPARATOR = '\t';

const FAKE_DESIGNER_SCRIPT = [
  '#!/bin/sh',
  'dir=$(dirname "$0")',
  'line=""',
  'for arg in "$@"; do',
  '  if [ -z "$line" ]; then line="$arg"; else line="$line' + ARGV_SEPARATOR + '$arg"; fi',
  'done',
  'printf \'%s\\n\' "$line" >> "$dir/argv.log"',
  '',
  'listed() { [ -f "$dir/$1" ] && grep -Fxq -- "$2" "$dir/$1"; }',
  '',
  'mode=""; ext=""; file=""; out=""; prev=""',
  'for arg in "$@"; do',
  '  case "$arg" in',
  '    /DumpDBCfgList) mode=list ;;',
  '    /UpdateDBCfg) mode=update ;;',
  '  esac',
  '  case "$prev" in',
  '    /DumpCfg) mode=dump; file="$arg" ;;',
  '    /LoadCfg) mode=load; file="$arg" ;;',
  '    -Extension) ext="$arg" ;;',
  '    /Out) out="$arg" ;;',
  '  esac',
  '  prev="$arg"',
  'done',
  '',
  'case "$mode" in',
  '  list)',
  '    if [ -f "$dir/list-fails" ]; then printf \'boom\' > "$out"; exit 1; fi',
  '    if [ -f "$dir/db-extensions.txt" ]; then cat "$dir/db-extensions.txt" > "$out"; else : > "$out"; fi',
  '    exit 0 ;;',
  '  dump)',
  '    if listed fail-dump.txt "$ext"; then printf \'0123456789abcdef\' > "$file"; exit 1; fi',
  '    printf \'cfe:%s\' "$ext" > "$file"',
  '    if listed sigterm-dump.txt "$ext"; then kill -TERM $PPID; sleep 0.5; fi',
  '    exit 0 ;;',
  '  update)',
  '    if listed fail-update.txt "$ext"; then exit 1; fi',
  '    exit 0 ;;',
  '  load)',
  '    if listed fail-load.txt "$ext"; then exit 1; fi',
  '    if listed sigterm-load.txt "$ext"; then kill -TERM $PPID; sleep 0.5; fi',
  '    exit 0 ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

/**
 * Рабочее окружение одного теста: проект (`root`) с `env.json`, каталог заглушки
 * (`binDir`), каталог для выгрузки/загрузки (`dataDir`) и путь файла-результата.
 */
export interface BatchWorkspace {
  readonly root: string;
  readonly binDir: string;
  readonly dataDir: string;
  readonly v8Path: string;
  readonly infoBasePath: string;
  readonly resultFile: string;
  dispose(): void;
}

export function createBatchWorkspace(): BatchWorkspace {
  // Без realpath — сознательно: пути идут в CLI и в argv заглушки ровно в том
  // виде, как заданы (`path.resolve` симлинки не раскрывает), поэтому строгая
  // посимвольная сверка вектора не зависит от того, где ФС держит временный
  // каталог. Раскрытие macOS-овского `/var/…` в `/private/var/…` журнальным
  // проверкам сегодня не мешает (`maskSensitiveCliArgs` не трогает аргументы с
  // разделителем пути после `/P`), но и пользы не даёт.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-batch-'));
  const binDir = path.join(root, 'bin');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(binDir);
  fs.mkdirSync(dataDir);
  const v8Path = path.join(binDir, '1cv8');
  if (!IS_WINDOWS) {
    fs.writeFileSync(v8Path, FAKE_DESIGNER_SCRIPT, 'utf-8');
    fs.chmodSync(v8Path, 0o755);
  }
  const infoBasePath = path.join(root, 'fake-infobase');
  fs.writeFileSync(
    path.join(root, 'env.json'),
    JSON.stringify({
      default: {
        '--ibconnection': `/F${infoBasePath}`,
        '--db-user': TEST_USER,
        '--db-pwd': TEST_PASSWORD,
        '--path': v8Path,
      },
    }, null, 2),
    'utf-8'
  );
  return {
    root,
    binDir,
    dataDir,
    v8Path,
    infoBasePath,
    resultFile: path.join(root, 'result.json'),
    dispose: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Заведомо не существующий путь к платформе: CLI падает на `resolveConnection` ДО любого спавна. */
export function absentV8Path(root: string): string {
  return path.join(root, 'definitely', 'not', 'installed', 'v8vscedit-test-fixture', '1cv8');
}

// ─── Управление заглушкой ───

/** Кладёт в `/Out` списка расширений ровно эти байты (кодировка — на совести вызывающего теста). */
export function setDbExtensionsRaw(ws: BatchWorkspace, bytes: Buffer): void {
  fs.writeFileSync(path.join(ws.binDir, 'db-extensions.txt'), bytes);
}

/** Как реальная платформа: UTF-8 с BOM, CRLF (формат снят с живой базы, см. `ExtensionListParser`). */
export function setDbExtensions(ws: BatchWorkspace, names: readonly string[]): void {
  const text = names.map((name) => `${name}\r\n`).join('');
  setDbExtensionsRaw(ws, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf-8')]));
}

export type FakeControl = 'fail-dump.txt' | 'fail-load.txt' | 'fail-update.txt' | 'sigterm-dump.txt' | 'sigterm-load.txt';

export function setFakeControl(ws: BatchWorkspace, control: FakeControl, names: readonly string[]): void {
  fs.writeFileSync(path.join(ws.binDir, control), `${names.join('\n')}\n`, 'utf-8');
}

export function makeListFail(ws: BatchWorkspace): void {
  fs.writeFileSync(path.join(ws.binDir, 'list-fails'), '', 'utf-8');
}

// ─── Чтение argv.log ───

/** Один запуск Конфигуратора: полный argv (включая ведущий `DESIGNER`). */
export type DesignerInvocation = readonly string[];

export function readInvocations(ws: BatchWorkspace): DesignerInvocation[] {
  const logPath = path.join(ws.binDir, 'argv.log');
  if (!fs.existsSync(logPath)) {
    return [];
  }
  return fs.readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split(ARGV_SEPARATOR));
}

export type InvocationKind = '/DumpCfg' | '/LoadCfg' | '/DumpDBCfgList' | '/UpdateDBCfg';

export function invocationsOf(ws: BatchWorkspace, kind: InvocationKind): DesignerInvocation[] {
  return readInvocations(ws).filter((argv) => argv.includes(kind));
}

/** Значение, следующее в argv за ключом (`-Extension X` → `X`). */
export function argAfter(argv: DesignerInvocation, key: string): string | undefined {
  const index = argv.indexOf(key);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Имена расширений (`-Extension`) по всем запускам заданного вида — в порядке запусков. */
export function extensionsOf(ws: BatchWorkspace, kind: InvocationKind): string[] {
  return invocationsOf(ws, kind)
    .map((argv) => argAfter(argv, '-Extension'))
    .filter((name): name is string => name !== undefined);
}

/** Ведущая часть вектора любого запуска: `DESIGNER`, подключение к файловой базе, пользователь, пароль. */
export function expectedConnectionPrefix(ws: BatchWorkspace): string[] {
  return ['DESIGNER', '/F', ws.infoBasePath, `/N${TEST_USER}`, `/P${TEST_PASSWORD}`];
}

// ─── Запуск собранного CLI ───

export interface CliRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Аргументы подключения CLI (то же, что строит `buildConnectionCliArgs` из `env.json`). */
export function connectionCliArgs(ws: BatchWorkspace): string[] {
  return ['-InfoBasePath', ws.infoBasePath, '-UserName', TEST_USER, '-Password', TEST_PASSWORD, '-V8Path', ws.v8Path];
}

/**
 * Запускает собранный CLI дочерним процессом. Тайм-аут — страховка от зависания
 * теста, а не часть проверки: детерминированные сценарии укладываются в секунды.
 */
export function runCli(cliArgs: readonly string[], timeoutMs = 60_000): Promise<CliRunResult> {
  assertCliBuilt();
  return new Promise<CliRunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...cliArgs], { shell: false });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8'),
      });
    });
  });
}

// ─── Файловые помощники ───

/** Отсортированный список имён (файлов и каталогов) первого уровня; каталога нет — пустой список. */
export function listNames(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** Ровно N имён расширений `Ext01…ExtNN`: нулевой отступ делает порядок сортировки очевидным при любой локали. */
export function makeExtensionNames(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `Ext${String(index + 1).padStart(2, '0')}`);
}

/** Кладёт в каталог непустой `.cfe` с известным содержимым (`cfe:<имя>`, как выгружает заглушка). */
export function writeCfeFile(dir: string, fileName: string, extensionName: string): void {
  fs.writeFileSync(path.join(dir, fileName), `cfe:${extensionName}`);
}

/** Вектор `.part`-остатков: staging-файлы выгрузки не должны переживать прогон ни при каком исходе. */
export function partFiles(dir: string): string[] {
  return listNames(dir).filter((name) => name.endsWith('.part') || name.endsWith('.tmp'));
}
