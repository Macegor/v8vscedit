import * as assert from 'assert';
import { DesignerAgentJsonReader } from '../../infra/agent/DesignerAgentJsonReader';

suite('DesignerAgentJsonReader', () => {
  test('читает JSON-массивы из вывода с приглашениями', () => {
    const reader = new DesignerAgentJsonReader();

    const first = reader.push('designer> [\n{"type":"log","message":"Начало"},');
    const second = reader.push('\n{"type":"progress","body":{"percent":40}}\n]\ndesigner> ');

    assert.deepStrictEqual(first, []);
    assert.strictEqual(second.length, 1);
    assert.strictEqual(second[0].length, 2);
    assert.deepStrictEqual(second[0][0], { type: 'log', message: 'Начало' });
    assert.deepStrictEqual(second[0][1], { type: 'progress', body: { percent: 40 } });
  });

  test('читает несколько массивов из одного фрагмента', () => {
    const reader = new DesignerAgentJsonReader();

    const messages = reader.push('[{"type":"success","message":""}]\n[{"type":"success","body":"8.5.1.100"}]');

    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0], [{ type: 'success', message: '' }]);
    assert.deepStrictEqual(messages[1], [{ type: 'success', body: '8.5.1.100' }]);
  });

  test('не ломается на квадратных скобках внутри строк', () => {
    const reader = new DesignerAgentJsonReader();

    const messages = reader.push('[{"type":"log","message":"Файл [Configuration.xml] обработан"}]');

    assert.strictEqual(messages.length, 1);
    assert.deepStrictEqual(messages[0][0], {
      type: 'log',
      message: 'Файл [Configuration.xml] обработан',
    });
  });

  test('возвращает ошибку формата с фрагментом вывода', () => {
    const reader = new DesignerAgentJsonReader();

    assert.throws(
      () => reader.push('[{"type":"success",]'),
      /Не удалось разобрать JSON-ответ агента/
    );
  });
});
