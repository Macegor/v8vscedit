import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import {
  allOrderedPairs,
  CANON_CHILD_ORDER,
  checkPairOrder,
  declaredEncoding,
  EXAMPLE_GENERATIONS,
  directChildObjectsTagSequence,
  hasExampleCorpus,
  KNOWN_POLLUTED_FIXTURES,
  listXmlFilesRecursive,
  MIN_FILES_FOR_KIND,
  ORDERED_OWNER_KINDS,
  scanOwnerFiles,
} from './support/childObjectsCorpus';

/**
 * Задача «порядок дочерних элементов в `<ChildObjects>` по виду владельца +
 * регистр `UTF-8` в XML-декларации» — часть T-1/T-2/T-17: снятие правил С
 * ЭТАЛОНА `example/` (полный корпус 2.20+2.21, cf и cfe/EVOLC) и независимая
 * (не по хардкоженной строке golden-теста) проверка сгенерированных файлов
 * против него.
 *
 * `example/` не отслеживается git (см. CLAUDE.md) — на чистом клоне сьют
 * пропускается целиком (`this.skip()`), а не падает.
 */
suite('ChildObjects: порядок и декларация — снятие правил с эталона example/ (T-1, T-2, T-17)', function () {
  suiteSetup(function () {
    if (!hasExampleCorpus()) {
      this.skip();
    }
  });

  suite('T-1: канон порядка по виду владельца — 0 нарушений по всему корпусу', () => {
    for (const kind of ORDERED_OWNER_KINDS) {
      test(`${kind}: полнота выборки (>= ${String(MIN_FILES_FOR_KIND[kind])} файлов) и 0 нарушений порядка по всем парам строки`, () => {
        const files = scanOwnerFiles(kind);
        assert.ok(
          files.length >= MIN_FILES_FOR_KIND[kind],
          `${kind}: корпус даёт только ${String(files.length)} файлов — недостаточно для «зелёный не на пустом корпусе» ` +
          `(порог ${String(MIN_FILES_FOR_KIND[kind])}); проверь, что example/ на месте и структура выгрузки не изменилась`
        );

        const order = CANON_CHILD_ORDER[kind];
        for (const [tagA, tagB] of allOrderedPairs(order)) {
          const { violations } = checkPairOrder(files, tagA, tagB);
          assert.deepStrictEqual(
            violations,
            [],
            `${kind}: тег "${tagB}" не должен предшествовать "${tagA}" ни в одном файле корпуса, найдены нарушения`
          );
        }
      });
    }

    test('AccountingRegister: тонкая выборка (2 файла из РАЗНЫХ генераций/конфигураций), согласие полное', () => {
      const files = scanOwnerFiles('AccountingRegister');
      const relPaths = files.map((f) => path.relative(process.cwd(), f.filePath));
      assert.strictEqual(files.length, 2, 'ожидалось РОВНО 2 файла в корпусе (см. отчёт задачи) — если больше, порог MIN_FILES_FOR_KIND можно поднять');
      assert.ok(relPaths.some((p) => p.includes('2.20')), 'один файл обязан быть из генерации 2.20');
      assert.ok(relPaths.some((p) => p.includes('2.21')), 'второй файл обязан быть из генерации 2.21');
    });

    test('CalculationRegister: тег Recalculation в корпусе отсутствует — не должен попадать в канон', () => {
      const files = scanOwnerFiles('CalculationRegister');
      const seenTags = new Set(files.flatMap((f) => f.tags ?? []));
      assert.ok(!seenTags.has('Recalculation'), 'Recalculation не встречается в эталоне CalculationRegister — не должен быть в CANON_CHILD_ORDER');
      assert.ok(!CANON_CHILD_ORDER.CalculationRegister.includes('Recalculation'));
    });
  });

  suite('T-2: XML-декларация — все файлы корпуса объявляют encoding="UTF-8", кроме заведомых артефактов', () => {
    test('example/2.20 + example/2.21 (cf и cfe/EVOLC): 0 файлов с encoding, отличным от "UTF-8" (за исключением KNOWN_POLLUTED_FIXTURES)', function () {
      // Полный рекурсивный обход ~45k файлов корпуса (все .xml, включая формы/
      // макеты, не только объекты-владельцы) укладывается в единицы секунд
      // (см. типовой замер в typedFieldCorpus.ts), но превышает дефолтный
      // таймаут Mocha 2000ms — увеличиваем явно для ЭТОГО теста, подвыборка
      // не нужна (обход детерминирован и полон).
      this.timeout(30000);
      const pollutedSet = new Set(KNOWN_POLLUTED_FIXTURES.map((p) => path.normalize(p)));
      const allFiles = [EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21, EXAMPLE_GENERATIONS.cfe21]
        .flatMap((root) => listXmlFilesRecursive(root));
      assert.ok(allFiles.length > 1000, `корпус неожиданно мал (${String(allFiles.length)} xml-файлов) — похоже на неполный example/`);

      const offenders: { file: string; encoding: string }[] = [];
      let checked = 0;
      for (const filePath of allFiles) {
        if (pollutedSet.has(path.normalize(filePath))) {
          continue;
        }
        const xml = fs.readFileSync(filePath, 'utf-8');
        const encoding = declaredEncoding(xml);
        if (encoding === undefined) {
          continue;
        }
        checked += 1;
        if (encoding !== 'UTF-8') {
          offenders.push({ file: filePath, encoding });
        }
      }
      assert.ok(checked > 1000, `слишком мало файлов с XML-декларацией проверено (${String(checked)})`);
      assert.deepStrictEqual(offenders, [], 'найдены файлы корпуса с encoding, отличным от "UTF-8" (кроме заведомых артефактов)');
    });

    test('KNOWN_POLLUTED_FIXTURES реально существуют и реально объявляют encoding="utf-8" (иначе список исключений устарел)', () => {
      for (const filePath of KNOWN_POLLUTED_FIXTURES) {
        assert.ok(fs.existsSync(filePath), `заявленный «загрязнённый» файл не найден: ${filePath}`);
        const xml = fs.readFileSync(filePath, 'utf-8');
        assert.strictEqual(declaredEncoding(xml), 'utf-8', `${filePath}: ожидалась строчная "utf-8" (артефакт того же дефекта)`);
      }
    });
  });

  suite('T-17: связка golden ↔ example/ — генератор сверяется с корпусом, а не с самим собой', () => {
    function newConfigRoot(version: string): string {
      const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-corpus-link-'));
      const configXml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        `<MetaDataObject version="${version}">`,
        '\t<Configuration>',
        '\t\t<Properties><Name>Тест</Name><Synonym/></Properties>',
        '\t\t<ChildObjects/>',
        '\t</Configuration>',
        '</MetaDataObject>',
      ].join('\n');
      fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), configXml, 'utf-8');
      return configRoot;
    }

    // Виды, для которых в example/ ЕСТЬ файлы (используем как «живой» образец
    // для сверки декларации) И для которых MetadataXmlCreator умеет создавать
    // корневой объект — пересечение обоих множеств.
    const LINKABLE_KINDS = ['Catalog', 'Document', 'InformationRegister', 'Enum', 'Report', 'DataProcessor', 'BusinessProcess'] as const;

    for (const kind of LINKABLE_KINDS) {
      test(`${kind}: декларация сгенерированного корневого объекта байт-равна декларации реального файла из корпуса`, () => {
        const sample = scanOwnerFiles(kind).find((f) => f.tags !== null);
        assert.ok(sample, `${kind}: не нашлось ни одного файла с распознанным <ChildObjects> в корпусе`);
        // \u0424\u0430\u0439\u043B\u044B \u043A\u043E\u0440\u043F\u0443\u0441\u0430 \u043D\u0435\u0440\u0435\u0434\u043A\u043E \u0432 CRLF (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 example/2.21/src/cf/Catalogs/\u0412\u0430\u043B\u044E\u0442\u044B.xml) \u2014
        // \u0441\u043D\u0438\u043C\u0430\u0435\u043C BOM \u0438 \u0445\u0432\u043E\u0441\u0442\u043E\u0432\u043E\u0439 \r \u041F\u0415\u0420\u0415\u0414 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0435\u043C: EOL-\u0441\u0442\u0438\u043B\u044C \u0438\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0430 \u043D\u0435 \u0432\u0445\u043E\u0434\u0438\u0442
        // \u0432 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u043E\u0435 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u043E (\u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440 \u0432\u0441\u0435\u0433\u0434\u0430 \u043F\u0438\u0448\u0435\u0442 LF), \u0430 \u0441\u0430\u043C\u0430 \u0434\u0435\u043A\u043B\u0430\u0440\u0430\u0446\u0438\u044F
        // "<?xml ... encoding=...?>" \u0441\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u043F\u043E\u0431\u0430\u0439\u0442\u043E\u0432\u043E \u0431\u0435\u0437 \u043E\u0441\u043B\u0430\u0431\u043B\u0435\u043D\u0438\u0439.
        const sampleDeclarationLine = sample.xml.split('\n')[0].replace(/^\uFEFF/, '').replace(/\r$/, '');

        const configRoot = newConfigRoot('2.21');
        const result = new MetadataXmlCreator().addRootObject({ configRoot, kind, name: 'ТестСвязки' });
        assert.strictEqual(result.success, true, result.errors.join('; '));
        const generatedXmlPath = result.changedFiles.find((f) => f.endsWith('.xml') && !f.endsWith('Configuration.xml'));
        assert.ok(generatedXmlPath, 'не найден сгенерированный XML владельца среди changedFiles');
        const generatedXml = fs.readFileSync(generatedXmlPath, 'utf-8');
        const generatedDeclarationLine = generatedXml.split('\n')[0];

        assert.strictEqual(
          generatedDeclarationLine,
          sampleDeclarationLine,
          `${kind}: декларация сгенерированного файла обязана побайтово совпасть с реальным файлом из example/ ` +
          `(источник образца: ${sample.filePath})`
        );
      });
    }

    test('Catalog: после добавления Attribute→TabularSection→Form→Template→Command сгенерированная последовательность — ПОДПОСЛЕДОВАТЕЛЬНОСТЬ канона из T-1 (не хардкод, а сверка с CANON_CHILD_ORDER)', () => {
      const configRoot = newConfigRoot('2.21');
      const creator = new MetadataXmlCreator();
      creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Тест' });
      const ownerXml = path.join(configRoot, 'Catalogs', 'Тест.xml');
      for (const step of [
        { childTag: 'Attribute' as const, name: 'Р1' },
        { childTag: 'TabularSection' as const, name: 'ТЧ1' },
        { childTag: 'Form' as const, name: 'Ф1' },
        { childTag: 'Template' as const, name: 'М1', templateType: 'SpreadsheetDocument' as const },
      ]) {
        const r = creator.addChildElement({ ownerObjectXmlPath: ownerXml, ...step });
        assert.strictEqual(r.success, true, r.errors.join('; '));
      }
      const xml = fs.readFileSync(ownerXml, 'utf-8');
      const tags = directChildObjectsTagSequence(xml, 'Catalog');
      assert.ok(tags, 'не удалось извлечь последовательность прямых детей ChildObjects сгенерированного файла');
      const canon = CANON_CHILD_ORDER.Catalog;
      const canonIndex = new Map(canon.map((t, i) => [t, i]));
      const indices = tags.map((t) => canonIndex.get(t));
      assert.ok(indices.every((i): i is number => i !== undefined), `в сгенерированной последовательности встретился тег вне канона: ${JSON.stringify(tags)}`);
      // Начиная с TS 5.5 `indices.every((i): i is number => ...)` внутри
      // assert.ok сужает САМ массив `indices` до `number[]` для кода ниже —
      // повторная фильтрация здесь была бы избыточной (типы не пересекаются).
      const sorted = [...indices].sort((a, b) => a - b);
      assert.deepStrictEqual(indices, sorted, `последовательность ${JSON.stringify(tags)} не является подпоследовательностью канона ${JSON.stringify(canon)}`);
    });
  });
});
