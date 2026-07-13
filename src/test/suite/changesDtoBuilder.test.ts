import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { canonicalRootPath } from '../../domain/CanonicalNames';
import type { MetaKind } from '../../domain/MetaTypes';
import { aggregateMetadataChanges, type ChangesModel } from '../../infra/git/MetadataChangeAggregator';
import { readPorcelainEntries } from '../../infra/git/GitStatusReader';
/**
 * ПИВОТ: старый плоский `buildChangesState(model, iconResolver)` (секция →
 * объект напрямую) заменяется навигаторной сборкой в
 * `MetadataChangesViewProvider` + `changesTreeAssembler` (см.
 * `changesTreeAssembler.test.ts`). `changesDtoBuilder` теперь экспортирует
 * ЧИСТЫЕ билдеры одного объекта/части — `buildObjectNode`/`buildPartNode` —
 * без знания о навигаторной иерархии (её строит вызывающая сторона).
 * `resolveChangeAddress`/`NODE_ID_RE`/discard-хелперы и id-схема
 * (`<side>#<groupIndex>[.<partIndex>]`, `other#<rawIndex>`) — КОНТРАКТ,
 * который не меняется, поэтому соответствующие тесты сохранены как есть,
 * только без прослойки `buildChangesState`.
 */
import {
  buildObjectNode,
  buildOtherSection,
  buildPartNode,
  resolveChangeAddress,
  type IconDto,
  type TreeNodeDto,
} from '../../ui/views/changes/changesDtoBuilder';
import {
  appendLine,
  buildChangesBaselineRepo,
  git,
  removeFixtureRepo,
  type ChangesFixture,
} from './support/changesFixtures';

/**
 * Фейковый резолвер иконок — единственная внешняя зависимость builder'а
 * (реальные SVG-иконки читаются в `MetadataChangesViewProvider.buildIcon` через
 * `getIconUris`, который требует `vscode.Uri`/webview; здесь важно лишь то,
 * что builder ОБРАЩАЕТСЯ к резолверу по `rootKind` объекта и переносит его
 * результат в DTO, а не то, как рисуется сама иконка).
 */
function fakeIconResolver(calls: MetaKind[]): (kind: MetaKind) => IconDto {
  return (kind: MetaKind): IconDto => {
    calls.push(kind);
    return { kind: 'metadata', name: kind };
  };
}

function buildModel(fixture: ChangesFixture): ChangesModel {
  const entries = readPorcelainEntries(fixture.gitRoot);
  return aggregateMetadataChanges(entries, fixture.gitRoot, fixture.configRoots);
}

/** Индекс группы объекта по каноническому пути на нужной стороне — падает явно, если объект не найден. */
function groupIndex(model: ChangesModel, side: 'staged' | 'unstaged', canonicalPath: string): number {
  const groups = side === 'staged' ? model.staged : model.unstaged;
  const idx = groups.findIndex((g) => g.canonicalPath === canonicalPath);
  assert.ok(idx >= 0, `группа «${canonicalPath}» не найдена на стороне ${side}, получено: ${groups.map((g) => g.canonicalPath).join(', ')}`);
  return idx;
}

