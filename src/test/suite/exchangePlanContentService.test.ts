import * as assert from 'assert';
import * as path from 'path';
import { ExchangePlanContentService } from '../../infra/xml/ExchangePlanContentService';

const EXAMPLE_CF = path.resolve(process.cwd(), 'example/src/cf');

suite('ExchangePlanContentService', () => {
  test('Находит планы обмена, в состав которых входит объект метаданных', () => {
    const service = new ExchangePlanContentService();
    const snapshot = service.readObjectContentSnapshot(EXAMPLE_CF, 'Catalog.Номенклатура');

    assert.strictEqual(snapshot.objectRef, 'Catalog.Номенклатура');
    assert.ok(snapshot.items.length > 0, 'Планы обмена для справочника не найдены');
    assert.ok(
      snapshot.items.some((item) => item.exchangePlanName === 'ТоварыИУслуги'),
      'План обмена ТоварыИУслуги не найден'
    );
    assert.ok(
      snapshot.items.every((item) => item.autoRecordLabel === 'Разрешить' || item.autoRecordLabel === 'Запретить'),
      'Авторегистрация должна выводиться русским представлением'
    );
  });
});
