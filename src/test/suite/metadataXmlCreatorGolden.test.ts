import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import {
  GOLDEN_BusinessProcess21,
  GOLDEN_Catalog20,
  GOLDEN_Catalog21,
  GOLDEN_CHILD_2_21,
  GOLDEN_CommonForm21,
  GOLDEN_DataProcessor21,
  GOLDEN_Document21,
  GOLDEN_Enum21,
  GOLDEN_InformationRegister21,
  GOLDEN_Report21,
  GOLDEN_Role21,
} from './support/metadataXmlCreatorGoldenFixtures';

/**
 * Байт-в-байт характеризация `MetadataXmlCreator` ДО дробления God-класса
 * (1714 строк, ~86 module-level функций генерации XML) на подфайлы
 * `src/infra/xml/creator/*`. Инвариант проекта (CLAUDE.md, п. 17 «Известные
 * технические долги»/анти-паттерны): любой рефактор XML-генератора обязан
 * предваряться golden-тестом, фиксирующим ПОЛНЫЙ текст каждого созданного
 * файла — не подстроки (в отличие от formatVersionGeneration.test.ts, который
 * проверяет .includes на конкретные теги). Этот тест — страховочная сеть:
 * он обязан остаться зелёным после дробления на creator/*, иначе рефактор
 * изменил поведение генератора, а не только структуру кода. Switch по kind
 * НЕ преобразуется в таблицу в рамках этой задачи — дробление вербатим.
 *
 * Единственный источник недетерминизма — crypto.randomUUID() внутри newUuid()
 * (uuid корневого объекта, InternalInfo.GeneratedType.TypeId/ValueId, uuid
 * дескрипторов формы/шаблона). Эти значения не участвуют в бизнес-контракте
 * (валидируются платформой только по форме GUID), поэтому перед сравнением с
 * эталоном нормализуются в плейсхолдер "<UUID>" через regex — единственная
 * точка, где допустима не побайтовая строка. Весь остальной текст (переводы
 * строк, отступы, BOM, самозакрытие тегов, порядок свойств) сравнивается
 * буквально с эталонами из support/metadataXmlCreatorGoldenFixtures.ts,
 * которые зафиксированы из фактического вывода MetadataXmlCreator на HEAD.
 */
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function readNormalized(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8').replace(UUID_RE, '<UUID>');
}