suite('changesDtoBuilder — buildObjectNode/buildPartNode строят TreeNodeDto объекта и его частей', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('buildObjectNode: иконка запрошена по rootKind, метка — канонический путь, id — `${side}#${index}`', () => {
    appendLine(fixture.objectModuleBsl, '// staged-правка модуля объекта');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);

    const model = buildModel(fixture);
    const idx = groupIndex(model, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const calls: MetaKind[] = [];

    const node = buildObjectNode('staged', model.staged[idx], idx, fakeIconResolver(calls));

    assert.strictEqual(node.id, `staged#${String(idx)}`);
    assert.strictEqual(node.key, node.id);
    assert.strictEqual(node.label, 'ПричиныВозврата', 'метка объекта — ИМЯ, тип уже виден по узлу-коллекции навигаторной иерархии');
    assert.ok(calls.includes('Catalog'), `резолвер иконок должен быть вызван с rootKind объекта, вызовы: ${calls.join(',')}`);
    assert.deepStrictEqual(node.icon, { kind: 'metadata', name: 'Catalog' });
    assert.strictEqual(node.kind, 'changeObject');
    // Список изменений заведомо небольшой — в отличие от ленивого дерева
    // навигатора здесь части объекта строятся сразу, без отдельной подгрузки.
    assert.strictEqual(node.hasChildren, true);
    assert.strictEqual(node.loaded, true);
    assert.ok(Array.isArray(node.children) && node.children.length === 1);
    assert.strictEqual(node.children[0].id, `${node.id}.0`, 'часть строится через buildPartNode по той же id-схеме');
  });

  test('инлайн-кнопки индексации: unstaged → «stage», staged → «unstage» на объекте и его частях', () => {
    appendLine(fixture.objectModuleBsl, '// правка');
    const model = buildModel(fixture);

    const unstagedIdx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const unstagedNode = buildObjectNode('unstaged', model.unstaged[unstagedIdx], unstagedIdx, fakeIconResolver([]));
    assert.deepStrictEqual(unstagedNode.inlineActions?.map((a) => a.id), ['stage'], 'на unstaged-объекте — кнопка проиндексировать');
    assert.deepStrictEqual(
      unstagedNode.children?.map((c) => c.inlineActions?.[0].id),
      unstagedNode.children?.map(() => 'stage'),
      'части unstaged-объекта тоже получают кнопку stage',
    );

    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    const stagedModel = buildModel(fixture);
    const stagedIdx = groupIndex(stagedModel, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const stagedNode = buildObjectNode('staged', stagedModel.staged[stagedIdx], stagedIdx, fakeIconResolver([]));
    assert.deepStrictEqual(stagedNode.inlineActions?.map((a) => a.id), ['unstage'], 'на staged-объекте — кнопка снять индексацию');
    assert.strictEqual(stagedNode.children?.[0].inlineActions?.[0].id, 'unstage', 'часть staged-объекта получает кнопку unstage');
  });

  test('buildPartNode: id по схеме `${objectId}.${partIndex}`, метка/kind/gitStatus части', () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка модуля объекта');
    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const part = model.unstaged[idx].parts[0];

    // objectId сознательно НЕ совпадает с реальным индексом группы — доказывает,
    // что buildPartNode чистая функция над переданным id, а не завязана на модель.
    const node = buildPartNode('unstaged#7', part, 3);

    assert.strictEqual(node.id, 'unstaged#7.3');
    assert.strictEqual(node.key, node.id);
    assert.strictEqual(node.label, 'МодульОбъекта');
    assert.strictEqual(node.kind, 'changePart');
    assert.strictEqual(node.hasChildren, false);
    assert.strictEqual(node.loaded, true);
    assert.deepStrictEqual(node.actions, []);
    assert.strictEqual(node.gitStatus, 'modified');
  });

  test('дочерние узлы — части с метками «Свойства»/«МодульОбъекта»/«Форма.<Имя>» и их gitStatus', () => {
    // Часть 1: корневой XML свойств объекта «ПричиныВозврата» правится (unstaged).
    appendLine(path.join(fixture.catalogsDir, 'ПричиныВозврата.xml'), '<!-- unstaged-правка свойств -->');
    // Часть 2: модуль объекта того же каталога индексируется (staged).
    appendLine(fixture.objectModuleBsl, '// staged-правка модуля объекта');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    // Часть 3: форма другого объекта удалена из рабочего дерева (unstaged D).
    fs.rmSync(fixture.formXml);

    const model = buildModel(fixture);

    const stagedIdx = groupIndex(model, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const stagedNode = buildObjectNode('staged', model.staged[stagedIdx], stagedIdx, fakeIconResolver([]));
    const modulePart = stagedNode.children?.find((n: TreeNodeDto) => n.label === 'МодульОбъекта');
    assert.ok(modulePart, `ожидалась часть «МодульОбъекта», получено: ${JSON.stringify(stagedNode.children)}`);
    assert.strictEqual(modulePart.gitStatus, 'modified');

    const propsIdx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const propsNode = buildObjectNode('unstaged', model.unstaged[propsIdx], propsIdx, fakeIconResolver([]));
    const propsPart = propsNode.children?.find((n: TreeNodeDto) => n.label === 'Свойства');
    assert.ok(propsPart, `ожидалась часть «Свойства», получено: ${JSON.stringify(propsNode.children)}`);
    assert.strictEqual(propsPart.gitStatus, 'modified');

    const formIdx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'РолиКонтактныхЛиц'));
    const formNode = buildObjectNode('unstaged', model.unstaged[formIdx], formIdx, fakeIconResolver([]));
    const formPart = formNode.children?.find((n: TreeNodeDto) => n.label === 'Форма.ФормаЭлемента');
    assert.ok(formPart, `ожидалась часть «Форма.ФормаЭлемента», получено: ${JSON.stringify(formNode.children)}`);
    assert.strictEqual(formPart.gitStatus, 'deleted');
  });

  test('aggregateStatus объекта (combine add+delete → modified) корректно отражён на узле объекта', () => {
    // Тот же объект «ПричиныВозврата» получает ОДНОВРЕМЕННО добавленную часть
    // (новый макет) и удалённую (ManagerModule.bsl) — по правилу combineStatus
    // в MetadataChangeAggregator это должно схлопнуться в aggregateStatus 'M',
    // при этом каждая часть сохраняет СВОЙ статус ('added'/'deleted').
    const templateDir = path.join(fixture.catalogsDir, 'ПричиныВозврата', 'Templates', 'Т1', 'Ext');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'Template.xml'), 'новый макет\n', 'utf-8');
    fs.rmSync(path.join(fixture.catalogsDir, 'ПричиныВозврата', 'Ext', 'ManagerModule.bsl'));

    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const node = buildObjectNode('unstaged', model.unstaged[idx], idx, fakeIconResolver([]));

    assert.strictEqual(node.gitStatus, 'modified', 'схлопнутый статус объекта — modified (add+delete)');

    const templatePart = node.children?.find((n: TreeNodeDto) => n.label === 'Макет.Т1');
    assert.ok(templatePart, `ожидалась часть «Макет.Т1», получено: ${JSON.stringify(node.children)}`);
    assert.strictEqual(templatePart.gitStatus, 'added', 'сама часть-макет остаётся added, схлопывание — только у объекта');

    const managerPart = node.children?.find((n: TreeNodeDto) => n.label === 'МодульМенеджера');
    assert.ok(managerPart, `ожидалась часть «МодульМенеджера», получено: ${JSON.stringify(node.children)}`);
    assert.strictEqual(managerPart.gitStatus, 'deleted', 'удалённая часть остаётся deleted');
  });

  test('staged и unstaged независимы: один и тот же canonicalPath, но РАЗНЫЕ id (частично проиндексированный MM-файл)', () => {
    appendLine(fixture.objectModuleBsl, '// правка №1 — будет застейджена');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    appendLine(fixture.objectModuleBsl, '// правка №2 — поверх индекса, unstaged');
    assert.strictEqual(
      git(fixture.gitRoot, ['status', '--porcelain', '--', path.relative(fixture.gitRoot, fixture.objectModuleBsl)])
        .trim()
        .slice(0, 2),
      'MM',
      'предусловие: файл должен быть частично застейджен (MM)'
    );

    const model = buildModel(fixture);
    const stagedIdx = groupIndex(model, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const unstagedIdx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const stagedNode = buildObjectNode('staged', model.staged[stagedIdx], stagedIdx, fakeIconResolver([]));
    const unstagedNode = buildObjectNode('unstaged', model.unstaged[unstagedIdx], unstagedIdx, fakeIconResolver([]));

    assert.strictEqual(stagedNode.label, unstagedNode.label, 'имя объекта на обеих сторонах одинаково');
    assert.notStrictEqual(
      stagedNode.id,
      unstagedNode.id,
      'staged- и unstaged-узлы одного объекта должны иметь разные id, иначе провайдер не различит стороны при stage/unstage'
    );
  });

  test('удалённый объект без остатка на диске: узел объекта — deleted, метка из canonicalPath (по строке пути)', () => {
    // Весь каталог объекта «ПричиныВозврата» и его корневой XML удалены — на
    // диске от объекта не осталось ничего. resolveFilePart строит принадлежность
    // СТРОГО по строке пути (см. MetadataChangeResolver), поэтому builder обязан
    // построить узел объекта, не обращаясь к ФС/кэшу.
    fs.rmSync(path.join(fixture.catalogsDir, 'ПричиныВозврата'), { recursive: true, force: true });
    fs.rmSync(path.join(fixture.catalogsDir, 'ПричиныВозврата.xml'));

    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const node = buildObjectNode('unstaged', model.unstaged[idx], idx, fakeIconResolver([]));

    assert.strictEqual(node.gitStatus, 'deleted');
    assert.ok(node.children && node.children.length > 0, 'у удалённого объекта всё равно должны быть части (Свойства, модули)');
    assert.ok(node.children.every((c: TreeNodeDto) => c.gitStatus === 'deleted'), 'все части полностью удалённого объекта — deleted');
  });

  // ─── Read-only режим (Слой 3a, задача C): узлы истории/коммита не индексируются ──
  //
  // Граф истории показывает узлы КОММИТОВ (в т.ч. чужих/уже закоммиченных
  // изменений) — их нельзя ни застейджить, ни снять с индексации, поэтому
  // билдеры получают необязательный флаг, отключающий инлайн-кнопки.
  // Тест БЕЗ опции выше («инлайн-кнопки индексации…») — регрессионная защита
  // текущего поведения панели изменений, он не удаляется и не дублируется.

  test('buildObjectNode({ readonly: true }) — inlineActions отсутствует, но остальные поля узла и его частей как обычно', () => {
    appendLine(fixture.objectModuleBsl, '// правка для read-only узла (граф истории)');
    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));

    const node = buildObjectNode('unstaged', model.unstaged[idx], idx, fakeIconResolver([]), { readonly: true });

    assert.strictEqual(node.inlineActions, undefined, 'узел истории/коммита read-only — stage/unstage недоступны');
    assert.deepStrictEqual(node.actions, []);
    assert.strictEqual(node.gitStatus, 'modified');
    assert.strictEqual(node.label, 'ПричиныВозврата');
    assert.ok(Array.isArray(node.children) && node.children.length === 1, 'состав частей объекта в read-only режиме не меняется');
    assert.strictEqual(
      node.children[0].inlineActions,
      undefined,
      'дочерние части read-only объекта тоже не должны предлагать stage/unstage'
    );
  });

  test('buildObjectNode без опции (значение по умолчанию) — inlineActions присутствует, поведение не меняется read-only режимом', () => {
    // Дублирует инвариант соседнего теста «инлайн-кнопки индексации…», но
    // именно ПОСЛЕ появления параметра readonly — фиксирует, что необязательный
    // 4-й параметр не ломает вызовы без него (обратная совместимость сигнатуры).
    appendLine(fixture.objectModuleBsl, '// правка без read-only опции');
    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));

    const node = buildObjectNode('unstaged', model.unstaged[idx], idx, fakeIconResolver([]));

    assert.deepStrictEqual(node.inlineActions?.map((a) => a.id), ['stage']);
  });

  test('buildPartNode(objectId, part, index, true) — часть без inlineActions, остальные поля как обычно', () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка модуля объекта для read-only части');
    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const part = model.unstaged[idx].parts[0];

    const node = buildPartNode('unstaged#7', part, 3, true);

    assert.strictEqual(node.id, 'unstaged#7.3');
    assert.strictEqual(node.label, 'МодульОбъекта');
    assert.strictEqual(node.kind, 'changePart');
    assert.strictEqual(node.gitStatus, 'modified');
    assert.strictEqual(node.inlineActions, undefined, 'read-only часть не должна предлагать stage/unstage');
  });

  test('buildPartNode без read-only флага (значение по умолчанию) — inlineActions присутствует как раньше', () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка для проверки обратной совместимости buildPartNode');
    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const part = model.unstaged[idx].parts[0];

    const node = buildPartNode('unstaged#7', part, 3);

    assert.deepStrictEqual(node.inlineActions?.map((a) => a.id), ['stage']);
  });
});

