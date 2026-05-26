import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { RepositoryService } from '../../infra/repository/RepositoryService';

const EXAMPLE_ROOT = path.resolve(__dirname, '../../../example');
const EXAMPLE_CF = path.join(EXAMPLE_ROOT, 'src', 'cf');

suite('RepositoryService', () => {
  let service: RepositoryService;
  let envBackup: string | undefined;
  let stateBackup: string | undefined;

  const envPath = path.join(EXAMPLE_ROOT, 'env.json');
  const statePath = path.join(EXAMPLE_ROOT, '.v8vscedit', 'repository', 'state.json');

  setup(() => {
    service = new RepositoryService(EXAMPLE_ROOT);
    envBackup = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : undefined;
    stateBackup = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf-8') : undefined;
  });

  teardown(() => {
    restoreFile(envPath, envBackup);
    restoreFile(statePath, stateBackup);
  });

  test('Запрещает редактирование незахваченного модуля объекта при активном подключении к хранилищу', function () {
    const target_ = findFirstCatalogWithModule();
    if (!target_) {
      this.skip();
    }
    const { xmlPath, modulePath, objectName } = target_;
    const target = service.resolveTargetByXmlPath(xmlPath);

    assert.ok(target, 'Не удалось определить цель хранилища для примера.');

    service.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    service.setConnected(target, true);

    assert.strictEqual(service.isEditRestricted(modulePath), true);

    const fullName = service.resolveFullName({
      nodeKind: 'Catalog',
      label: objectName,
      xmlPath,
    });
    assert.strictEqual(fullName, `Справочник.${objectName}`);

    service.setLocked(target, [fullName], true);
    assert.strictEqual(service.isEditRestricted(modulePath), false);
  });

  test('Для модуля формы использует захват корневого объекта', function () {
    const target_ = findFirstCatalogWithForm();
    if (!target_) {
      this.skip();
    }
    const { xmlPath, formModulePath, objectName } = target_;
    const target = service.resolveTargetByXmlPath(xmlPath);

    assert.ok(target, 'Не удалось определить цель хранилища для примера.');

    service.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    service.setConnected(target, true);

    assert.strictEqual(service.isEditRestricted(formModulePath), true);

    service.setLocked(target, [`Справочник.${objectName}`], true);
    assert.strictEqual(service.isEditRestricted(formModulePath), false);
  });
  test('Для создания корневых объектов требуется захват корня конфигурации', () => {
    const configXmlPath = path.join(EXAMPLE_CF, 'Configuration.xml');
    const target = service.resolveTargetByConfigRoot(EXAMPLE_CF);

    assert.ok(target, 'Не удалось определить цель хранилища для корня конфигурации.');

    service.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    service.setConnected(target, true);

    assert.strictEqual(service.isMetadataEditRestricted(target), true);
    assert.strictEqual(service.isRootLocked(target), false);

    const objects = service.createObjectsFileForNode({
      nodeKind: 'configuration',
      label: 'Конфигурация',
      xmlPath: configXmlPath,
    }, false);

    service.setLocked(target, objects.fullNames, true);

    assert.strictEqual(service.isRootLocked(target), true);
    assert.strictEqual(service.isMetadataEditRestricted(target), false);
  });

  test('findConfigRoot — повторный resolveTargetByXmlPath возвращает кэшированный target', () => {
    const target_ = findFirstCatalogWithModule();
    if (!target_) {
      return;
    }
    const { xmlPath } = target_;

    const first = service.resolveTargetByXmlPath(xmlPath);
    assert.ok(first, 'Первый вызов должен найти конфигурацию.');

    // После прогрева внутренний кэш findConfigRoot должен содержать запись
    // ровно для директории файла. Это и есть наблюдаемое свидетельство мемоизации.
    const size = service.getConfigRootCacheSize();
    assert.ok(size > 0, 'Кэш findConfigRoot должен заполниться при первом проходе.');

    const second = service.resolveTargetByXmlPath(xmlPath);
    assert.deepStrictEqual(second, first);
    assert.strictEqual(service.getConfigRootCacheSize(), size, 'Повторный вызов не должен расширять кэш.');
  });

  test('findConfigRoot — invalidateConfigRootCache сбрасывает кэш', () => {
    const target_ = findFirstCatalogWithModule();
    if (!target_) {
      return;
    }
    const { xmlPath } = target_;

    service.resolveTargetByXmlPath(xmlPath);
    assert.ok(service.getConfigRootCacheSize() > 0);

    service.invalidateConfigRootCache();
    assert.strictEqual(service.getConfigRootCacheSize(), 0);

    // После сброса кэша повторный вызов снова прогревает кэш.
    service.resolveTargetByXmlPath(xmlPath);
    assert.ok(service.getConfigRootCacheSize() > 0);
  });
});

// Ищет справочник, у которого есть XML и реальный ObjectModule.bsl рядом.
function findFirstCatalogWithModule(): { xmlPath: string; modulePath: string; objectName: string } | null {
  const catalogsDir = path.join(EXAMPLE_CF, 'Catalogs');
  if (!fs.existsSync(catalogsDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(catalogsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.xml')) {
      continue;
    }
    const objectName = path.basename(entry.name, '.xml');
    const xmlPath = path.join(catalogsDir, entry.name);
    const modulePath = path.join(catalogsDir, objectName, 'Ext', 'ObjectModule.bsl');
    if (fs.existsSync(modulePath)) {
      return { xmlPath, modulePath, objectName };
    }
  }
  return null;
}

// Ищет справочник, у которого есть XML и модуль формы рядом.
function findFirstCatalogWithForm(): { xmlPath: string; formModulePath: string; objectName: string } | null {
  const catalogsDir = path.join(EXAMPLE_CF, 'Catalogs');
  if (!fs.existsSync(catalogsDir)) {
    return null;
  }
  for (const entry of fs.readdirSync(catalogsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.xml')) {
      continue;
    }
    const objectName = path.basename(entry.name, '.xml');
    const xmlPath = path.join(catalogsDir, entry.name);
    const formsDir = path.join(catalogsDir, objectName, 'Forms');
    if (!fs.existsSync(formsDir)) {
      continue;
    }
    for (const formEntry of fs.readdirSync(formsDir, { withFileTypes: true })) {
      if (!formEntry.isDirectory()) {
        continue;
      }
      const formModulePath = path.join(formsDir, formEntry.name, 'Ext', 'Form', 'Module.bsl');
      if (fs.existsSync(formModulePath)) {
        return { xmlPath, formModulePath, objectName };
      }
    }
  }
  return null;
}

function restoreFile(filePath: string, backup: string | undefined): void {
  if (backup === undefined) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, backup, 'utf-8');
}
