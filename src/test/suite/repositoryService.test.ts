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

  test('Запрещает редактирование незахваченного модуля объекта при активном подключении к хранилищу', () => {
    const objectName = 'УдалитьЗаявкаКабинетСотрудника';
    const xmlPath = path.join(EXAMPLE_CF, 'BusinessProcesses', `${objectName}.xml`);
    const modulePath = path.join(EXAMPLE_CF, 'BusinessProcesses', objectName, 'Ext', 'ObjectModule.bsl');
    const target = service.resolveTargetByXmlPath(xmlPath);

    assert.ok(target, 'Не удалось определить цель хранилища для примера.');

    service.saveBinding(target!, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    service.setConnected(target!, true);

    assert.strictEqual(service.isEditRestricted(modulePath), true);

    const fullName = service.resolveFullName({
      nodeKind: 'BusinessProcess',
      label: objectName,
      xmlPath,
    });
    assert.strictEqual(fullName, 'БизнесПроцесс.УдалитьЗаявкаКабинетСотрудника');

    service.setLocked(target!, [fullName!], true);
    assert.strictEqual(service.isEditRestricted(modulePath), false);
  });

  test('Для модуля формы использует захват корневого объекта', () => {
    const objectName = 'УдалитьЗаявкаКабинетСотрудника';
    const xmlPath = path.join(EXAMPLE_CF, 'BusinessProcesses', `${objectName}.xml`);
    const formModulePath = path.join(
      EXAMPLE_CF,
      'BusinessProcesses',
      objectName,
      'Forms',
      'ФормаСписка',
      'Ext',
      'Form',
      'Module.bsl'
    );
    const target = service.resolveTargetByXmlPath(xmlPath);

    assert.ok(target, 'Не удалось определить цель хранилища для примера.');

    service.saveBinding(target!, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    service.setConnected(target!, true);

    assert.strictEqual(service.isEditRestricted(formModulePath), true);

    service.setLocked(target!, ['БизнесПроцесс.УдалитьЗаявкаКабинетСотрудника'], true);
    assert.strictEqual(service.isEditRestricted(formModulePath), false);
  });
});

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
