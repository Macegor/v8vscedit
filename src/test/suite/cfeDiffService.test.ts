import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CfeDiffService } from '../../infra/cfe/CfeDiffService';

suite('cfeDiffService', () => {
  test('показывает заимствованные объекты и перехватчики BSL', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-diff-'));
    const cfe = path.join(root, 'cfe');
    fs.mkdirSync(path.join(cfe, 'Catalogs', 'Товары', 'Ext'), { recursive: true });
    fs.writeFileSync(path.join(cfe, 'Configuration.xml'), buildConfigurationXml(), 'utf-8');
    fs.writeFileSync(path.join(cfe, 'Catalogs', 'Товары.xml'), buildBorrowedCatalogXml(), 'utf-8');
    fs.writeFileSync(
      path.join(cfe, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl'),
      '&Перед("ПередЗаписью")\nПроцедура Расш_ПередЗаписью()\nКонецПроцедуры\n',
      'utf-8'
    );

    const result = new CfeDiffService().analyze({ extensionPath: cfe, mode: 'overview' });

    assert.strictEqual(result.objects.length, 1);
    assert.strictEqual(result.objects[0].ref, 'Catalog.Товары');
    assert.strictEqual(result.objects[0].borrowed, true);
    assert.strictEqual(result.objects[0].interceptors.length, 1);
    assert.strictEqual(result.objects[0].interceptors[0].type, 'Перед');
    assert.strictEqual(result.objects[0].interceptors[0].method, 'ПередЗаписью');
  });

  test('проверяет перенос блоков #Вставка в основную конфигурацию', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-diff-transfer-'));
    const cfe = path.join(root, 'cfe');
    const cf = path.join(root, 'cf');
    fs.mkdirSync(path.join(cfe, 'Catalogs', 'Товары', 'Ext'), { recursive: true });
    fs.mkdirSync(path.join(cf, 'Catalogs', 'Товары', 'Ext'), { recursive: true });
    fs.writeFileSync(path.join(cfe, 'Configuration.xml'), buildConfigurationXml(), 'utf-8');
    fs.writeFileSync(path.join(cfe, 'Catalogs', 'Товары.xml'), buildBorrowedCatalogXml(), 'utf-8');
    fs.writeFileSync(
      path.join(cfe, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl'),
      [
        '&ИзменениеИКонтроль("ПередЗаписью")',
        'Процедура Расш_ПередЗаписью()',
        '#Вставка',
        'Сообщить("перенесено");',
        '#КонецВставки',
        'КонецПроцедуры',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(cf, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl'),
      'Процедура ПередЗаписью()\nСообщить("перенесено");\nКонецПроцедуры\n',
      'utf-8'
    );

    const result = new CfeDiffService().analyze({ extensionPath: cfe, configPath: cf, mode: 'transfer' });

    assert.strictEqual(result.transferChecks.length, 1);
    assert.strictEqual(result.transferChecks[0].status, 'transferred');
  });

  test('возвращает статусы not_transferred и needs_review для спорных вставок', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-diff-status-'));
    const cfe = path.join(root, 'cfe');
    const cf = path.join(root, 'cf');
    fs.mkdirSync(path.join(cfe, 'Catalogs', 'Товары', 'Ext'), { recursive: true });
    fs.mkdirSync(path.join(cf, 'Catalogs', 'Товары', 'Ext'), { recursive: true });
    fs.writeFileSync(path.join(cfe, 'Configuration.xml'), buildConfigurationXml(), 'utf-8');
    fs.writeFileSync(path.join(cfe, 'Catalogs', 'Товары.xml'), buildBorrowedCatalogXml(), 'utf-8');
    fs.writeFileSync(
      path.join(cfe, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl'),
      [
        '// обычная строка без перехватчика',
        '#Вставка',
        'Сообщить("нет в конфигурации");',
        '#КонецВставки',
        '#Вставка',
        '#КонецВставки',
      ].join('\n'),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(cf, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl'),
      'Процедура ПередЗаписью()\nКонецПроцедуры\n',
      'utf-8'
    );

    const result = new CfeDiffService().analyze({ extensionPath: cfe, configPath: cf, mode: 'transfer' });

    assert.deepStrictEqual(
      result.transferChecks.map((item) => item.status),
      ['not_transferred', 'needs_review']
    );
    assert.strictEqual(result.objects[0].interceptors.length, 0);
  });

  test('предупреждает, если режим transfer запущен без пути к конфигурации', () => {
    const cfe = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-diff-warning-'));
    fs.writeFileSync(path.join(cfe, 'Configuration.xml'), buildConfigurationXml(), 'utf-8');

    const result = new CfeDiffService().analyze({ extensionPath: cfe, mode: 'transfer' });

    assert.strictEqual(result.transferChecks.length, 0);
    assert.strictEqual(result.warnings.length, 1);
  });
});

function buildConfigurationXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>EVOLC</Name>
      <ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>
    </Properties>
    <ChildObjects>
      <Catalog>Товары</Catalog>
    </ChildObjects>
  </Configuration>
</MetaDataObject>`;
}

function buildBorrowedCatalogXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Catalog>
    <Properties>
      <Name>Товары</Name>
      <ObjectBelonging>Adopted</ObjectBelonging>
    </Properties>
    <ChildObjects/>
  </Catalog>
</MetaDataObject>`;
}
