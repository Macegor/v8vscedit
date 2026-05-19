import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentWorkspaceService } from '../../infra/agent/AgentWorkspaceService';
import { mirrorDirectorySnapshot } from '../../infra/agent/DirectorySnapshot';

suite('AgentWorkspaceService', () => {
  test('строит пути агента внутри .v8vscedit/agent', () => {
    const root = createTempRoot();
    try {
      const service = new AgentWorkspaceService(root);
      const workspace = service.resolveWorkspace('file-base', { kind: 'cfe', extensionName: 'EVOLC' });

      assert.strictEqual(workspace.projectRoot, root);
      assert.strictEqual(workspace.agentRoot, path.join(root, '.v8vscedit', 'agent'));
      assert.strictEqual(workspace.targetDir, path.join(root, '.v8vscedit', 'agent', '0', 'workspace', 'file-base', 'cfe', 'EVOLC'));
      assert.strictEqual(workspace.targetAgentDir, 'workspace/file-base/cfe/EVOLC');
      assert.ok(!workspace.targetDir.startsWith(path.join(root, 'src', 'cfe')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('создаёт list-файл с относительными путями и UTF-8 BOM', () => {
    const root = createTempRoot();
    try {
      const service = new AgentWorkspaceService(root);
      const listPath = service.writeListFile('operation-1', [
        'Configuration.xml',
        'Catalogs/Контрагенты.xml',
      ]);

      assert.strictEqual(listPath, path.join(root, '.v8vscedit', 'agent', '0', 'lists', 'operation-1.txt'));
      const data = fs.readFileSync(listPath);
      assert.deepStrictEqual([...data.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      assert.strictEqual(data.subarray(3).toString('utf-8'), 'Configuration.xml\nCatalogs/Контрагенты.xml');
      assert.strictEqual(service.toAgentPath(listPath), 'lists/operation-1.txt');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('запрещает абсолютные пути и выход из каталога в list-файле', () => {
    const root = createTempRoot();
    try {
      const service = new AgentWorkspaceService(root);

      assert.throws(() => service.writeListFile('bad-absolute', ['/tmp/Configuration.xml']), /относительными/);
      assert.throws(() => service.writeListFile('bad-parent', ['../Configuration.xml']), /выходить за пределы/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('копирующая синхронизация не перемещает исходники проекта', () => {
    const root = createTempRoot();
    try {
      const source = path.join(root, 'src', 'cf');
      const target = path.join(root, '.v8vscedit', 'agent', 'workspace', 'cf');
      fs.mkdirSync(source, { recursive: true });
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(source, 'Configuration.xml'), '<new/>', 'utf-8');
      fs.writeFileSync(path.join(target, 'Old.xml'), '<old/>', 'utf-8');

      mirrorDirectorySnapshot(source, target);

      assert.ok(fs.existsSync(path.join(source, 'Configuration.xml')));
      assert.ok(fs.existsSync(path.join(target, 'Configuration.xml')));
      assert.ok(!fs.existsSync(path.join(target, 'Old.xml')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-agent-test-'));
}
