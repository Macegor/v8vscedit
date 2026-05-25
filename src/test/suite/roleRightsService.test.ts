import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RoleRightsService } from '../../infra/role';
import { ConfigurationInfoService, ConfigurationScaffoldService } from '../../infra/xml';

suite('roleRightsService', () => {
  test('читает сводку прав роли из реального Rights.xml', function () {
    // Используем первую найденную роль в example/src/cf/Roles. RLS и шаблоны
    // могут отсутствовать в произвольной выгрузке — проверяем только базовый контракт.
    const target = findFirstRoleRightsPath();
    if (!target) {
      this.skip();
    }
    const result = new RoleRightsService().info({ rightsPath: target.rightsPath, limit: 40 });

    assert.strictEqual(result.name, target.roleName);
    assert.ok(result.totalAllowed > 0);
    assert.ok(result.lines.some((line) => line.includes('Allowed rights')));
  });

  test('валидирует реальную роль без ошибок', function () {
    const target = findFirstRoleRightsPath();
    if (!target) {
      this.skip();
    }
    const result = new RoleRightsService().validate({ rightsPath: target.rightsPath, detailed: true });

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

  test('точечно редактирует Rights.xml: grant/revoke/setRls/setFlags/templates и вложенные объекты', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-role-edit-'));
    new ConfigurationScaffoldService().createConfiguration({
      name: 'Основа',
      outputDir: root,
      compatibilityMode: 'Version8_3_24',
    });
    const service = new RoleRightsService();
    const compiled = service.compile({
      outputDir: root,
      definition: {
        name: 'РольДляРедактирования',
        synonym: 'Роль для редактирования',
        objects: ['Catalog.Контрагенты: @view'],
      },
    });

    const editAdd = service.edit({
      rightsPath: compiled.rightsPath,
      operations: [
        { op: 'grant', object: 'Catalog.Контрагенты', rights: ['Edit'], rls: { Read: '#ДляКонтрагента("")' } },
        { op: 'grant', object: 'Document.Реализация', preset: 'view' },
        { op: 'grant', object: 'Catalog.Контрагенты.Attribute.ИНН', rights: ['View', 'Edit'] },
        { op: 'grant', object: 'DataProcessor.Загрузка.Command.Запустить', rights: ['View'] },
        { op: 'setFlags', flags: { setForNewObjects: true, independentRightsOfChildObjects: true } },
        { op: 'addTemplate', name: 'ДляКонтрагента(Мод)', condition: 'ГДЕ Контрагент = &ТекКонтрагент' },
      ],
    });
    assert.strictEqual(editAdd.success, true);
    assert.strictEqual(editAdd.changed, true);
    assert.ok(editAdd.applied >= 6);

    let xml = fs.readFileSync(compiled.rightsPath, 'utf-8');
    assert.ok(xml.includes('<name>Catalog.Контрагенты</name>'));
    assert.ok(xml.includes('<name>Edit</name>'));
    assert.ok(xml.includes('<condition>#ДляКонтрагента("")</condition>'));
    assert.ok(xml.includes('<name>Document.Реализация</name>'));
    assert.ok(xml.includes('<name>Catalog.Контрагенты.Attribute.ИНН</name>'));
    assert.ok(xml.includes('<name>DataProcessor.Загрузка.Command.Запустить</name>'));
    assert.ok(xml.includes('<setForNewObjects>true</setForNewObjects>'));
    assert.ok(xml.includes('<independentRightsOfChildObjects>true</independentRightsOfChildObjects>'));
    assert.ok(xml.includes('<name>ДляКонтрагента(Мод)</name>'));

    const editRemove = service.edit({
      rightsPath: compiled.rightsPath,
      operations: [
        { op: 'setRls', object: 'Catalog.Контрагенты', right: 'Read', condition: '' },
        { op: 'revoke', object: 'Catalog.Контрагенты', rights: ['Edit'] },
        { op: 'revoke', object: 'Document.Реализация' },
        { op: 'removeTemplate', name: 'ДляКонтрагента(Мод)' },
      ],
    });
    assert.strictEqual(editRemove.success, true);
    assert.strictEqual(editRemove.changed, true);

    xml = fs.readFileSync(compiled.rightsPath, 'utf-8');
    assert.ok(!xml.includes('<name>Document.Реализация</name>'), 'объект Document должен быть удалён');
    assert.ok(!xml.includes('<condition>#ДляКонтрагента("")</condition>'), 'RLS должен быть сброшен');
    assert.ok(!xml.includes('<name>ДляКонтрагента(Мод)</name>'), 'шаблон должен быть удалён');

    const summary = service.info({ rightsPath: compiled.rightsPath });
    const contractors = summary.allowed
      .flatMap((group) => group.objects)
      .find((object) => object.name === 'Контрагенты');
    assert.ok(contractors, 'Catalog.Контрагенты должен остаться в Rights.xml');
    assert.ok(!contractors.rights.some((right) => right.startsWith('Edit')), 'право Edit должно быть отозвано у Контрагенты');

    const validation = service.validate({ rightsPath: compiled.rightsPath });
    assert.strictEqual(validation.errors, 0, validation.lines.join('\n'));
  });

  test('грейс-сценарии edit: ошибки и предупреждения для отсутствующих объектов/прав', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-role-edit-warn-'));
    new ConfigurationScaffoldService().createConfiguration({
      name: 'Основа2',
      outputDir: root,
      compatibilityMode: 'Version8_3_24',
    });
    const service = new RoleRightsService();
    const compiled = service.compile({
      outputDir: root,
      definition: {
        name: 'ПустаяРоль',
        synonym: 'Пустая',
      },
    });

    const missing = service.edit({
      rightsPath: compiled.rightsPath,
      operations: [
        { op: 'revoke', object: 'Catalog.Несуществующий' },
        { op: 'setRls', object: 'Catalog.Несуществующий', right: 'Read', condition: 'X' },
        { op: 'grant', object: 'Catalog.Товары', rls: { Read: '#X("")' } },
      ],
    });
    assert.strictEqual(missing.success, true);
    assert.ok(missing.warnings.length >= 3, `ожидаются предупреждения, получено: ${String(missing.warnings.length)}`);
    assert.ok(missing.warnings.some((w) => w.includes('Catalog.Несуществующий')));
    assert.ok(missing.warnings.some((w) => w.includes('Catalog.Товары') && w.includes('RLS')));

    const broken = service.edit({
      rightsPath: path.join(root, 'Roles', 'НетТакой', 'Ext', 'Rights.xml'),
      operations: [{ op: 'revoke', object: 'Catalog.Что-то' }],
    });
    assert.strictEqual(broken.success, false);
    assert.ok(broken.errors[0].includes('Rights.xml не найден'));
  });

  test('управляет DefaultRoles через фасад: list/add/remove/set, в т.ч. при <DefaultRoles/>', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-default-roles-'));
    const configPath = path.join(root, 'Configuration.xml');
    fs.writeFileSync(
      configPath,
      `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>Тест</Name>
      <DefaultRoles/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`,
      'utf-8'
    );

    const service = new RoleRightsService();
    const initial = service.listDefaultRoles({ configPath: root });
    assert.strictEqual(initial.configXmlPath, configPath);
    assert.deepStrictEqual([...initial.roles], []);

    const afterAdd = service.addDefaultRole({ configPath: root, role: 'БазовыеПрава' });
    assert.strictEqual(afterAdd.success, true);
    assert.strictEqual(afterAdd.changed, true);
    assert.deepStrictEqual([...afterAdd.roles], ['Role.БазовыеПрава']);

    const duplicate = service.addDefaultRole({ configPath: configPath, role: 'Role.БазовыеПрава' });
    assert.strictEqual(duplicate.success, true);
    assert.strictEqual(duplicate.changed, false);
    assert.ok(duplicate.warnings.length > 0);

    const replaced = service.setDefaultRoles({ configPath: root, roles: ['ПолныеПрава', 'Role.Чтение'] });
    assert.strictEqual(replaced.success, true);
    assert.deepStrictEqual([...replaced.roles], ['Role.ПолныеПрава', 'Role.Чтение']);

    const removed = service.removeDefaultRole({ configPath: root, role: 'Role.ПолныеПрава' });
    assert.strictEqual(removed.success, true);
    assert.deepStrictEqual([...removed.roles], ['Role.Чтение']);

    const cleared = service.setDefaultRoles({ configPath: root, roles: [] });
    assert.strictEqual(cleared.success, true);
    assert.deepStrictEqual([...cleared.roles], []);
    const finalXml = fs.readFileSync(configPath, 'utf-8');
    assert.ok(/<DefaultRoles\s*\/>/.test(finalXml));
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

// Находит первую роль в example/src/cf/Roles, у которой есть Ext/Rights.xml.
function findFirstRoleRightsPath(): { rightsPath: string; roleName: string } | null {
  const rolesDir = path.join(__dirname, '..', '..', '..', 'example', 'src', 'cf', 'Roles');
  if (!fs.existsSync(rolesDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(rolesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rightsPath = path.join(rolesDir, entry.name, 'Ext', 'Rights.xml');
    if (fs.existsSync(rightsPath)) {
      return { rightsPath, roleName: entry.name };
    }
  }
  return null;
}

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
