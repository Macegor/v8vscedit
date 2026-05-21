import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MetadataInfoService,
  MetadataValidationService,
} from '../../infra/xml';

suite('metadataInfoValidationService', () => {
  test('читает структуру объекта из каталога объекта', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-info-'));
    const catalogDir = path.join(root, 'Catalogs');
    const objectDir = path.join(catalogDir, 'Товары');
    fs.mkdirSync(objectDir, { recursive: true });
    fs.writeFileSync(path.join(catalogDir, 'Товары.xml'), buildCatalogXml(), 'utf-8');

    const result = new MetadataInfoService().read({
      objectPath: objectDir,
      mode: 'full',
      name: 'Состав',
    });

    assert.strictEqual(result.kind, 'Catalog');
    assert.strictEqual(result.name, 'Товары');
    assert.strictEqual(result.synonym, 'Товары');
    assert.strictEqual(result.childCounts.Attribute, 1);
    assert.strictEqual(result.childCounts.TabularSection, 1);
    assert.strictEqual(result.childCounts.Column, 1);
    assert.strictEqual(result.drillDown?.name, 'Состав');
    assert.ok(result.lines.some((line) => line.includes('Количество')));
  });

  test('валидирует корректный объект без ошибок', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-validate-ok-'));
    fs.mkdirSync(path.join(root, 'Catalogs'), { recursive: true });
    const xmlPath = path.join(root, 'Catalogs', 'Товары.xml');
    fs.writeFileSync(xmlPath, buildCatalogXml(), 'utf-8');

    const result = new MetadataValidationService().validate({ objectPath: xmlPath, detailed: true });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.errors, 0);
    assert.strictEqual(result.objects[0].kind, 'Catalog');
    assert.ok(result.objects[0].issues.some((issue) => issue.code === 'parsed'));
  });

  test('находит ошибки имени, uuid и дублей дочерних элементов', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-validate-bad-'));
    fs.mkdirSync(path.join(root, 'Catalogs'), { recursive: true });
    const xmlPath = path.join(root, 'Catalogs', 'Плохой.xml');
    fs.writeFileSync(xmlPath, buildInvalidCatalogXml(), 'utf-8');

    const result = new MetadataValidationService().validate({ objectPath: xmlPath, maxErrors: 10 });

    assert.strictEqual(result.ok, false);
    assert.ok(result.objects[0].issues.some((issue) => issue.code === 'invalid-name'));
    assert.ok(result.objects[0].issues.some((issue) => issue.code === 'invalid-uuid'));
    assert.ok(result.objects[0].issues.some((issue) => issue.code === 'duplicate-child'));
  });

  test('ограничивает количество ошибок maxErrors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-validate-limit-'));
    fs.mkdirSync(path.join(root, 'Catalogs'), { recursive: true });
    const xmlPath = path.join(root, 'Catalogs', 'Плохой.xml');
    fs.writeFileSync(xmlPath, buildInvalidCatalogXml(), 'utf-8');

    const result = new MetadataValidationService().validate({ objectPath: xmlPath, maxErrors: 1 });

    assert.strictEqual(result.errors, 1);
    assert.strictEqual(result.objects[0].issues.filter((issue) => issue.severity === 'error').length, 1);
  });

  test('возвращает ошибку для отсутствующего XML объекта', () => {
    const result = new MetadataValidationService().validate({ objectPath: path.join(os.tmpdir(), 'missing-object.xml') });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.objects[0].issues[0].code, 'file-not-found');
  });

  test('поддерживает пакетную проверку путей через pipe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-meta-validate-batch-'));
    fs.mkdirSync(path.join(root, 'Catalogs'), { recursive: true });
    const first = path.join(root, 'Catalogs', 'Товары.xml');
    const second = path.join(root, 'Catalogs', 'Услуги.xml');
    fs.writeFileSync(first, buildCatalogXml('Товары'), 'utf-8');
    fs.writeFileSync(second, buildCatalogXml('Услуги'), 'utf-8');

    const result = new MetadataValidationService().validate({ objectPath: `${first}|${second}` });

    assert.strictEqual(result.objects.length, 2);
    assert.strictEqual(result.errors, 0);
  });
});

function buildCatalogXml(name = 'Товары'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Catalog uuid="11111111-1111-1111-1111-111111111111">
    <Properties>
      <Name>${name}</Name>
      <Synonym>
        <v8:item>
          <v8:lang>ru</v8:lang>
          <v8:content>${name}</v8:content>
        </v8:item>
      </Synonym>
    </Properties>
    <ChildObjects>
      <Attribute>
        <Properties>
          <Name>Артикул</Name>
          <Synonym>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>Артикул</v8:content>
            </v8:item>
          </Synonym>
        </Properties>
      </Attribute>
      <TabularSection>
        <Properties>
          <Name>Состав</Name>
          <Synonym>
            <v8:item>
              <v8:lang>ru</v8:lang>
              <v8:content>Состав</v8:content>
            </v8:item>
          </Synonym>
        </Properties>
        <ChildObjects>
          <Attribute>
            <Properties>
              <Name>Количество</Name>
              <Synonym>
                <v8:item>
                  <v8:lang>ru</v8:lang>
                  <v8:content>Количество</v8:content>
                </v8:item>
              </Synonym>
            </Properties>
          </Attribute>
        </ChildObjects>
      </TabularSection>
    </ChildObjects>
  </Catalog>
</MetaDataObject>`;
}

function buildInvalidCatalogXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Catalog uuid="bad">
    <Properties>
      <Name>1Плохой</Name>
    </Properties>
    <ChildObjects>
      <Attribute>
        <Properties>
          <Name>Код</Name>
        </Properties>
      </Attribute>
      <Attribute>
        <Properties>
          <Name>Код</Name>
        </Properties>
      </Attribute>
    </ChildObjects>
  </Catalog>
</MetaDataObject>`;
}
