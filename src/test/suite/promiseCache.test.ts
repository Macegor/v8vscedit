import * as assert from 'assert';
import { getOrCreate } from '../../infra/process/PromiseCache';

/**
 * PromiseCache.getOrCreate закрывает TOCTOU-гонку в DesignerAgentSessionManager
 * (и аналогичных местах): два параллельных запроса с одним ключом не должны
 * порождать два процесса/подключения, а неудачная инициализация не должна
 * навсегда "отравлять" кэш зареджекченным промисом.
 */
suite('PromiseCache.getOrCreate', () => {
  test('параллельные вызовы с одним ключом переиспользуют один и тот же промис фабрики', async () => {
    const map = new Map<string, Promise<number>>();
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 20));
    };

    const [first, second] = await Promise.all([
      getOrCreate(map, 'session-a', factory),
      getOrCreate(map, 'session-a', factory),
    ]);

    assert.strictEqual(factoryCalls, 1, 'фабрика должна быть вызвана ровно один раз на параллельных запросах');
    assert.strictEqual(first, 42);
    assert.strictEqual(second, 42);
  });

  test('reject фабрики удаляет ключ из map — повторный вызов создаёт новую попытку', async () => {
    const map = new Map<string, Promise<number>>();
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls += 1;
      if (factoryCalls === 1) {
        return Promise.reject(new Error('первое подключение недоступно'));
      }
      return Promise.resolve(7);
    };

    await assert.rejects(getOrCreate(map, 'session-b', factory), /первое подключение недоступно/);
    // Ключ не должен остаться в map с "отравленным" промисом.
    assert.strictEqual(map.has('session-b'), false);

    const result = await getOrCreate(map, 'session-b', factory);
    assert.strictEqual(result, 7);
    assert.strictEqual(factoryCalls, 2, 'после неудачи повторный вызов обязан снова дёрнуть фабрику');
  });

  test('разные ключи кэшируются независимо друг от друга', async () => {
    const map = new Map<string, Promise<string>>();
    const calls: string[] = [];
    const factory = (key: string) => () => {
      calls.push(key);
      return Promise.resolve(`value-${key}`);
    };

    const resultA = await getOrCreate(map, 'key-a', factory('key-a'));
    const resultB = await getOrCreate(map, 'key-b', factory('key-b'));
    const resultAAgain = await getOrCreate(map, 'key-a', factory('key-a'));

    assert.strictEqual(resultA, 'value-key-a');
    assert.strictEqual(resultB, 'value-key-b');
    assert.strictEqual(resultAAgain, 'value-key-a');
    // key-a при повторном вызове должен браться из кэша, а не пересоздаваться.
    assert.deepStrictEqual(calls, ['key-a', 'key-b']);
  });
});
