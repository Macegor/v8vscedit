import * as assert from 'assert';
import { getAgentMessageText } from '../../domain/agent';

suite('AgentMessage', () => {
  test('форматирует прогресс без сырого JSON', () => {
    const text = getAgentMessageText({
      type: 'progress',
      body: {
        message: 'Обработка структуры базы данных...',
        percent: 50,
      },
    });

    assert.strictEqual(text, 'Обработка структуры базы данных...: 50%');
  });

  test('форматирует изменение структуры БД как текст', () => {
    const text = getAgentMessageText({
      type: 'dbstru',
      body: {
        info: 'change',
        message: 'Новый объект: Документ.ев_ТестовыйДокумент',
      },
    });

    assert.strictEqual(text, 'Изменение структуры БД: Новый объект: Документ.ев_ТестовыйДокумент');
  });

  test('скрывает служебный generation-id из пользовательского лога', () => {
    const text = getAgentMessageText({
      type: 'generation-id',
      body: '33df558509d00c0a61fa7925babca6eb202c72b6',
    });

    assert.strictEqual(text, '');
  });
});
