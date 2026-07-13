import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitMetadataStatusService } from '../../infra/git/GitMetadataStatusService';

/**
 * Дополняет `gitMetadataStatusServiceCharacterization.test.ts` (сфокусирован на
 * `kind: 'paths'`) веткам, которые он не задевает: `clear()`/`invalidate()`,
 * `kind: 'child'`/`kind: 'group'`, агрегация каталога (`kind: 'paths'` на
 * директорию), поведение при отсутствии git и при исчезновении `.git` между
 * вызовами. Все сценарии — на реальных временных git-репозиториях и реальных
 * XML-фикстурах `example/2.21/src/cf/Catalogs`, без моков git-процесса.
 */

const FIXTURES_DIR = path.resolve(__dirname, '../../../example/2.21/src/cf/Catalogs');
const ROLES_FIXTURE = path.join(FIXTURES_DIR, 'РолиКонтактныхЛиц.xml');
const TABULAR_SECTION_FIXTURE = path.join(FIXTURES_DIR, 'КолонкиКалендарейСотрудников.xml');
const HTTP_SERVICE_FIXTURE = path.resolve(__dirname, '../../../example/2.21/src/cf/HTTPServices/Chatbot.xml');

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
}

function tmpRepo(prefix: string): string {
  // realpathSync: см. gitPorcelainReader.test.ts — иначе /tmp на macOS разойдётся
  // с тем, что вернёт `git rev-parse --show-toplevel`.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Готовит репозиторий с одним закоммиченным реальным объектом-справочником. */
function buildBaselineRepo(): { repo: string; catalogsDir: string; xmlPath: string } {
  const repo = tmpRepo('v8vscedit-status-cov-');
  const catalogsDir = path.join(repo, 'Catalogs');
  fs.mkdirSync(catalogsDir, { recursive: true });
  const xmlPath = path.join(catalogsDir, 'РолиКонтактныхЛиц.xml');
  fs.copyFileSync(ROLES_FIXTURE, xmlPath);

  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@test.local']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'baseline']);

  return { repo, catalogsDir, xmlPath };
}

suite('GitMetadataStatusService — дополнительное покрытие (clear/invalidate/child/group/directory)', () => {
  test('clear() сбрасывает весь кэш: устаревший статус до вызова, актуальный — после', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);

      const before = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
      assert.strictEqual(before, undefined, 'файл чист сразу после коммита');

      fs.appendFileSync(xmlPath, '\n<!-- правка после прогрева кэша -->\n', 'utf-8');
      const stale = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
      assert.strictEqual(stale, undefined, 'без clear()/invalidate() batch-карта не перечитывается — статус остаётся устаревшим');

      service.clear();
      const fresh = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
      assert.strictEqual(fresh, 'modified', 'после clear() статус должен быть пересчитан по актуальному git status');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('invalidate([]) — no-op, не бросает исключение и не трогает уже прогретую карту', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);
      service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });

      assert.doesNotThrow(() => { service.invalidate([]); });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('invalidate([путь]) точечно форсирует новый git status для затронутого файла', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);
      const before = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
      assert.strictEqual(before, undefined);

      fs.appendFileSync(xmlPath, '\n<!-- правка после прогрева кэша -->\n', 'utf-8');
      service.invalidate([xmlPath]);

      const after = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
      assert.strictEqual(after, 'modified', 'invalidate() должен форсировать перечитывание batch-карты');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child на неизменённом файле — undefined без обращения к содержимому XML', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Attribute', name: 'Описание' });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child без name — undefined (даже если файл изменён)', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      fs.appendFileSync(xmlPath, '\n<!-- правка -->\n', 'utf-8');
      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Attribute' });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child на untracked-файле — added без чтения HEAD', () => {
    const { repo, catalogsDir } = buildBaselineRepo();
    try {
      const neverCommitted = path.join(catalogsDir, 'НикогдаНеКоммичен.xml');
      fs.copyFileSync(ROLES_FIXTURE, neverCommitted);

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'child',
        ownerXmlPath: neverCommitted,
        childKind: 'Attribute',
        name: 'Описание',
      });
      assert.strictEqual(status, 'added');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child: реквизит добавлен в уже изменённый (не полностью новый) файл — added', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const original = fs.readFileSync(xmlPath, 'utf-8');
      const attributeStart = original.indexOf('<Attribute uuid="db75f176-baf0-4b29-a8f2-be36560f7cc7">');
      const attributeEnd = original.indexOf('</Attribute>', attributeStart) + '</Attribute>'.length;
      assert.ok(attributeStart !== -1 && attributeEnd > attributeStart);
      const attributeBlock = original.slice(attributeStart, attributeEnd);

      // Дублируем реальный блок реквизита под новым именем/uuid — тот же
      // валидный XML-фрагмент 1С, просто с изменённым <Name> (не выдуманная схема).
      const duplicatedBlock = attributeBlock
        .replace('<Name>Описание</Name>', '<Name>ОписаниеДоп</Name>')
        .replace('db75f176-baf0-4b29-a8f2-be36560f7cc7', 'db75f176-baf0-4b29-a8f2-be36560f7cc8');
      const withNewAttribute = original.replace('</ChildObjects>', `${duplicatedBlock}\n\t\t\t</ChildObjects>`);
      fs.writeFileSync(xmlPath, withNewAttribute, 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Attribute', name: 'ОписаниеДоп' });
      assert.strictEqual(status, 'added', 'реквизит присутствует только в текущей версии файла');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child: реквизит удалён из ещё существующего файла — deleted', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const original = fs.readFileSync(xmlPath, 'utf-8');
      const attributeStart = original.indexOf('<Attribute uuid="db75f176-baf0-4b29-a8f2-be36560f7cc7">');
      const attributeEnd = original.indexOf('</Attribute>', attributeStart) + '</Attribute>'.length;
      assert.ok(attributeStart !== -1 && attributeEnd > attributeStart);
      const withoutAttribute = original.slice(0, attributeStart) + original.slice(attributeEnd);
      fs.writeFileSync(xmlPath, withoutAttribute, 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Attribute', name: 'Описание' });
      assert.strictEqual(status, 'deleted', 'реквизит присутствовал в HEAD, в текущей версии файла отсутствует');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child: файл целиком удалён с диска — deleted (extractTargetXml получает null вместо текущего XML)', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      fs.rmSync(xmlPath);

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Attribute', name: 'Описание' });
      assert.strictEqual(status, 'deleted');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=group: файл изменён, но ВНЕ запрошенной группы (Comment объекта, не Attribute) — undefined', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const original = fs.readFileSync(xmlPath, 'utf-8');
      // Правим <Comment/> объекта — это ВНЕ <ChildObjects>, поэтому реквизиты
      // (группа childKind='Attribute') остаются идентичными current/HEAD, а файл
      // в целом всё равно "изменён" (fileChanged=true у снапшота).
      const beforeChildObjects = original.indexOf('<ChildObjects>');
      assert.ok(original.slice(0, beforeChildObjects).includes('<Comment/>'));
      const withCommentEdit = original.replace(
        '<Comment/>',
        '<Comment>правка комментария объекта</Comment>'
      );
      assert.notStrictEqual(withCommentEdit, original);
      fs.writeFileSync(xmlPath, withCommentEdit, 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'group', ownerXmlPath: xmlPath, childKind: 'Attribute' });
      assert.strictEqual(status, undefined, 'группа «Реквизиты» не изменилась — правка была вне ChildObjects');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=group на untracked-файле — modified (агрегат группы: fileAdded короткое замыкание)', () => {
    const { repo, catalogsDir } = buildBaselineRepo();
    try {
      const neverCommitted = path.join(catalogsDir, 'НикогдаНеКоммичен.xml');
      fs.copyFileSync(ROLES_FIXTURE, neverCommitted);

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'group', ownerXmlPath: neverCommitted, childKind: 'Attribute' });
      assert.strictEqual(status, 'modified');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=group: содержимое реквизита изменилось внутри файла — modified', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const original = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(original.includes('<MultiLine>true</MultiLine>'));
      fs.writeFileSync(xmlPath, original.replace('<MultiLine>true</MultiLine>', '<MultiLine>false</MultiLine>'), 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'group', ownerXmlPath: xmlPath, childKind: 'Attribute' });
      assert.strictEqual(status, 'modified');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=group: файл целиком удалён — modified (extractGroupXml получает null вместо текущего XML)', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      fs.rmSync(xmlPath);

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'group', ownerXmlPath: xmlPath, childKind: 'Attribute' });
      assert.strictEqual(status, 'modified');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child, childKind=Column: колонка табличной части изменена — modified (nesting-aware извлечение через tabularSectionName)', () => {
    const repo = tmpRepo('v8vscedit-status-cov-column-');
    try {
      const catalogsDir = path.join(repo, 'Catalogs');
      fs.mkdirSync(catalogsDir, { recursive: true });
      const xmlPath = path.join(catalogsDir, 'КолонкиКалендарейСотрудников.xml');
      fs.copyFileSync(TABULAR_SECTION_FIXTURE, xmlPath);
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'test@test.local']);
      git(repo, ['config', 'user.name', 'test']);
      // Реальные XML-фикстуры хранятся с CRLF — фиксируем autocrlf=false, иначе
      // git нормализует концы строк при add и файл окажется "изменён" сразу
      // после коммита (см. обоснование в changesFixtures.ts).
      git(repo, ['config', 'core.autocrlf', 'false']);
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'baseline']);

      const original = fs.readFileSync(xmlPath, 'utf-8');
      // `<MultiLine>false</MultiLine>` встречается в файле несколько раз (у разных
      // реквизитов/колонок) — правим ИМЕННО в блоке колонки «СостояниеЗадачи»,
      // а не первое попавшееся вхождение (иначе правка попадёт мимо запрошенной части).
      const columnStart = original.indexOf('<Attribute uuid="03a93493-d9b7-45c7-817d-2ebad4e9ddef">');
      const columnEnd = original.indexOf('</Attribute>', columnStart) + '</Attribute>'.length;
      assert.ok(columnStart !== -1 && columnEnd > columnStart);
      const columnBlock = original.slice(columnStart, columnEnd);
      assert.ok(columnBlock.includes('<Name>СостояниеЗадачи</Name>'));
      assert.ok(columnBlock.includes('<MultiLine>false</MultiLine>'));
      const patchedColumnBlock = columnBlock.replace('<MultiLine>false</MultiLine>', '<MultiLine>true</MultiLine>');
      const withPatchedColumn = original.slice(0, columnStart) + patchedColumnBlock + original.slice(columnEnd);
      fs.writeFileSync(xmlPath, withPatchedColumn, 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'child',
        ownerXmlPath: xmlPath,
        childKind: 'Column',
        name: 'СостояниеЗадачи',
        tabularSectionName: 'ПравилаКолонки',
      });
      assert.strictEqual(status, 'modified');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child, childKind=Method: метод URL-шаблона HTTP-сервиса изменён — modified (nesting-aware извлечение через urlTemplateName)', () => {
    const repo = tmpRepo('v8vscedit-status-cov-method-');
    try {
      const servicesDir = path.join(repo, 'HTTPServices');
      fs.mkdirSync(servicesDir, { recursive: true });
      const xmlPath = path.join(servicesDir, 'Chatbot.xml');
      fs.copyFileSync(HTTP_SERVICE_FIXTURE, xmlPath);
      git(repo, ['init', '-q']);
      git(repo, ['config', 'user.email', 'test@test.local']);
      git(repo, ['config', 'user.name', 'test']);
      // Реальные XML-фикстуры хранятся с CRLF — фиксируем autocrlf=false, иначе
      // git нормализует концы строк при add и файл окажется "изменён" сразу
      // после коммита (см. обоснование в changesFixtures.ts).
      git(repo, ['config', 'core.autocrlf', 'false']);
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'baseline']);

      const original = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(original.includes('<Handler>TelegramPost</Handler>'));
      fs.writeFileSync(xmlPath, original.replace('<Handler>TelegramPost</Handler>', '<Handler>TelegramPostV2</Handler>'), 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'child',
        ownerXmlPath: xmlPath,
        childKind: 'Method',
        name: 'POST',
        urlTemplateName: 'telegram',
      });
      assert.strictEqual(status, 'modified');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('getFileDecorationStatus/getDirectoryStatus вне git-репозитория — undefined без исключения', () => {
    const outsideAnyRepo = tmpRepo('v8vscedit-status-cov-no-git-');
    try {
      fs.mkdirSync(path.join(outsideAnyRepo, 'Catalogs'));
      const service = new GitMetadataStatusService(outsideAnyRepo);

      const status = service.getStatus({
        kind: 'paths',
        ownerXmlPath: path.join(outsideAnyRepo, 'Catalogs'),
        childKind: 'Attribute',
        paths: [path.join(outsideAnyRepo, 'Catalogs')],
      });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(outsideAnyRepo, { recursive: true, force: true });
    }
  });

  test('getDirectoryStatus: чистый репозиторий (statusByPath пуст) — undefined', () => {
    const { repo, catalogsDir } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'paths',
        ownerXmlPath: catalogsDir,
        childKind: 'Attribute',
        paths: [catalogsDir],
      });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('getDirectoryStatus: изменения есть, но не под запрошенным каталогом (continue по префиксу) — undefined', () => {
    const { repo, catalogsDir } = buildBaselineRepo();
    try {
      const unrelatedDir = path.join(repo, 'Documents');
      fs.mkdirSync(unrelatedDir, { recursive: true });
      fs.writeFileSync(path.join(unrelatedDir, 'НовыйДокумент.xml'), 'содержимое\n', 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'paths',
        ownerXmlPath: catalogsDir,
        childKind: 'Attribute',
        paths: [catalogsDir],
      });
      assert.strictEqual(status, undefined, 'изменения в Documents не должны отражаться на агрегате Catalogs');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('getDirectoryStatus: только добавленные файлы внутри каталога — added', () => {
    const { repo } = buildBaselineRepo();
    try {
      const onlyAddedDir = path.join(repo, 'Documents');
      fs.mkdirSync(onlyAddedDir, { recursive: true });
      fs.writeFileSync(path.join(onlyAddedDir, 'НовыйДокумент.xml'), 'содержимое\n', 'utf-8');

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'paths',
        ownerXmlPath: onlyAddedDir,
        childKind: 'Attribute',
        paths: [onlyAddedDir],
      });
      assert.strictEqual(status, 'added');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('getDirectoryStatus: только удалённые файлы внутри каталога — deleted', () => {
    const { repo } = buildBaselineRepo();
    try {
      const onlyDeletedDir = path.join(repo, 'OnlyDeleted');
      fs.mkdirSync(onlyDeletedDir, { recursive: true });
      const toDelete = path.join(onlyDeletedDir, 'file.xml');
      fs.copyFileSync(ROLES_FIXTURE, toDelete);
      git(repo, ['add', '-A']);
      git(repo, ['commit', '-q', '-m', 'add file to delete']);
      fs.rmSync(toDelete);

      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({
        kind: 'paths',
        ownerXmlPath: onlyDeletedDir,
        childKind: 'Attribute',
        paths: [onlyDeletedDir],
      });
      assert.strictEqual(status, 'deleted');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=paths без массива paths — undefined (fallback target.paths ?? [] на пустой список)', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);
      // target.paths не задан вовсе: getPathsStatus получает [] через `?? []`
      // и агрегирует пустой список → статуса нет.
      const status = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute' });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child, childKind=Column без tabularSectionName — undefined (колонку негде искать без контейнера ТЧ)', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      // Файл изменён (fileChanged=true), но у Column-цели нет tabularSectionName —
      // extractTargetXml не может локализовать колонку и возвращает null для обеих
      // версий, значит различий не найдено → статус undefined.
      fs.appendFileSync(xmlPath, '\n<!-- правка -->\n', 'utf-8');
      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Column', name: 'СостояниеЗадачи' });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('kind=child, childKind=Method без urlTemplateName — undefined (метод негде искать без контейнера URL-шаблона)', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      // Аналогично Column: Method без urlTemplateName не локализуется, extractTargetXml
      // возвращает null для current и HEAD → различий нет → undefined.
      fs.appendFileSync(xmlPath, '\n<!-- правка -->\n', 'utf-8');
      const service = new GitMetadataStatusService(repo);
      const status = service.getStatus({ kind: 'child', ownerXmlPath: xmlPath, childKind: 'Method', name: 'POST' });
      assert.strictEqual(status, undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('ensureStatusMap: репозиторий исчезает между вызовами (.git удалён) — статус мягко пуст, без исключения', () => {
    const { repo, xmlPath } = buildBaselineRepo();
    try {
      const service = new GitMetadataStatusService(repo);
      // Прогреваем batch-карту и мемоизируем gitRoot ДО удаления `.git`.
      const before = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
      assert.strictEqual(before, undefined);

      fs.rmSync(path.join(repo, '.git'), { recursive: true, force: true });
      // invalidate() не трогает мемоизированный this.gitRoot — только сбрасывает
      // `loaded`, форсируя повторный (теперь уже проваливающийся) git status.
      service.invalidate([xmlPath]);

      assert.doesNotThrow(() => {
        const after = service.getStatus({ kind: 'paths', ownerXmlPath: xmlPath, childKind: 'Attribute', paths: [xmlPath] });
        assert.strictEqual(after, undefined, 'после исчезновения репозитория git status падает — карта остаётся пустой');
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
