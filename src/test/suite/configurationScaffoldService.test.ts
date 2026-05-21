import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ConfigurationInfoService,
  ConfigurationScaffoldService,
  ConfigurationValidationService,
} from '../../infra/xml';

suite('configurationScaffoldService', () => {
  test('создаёт пустую CF-конфигурацию и она проходит базовую валидацию', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cf-init-'));
    const service = new ConfigurationScaffoldService();
    const result = service.createConfiguration({
      name: 'МояКонфигурация',
      synonym: 'Моя конфигурация',
      outputDir: root,
      version: '1.0.0.1',
      vendor: 'Тест',
      compatibilityMode: 'Version8_3_24',
    });

    assert.ok(result.changedFiles.includes(path.join(root, 'Configuration.xml')));
    assert.ok(fs.existsSync(path.join(root, 'Languages', 'Русский.xml')));

    const info = new ConfigurationInfoService().read({ configPath: root, mode: 'brief' });
    assert.strictEqual(info.name, 'МояКонфигурация');
    assert.strictEqual(info.synonym, 'Моя конфигурация');
    assert.strictEqual(info.version, '1.0.0.1');
    assert.strictEqual(info.objectCounts.Language, 1);

    const validation = new ConfigurationValidationService().validate({ configPath: root, detailed: true });
    assert.strictEqual(validation.errors, 0);
  });

  test('создаёт CFE-расширение с ролью и наследует режим совместимости из CF', () => {
    const cfRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cf-base-'));
    const cfeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-cfe-init-'));
    new ConfigurationScaffoldService().createConfiguration({
      name: 'Основа',
      outputDir: cfRoot,
      compatibilityMode: 'Version8_3_27',
    });

    const result = new ConfigurationScaffoldService().createExtension({
      name: 'Расширение',
      namePrefix: 'Расш_',
      outputDir: cfeRoot,
      configPath: cfRoot,
      purpose: 'Customization',
    });

    assert.deepStrictEqual(result.warnings, []);
    assert.ok(fs.existsSync(path.join(cfeRoot, 'Roles', 'Расш_ОсновнаяРоль.xml')));
    const xml = fs.readFileSync(path.join(cfeRoot, 'Configuration.xml'), 'utf-8');
    assert.ok(xml.includes('<ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>'));
    assert.ok(xml.includes('<NamePrefix>Расш_</NamePrefix>'));
    assert.ok(xml.includes('<ConfigurationExtensionCompatibilityMode>Version8_3_27</ConfigurationExtensionCompatibilityMode>'));

    const validation = new ConfigurationValidationService().validate({ configPath: cfeRoot });
    assert.strictEqual(validation.errors, 0);
  });
});
