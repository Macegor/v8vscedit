import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { BslReadonlyGuard } from '../../ui/readonly/BslReadonlyGuard';
import type { RepositoryService } from '../../infra/repository/RepositoryService';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import {
  LineLogger,
  makeTempDir,
  objectXml,
  removeTempDir,
  testUuid,
  writeBin,
  writeFileIn,
} from './support/parentConfigurationsBin';

const LOCKED = testUuid(301);
const EDITABLE = testUuid(302);
const REMOVED = testUuid(303);
const NONE = testUuid(304);

const READONLY_COMMAND = 'workbench.action.files.setActiveEditorReadonlyInSession';

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Условие не выполнено за отведённое время ожидания');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * BslReadonlyGuard с РЕАЛЬНЫМ SupportInfoService (плоская раскладка выгрузки):
 * readonly ставится только для Locked; Editable/Removed/None не блокируются.
 * Решение принимается синхронно в обработчике onDidOpenTextDocument, поэтому
 * «не заблокировано» проверяется по отсутствию строки лога и вызова команды.
 */
suite('BslReadonlyGuard — режимы поддержки (реальный SupportInfoService)', () => {
  let tmp: string;
  let cf: string;
  let readonlyCalls: number;
  let originalExecute: typeof vscode.commands.executeCommand;
  const guardLog = new LineLogger();

  setup(() => {
    tmp = makeTempDir('v8vscedit-guard-support-');
    cf = path.join(tmp, 'cf');
    writeFileIn(cf, 'Documents/Заперт.xml', objectXml('Document', LOCKED, 'Заперт'));
    writeFileIn(cf, 'Documents/Разрешён.xml', objectXml('Document', EDITABLE, 'Разрешён'));
    writeFileIn(cf, 'Documents/Снят.xml', objectXml('Document', REMOVED, 'Снят'));
    writeFileIn(cf, 'Documents/Собственный.xml', objectXml('Document', NONE, 'Собственный'));
    writeBin(cf, [{
      name: 'П',
      records: [
        { code: 0, uuid: LOCKED },
        { code: 1, uuid: EDITABLE },
        { code: 2, uuid: REMOVED },
      ],
    }]);
    guardLog.lines.length = 0;
    readonlyCalls = 0;
    originalExecute = vscode.commands.executeCommand;
    (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = ((
      command: string,
      ...rest: unknown[]
    ) => {
      if (command === READONLY_COMMAND) {
        readonlyCalls += 1;
      }
      return (originalExecute as (c: string, ...r: unknown[]) => Thenable<unknown>)(command, ...rest);
    }) as typeof vscode.commands.executeCommand;
  });

  teardown(async () => {
    (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecute;
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    removeTempDir(tmp);
  });

  async function openBsl(relPath: string): Promise<void> {
    const file = writeFileIn(cf, relPath, 'Процедура Тест()\nКонецПроцедуры\n');
    const support = new SupportInfoService(new LineLogger());
    support.loadConfig(cf);
    const repositoryService = { isEditRestricted: () => false } as unknown as RepositoryService;
    const guard = new BslReadonlyGuard(support, repositoryService, guardLog as unknown as vscode.OutputChannel);
    const disposable = guard.register();
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(doc, { preview: false });
      if (guardLog.includes('Блокировка')) {
        await waitUntil(() => readonlyCalls > 0, 5000);
      }
    } finally {
      disposable.dispose();
    }
  }

  test('Locked: модуль объекта — readonly', async function () {
    this.timeout(15_000);
    await openBsl('Documents/Заперт/Ext/ObjectModule.bsl');
    assert.strictEqual(guardLog.includes('Блокировка'), true);
    assert.strictEqual(readonlyCalls, 1);
  });

  test('Locked: модуль формы без дескриптора наследует Locked объекта — readonly', async function () {
    this.timeout(15_000);
    await openBsl('Documents/Заперт/Forms/Ф/Ext/Form/Module.bsl');
    assert.strictEqual(guardLog.includes('Блокировка'), true);
    assert.strictEqual(readonlyCalls, 1);
  });

  const notBlocked: readonly (readonly [string, string])[] = [
    ['Editable', 'Documents/Разрешён/Ext/ObjectModule.bsl'],
    ['Removed', 'Documents/Снят/Ext/ObjectModule.bsl'],
    ['None', 'Documents/Собственный/Ext/ObjectModule.bsl'],
  ];
  for (const [title, rel] of notBlocked) {
    test(`${title}: readonly не ставится`, async function () {
      this.timeout(15_000);
      await openBsl(rel);
      assert.strictEqual(guardLog.includes('Блокировка'), false);
      assert.strictEqual(readonlyCalls, 0);
    });
  }
});