suite('changesDtoBuilder — buildOtherSection строит плоскую секцию «Прочие» из RawChange', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('untracked-файл вне структуры выгрузки → узел changeRaw с gitStatus=added (rawStatus «??» → A)', () => {
    fs.writeFileSync(path.join(fixture.cfRoot, 'RANDOM_NOTES.txt'), 'служебная заметка\n', 'utf-8');

    const model = buildModel(fixture);
    const section = buildOtherSection(model.unresolved);

    assert.strictEqual(section.kind, 'other');
    assert.strictEqual(section.label, 'Прочие');
    assert.strictEqual(section.nodes.length, 1);
    const node = section.nodes[0];
    assert.strictEqual(node.id, 'other#0');
    assert.strictEqual(node.key, node.id);
    assert.strictEqual(node.label, 'src/cf/RANDOM_NOTES.txt');
    assert.strictEqual(node.kind, 'changeRaw');
    assert.strictEqual(node.hasChildren, false);
    assert.strictEqual(node.loaded, true);
    assert.deepStrictEqual(node.actions, []);
    assert.strictEqual(node.gitStatus, 'added', 'untracked («??») схлопывается в rawStatus=A → gitStatus=added');
  });

  test('отслеживаемый изменённый файл вне структуры выгрузки → gitStatus=modified (rawStatus «M» — общая ветка)', () => {
    const strayFile = path.join(fixture.cfRoot, 'ПостороннийФайл.txt');
    fs.writeFileSync(strayFile, 'первая версия\n', 'utf-8');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, strayFile)]);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'добавлен посторонний файл']);
    fs.appendFileSync(strayFile, 'вторая версия\n', 'utf-8');

    const model = buildModel(fixture);
    const section = buildOtherSection(model.unresolved);

    assert.strictEqual(section.nodes.length, 1);
    assert.strictEqual(section.nodes[0].gitStatus, 'modified');
  });

  test('удалённый из рабочего дерева отслеживаемый файл → gitStatus=deleted (rawStatus «D» — index/worktree)', () => {
    const strayFile = path.join(fixture.cfRoot, 'ПостороннийФайл.txt');
    fs.writeFileSync(strayFile, 'версия для удаления\n', 'utf-8');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, strayFile)]);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'добавлен посторонний файл на удаление']);
    fs.rmSync(strayFile);

    const model = buildModel(fixture);
    const section = buildOtherSection(model.unresolved);

    assert.strictEqual(section.nodes.length, 1);
    assert.strictEqual(section.nodes[0].gitStatus, 'deleted');
  });

  test('пустой unresolved → пустая секция «Прочие»', () => {
    const model = buildModel(fixture);
    const section = buildOtherSection(model.unresolved);

    assert.deepStrictEqual(section.nodes, []);
  });
});

