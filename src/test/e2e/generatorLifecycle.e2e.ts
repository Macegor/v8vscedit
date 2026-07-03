import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../extension';
import type { CommandServices } from '../../ui/commands/_shared';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { isOnecAvailable, readOnecEnv } from '../suite/support/onecEnv';

/**
 * E2E: полный жизненный цикл генерации на реальной выгрузке (по умолчанию
 * example/2.20) через КОМАНДЫ/СЕРВИСЫ расширения и реальную загрузку в базу 1С:
 * создать → загрузить → дочерние → загрузить → изменить свойство → загрузить →
 * удалить → обновить. Каждый `updateChangedConfigurations` возвращает false при
 * отклонении конфигурации платформой — так падение теста = реальный баг
 * генерации. Без платформы/базы из env.json тесты пропускаются.
 *
 * Запуск: `npm run test:e2e` (на машине с 1С и заполненным env.json).
 */
const CATALOG_NAME = 'E2EГенераторСправочник';

suite('E2E: жизненный цикл генерации в базе 1С', function () {
  // Конфигуратор 1С долгий.
  this.timeout(30 * 60 * 1000);

  let services: CommandServices | undefined;
  let configRoot = '';
  let available = false;

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => (e.packageJSON as { name?: string }).name === 'v8vscedit');
    if (!ext) {
      return;
    }
    const api = (await ext.activate()) as ExtensionApi | undefined;
    if (!api) {
      return;
    }
    services = api.container.getServicesForTests();
    const workspaceRoot = services.workspaceFolder.uri.fsPath;
    configRoot = path.join(workspaceRoot, 'src', 'cf');
    available = isOnecAvailable(readOnecEnv(workspaceRoot));
  });

  suiteTeardown(() => {
    // Возвращаем выгрузку к исходному состоянию независимо от исхода.
    if (services && fs.existsSync(path.join(configRoot, 'Catalogs', `${CATALOG_NAME}.xml`))) {
      services.metadataXmlRemover.removeRootObject({ configRoot, kind: 'Catalog', name: CATALOG_NAME });
    }
  });

  async function loadIntoBase(): Promise<boolean> {
    return (await vscode.commands.executeCommand('v8vscedit.updateChangedConfigurations')) === true;
  }

  function ensureReady(ctx: Mocha.Context): CommandServices | null {
    if (!available || !services) {
      ctx.skip();
      return null;
    }
    return services;
  }

  test('создать объект → загрузить в базу', async function () {
    const svc = ensureReady(this);
    if (!svc) {
      return;
    }
    const result = svc.metadataXmlCreator.addRootObject({ configRoot, kind: 'Catalog', name: CATALOG_NAME });
    assert.strictEqual(result.success, true, `создание: ${result.errors.join('; ')}`);
    svc.markChangedConfigurationByFiles(result.changedFiles);
    assert.strictEqual(await loadIntoBase(), true, 'платформа отклонила созданный объект');
  });

  test('добавить дочерние элементы → загрузить в базу', async function () {
    const svc = ensureReady(this);
    if (!svc) {
      return;
    }
    const ownerXml = path.join(configRoot, 'Catalogs', `${CATALOG_NAME}.xml`);
    const changed: string[] = [];
    for (const step of [
      { childTag: 'Attribute' as const, name: 'E2EРеквизит' },
      { childTag: 'TabularSection' as const, name: 'E2EТабличнаяЧасть' },
      { childTag: 'Form' as const, name: 'E2EФорма' },
    ]) {
      const r = svc.metadataXmlCreator.addChildElement({ ownerObjectXmlPath: ownerXml, ...step });
      assert.strictEqual(r.success, true, `${step.childTag}: ${r.errors.join('; ')}`);
      changed.push(...r.changedFiles);
    }
    const col = svc.metadataXmlCreator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Column', name: 'E2EКолонка', tabularSectionName: 'E2EТабличнаяЧасть' });
    assert.strictEqual(col.success, true, `Column: ${col.errors.join('; ')}`);
    changed.push(...col.changedFiles);

    svc.markChangedConfigurationByFiles(changed);
    assert.strictEqual(await loadIntoBase(), true, 'платформа отклонила объект с дочерними элементами');
  });

  test('изменить свойство → загрузить в базу', async function () {
    const svc = ensureReady(this);
    if (!svc) {
      return;
    }
    const ownerXml = path.join(configRoot, 'Catalogs', `${CATALOG_NAME}.xml`);
    const changed = new ObjectXmlReader().updatePropertyInObject(ownerXml, {
      targetKind: 'Self',
      targetName: CATALOG_NAME,
      propertyKey: 'Comment',
      valueKind: 'string',
      value: 'E2E правка свойства',
    });
    assert.strictEqual(changed, true, 'свойство Comment не изменилось');
    svc.markChangedConfigurationByFiles([ownerXml]);
    assert.strictEqual(await loadIntoBase(), true, 'платформа отклонила изменение свойства');
  });

  test('удалить объект → обновить базу', async function () {
    const svc = ensureReady(this);
    if (!svc) {
      return;
    }
    const result = svc.metadataXmlRemover.removeRootObject({ configRoot, kind: 'Catalog', name: CATALOG_NAME });
    assert.strictEqual(result.success, true, `удаление: ${result.errors.join('; ')}`);
    svc.markChangedConfigurationByFiles(result.changedFiles);
    assert.strictEqual(await loadIntoBase(), true, 'платформа отклонила удаление объекта');
  });
});
