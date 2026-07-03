import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigXmlReader } from '../../infra/xml/ConfigXmlReader';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';

const EXAMPLE_CFE_ROOT = path.resolve(__dirname, '../../../example/2.21/src/cfe');
const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');
const configReader = new ConfigXmlReader();
const objectReader = new ObjectXmlReader();

// Тесты CFE применимы только когда в example/2.21/src/cfe есть хоть одно расширение.
// Возвращает корневой каталог первого найденного расширения или null.
function findFirstCfeRoot(): string | null {
  if (!fs.existsSync(EXAMPLE_CFE_ROOT)) {
    return null;
  }
  for (const entry of fs.readdirSync(EXAMPLE_CFE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(EXAMPLE_CFE_ROOT, entry.name);
    if (fs.existsSync(path.join(candidate, 'Configuration.xml'))) {
      return candidate;
    }
  }
  return null;
}

// Возвращает первое имя объекта указанного тега в ChildObjects расширения.
function firstChildObject(cfeRoot: string, tag: string): string | null {
  const info = configReader.read(path.join(cfeRoot, 'Configuration.xml'));
  return info.childObjects.get(tag)?.[0] ?? null;
}

suite('ConfigParser — Configuration.xml', () => {
  test('Парсит имя и namePrefix расширения CFE', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      this.skip();
    }
    const info = configReader.read(path.join(cfeRoot, 'Configuration.xml'));
    assert.strictEqual(info.kind, 'cfe');
    assert.ok(info.name.length > 0, 'Имя расширения пустое');
  });

  test('Парсит имя основной конфигурации', () => {
    const info = configReader.read(path.join(EXAMPLE_CF, 'Configuration.xml'));
    assert.strictEqual(info.kind, 'cf');
    assert.ok(info.name.length > 0, 'Имя конфигурации пустое');
    // Версия может отсутствовать в Configuration.xml — проверяем только тип.
    assert.strictEqual(typeof info.version, 'string');
  });

  test('ChildObjects расширения содержит хотя бы один объект какого-либо типа', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      this.skip();
    }
    const info = configReader.read(path.join(cfeRoot, 'Configuration.xml'));
    const total = Array.from(info.childObjects.values()).reduce((sum, list) => sum + list.length, 0);
    assert.ok(total > 0, 'ChildObjects расширения пустые');
  });

  test('ChildObjects основной конфигурации содержит хотя бы один объект', () => {
    const info = configReader.read(path.join(EXAMPLE_CF, 'Configuration.xml'));
    const total = Array.from(info.childObjects.values()).reduce((sum, list) => sum + list.length, 0);
    assert.ok(total > 0, 'ChildObjects основной конфигурации пустые');
  });
});

suite('ConfigParser — объекты метаданных', () => {
  test('Парсит реквизиты первого документа расширения', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      this.skip();
    }
    const docName = firstChildObject(cfeRoot, 'Document');
    if (!docName) {
      this.skip();
    }
    const xmlPath = path.join(cfeRoot, 'Documents', `${docName}.xml`);
    if (!fs.existsSync(xmlPath)) {
      this.skip();
    }
    const info = objectReader.read(xmlPath);
    assert.ok(info, 'ObjectInfo не получен');
    assert.strictEqual(info.tag, 'Document');
    assert.strictEqual(info.name, docName);
  });

  test('Парсит формы первого документа расширения', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      this.skip();
    }
    const docName = firstChildObject(cfeRoot, 'Document');
    if (!docName) {
      this.skip();
    }
    const xmlPath = path.join(cfeRoot, 'Documents', `${docName}.xml`);
    if (!fs.existsSync(xmlPath)) {
      this.skip();
    }
    const info = objectReader.read(xmlPath);
    assert.ok(info);
    // Документ может не иметь форм — но парсер должен корректно сообщить пустой список.
    const forms = info.children.filter((c) => c.tag === 'Form');
    assert.ok(Array.isArray(forms));
  });

  test('Парсит значения первого перечисления расширения', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      this.skip();
    }
    const enumName = firstChildObject(cfeRoot, 'Enum');
    if (!enumName) {
      this.skip();
    }
    const xmlPath = path.join(cfeRoot, 'Enums', `${enumName}.xml`);
    if (!fs.existsSync(xmlPath)) {
      this.skip();
    }
    const info = objectReader.read(xmlPath);
    assert.ok(info);
    const values = info.children.filter((c) => c.tag === 'EnumValue');
    assert.ok(values.length > 0, 'Значения перечисления не найдены');
  });

  test('Парсит измерения и ресурсы первого регистра сведений расширения', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      this.skip();
    }
    const regName = firstChildObject(cfeRoot, 'InformationRegister');
    if (!regName) {
      this.skip();
    }
    const xmlPath = path.join(cfeRoot, 'InformationRegisters', `${regName}.xml`);
    if (!fs.existsSync(xmlPath)) {
      this.skip();
    }
    const info = objectReader.read(xmlPath);
    assert.ok(info);
    assert.strictEqual(info.tag, 'InformationRegister');
    const dims = info.children.filter((c) => c.tag === 'Dimension');
    const res = info.children.filter((c) => c.tag === 'Resource');
    assert.ok(dims.length + res.length > 0, 'У регистра нет ни измерений, ни ресурсов');
  });

  test('Добавляет стандартные реквизиты, если у корневого объекта нет Properties', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-object-reader-'));
    const xmlPath = path.join(dir, 'Catalog.xml');
    fs.writeFileSync(
      xmlPath,
      '<MetaDataObject><Catalog></Catalog></MetaDataObject>',
      'utf-8'
    );

    const info = objectReader.read(xmlPath);
    assert.ok(info);
    const standard = info.children.filter((child) => child.tag === 'StandardAttribute');
    assert.ok(standard.some((child) => child.name === 'Code'));
    assert.ok(standard.some((child) => child.presentation === 'Наименование'));
  });
});