suite('changesDtoBuilder — resolveChangeAddress восстанавливает адрес узла по id', () => {
  let fixture: ChangesFixture;

  setup(() => {
    fixture = buildChangesBaselineRepo();
  });

  teardown(() => {
    removeFixtureRepo(fixture);
  });

  test('объектный узел (partIndex не указан) — все файлы всех частей объекта, single=false при нескольких файлах', () => {
    // У объекта «ПричиныВозврата» две изменённые части (макет добавлен, менеджер удалён).
    const templateDir = path.join(fixture.catalogsDir, 'ПричиныВозврата', 'Templates', 'Т1', 'Ext');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'Template.xml'), 'новый макет\n', 'utf-8');
    fs.rmSync(path.join(fixture.catalogsDir, 'ПричиныВозврата', 'Ext', 'ManagerModule.bsl'));

    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));

    const address = resolveChangeAddress(model, `unstaged#${String(idx)}`);
    assert.ok(address, 'адрес объектного узла должен быть восстановлен');
    assert.strictEqual(address.side, 'unstaged');
    assert.strictEqual(address.relFiles.length, 2, 'ожидались файлы ОБЕИХ частей объекта, а не одной');
    assert.strictEqual(address.discards.length, 2);
    assert.strictEqual(address.single, false, 'у объекта из двух файлов single должен быть false');
  });

  test('объектный узел с ровно одним файлом одной части — single=true', () => {
    appendLine(fixture.objectModuleBsl, '// staged-правка модуля объекта');
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);

    const model = buildModel(fixture);
    const idx = groupIndex(model, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));

    const address = resolveChangeAddress(model, `staged#${String(idx)}`);
    assert.ok(address);
    assert.strictEqual(address.relFiles.length, 1);
    assert.strictEqual(address.single, true);
  });

  test('other/raw-узел — сторона other, один файл, discard-запись из discardStatusFromRaw', () => {
    fs.writeFileSync(path.join(fixture.cfRoot, 'RANDOM_NOTES.txt'), 'служебная заметка\n', 'utf-8');

    const model = buildModel(fixture);
    const rawIdx = model.unresolved.findIndex((r) => r.relPath === 'src/cf/RANDOM_NOTES.txt');
    assert.ok(rawIdx >= 0);

    const address = resolveChangeAddress(model, `other#${String(rawIdx)}`);
    assert.ok(address);
    assert.strictEqual(address.side, 'other');
    assert.deepStrictEqual(address.relFiles, ['src/cf/RANDOM_NOTES.txt']);
    assert.strictEqual(address.single, true);
    assert.strictEqual(address.discards[0].status, 'untracked', 'untracked-файл («??») должен отмениться как untracked (unlink)');
  });

  test('невалидный id (не совпадает с форматом узла) → undefined', () => {
    const model = buildModel(fixture);
    assert.strictEqual(resolveChangeAddress(model, 'not-a-node-id'), undefined);
    assert.strictEqual(resolveChangeAddress(model, ''), undefined);
  });

  test('staged/unstaged с индексом группы за пределами массива → undefined', () => {
    const model = buildModel(fixture);
    assert.strictEqual(resolveChangeAddress(model, 'staged#0'), undefined, 'staged пуст в чистом репозитории');
    assert.strictEqual(resolveChangeAddress(model, 'unstaged#0'), undefined, 'unstaged пуст в чистом репозитории');
  });

  test('other с индексом за пределами unresolved → undefined', () => {
    const model = buildModel(fixture);
    assert.strictEqual(resolveChangeAddress(model, 'other#0'), undefined, 'unresolved пуст в чистом репозитории');
  });

  test('индекс части за пределами массива parts существующей группы → undefined', () => {
    appendLine(fixture.objectModuleBsl, '// unstaged-правка модуля объекта — единственная часть');
    const model = buildModel(fixture);
    const idx = groupIndex(model, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    // У группы ровно одна часть (индекс 0) — обращение по индексу 5 не существует.
    assert.strictEqual(resolveChangeAddress(model, `unstaged#${String(idx)}.5`), undefined);
  });

  test('discardStatusFromChange: added-часть в unstaged — untracked, added-часть в staged — modified', () => {
    const templateDir = path.join(fixture.catalogsDir, 'ПричиныВозврата', 'Templates', 'Т2', 'Ext');
    fs.mkdirSync(templateDir, { recursive: true });
    const templateXml = path.join(templateDir, 'Template.xml');
    fs.writeFileSync(templateXml, 'новый макет\n', 'utf-8');

    const unstagedModel = buildModel(fixture);
    const unstagedIdx = groupIndex(unstagedModel, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const unstagedAddress = resolveChangeAddress(unstagedModel, `unstaged#${String(unstagedIdx)}`);
    assert.ok(unstagedAddress);
    assert.strictEqual(unstagedAddress.discards[0].status, 'untracked', 'добавленный, но НЕ застейдженный файл отменяется как untracked');

    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, templateXml)]);
    const stagedModel = buildModel(fixture);
    const stagedIdx = groupIndex(stagedModel, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const stagedAddress = resolveChangeAddress(stagedModel, `staged#${String(stagedIdx)}`);
    assert.ok(stagedAddress);
    assert.strictEqual(stagedAddress.discards[0].status, 'modified', 'застейдженное добавление отменяется как modified (unstage/checkout из индекса), а не unlink');
  });

  test('discardStatusFromChange: удалённая часть — deleted и в unstaged, и в staged', () => {
    fs.rmSync(fixture.objectModuleBsl);

    const unstagedModel = buildModel(fixture);
    const unstagedIdx = groupIndex(unstagedModel, 'unstaged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const unstagedAddress = resolveChangeAddress(unstagedModel, `unstaged#${String(unstagedIdx)}`);
    assert.ok(unstagedAddress);
    assert.strictEqual(unstagedAddress.discards[0].status, 'deleted');

    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, fixture.objectModuleBsl)]);
    const stagedModel = buildModel(fixture);
    const stagedIdx = groupIndex(stagedModel, 'staged', canonicalRootPath('Catalog', 'ПричиныВозврата'));
    const stagedAddress = resolveChangeAddress(stagedModel, `staged#${String(stagedIdx)}`);
    assert.ok(stagedAddress);
    assert.strictEqual(stagedAddress.discards[0].status, 'deleted');
  });

  test('discardStatusFromRaw: untracked («??»), deleted (D), modified (M) — по реальным сырым файлам вне структуры выгрузки', () => {
    const strayFile = path.join(fixture.cfRoot, 'ПостороннийФайл.txt');

    // untracked: файл создан, но не добавлен в индекс — index=worktree='?'.
    fs.writeFileSync(strayFile, 'первая версия\n', 'utf-8');
    const untrackedModel = buildModel(fixture);
    assert.strictEqual(resolveChangeAddress(untrackedModel, 'other#0')?.discards[0].status, 'untracked');

    // Закоммитим файл как часть базовой линии репозитория (сам файл вне
    // структуры выгрузки, поэтому remains unresolved и после коммита).
    git(fixture.gitRoot, ['add', path.relative(fixture.gitRoot, strayFile)]);
    git(fixture.gitRoot, ['commit', '-q', '-m', 'добавлен посторонний файл']);

    // modified: правка отслеживаемого файла — worktree='M'.
    fs.appendFileSync(strayFile, 'вторая версия\n', 'utf-8');
    const modifiedModel = buildModel(fixture);
    assert.strictEqual(resolveChangeAddress(modifiedModel, 'other#0')?.discards[0].status, 'modified');

    // deleted: отслеживаемый файл удалён из рабочего дерева — worktree='D'.
    fs.rmSync(strayFile);
    const deletedModel = buildModel(fixture);
    assert.strictEqual(resolveChangeAddress(deletedModel, 'other#0')?.discards[0].status, 'deleted');
  });
});
