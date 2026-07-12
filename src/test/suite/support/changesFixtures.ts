import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConfigurations, type ConfigEntry } from '../../../infra/fs/ConfigLocator';

/**
 * Общий фундамент фикстур для тестов ВЕХИ 2 (UI-слой представления «Изменения
 * метаданных»): реальный временный git-репозиторий со штатной структурой
 * `src/cf`, собранной из подмножества реальных фикстур
 * `example/2.21/src/cf/Catalogs` (те же объекты, что использует
 * `metadataChangeAggregator.test.ts` в ВЕХЕ 1 — «ПричиныВозврата» с модулями
 * объекта/менеджера/команды и «РолиКонтактныхЛиц» с формами).
 *
 * Вынесено в support, чтобы каждый test-файл провайдера/узла/команд не
 * дублировал построение репозитория — сами git-мутации (что именно правится/
 * стейджится/удаляется) остаются в конкретном тесте.
 */
const FIXTURES_DIR = path.resolve(__dirname, '../../../../example/2.21/src/cf/Catalogs');
const CONFIGURATION_XML = path.resolve(__dirname, '../../../../example/2.21/src/cf/Configuration.xml');
// Общий модуль для веток «Общее → Общие модули → …» навигаторной иерархии —
// используется тестами дерева представления «Изменения метаданных» (ВЕХА 2),
// не нужен агрегатору ВЕХИ 1, поэтому вынесен отдельной константой.
const COMMON_MODULES_FIXTURES_DIR = path.resolve(__dirname, '../../../../example/2.21/src/cf/CommonModules');

export function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

/**
 * Статус одного файла по `git status --porcelain` (пустая строка — файл чист).
 * Обрезаем ТОЛЬКО завершающий перевод строки — см. обоснование в
 * `gitWriteService.test.ts`: `trim()` снёс бы значащий ведущий пробел кода статуса.
 */
export function statusOf(repo: string, relPath: string): string {
  const output = git(repo, ['status', '--porcelain', '--', relPath]);
  return output.replace(/\r?\n$/, '');
}

export function appendLine(filePath: string, line: string): void {
  fs.appendFileSync(filePath, `\n${line}\n`, 'utf-8');
}

export interface ChangesFixture {
  readonly workspaceRoot: string;
  readonly gitRoot: string;
  readonly cfRoot: string;
  readonly catalogsDir: string;
  readonly configRoots: ConfigEntry[];
  /** `Catalogs/ПричиныВозврата/Ext/ObjectModule.bsl` — модуль объекта. */
  readonly objectModuleBsl: string;
  /** `Catalogs/ПричиныВозврата/Commands/ПричиныВозврата/Ext/CommandModule.bsl` — модуль команды того же объекта. */
  readonly commandModuleBsl: string;
  /** `Catalogs/РолиКонтактныхЛиц/Forms/ФормаЭлемента/Ext/Form.xml` — описание формы другого объекта. */
  readonly formXml: string;
  /** `CommonModules/GoogleПереводчик/Ext/Module.bsl` — модуль общего модуля (ветка «Общее → Общие модули»). */
  readonly commonModuleBsl: string;
}

/** Собирает временный репозиторий с baseline-коммитом; рабочее дерево ещё чистое. */
export function buildChangesBaselineRepo(): ChangesFixture {
  // realpathSync: macOS резолвит /tmp в /private/tmp — без этого абсолютные пути
  // из наших вычислений разойдутся с тем, что вернёт git (см. gitPorcelainReader.test.ts).
  const workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-changes-ui-')));
  const cfRoot = path.join(workspaceRoot, 'src', 'cf');
  const catalogsDir = path.join(cfRoot, 'Catalogs');
  fs.mkdirSync(catalogsDir, { recursive: true });

  fs.copyFileSync(CONFIGURATION_XML, path.join(cfRoot, 'Configuration.xml'));

  fs.copyFileSync(path.join(FIXTURES_DIR, 'ПричиныВозврата.xml'), path.join(catalogsDir, 'ПричиныВозврата.xml'));
  fs.cpSync(path.join(FIXTURES_DIR, 'ПричиныВозврата'), path.join(catalogsDir, 'ПричиныВозврата'), { recursive: true });

  fs.copyFileSync(path.join(FIXTURES_DIR, 'РолиКонтактныхЛиц.xml'), path.join(catalogsDir, 'РолиКонтактныхЛиц.xml'));
  fs.cpSync(path.join(FIXTURES_DIR, 'РолиКонтактныхЛиц'), path.join(catalogsDir, 'РолиКонтактныхЛиц'), { recursive: true });

  const commonModulesDir = path.join(cfRoot, 'CommonModules');
  fs.mkdirSync(commonModulesDir, { recursive: true });
  fs.copyFileSync(
    path.join(COMMON_MODULES_FIXTURES_DIR, 'GoogleПереводчик.xml'),
    path.join(commonModulesDir, 'GoogleПереводчик.xml')
  );
  fs.cpSync(
    path.join(COMMON_MODULES_FIXTURES_DIR, 'GoogleПереводчик'),
    path.join(commonModulesDir, 'GoogleПереводчик'),
    { recursive: true }
  );

  git(workspaceRoot, ['init', '-q']);
  git(workspaceRoot, ['config', 'user.email', 'test@test.local']);
  git(workspaceRoot, ['config', 'user.name', 'test']);
  // Реальные XML/BSL-фикстуры хранятся с CRLF — фиксируем autocrlf=false, чтобы
  // тест не зависел от глобального git-конфига разработчика (см. metadataChangeAggregator.test.ts).
  git(workspaceRoot, ['config', 'core.autocrlf', 'false']);
  // quotepath=false — иначе git выводит кириллические пути выгрузки в octal-escape
  // (`\320\237…`), и сырой `git status --porcelain` в `statusOf` не совпадает с
  // ожидаемыми литеральными именами объектов метаданных.
  git(workspaceRoot, ['config', 'core.quotepath', 'false']);
  git(workspaceRoot, ['add', '-A']);
  git(workspaceRoot, ['commit', '-q', '-m', 'baseline']);

  const configRoots = findConfigurations(workspaceRoot);

  return {
    workspaceRoot,
    gitRoot: workspaceRoot,
    cfRoot,
    catalogsDir,
    configRoots,
    objectModuleBsl: path.join(catalogsDir, 'ПричиныВозврата', 'Ext', 'ObjectModule.bsl'),
    commandModuleBsl: path.join(
      catalogsDir, 'ПричиныВозврата', 'Commands', 'ПричиныВозврата', 'Ext', 'CommandModule.bsl'
    ),
    formXml: path.join(catalogsDir, 'РолиКонтактныхЛиц', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml'),
    commonModuleBsl: path.join(commonModulesDir, 'GoogleПереводчик', 'Ext', 'Module.bsl'),
  };
}

export function removeFixtureRepo(fixture: ChangesFixture): void {
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}
