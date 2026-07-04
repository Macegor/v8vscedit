import * as assert from 'assert';
import {
  canonicalChildPath,
  parseCanonicalPath,
  SEGMENTED_CHILD_TAGS,
  type ParsedCanonicalPath,
} from '../../domain/CanonicalNames';
import { CHILD_TAG_CONFIG } from '../../domain/ChildTag';
import { META_TYPES } from '../../domain/MetaTypes';

/**
 * Каноническое именование третьего уровня вложенности HTTP-сервиса:
 * `HTTPService → URLTemplate → Method`. Контейнерный паттерн повторяет
 * `TabularSection → Column`, поэтому у `Method` появляется отдельное поле
 * `urlTemplateName` (по аналогии с `tabularSectionName`), а НЕ переиспользуется
 * существующий слот — см. план (осознанное дублирование имени контейнера-родителя).
 *
 * До реализации домена (`MetaKind`, `ChildTag`, `CHILD_TAG_CONFIG`, ветки
 * `canonicalChildPath`/`parseAfterRoot`) эти тесты падают — либо на этапе
 * компиляции (нет литералов `'URLTemplate'`/`'Method'` в типах), либо в рантайме
 * (`CHILD_TAG_CONFIG['URLTemplate']` не определён, обращение к `.pathSegment`
 * бросает исключение, либо построенный путь не совпадает с ожидаемым).
 */
suite('CanonicalNames — HTTP-сервис: URLTemplate → Method (третий уровень вложенности)', () => {
  test('URLTemplate — сегментированный дочерний элемент HTTPService (двухсегментный хвост)', () => {
    const path = canonicalChildPath({
      rootKind: 'HTTPService',
      rootName: 'ServiceEntry',
      childTag: 'URLTemplate',
      childName: 'PostEntries',
    });
    assert.strictEqual(path, 'HTTPСервисы.ServiceEntry.URLШаблон.PostEntries');
  });

  test('Method внутри URLTemplate — третий уровень вложенности, urlTemplateName как явный параметр', () => {
    const path = canonicalChildPath({
      rootKind: 'HTTPService',
      rootName: 'ServiceEntry',
      childTag: 'Method',
      childName: 'POST',
      urlTemplateName: 'PostEntries',
    });
    assert.strictEqual(path, 'HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.POST');
  });

  test('Разные Method с одинаковым именем в разных URLTemplate дают разные канонические пути', () => {
    const inPostEntries = canonicalChildPath({
      rootKind: 'HTTPService',
      rootName: 'ServiceEntry',
      childTag: 'Method',
      childName: 'GET',
      urlTemplateName: 'PostEntries',
    });
    const inPing = canonicalChildPath({
      rootKind: 'HTTPService',
      rootName: 'ServiceEntry',
      childTag: 'Method',
      childName: 'GET',
      urlTemplateName: 'ping',
    });
    assert.notStrictEqual(inPostEntries, inPing, 'одноимённые методы разных URLTemplate не должны совпасть по пути');
    assert.strictEqual(inPostEntries, 'HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.GET');
    assert.strictEqual(inPing, 'HTTPСервисы.ServiceEntry.URLШаблон.ping.Метод.GET');
  });

  test('parseCanonicalPath разбирает URLTemplate.PostEntries обратно в {childTag, childName}', () => {
    const parsed: ParsedCanonicalPath = parseCanonicalPath('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries');
    assert.strictEqual(parsed.kind, 'child');
    assert.strictEqual(parsed.rootKind, 'HTTPService');
    assert.strictEqual(parsed.rootName, 'ServiceEntry');
    assert.strictEqual(parsed.childTag, 'URLTemplate');
    assert.strictEqual(parsed.childName, 'PostEntries');
  });

  test('parseCanonicalPath разбирает URLШаблон.X.Метод.Y с явным urlTemplateName в результате', () => {
    const parsed = parseCanonicalPath('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Метод.POST') as ParsedCanonicalPath & {
      urlTemplateName?: string;
    };
    assert.strictEqual(parsed.kind, 'child');
    assert.strictEqual(parsed.childTag, 'Method');
    assert.strictEqual(parsed.childName, 'POST');
    assert.strictEqual(
      parsed.urlTemplateName,
      'PostEntries',
      'ParsedCanonicalPath.child должен нести urlTemplateName для методов'
    );
  });

  test('Некорректная роль внутри URLШаблон.X (не «Метод») — отбивается с понятной ошибкой', () => {
    assert.throws(() => parseCanonicalPath('HTTPСервисы.ServiceEntry.URLШаблон.PostEntries.Форма.Х'));
  });

  test('CHILD_TAG_CONFIG: URLTemplate → «URLШаблон», Method → «Метод»', () => {
    assert.strictEqual(CHILD_TAG_CONFIG.URLTemplate.pathSegment, 'URLШаблон');
    assert.strictEqual(CHILD_TAG_CONFIG.Method.pathSegment, 'Метод');
  });

  test('URLTemplate — сегментированный тег (требует явного сегмента-роли в пути)', () => {
    assert.ok(
      SEGMENTED_CHILD_TAGS.includes('URLTemplate'),
      'URLTemplate должен быть в SEGMENTED_CHILD_TAGS: путь всегда содержит сегмент «URLШаблон»'
    );
  });

  test('META_TYPES: URLTemplate/Method — дочерние типы группы «child», без pathSegment/folder', () => {
    const urlTemplateDef = META_TYPES.URLTemplate;
    const methodDef = META_TYPES.Method;
    assert.strictEqual(urlTemplateDef.group, 'child');
    assert.strictEqual(methodDef.group, 'child');
    assert.strictEqual(urlTemplateDef.pathSegment, undefined, 'URLTemplate — дочерний тип, без канонического pathSegment корня');
    assert.strictEqual(methodDef.pathSegment, undefined);
    assert.strictEqual(urlTemplateDef.folder, undefined);
    assert.strictEqual(methodDef.folder, undefined);
    assert.ok(urlTemplateDef.childTags?.includes('Method'), 'URLTemplate.childTags должен включать Method');
  });

  test('META_TYPES.HTTPService — childTags включает URLTemplate', () => {
    assert.ok(META_TYPES.HTTPService.childTags?.includes('URLTemplate'), 'HTTPService.childTags должен включать URLTemplate');
  });

  // ── Регресс: существующие контейнерные пути ТЧ/Колонка не сломаны ────────
  test('РЕГРЕСС: колонка ТЧ по-прежнему строит путь …ТабличнаяЧасть.X.Реквизит.Y', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog',
      rootName: 'Контрагенты',
      childTag: 'Attribute',
      childName: 'ФИО',
      tabularSectionName: 'КонтактныеЛица',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.ТабличнаяЧасть.КонтактныеЛица.Реквизит.ФИО');
  });

  test('РЕГРЕСС: parseCanonicalPath для колонки ТЧ по-прежнему возвращает tabularSectionName (без urlTemplateName)', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.ТабличнаяЧасть.КонтактныеЛица.Реквизит.ФИО');
    assert.strictEqual(parsed.kind, 'child');
    assert.strictEqual(parsed.tabularSectionName, 'КонтактныеЛица');
    assert.strictEqual(parsed.urlTemplateName, undefined);
  });
});
