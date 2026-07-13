import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findConfigurations, type ConfigEntry } from '../../infra/fs/ConfigLocator';
import { canonicalRootPath } from '../../domain/CanonicalNames';
// ВЕХА 1 «Изменения метаданных», компонент №3 и №4 плана.
// Оба модуля ещё не реализованы.
import { resolveFilePart } from '../../infra/git/MetadataChangeResolver';
import { parsePorcelain } from '../../infra/git/GitPorcelainReader';
import {
  aggregateMetadataChanges,
  type ChangesModel,
  type ObjectChangeGroup,
  type PartChange,
  type RawChange,
} from '../../infra/git/MetadataChangeAggregator';

/**
 * Реальный временный git-репозиторий со штатной структурой `src/cf`, собранной
 * из подмножества реальных фикстур `example/2.21/src/cf/Catalogs`. Проверяем
 * агрегацию изменений `git status --porcelain` в объектные группы на РЕАЛЬНОМ
 * git-процессе — без моков.
 */
const FIXTURES_DIR = path.resolve(__dirname, '../../../example/2.21/src/cf/Catalogs');
const CONFIGURATION_XML = path.resolve(__dirname, '../../../example/2.21/src/cf/Configuration.xml');

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function appendLine(filePath: string, line: string): void {
  fs.appendFileSync(filePath, `\n${line}\n`, 'utf-8');
}

interface Fixture {
  workspaceRoot: string;
  cfRoot: string;
  objectModuleBsl: string;
  commandModuleBsl: string;
  deletedFormXml: string;
  newCatalogXml: string;
  unresolvedInsideConfigRoot: string;
  unresolvedOutsideConfigRoot: string;
}

