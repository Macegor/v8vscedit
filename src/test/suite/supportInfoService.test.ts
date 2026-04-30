import * as assert from 'assert';
import * as path from 'path';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import { Logger } from '../../infra/support/Logger';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');

class TestLogger implements Logger {
  readonly messages: string[] = [];

  appendLine(message: string): void {
    this.messages.push(message);
  }
}

suite('SupportInfoService', () => {
  test('Трактует код 1 из ParentConfigurations.bin как редактирование с сохранением поддержки', () => {
    const service = new SupportInfoService(new TestLogger());
    const configurationXml = path.join(EXAMPLE_CF, 'Configuration.xml');

    service.loadConfig(EXAMPLE_CF);

    assert.strictEqual(service.getSupportMode(configurationXml), SupportMode.Editable);
    assert.strictEqual(service.isLocked(configurationXml), false);
  });
});
