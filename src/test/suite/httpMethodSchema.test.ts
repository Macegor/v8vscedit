import * as assert from 'assert';
import { ENUM_OPTIONS, PROPERTY_TITLE_RU } from '../../infra/xml/PropertySchema';

/**
 * Контракт свойств HTTP-сервиса, отражающий конфигуратор 1С:
 *  - перечисление HTTP-метода — полный список глаголов (значение = подпись),
 *    последний пункт — «Любой» (сериализуется как `Any`);
 *  - подписи корневых свойств сервиса на русском (в т.ч. «Время жизни сеанса»).
 */
suite('HTTP-сервис: схема свойств метода и подписи', () => {
  test('ENUM_OPTIONS.HTTPMethod — полный список глаголов конфигуратора, с «Любой»=Any в конце', () => {
    const options = ENUM_OPTIONS.HTTPMethod;
    assert.ok(options, 'перечисление HTTPMethod определено');

    const values = options.map((o) => o.value);
    assert.deepStrictEqual(values, [
      'GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'MERGE', 'OPTIONS', 'TRACE',
      'CONNECT', 'PROPFIND', 'PROPPATCH', 'MOVE', 'COPY', 'LOCK', 'UNLOCK', 'MKCOL', 'Any',
    ]);

    // Для всех глаголов подпись совпадает со значением; исключение — «Любой» для Any.
    for (const opt of options) {
      if (opt.value === 'Any') {
        assert.strictEqual(opt.label, 'Любой');
      } else {
        assert.strictEqual(opt.label, opt.value, `подпись глагола ${opt.value} должна совпадать со значением`);
      }
    }
  });

  test('Подписи свойств HTTP-сервиса: SessionMaxAge → «Время жизни сеанса», HTTPMethod → «HTTP-метод»', () => {
    assert.strictEqual(PROPERTY_TITLE_RU.SessionMaxAge, 'Время жизни сеанса');
    assert.strictEqual(PROPERTY_TITLE_RU.HTTPMethod, 'HTTP-метод');
    assert.strictEqual(PROPERTY_TITLE_RU.RootURL, 'Корневой URL');
    assert.strictEqual(PROPERTY_TITLE_RU.ReuseSessions, 'Повторное использование сеансов');
  });
});
