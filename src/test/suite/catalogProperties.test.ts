import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { ensureStandardAttributeXml } from '../../infra/xml/XmlUtils';
import { buildRootMetaObjectProperties } from '../../ui/views/properties/PropertyBuilder';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');
const objectReader = new ObjectXmlReader();

// Возвращает путь к первому Catalog в example/src/cf без блока StandardAttributes.
function findFirstCatalogWithoutStandardAttributes(): string | null {
  const catalogsDir = path.join(EXAMPLE_CF, 'Catalogs');
  if (!fs.existsSync(catalogsDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(catalogsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.xml')) {
      continue;
    }
    const file = path.join(catalogsDir, entry.name);
    const xml = fs.readFileSync(file, 'utf-8');
    if (!xml.includes('<StandardAttributes>')) {
      return file;
    }
  }
  return null;
}

suite('Properties — справочник', () => {
  test('Показывает свойства справочника по разделам конфигуратора', () => {
    // Тест проверяет наличие ключевых свойств, общих для любого справочника;
    // конкретные значения зависят от выгрузки и не проверяются.
    const catalogPath = findFirstCatalogWithoutStandardAttributes()
      ?? path.join(EXAMPLE_CF, 'Catalogs', 'Пользователи.xml');
    const xml = fs.readFileSync(catalogPath, 'utf-8');
    const props = buildRootMetaObjectProperties(xml, 'Catalog');

    const keys = props.map((item) => item.key);
    assert.ok(keys.includes('Hierarchical'), 'Hierarchical не найден');
    assert.ok(keys.includes('Owners'), 'Owners не найден');
    assert.ok(keys.includes('DescriptionLength'), 'DescriptionLength не найден');
    assert.ok(keys.includes('DefaultFolderForm'), 'DefaultFolderForm не найден');
    assert.ok(keys.includes('InputByString'), 'InputByString не найден');
    assert.ok(keys.includes('UseStandardCommands'), 'UseStandardCommands не найден');
    assert.ok(keys.includes('BasedOn'), 'BasedOn не найден');
    assert.ok(keys.includes('PredefinedDataUpdate'), 'PredefinedDataUpdate не найден');
    assert.ok(!keys.includes('Characteristics'), 'Characteristics не должен выводиться в свойствах справочника');

    const owners = props.find((item) => item.key === 'Owners');
    assert.ok(owners, 'Owners не найден');
    assert.strictEqual(owners.section, 'Владельцы');

    const codeType = props.find((item) => item.key === 'CodeType');
    assert.ok(codeType, 'CodeType не найден');
    assert.strictEqual(codeType.kind, 'enum');

    const inputByString = props.find((item) => item.key === 'InputByString');
    assert.ok(inputByString, 'InputByString не найден');
    assert.strictEqual(inputByString.kind, 'metadataReferenceList');
  });

  test('Показывает стандартные реквизиты корневого объекта с русскими представлениями', () => {
    // Используем любой доступный Catalog из example/src/cf — в нём всегда есть
    // дефолтные стандартные реквизиты (PredefinedDataName, Ref, ...), даже если
    // блока StandardAttributes нет в XML, парсер добавляет их по умолчанию.
    const catalogsDir = path.join(EXAMPLE_CF, 'Catalogs');
    const entry = fs.readdirSync(catalogsDir, { withFileTypes: true })
      .find((item) => item.isFile() && item.name.endsWith('.xml'));
    assert.ok(entry, 'В example/src/cf/Catalogs нет ни одного справочника');
    const objectInfo = objectReader.read(path.join(catalogsDir, entry.name));

    const standardAttributes = objectInfo?.children.filter((item) => item.tag === 'StandardAttribute') ?? [];
    assert.ok(standardAttributes.length > 0, 'Стандартные реквизиты не найдены');
    const expectedTriple = ['PredefinedDataName', 'Predefined', 'Ref'];
    const presentations: Record<string, string> = {
      PredefinedDataName: 'Имя предопределенных данных',
      Predefined: 'Предопределенный',
      Ref: 'Ссылка',
    };
    for (const name of expectedTriple) {
      const item = standardAttributes.find((attr) => attr.name === name);
      assert.ok(item, `Стандартный реквизит ${name} не найден`);
      assert.strictEqual(item.presentation, presentations[name]);
    }
  });

  test('Выводит стандартные реквизиты из поля ввода по строке, если блока StandardAttributes нет', function () {
    // Берём любой справочник без блока StandardAttributes; если такого нет — тест не применим.
    const catalogPath = findFirstCatalogWithoutStandardAttributes();
    if (!catalogPath) {
      this.skip();
    }
    const objectInfo = objectReader.read(catalogPath);

    const standardAttributes = objectInfo?.children.filter((item) => item.tag === 'StandardAttribute') ?? [];
    assert.ok(standardAttributes.length > 0, 'Стандартные реквизиты не материализованы');
    // Проверяем хотя бы наличие ключевых стандартных реквизитов справочника по умолчанию.
    const names = standardAttributes.map((item) => item.name);
    for (const required of ['Ref', 'DeletionMark', 'Code', 'Description']) {
      assert.ok(names.includes(required), `Стандартный реквизит ${required} не материализован`);
    }
  });

  test('Материализует стандартный реквизит при открытии свойств', () => {
    // Копируем любой Catalog без блока StandardAttributes во временный файл и
    // проверяем, что материализация добавляет нужные узлы. Так тест не зависит
    // от конкретного объекта и не модифицирует фикстуру example/.
    const sourcePath = findFirstCatalogWithoutStandardAttributes()
      ?? path.join(EXAMPLE_CF, 'Catalogs', 'Пользователи.xml');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-catalog-prop-'));
    try {
      const targetPath = path.join(tempRoot, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, targetPath);
      const original = fs.readFileSync(targetPath, 'utf-8');
      // Если фикстура уже содержит StandardAttributes — материализация всё равно должна
      // отработать без ошибки и оставить блок на месте.
      const hadBlock = original.includes('<StandardAttributes>');
      const materialized = ensureStandardAttributeXml(targetPath, 'Code', 'Catalog');
      assert.ok(materialized, 'XML стандартного реквизита не создан');

      const saved = fs.readFileSync(targetPath, 'utf-8');
      assert.ok(saved.includes('<StandardAttributes>'));
      assert.ok(saved.includes('<xr:StandardAttribute name="Code">'));
      if (!hadBlock) {
        assert.ok(saved.includes('<xr:Indexing>Index</xr:Indexing>'));
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
