import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import { registerSupportWatcher } from '../../ui/support/SupportWatcher';
import {
  LineLogger,
  makeTempDir,
  objectXml,
  removeTempDir,
  testUuid,
  writeBin,
  writeFileIn,
} from './support/parentConfigurationsBin';

const OBJ = testUuid(401);
const WAIT_MS = 15_000;

suite('registerSupportWatcher — реакция на ParentConfigurations.bin', () => {
  let tmp: string;
  let cf: string;
  let xmlPath: string;
  let context: vscode.ExtensionContext;
  let service: SupportInfoService;
  let refreshes: number;
  let notify: (() => void) | undefined;

  setup(() => {
    tmp = makeTempDir('v8vscedit-support-watcher-');
    cf = path.join(tmp, 'cf');
    xmlPath = writeFileIn(cf, 'Catalogs/Объект.xml', objectXml('Catalog', OBJ, 'Объект'));
    service = new SupportInfoService(new LineLogger());
    refreshes = 0;
    notify = undefined;
    context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
    const folder: vscode.WorkspaceFolder = { uri: vscode.Uri.file(tmp), name: 'tmp', index: 0 };
    registerSupportWatcher(folder, context, service, () => {
      refreshes += 1;
      notify?.();
    });
  });

  teardown(() => {
    for (const d of context.subscriptions) {
      d.dispose();
    }
    removeTempDir(tmp);
  });

  /**
   * Ждёт ближайшего обновления дерева, инициированного действием `act`. Подписка
   * watcher'а на каталог вне workspace поднимается асинхронно и ранние события
   * теряет, поэтому действие повторяется, пока событие не придёт (идемпотентно:
   * каждое повторение записывает то же состояние файла).
   */
  async function refreshAfter(act: () => void): Promise<void> {
    const before = refreshes;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(retry);
        reject(new Error('watcher не сработал за отведённое время'));
      }, WAIT_MS);
      const retry = setInterval(act, 500);
      notify = () => {
        if (refreshes > before) {
          clearTimeout(timer);
          clearInterval(retry);
          resolve();
        }
      };
      act();
    });
  }

  test('создание, изменение и удаление bin перечитывают режим и обновляют дерево', async function () {
    this.timeout(3 * WAIT_MS + 5_000);
    assert.strictEqual(service.getSupportMode(xmlPath), SupportMode.None);

    await refreshAfter(() => writeBin(cf, [{ name: 'П', records: [{ code: 0, uuid: OBJ }] }]));
    assert.strictEqual(service.getSupportMode(xmlPath), SupportMode.Locked, 'после создания bin');

    await refreshAfter(() => writeBin(cf, [{ name: 'П', records: [{ code: 1, uuid: OBJ }] }]));
    assert.strictEqual(service.getSupportMode(xmlPath), SupportMode.Editable, 'после изменения bin');

    await refreshAfter(() => {
      fs.rmSync(path.join(cf, 'Ext', 'ParentConfigurations.bin'), { force: true });
    });
    assert.strictEqual(service.getSupportMode(xmlPath), SupportMode.None, 'после удаления bin');
  });
});