function buildFixtureRepo(): Fixture {
  // realpathSync: см. комментарий в gitPorcelainReader.test.ts — иначе абсолютные
  // пути разойдутся с тем, что вернёт реальный git-процесс на macOS.
  const workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-change-aggregator-')));
  const cfRoot = path.join(workspaceRoot, 'src', 'cf');
  const catalogsDir = path.join(cfRoot, 'Catalogs');
  fs.mkdirSync(catalogsDir, { recursive: true });

  // Configuration.xml нужен только как маркер для ConfigLocator — содержимое
  // реальное (не выдумано), но не разбирается ни резолвером, ни агрегатором.
  fs.copyFileSync(CONFIGURATION_XML, path.join(cfRoot, 'Configuration.xml'));

  // Объект №1 — «ПричиныВозврата»: реальный маленький справочник с модулем
  // объекта, менеджера и командой (несколько частей на один объект).
  fs.copyFileSync(path.join(FIXTURES_DIR, 'ПричиныВозврата.xml'), path.join(catalogsDir, 'ПричиныВозврата.xml'));
  fs.cpSync(path.join(FIXTURES_DIR, 'ПричиныВозврата'), path.join(catalogsDir, 'ПричиныВозврата'), { recursive: true });

  // Объект №2 — «РолиКонтактныхЛиц»: реальный справочник с формами (для сценария
  // удаления файла формы).
  fs.copyFileSync(path.join(FIXTURES_DIR, 'РолиКонтактныхЛиц.xml'), path.join(catalogsDir, 'РолиКонтактныхЛиц.xml'));
  fs.cpSync(path.join(FIXTURES_DIR, 'РолиКонтактныхЛиц'), path.join(catalogsDir, 'РолиКонтактныхЛиц'), { recursive: true });

  git(workspaceRoot, ['init', '-q']);
  git(workspaceRoot, ['config', 'user.email', 'test@test.local']);
  git(workspaceRoot, ['config', 'user.name', 'test']);
  // Реальные XML/BSL-фикстуры хранятся с CRLF — фиксируем autocrlf=false, чтобы
  // тест не зависел от глобального git-конфига разработчика.
  git(workspaceRoot, ['config', 'core.autocrlf', 'false']);
  git(workspaceRoot, ['add', '-A']);
  git(workspaceRoot, ['commit', '-q', '-m', 'baseline']);

  const objectModuleBsl = path.join(catalogsDir, 'ПричиныВозврата', 'Ext', 'ObjectModule.bsl');
  const commandModuleBsl = path.join(
    catalogsDir, 'ПричиныВозврата', 'Commands', 'ПричиныВозврата', 'Ext', 'CommandModule.bsl'
  );
  const deletedFormXml = path.join(catalogsDir, 'РолиКонтактныхЛиц', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');

  // 1. Модуль объекта правится и индексируется (staged-only, M ).
  appendLine(objectModuleBsl, '// правка модуля объекта');
  git(workspaceRoot, ['add', path.relative(workspaceRoot, objectModuleBsl)]);

  // 2. Модуль команды того же объекта: сначала правится и индексируется,
  //    затем правится ЕЩЁ раз без индексации — получаем код `MM`, требование
  //    «файл в состоянии MM присутствует и в staged, и в unstaged».
  appendLine(commandModuleBsl, '// первая правка — попадёт в индекс');
  git(workspaceRoot, ['add', path.relative(workspaceRoot, commandModuleBsl)]);
  appendLine(commandModuleBsl, '// вторая правка — только в рабочем дереве');

  // 3. Удаление файла формы другого объекта — только в рабочем дереве.
  fs.rmSync(deletedFormXml);

  // 4. Новый объект метаданных целиком — добавлен и застейджен.
  const newCatalogXml = path.join(catalogsDir, 'НовыйСправочник.xml');
  fs.copyFileSync(path.join(FIXTURES_DIR, 'ВидыРесурсовПредприятия.xml'), newCatalogXml);
  git(workspaceRoot, ['add', path.relative(workspaceRoot, newCatalogXml)]);

  // 5. Файл внутри configRoot, не относящийся ни к одному объекту метаданных.
  const unresolvedInsideConfigRoot = path.join(cfRoot, 'RANDOM_NOTES.txt');
  fs.writeFileSync(unresolvedInsideConfigRoot, 'служебная заметка вне структуры выгрузки\n', 'utf-8');

  // 6. Файл целиком вне выгрузки (вне src/cf и src/cfe/*).
  const unresolvedOutsideConfigRoot = path.join(workspaceRoot, 'README.md');
  fs.writeFileSync(unresolvedOutsideConfigRoot, '# заметка на уровне воркспейса\n', 'utf-8');

  return {
    workspaceRoot,
    cfRoot,
    objectModuleBsl,
    commandModuleBsl,
    deletedFormXml,
    newCatalogXml,
    unresolvedInsideConfigRoot,
    unresolvedOutsideConfigRoot,
  };
}

suite('MetadataChangeAggregator — агрегация изменений на реальном git-репозитории', () => {
  let fixture: Fixture;
  let model: ChangesModel;

  suiteSetup(() => {
    fixture = buildFixtureRepo();
    const output = git(fixture.workspaceRoot, ['status', '--porcelain', '--untracked-files=all']);
    const entries = parsePorcelain(output);
    const configRoots = findConfigurations(fixture.workspaceRoot);
    assert.strictEqual(configRoots.length, 1, 'должен найтись ровно один config-root (src/cf)');

    model = aggregateMetadataChanges(entries, fixture.workspaceRoot, configRoots);
  });

  suiteTeardown(() => {
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  });

  function findGroup(list: readonly ObjectChangeGroup[], canonicalPath: string): ObjectChangeGroup {
    const found = list.filter((g: ObjectChangeGroup) => g.canonicalPath === canonicalPath);
    assert.strictEqual(found.length, 1, `ожидалась ровно одна группа «${canonicalPath}», найдено ${String(found.length)}`);
    return found[0];
  }

  function filesOfParts(parts: readonly PartChange[]): string[] {
    return parts.flatMap((p: PartChange) => p.files.map((f: string) => path.resolve(fixture.workspaceRoot, f)));
  }

  test('объект «ПричиныВозврата» присутствует и в staged, и в unstaged (файл в состоянии MM)', () => {
    const canon = canonicalRootPath('Catalog', 'ПричиныВозврата');
    const staged = findGroup(model.staged, canon);
    const unstaged = findGroup(model.unstaged, canon);

    assert.strictEqual(staged.rootKind, 'Catalog');
    assert.strictEqual(staged.rootName, 'ПричиныВозврата');
    assert.strictEqual(staged.configRoot, fixture.cfRoot);

    // В staged должны попасть ОБЕ застейдженные части: модуль объекта (M )
    // и первая правка модуля команды (M из MM).
    assert.strictEqual(staged.parts.length, 2, `ожидалось 2 части в staged, получено ${String(staged.parts.length)}`);
    const stagedFiles = filesOfParts(staged.parts);
    assert.ok(stagedFiles.some((f: string) => f === fixture.objectModuleBsl), 'модуль объекта должен быть среди staged-файлов');
    assert.ok(stagedFiles.some((f: string) => f === fixture.commandModuleBsl), 'модуль команды должен быть среди staged-файлов');
    for (const part of staged.parts) {
      assert.strictEqual(part.status, 'M');
    }
    assert.strictEqual(staged.aggregateStatus, 'M');

    // В unstaged — только вторая правка модуля команды (M из MM);
    // модуль объекта в рабочем дереве больше не менялся.
    assert.strictEqual(unstaged.parts.length, 1, `ожидалась 1 часть в unstaged, получено ${String(unstaged.parts.length)}`);
    const unstagedFiles = filesOfParts(unstaged.parts);
    assert.ok(unstagedFiles.some((f: string) => f === fixture.commandModuleBsl));
    assert.ok(!unstagedFiles.some((f: string) => f === fixture.objectModuleBsl), 'модуль объекта не должен быть в unstaged');
    assert.strictEqual(unstaged.parts[0].status, 'M');
    assert.strictEqual(unstaged.aggregateStatus, 'M');
  });

  test('части группы согласованы с MetadataChangeResolver (partLabel не изобретается заново)', () => {
    const canon = canonicalRootPath('Catalog', 'ПричиныВозврата');
    const staged = findGroup(model.staged, canon);
    const objectModulePart = staged.parts.find((p: PartChange) =>
      p.files.some((f: string) => path.resolve(fixture.workspaceRoot, f) === fixture.objectModuleBsl)
    );
    assert.ok(objectModulePart, 'часть для модуля объекта должна найтись');

    const resolved = resolveFilePart(fixture.cfRoot, fixture.objectModuleBsl);
    assert.ok(resolved);
    assert.strictEqual(objectModulePart.partLabel, resolved.partLabel);
  });

  test('объект «РолиКонтактныхЛиц» — удалённый файл формы попадает только в unstaged со статусом D', () => {
    const canon = canonicalRootPath('Catalog', 'РолиКонтактныхЛиц');
    const unstaged = findGroup(model.unstaged, canon);

    assert.strictEqual(unstaged.parts.length, 1);
    assert.strictEqual(unstaged.parts[0].status, 'D');
    const files = unstaged.parts[0].files.map((f: string) => path.resolve(fixture.workspaceRoot, f));
    assert.ok(files.some((f: string) => f === fixture.deletedFormXml));
    assert.strictEqual(unstaged.aggregateStatus, 'D');

    assert.strictEqual(
      model.staged.some((g: ObjectChangeGroup) => g.canonicalPath === canon),
      false,
      'объект не должен появляться в staged — удаление не индексировано'
    );
  });

  test('новый объект «НовыйСправочник» — добавлен и застейджен целиком (part=objectProperties, статус A)', () => {
    const canon = canonicalRootPath('Catalog', 'НовыйСправочник');
    const staged = findGroup(model.staged, canon);

    assert.strictEqual(staged.parts.length, 1);
    assert.strictEqual(staged.parts[0].status, 'A');
    const files = staged.parts[0].files.map((f: string) => path.resolve(fixture.workspaceRoot, f));
    assert.ok(files.some((f: string) => f === fixture.newCatalogXml));
    assert.strictEqual(staged.aggregateStatus, 'A');
  });

  test('удаление, застейдженное в индекс (index=D) — часть объекта получает статус D в staged', () => {
    // Отдельный маленький репозиторий: `git rm --cached` застейдживает удаление
    // без изменения рабочего дерева, чего не происходит в общем suiteSetup-фикстуре.
    const workspaceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-change-aggregator-staged-del-')));
    try {
      const cfRoot = path.join(workspaceRoot, 'src', 'cf');
      const catalogsDir = path.join(cfRoot, 'Catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      fs.copyFileSync(CONFIGURATION_XML, path.join(cfRoot, 'Configuration.xml'));
      fs.copyFileSync(path.join(FIXTURES_DIR, 'ПричиныВозврата.xml'), path.join(catalogsDir, 'ПричиныВозврата.xml'));
      fs.cpSync(path.join(FIXTURES_DIR, 'ПричиныВозврата'), path.join(catalogsDir, 'ПричиныВозврата'), { recursive: true });

      git(workspaceRoot, ['init', '-q']);
      git(workspaceRoot, ['config', 'user.email', 'test@test.local']);
      git(workspaceRoot, ['config', 'user.name', 'test']);
      git(workspaceRoot, ['config', 'core.autocrlf', 'false']);
      git(workspaceRoot, ['add', '-A']);
      git(workspaceRoot, ['commit', '-q', '-m', 'baseline']);

      const objectModuleBsl = path.join(catalogsDir, 'ПричиныВозврата', 'Ext', 'ObjectModule.bsl');
      // index=D, worktree=пробел: файл удалён и удаление сразу застейджено.
      git(workspaceRoot, ['rm', '--cached', '-q', path.relative(workspaceRoot, objectModuleBsl)]);
      fs.rmSync(objectModuleBsl);

      const output = git(workspaceRoot, ['status', '--porcelain', '--untracked-files=all']);
      const entries = parsePorcelain(output);
      const configRoots = findConfigurations(workspaceRoot);

      const model = aggregateMetadataChanges(entries, workspaceRoot, configRoots);
      const canon = canonicalRootPath('Catalog', 'ПричиныВозврата');
      const staged = findGroup(model.staged, canon);

      assert.strictEqual(staged.parts.length, 1);
      assert.strictEqual(staged.parts[0].status, 'D');
      assert.strictEqual(staged.aggregateStatus, 'D');
      assert.strictEqual(
        model.unstaged.some((g: ObjectChangeGroup) => g.canonicalPath === canon),
        false,
        'удаление полностью застейджено — в unstaged объект появляться не должен'
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test('вложенные configRoots — findOwningConfigRoot выбирает более длинный (более специфичный) корень', () => {
    // Синтетический, но РЕАЛЬНЫЙ на диске случай: конфиг-корень вложен в другой
    // конфиг-корень (например workspace целиком и src/cf внутри него). Порядок
    // в configRoots — от внешнего к внутреннему, как может вернуть обход ФС.
    const outerRoot = fixture.workspaceRoot;
    const innerRoot = fixture.cfRoot;
    const configRoots: ConfigEntry[] = [
      { rootPath: outerRoot, kind: 'cf' },
      { rootPath: innerRoot, kind: 'cf' },
    ];

    const output = git(fixture.workspaceRoot, ['status', '--porcelain', '--untracked-files=all']);
    const entries = parsePorcelain(output);
    const model = aggregateMetadataChanges(entries, fixture.workspaceRoot, configRoots);

    const canon = canonicalRootPath('Catalog', 'ПричиныВозврата');
    const staged = findGroup(model.staged, canon);
    assert.strictEqual(staged.configRoot, innerRoot, 'должен быть выбран более специфичный (длинный) конфиг-корень');
  });

  test('переименование (R): схлопывается в M только по НОВОМУ пути; старый путь не отражён (ограничение, итерация 2)', () => {
    // Характеризационный тест текущего поведения: агрегатор берёт из porcelain
    // только путь назначения переименования (relPath), а oldRelPath игнорирует.
    // Следствие-ограничение: stage/discard по такому узлу не затронет старый путь.
    // Полная поддержка rename отложена (см. долг «rename, итерация 2»).
    const configRoots = findConfigurations(fixture.workspaceRoot);
    const oldRel = 'src/cf/Catalogs/СтароеИмя.xml';
    const newRel = 'src/cf/Catalogs/ПричиныВозврата.xml';
    const entries = parsePorcelain(`R  ${oldRel} -> ${newRel}\n`);
    assert.strictEqual(entries[0].oldRelPath, oldRel, 'парсер сохраняет старый путь переименования');

    const renameModel = aggregateMetadataChanges(entries, fixture.workspaceRoot, configRoots);
    const canon = canonicalRootPath('Catalog', 'ПричиныВозврата');
    const staged = findGroup(renameModel.staged, canon);
    assert.strictEqual(staged.aggregateStatus, 'M', 'R схлопывается в M');
    const files = staged.parts.flatMap((p: PartChange) => p.files);
    assert.deepStrictEqual(
      files,
      [newRel],
      'учитывается только новый путь; старый путь переименования в группу не попадает (ограничение)'
    );
  });

  test('файлы вне структуры выгрузки (внутри и вне configRoot) попадают в unresolved', () => {
    const unresolvedAbsPaths = model.unresolved.map((r: RawChange) => path.resolve(fixture.workspaceRoot, r.relPath));
    assert.ok(
      unresolvedAbsPaths.some((p: string) => p === fixture.unresolvedInsideConfigRoot),
      'файл внутри configRoot без разбора резолвером должен попасть в unresolved'
    );
    assert.ok(
      unresolvedAbsPaths.some((p: string) => p === fixture.unresolvedOutsideConfigRoot),
      'файл вне всех configRoot должен попасть в unresolved'
    );
  });
});
