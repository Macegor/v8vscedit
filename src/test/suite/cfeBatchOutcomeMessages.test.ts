/**
 * Тесты чистой части команд пакетной выгрузки/загрузки
 * (`ui/commands/ext/CfeBatchCommands.ts`): композиция текста итога прогона и
 * предупреждения о восстановленных по имени файла расширениях.
 *
 * Обе функции — разбор отчёта, а не диалог: показ сведён к одному
 * `showWarningMessage` в тонком адаптере. Держать этот разбор внутри области
 * модальных диалогов (непроверяемой в CI) означало бы принимать на слово ровно
 * те два утверждения, ради которых он написан:
 *  - «не удалось» и «не обрабатывались» — РАЗНЫЕ категории: назвать сбойными
 *    расширения, до которых прогон не дошёл, значит отправить пользователя
 *    искать несуществующую проблему;
 *  - прерывание названо явно: иначе неполный набор бэкапов выглядит как полный;
 *  - файлы, чьё имя расширения восстановлено НЕ по манифесту, названы поимённо:
 *    это единственный признак того, что в базу могло уехать чужое поколение.
 */
import * as assert from 'assert';
import {
  buildBatchOutcomeMessage,
  buildRestoredByFileNameMessage,
} from '../../ui/commands/ext/CfeBatchCommands';
import type { CfeBatchReport, CfeBatchReportItem } from '../../infra/cfFile';

const TITLE = 'Выгружены не все расширения.';

function item(extensionName: string, status: CfeBatchReportItem['status']): CfeBatchReportItem {
  return { extensionName, fileName: `${extensionName}.cfe`, status };
}

function report(overrides: Partial<CfeBatchReport> = {}): CfeBatchReport {
  return { version: 1, operation: 'dump', interrupted: false, items: [], ...overrides };
}

suite('CfeBatchCommands.buildBatchOutcomeMessage — итог прогона пользователю', () => {
  test('отчёта нет (CLI не дошёл до его записи) → сообщения нет: причина уже показана обработчиком ошибки', () => {
    assert.strictEqual(buildBatchOutcomeMessage(undefined, TITLE), undefined);
  });

  test('чистый прогон (все ok, не прерван) → сообщения нет', () => {
    const message = buildBatchOutcomeMessage(report({ items: [item('Ext01', 'ok'), item('Ext02', 'ok')] }), TITLE);
    assert.strictEqual(message, undefined);
  });

  test('пустой прогон (0 расширений) → сообщения нет', () => {
    assert.strictEqual(buildBatchOutcomeMessage(report(), TITLE), undefined);
  });

  test('только failed: названы сбойные, про «не обрабатывались» и прерывание — ни слова', () => {
    const message = buildBatchOutcomeMessage(
      report({ items: [item('Ext01', 'ok'), item('Ext02', 'failed'), item('Ext03', 'failed')] }),
      TITLE
    );
    assert.ok(message, 'сообщение обязано быть');
    assert.ok(message.startsWith(TITLE), message);
    assert.ok(message.includes('Не удалось: Ext02, Ext03.'), message);
    assert.ok(!message.includes('Не обрабатывались'), message);
    assert.ok(!message.includes('прервана'), message);
    assert.ok(!message.includes('Ext01'), `успешное расширение не должно попадать в текст: ${message}`);
  });

  test('только notAttempted: это НЕ «не удалось» — категории разведены', () => {
    // Слить их в одну строку значит соврать: эти расширения не пробовали.
    const message = buildBatchOutcomeMessage(
      report({ items: [item('Ext01', 'ok'), item('Ext03', 'notAttempted'), item('Ext04', 'notAttempted')] }),
      TITLE
    );
    assert.ok(message, 'сообщение обязано быть');
    assert.ok(message.includes('Не обрабатывались: Ext03, Ext04.'), message);
    assert.ok(!message.includes('Не удалось'), `не пробовали — значит не «не удалось»: ${message}`);
  });

  test('прерывание названо явно, даже когда сбоев не было', () => {
    const message = buildBatchOutcomeMessage(
      report({ interrupted: true, items: [item('Ext01', 'ok'), item('Ext02', 'ok')] }),
      TITLE
    );
    assert.ok(message, 'о прерывании обязано быть сказано: неполный набор бэкапов иначе выглядит как полный');
    assert.ok(message.includes('Операция прервана.'), message);
  });

  test('прерывание + недошедшие: сказано и про прерывание, и про необработанные', () => {
    const message = buildBatchOutcomeMessage(
      report({ interrupted: true, items: [item('Ext01', 'ok'), item('Ext03', 'notAttempted')] }),
      TITLE
    );
    assert.ok(message);
    assert.ok(message.includes('Операция прервана.'), message);
    assert.ok(message.includes('Не обрабатывались: Ext03.'), message);
    assert.ok(!message.includes('Не удалось'), message);
  });

  test('всё сразу: порядок — сбой, прерывание, недошедшие; заголовок первым', () => {
    const message = buildBatchOutcomeMessage(
      report({
        interrupted: true,
        items: [item('Ext01', 'ok'), item('Ext02', 'failed'), item('Ext03', 'notAttempted'), item('Ext04', 'notAttempted')],
      }),
      TITLE
    );
    assert.strictEqual(
      message,
      `${TITLE} Не удалось: Ext02. Операция прервана. Не обрабатывались: Ext03, Ext04.`
    );
  });

  test('заголовок берётся из аргумента (у выгрузки и загрузки он разный)', () => {
    const message = buildBatchOutcomeMessage(
      report({ operation: 'load', items: [item('Ext02', 'failed')] }),
      'Загружены не все расширения.'
    );
    assert.ok(message?.startsWith('Загружены не все расширения.'), String(message));
  });
});

suite('CfeBatchCommands.buildRestoredByFileNameMessage — предупреждение о чужом поколении', () => {
  test('отчёта нет → предупреждения нет', () => {
    assert.strictEqual(buildRestoredByFileNameMessage(undefined), undefined);
  });

  test('поля нет (манифест описывал все файлы) → предупреждения нет', () => {
    assert.strictEqual(buildRestoredByFileNameMessage(report({ operation: 'load' })), undefined);
  });

  test('список пуст → предупреждения нет', () => {
    assert.strictEqual(buildRestoredByFileNameMessage(report({ operation: 'load', restoredByFileName: [] })), undefined);
  });

  test('непустой список: файлы названы поимённо и указан манифест, по которому имена НЕ восстановились', () => {
    const message = buildRestoredByFileNameMessage(
      report({ operation: 'load', restoredByFileName: ['A_B.cfe', 'Ext04.cfe'] })
    );
    assert.ok(message, 'предупреждение обязано быть: это единственный признак смешения поколений');
    assert.ok(message.includes('A_B.cfe') && message.includes('Ext04.cfe'), message);
    assert.ok(message.includes('cfe-dump.json'), `пользователь должен понять, какого файла не хватило: ${message}`);
  });
});
