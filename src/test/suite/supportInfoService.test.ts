import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import type { Logger } from '../../infra/support/Logger';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

class TestLogger implements Logger {
  readonly messages: string[] = [];

  appendLine(message: string): void {
    this.messages.push(message);
  }
}

suite('SupportInfoService', () => {
  test('Трактует код 1 из ParentConfigurations.bin как редактирование с сохранением поддержки', function () {
    // Тест требует наличия ParentConfigurations.bin в example/. В минимальной
    // выгрузке без поддержки бинарника нет — тогда тест неприменим, а сервис
    // корректно возвращает None для любого пути (это покрывают другие тесты).
    const binPath = path.join(EXAMPLE_CF, 'Ext', 'ParentConfigurations.bin');
    if (!fs.existsSync(binPath)) {
      this.skip();
    }
    const service = new SupportInfoService(new TestLogger());
    const configurationXml = path.join(EXAMPLE_CF, 'Configuration.xml');

    service.loadConfig(EXAMPLE_CF);

    assert.strictEqual(service.getSupportMode(configurationXml), SupportMode.Editable);
    assert.strictEqual(service.isLocked(configurationXml), false);
  });
});