function configXml(version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<MetaDataObject version="${version}">\n\t<Configuration>\n\t\t<Properties>\n\t\t\t<Name>Тест</Name>\n\t\t\t<Synonym/>\n\t\t</Properties>\n\t\t<ChildObjects/>\n\t</Configuration>\n</MetaDataObject>`;
}

function newConfigRoot(version: string): string {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-golden-creator-'));
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), configXml(version), 'utf-8');
  return configRoot;
}

/**
 * Сверяет фактический набор изменённых файлов и содержимое каждого из них
 * (нормализованное по UUID) с эталоном. Порядок `changedFiles` — часть
 * контракта, но сортируем для устойчивости к порядку обхода `fs.readdirSync`
 * относительно самого набора файлов, порождённых MetadataXmlCreator
 * (порядок elements внутри `changedFiles`, возвращаемый addRootObject/
 * addChildElement, фиксирован кодом и проверяется отдельно deepStrictEqual).
 */
function assertMatchesGolden(
  configRoot: string,
  actualChangedFiles: string[],
  golden: { changedFiles: string[]; files: Record<string, string> }
): void {
  const relChanged = actualChangedFiles.map((f) => path.relative(configRoot, f).split(path.sep).join('/'));
  assert.deepStrictEqual(relChanged, golden.changedFiles, 'состав и порядок changedFiles должны совпасть с эталоном');

  for (const [rel, expected] of Object.entries(golden.files)) {
    const actualPath = path.join(configRoot, ...rel.split('/'));
    assert.ok(fs.existsSync(actualPath), `эталонный файл ${rel} должен существовать`);
    assert.strictEqual(readNormalized(actualPath), expected, `содержимое ${rel} должно побайтово совпасть с эталоном`);
  }
}

suite('MetadataXmlCreator — байт-golden характеризация (предусловие дробления на infra/xml/creator/*)', () => {
  suite('addRootObject: репрезентативный набор видов, версия 2.21', () => {
    test('Catalog: полный XML (StandardAttributes, InternalInfo, childTags Attribute/TabularSection/Form/Command/Template) + Ext/ObjectModule.bsl', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Catalog', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_Catalog21);
    });

    test('Document: полный XML (Posting/RegisterRecords, StandardAttributes) + Ext/ObjectModule.bsl', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Document', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_Document21);
    });

    test('InformationRegister: полный XML (без StandardAttributes, Dimension/Resource childTags) + Ext/RecordSetModule.bsl', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'InformationRegister', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_InformationRegister21);
    });

    test('Enum: полный XML (без StandardAttributes, EnumValue childTag) + Ext/ManagerModule.bsl', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Enum', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_Enum21);
    });

    test('Report: полный XML (MainDataCompositionSchema, AuxiliaryVariantForm 2.21) + Ext/ObjectModule.bsl + Ext/ManagerModule.bsl', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Report', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_Report21);
    });

    test('DataProcessor: полный XML (DefaultForm/AuxiliaryForm) + Ext/ObjectModule.bsl + Ext/ManagerModule.bsl', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'DataProcessor', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_DataProcessor21);
    });

    test('Role: полный XML роли (без модулей) + Ext/Rights.xml (buildEmptyRightsXml)', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Role', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_Role21);
    });

    test('BusinessProcess: полный XML (AddressingAttribute-совместимые свойства) + Ext/ObjectModule.bsl + Ext/Flowchart.xml (buildBusinessProcessFlowchartXml)', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'BusinessProcess', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_BusinessProcess21);
    });

    test('CommonForm: вид с формой по умолчанию — полный XML + Ext/Form/Module.bsl + Ext/Form.xml (buildManagedFormXml)', () => {
      const configRoot = newConfigRoot('2.21');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'CommonForm', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_CommonForm21);
    });
  });

  suite('addRootObject: привязка к ruleset формата (2.20 vs 2.21) на одном виде', () => {
    test('Catalog@2.20: без xmlns:pal, version="2.20" — полный XML отличается от 2.21 только неймспейсом/версией', () => {
      const configRoot = newConfigRoot('2.20');
      const result = new MetadataXmlCreator().addRootObject({ configRoot, kind: 'Catalog', name: 'Тест' });
      assert.strictEqual(result.success, true, result.errors.join('; '));
      assertMatchesGolden(configRoot, result.changedFiles, GOLDEN_Catalog20);
    });
  });

  suite('addChildElement: Attribute/TabularSection/Form/Template на владельце Catalog, версия 2.21', () => {
    test('последовательное добавление 4 дочерних элементов: полный XML владельца после мутаций + созданные файлы Form/Template', () => {
      const configRoot = newConfigRoot('2.21');
      const creator = new MetadataXmlCreator();
      const rootResult = creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Тест' });
      assert.strictEqual(rootResult.success, true, rootResult.errors.join('; '));

      const ownerXml = path.join(configRoot, 'Catalogs', 'Тест.xml');
      const steps: { childTag: 'Attribute' | 'TabularSection' | 'Form' | 'Template'; name: string; templateType?: 'SpreadsheetDocument' }[] = [
        { childTag: 'Attribute', name: 'Реквизит1' },
        { childTag: 'TabularSection', name: 'ТЧ1' },
        { childTag: 'Form', name: 'Форма1' },
        { childTag: 'Template', name: 'Макет1', templateType: 'SpreadsheetDocument' },
      ];

      const allChanged = new Set<string>();
      for (const step of steps) {
        const result = creator.addChildElement({ ownerObjectXmlPath: ownerXml, ...step });
        assert.strictEqual(result.success, true, `${step.childTag} ${step.name}: ${result.errors.join('; ')}`);
        for (const changed of result.changedFiles) {
          allChanged.add(path.relative(configRoot, changed).split(path.sep).join('/'));
        }
      }

      assertMatchesGolden(configRoot, [...allChanged].map((rel) => path.join(configRoot, ...rel.split('/'))), GOLDEN_CHILD_2_21);
    });
  });
});
