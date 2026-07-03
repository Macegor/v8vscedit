import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ExchangePlanContentService } from '../../infra/xml/ExchangePlanContentService';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

suite('ExchangePlanContentService', () => {
  test('Находит планы обмена, в состав которых входит объект метаданных', function () {
    // Тест применим только при наличии планов обмена в example/2.20/src/cf/ExchangePlans;
    // в минимальной выгрузке их может не быть.
    const exchangePlansDir = path.join(EXAMPLE_CF, 'ExchangePlans');
    if (!fs.existsSync(exchangePlansDir)) {
      this.skip();
    }
    // Ищем первый план обмена и берём его первый объект из Content.
    let foundPlan: string | null = null;
    let foundObject: string | null = null;
    for (const entry of fs.readdirSync(exchangePlansDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const contentPath = path.join(exchangePlansDir, entry.name, 'Ext', 'Content.xml');
      if (!fs.existsSync(contentPath)) {
        continue;
      }
      const contentXml = fs.readFileSync(contentPath, 'utf-8');
      const match = /<Item[^>]*>[\s\S]*?<Metadata>([^<]+)<\/Metadata>/.exec(contentXml);
      if (match) {
        foundPlan = entry.name;
        foundObject = match[1];
        break;
      }
    }
    if (!foundPlan || !foundObject) {
      this.skip();
    }
    const service = new ExchangePlanContentService();
    const snapshot = service.readObjectContentSnapshot(EXAMPLE_CF, foundObject);

    assert.strictEqual(snapshot.objectRef, foundObject);
    assert.ok(snapshot.items.length > 0, 'Планы обмена для объекта не найдены');
    assert.ok(
      snapshot.items.some((item) => item.exchangePlanName === foundPlan),
      `План обмена ${foundPlan} не найден в результатах`
    );
    assert.ok(
      snapshot.items.every((item) => item.autoRecordLabel === 'Разрешить' || item.autoRecordLabel === 'Запретить'),
      'Авторегистрация должна выводиться русским представлением'
    );
  });
});
