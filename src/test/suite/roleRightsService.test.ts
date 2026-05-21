import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RoleRightsService } from '../../infra/role';
import { ConfigurationInfoService, ConfigurationScaffoldService } from '../../infra/xml';

suite('roleRightsService', () => {
  test('читает сводку прав роли из реального Rights.xml', () => {
    const rightsPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'example',
      'src',
      'cf',
      'Roles',
      'ЧтениеДатЗапретаЗагрузки',
      'Ext',
      'Rights.xml'
    );

    const result = new RoleRightsService().info({ rightsPath, limit: 40 });

    assert.strictEqual(result.name, 'ЧтениеДатЗапретаЗагрузки');
    assert.ok(result.totalAllowed > 0);
    assert.ok(result.rls.length > 0);
    assert.ok(result.templates.includes('ДляРегистра'));
    assert.ok(result.lines.some((line) => line.includes('Allowed rights')));
  });

  test('валидирует реальную роль без ошибок', () => {
    const rightsPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'example',
      'src',
      'cf',
      'Roles',
      'ЧтениеДатЗапретаЗагрузки',
      'Ext',
      'Rights.xml'
    );

    const result = new RoleRightsService().validate({ rightsPath, detailed: true });

    assert.strictEqual(result.errors, 0);
    assert.ok(result.checks > 0);
    assert.ok(result.issues.some((issue) => issue.message.includes('XML well-formed')));
  });

  test('создаёт роль из DSL, регистрирует её и валидирует Rights.xml', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-role-compile-'));
    new ConfigurationScaffoldService().createConfiguration({
      name: 'Основа',
      outputDir: root,
      compatibilityMode: 'Version8_3_24',
    });

    const service = new RoleRightsService();
    const result = service.compile({
      outputDir: root,
      definition: {
        name: 'ЧтениеТоваров',
        synonym: 'Чтение товаров',
        objects: [
          'Справочник.Товары: @view',
          {
            name: 'InformationRegister.Остатки',
            preset: 'view',
            rls: { Read: '#ДляРегистра("")' },
          },
        ],
        templates: [{ name: 'ДляРегистра(Мод)', condition: 'ГДЕ Организация = &ТекущаяОрганизация' }],
      },
    });

    assert.ok(fs.existsSync(result.metadataPath));
    assert.ok(fs.existsSync(result.rightsPath));
    assert.ok(result.changedFiles.includes(path.join(root, 'Configuration.xml')));

    const info = new ConfigurationInfoService().read({ configPath: root });
    assert.deepStrictEqual(info.objectCounts.Role, 1);

    const validation = service.validate({ rightsPath: result.rightsPath, detailed: true });
    assert.strictEqual(validation.errors, 0);
    assert.ok(validation.issues.some((issue) => issue.message.includes('Role.ЧтениеТоваров зарегистрирована')));

    const roleInfo = service.info({ rightsPath: path.join(root, 'Roles', 'ЧтениеТоваров.xml'), showDenied: true });
    assert.strictEqual(roleInfo.name, 'ЧтениеТоваров');
    assert.ok(roleInfo.rls.length > 0);
  });

  test('находит ошибки в некорректном Rights.xml', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-role-invalid-'));
    const rightsPath = path.join(root, 'Roles', 'ПлохаяРоль', 'Ext', 'Rights.xml');
    fs.mkdirSync(path.dirname(rightsPath), { recursive: true });
    fs.writeFileSync(rightsPath, buildInvalidRightsXml(), 'utf-8');

    const result = new RoleRightsService().validate({ rightsPath, maxErrors: 5 });

    assert.ok(result.errors > 0);
    assert.ok(result.warnings > 0);
    assert.ok(result.issues.some((issue) => issue.message.includes('ожидается true/false')));
  });
});

function buildInvalidRightsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Rights xmlns="http://v8.1c.ru/8.2/roles" version="2.18">
  <setForNewObjects>maybe</setForNewObjects>
  <object>
    <name>Catalog.Товары</name>
    <right>
      <name>StrangeRight</name>
      <value>yes</value>
    </right>
  </object>
</Rights>`;
}
