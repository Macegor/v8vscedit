import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CfePatchMethodService } from '../../infra/cfe/CfePatchMethodService';

suite('cfePatchMethodService', () => {
  test('создаёт перехватчик метода объекта с префиксом расширения', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-patch-'));
    writeExtensionConfig(root, 'Расш_');

    const service = new CfePatchMethodService();
    const result = service.addMethodInterceptor({
      extensionPath: root,
      modulePath: 'Catalog.Товары.ObjectModule',
      methodName: 'ПередЗаписью',
      interceptorType: 'Before',
      context: 'НаСервере',
      isFunction: false,
    });

    const modulePath = path.join(root, 'Catalogs', 'Товары', 'Ext', 'ObjectModule.bsl');
    assert.strictEqual(result.changedFiles.length, 1);
    assert.strictEqual(result.moduleFilePath, modulePath);
    assert.ok(fs.existsSync(modulePath));

    const bsl = fs.readFileSync(modulePath, 'utf-8');
    assert.ok(bsl.includes('&НаСервере'));
    assert.ok(bsl.includes('&Перед("ПередЗаписью")'));
    assert.ok(bsl.includes('Процедура Расш_ПередЗаписью()'));
    assert.ok(bsl.includes('КонецПроцедуры'));
  });

  test('добавляет функциональный перехватчик формы в существующий модуль', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-patch-form-'));
    writeExtensionConfig(root, 'Ext_');
    const formModule = path.join(root, 'Documents', 'Заказ', 'Forms', 'ФормаДокумента', 'Ext', 'Form', 'Module.bsl');
    fs.mkdirSync(path.dirname(formModule), { recursive: true });
    fs.writeFileSync(formModule, 'Процедура УжеЕсть()\nКонецПроцедуры\n', 'utf-8');

    const service = new CfePatchMethodService();
    const result = service.addMethodInterceptor({
      extensionPath: root,
      modulePath: 'Document.Заказ.Form.ФормаДокумента',
      methodName: 'Цена',
      interceptorType: 'After',
      context: 'НаКлиенте',
      isFunction: true,
    });

    assert.strictEqual(result.created, false);
    const bsl = fs.readFileSync(formModule, 'utf-8');
    assert.ok(bsl.includes('Процедура УжеЕсть()'));
    assert.ok(bsl.includes('&После("Цена")'));
    assert.ok(bsl.includes('Функция Ext_Цена()'));
    assert.ok(bsl.includes('Возврат Неопределено;'));
    assert.ok(bsl.includes('КонецФункции'));
  });
});

function writeExtensionConfig(root: string, prefix: string): void {
  fs.writeFileSync(
    path.join(root, 'Configuration.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>EVOLC</Name>
      <NamePrefix>${prefix}</NamePrefix>
      <ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`,
    'utf-8'
  );
}
