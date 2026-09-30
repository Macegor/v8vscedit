import * as assert from 'assert';
import { tryRequireProductionModule } from './support/tryRequireProductionModule';

/**
 * Тесты `src/test/suite/support/testFileSelection.ts` (`resolveTestFiles`) —
 * ЕЩЁ НЕ СУЩЕСТВУЕТ на фазе «красный». Чистый модуль: список всех
 * скомпилированных `*.test.js`, ПУТЬ к файлу-манифесту шарда (или
 * `undefined`) и функция чтения файла (внедрение I/O для тестируемости) →
 * список файлов для регистрации в Mocha.
 *
 * Ключевое свойство (регресс 2026-09-26, см. CLAUDE.md): файл из манифеста,
 * отсутствующий среди скомпилированных `*.test.js`, — ЭТО ОШИБКА (throw), а
 * НЕ молчаливый пропуск. Молчаливый пропуск — ровно тот класс дефекта
 * («часть тестов не прогналась, гейт не заметил»), ради которого дробление
 * на шарды и затевалось.
 */

interface TestFileSelectionModule {
  resolveTestFiles(allFiles: string[], shardListPath: string | undefined, readFile: (path: string) => string): string[];
}

suite('testFileSelection.ts — resolveTestFiles (T-coverage-gate)', () => {
  let mod: TestFileSelectionModule | undefined;

  suiteSetup(() => {
    // Путь — ОТНОСИТЕЛЬНО support/tryRequireProductionModule.ts (см. её JSDoc),
    // а не относительно этого тестового файла: testFileSelection.ts лежит
    // РЯДОМ с ней, в том же support/.
    mod = tryRequireProductionModule('./testFileSelection') as TestFileSelectionModule | undefined;
  });

  test('модуль src/test/suite/support/testFileSelection.ts существует и экспортирует resolveTestFiles', () => {
    assert.ok(mod, 'src/test/suite/support/testFileSelection.ts ещё не реализован (ожидаемо на фазе «красный» TDD)');
  });

  function resolve(allFiles: string[], shardListPath: string | undefined, readFile: (path: string) => string): string[] {
    if (!mod) {
      assert.fail('testFileSelection.ts не реализован — см. первый тест');
    }
    return mod.resolveTestFiles(allFiles, shardListPath, readFile);
  }

  const ALL = ['agentMessage.test.js', 'canonicalNames.test.js', 'zzzLast.test.js'];

  test('без shardListPath (undefined) — возвращает allFiles БЕЗ ИЗМЕНЕНИЙ, в исходном порядке', () => {
    const readFile = (): string => assert.fail('readFile не должен вызываться, когда список шарда не задан');
    const result = resolve(ALL, undefined, readFile);
    assert.deepStrictEqual(result, ALL);
  });

  test('с shardListPath — возвращает РОВНО перечисленные файлы, в порядке манифеста', () => {
    const manifestContent = 'zzzLast.test.js\nagentMessage.test.js\n';
    let requestedPath: string | undefined;
    const readFile = (p: string): string => {
      requestedPath = p;
      return manifestContent;
    };
    const result = resolve(ALL, '/tmp/shard-0.txt', readFile);
    assert.strictEqual(requestedPath, '/tmp/shard-0.txt', 'readFile обязан быть вызван РОВНО с переданным shardListPath');
    assert.deepStrictEqual(result, ['zzzLast.test.js', 'agentMessage.test.js']);
  });

  test('файл из манифеста ОТСУТСТВУЕТ среди allFiles — ОШИБКА (throw), а не молчаливый пропуск', () => {
    const manifestContent = 'agentMessage.test.js\nghostFile.test.js\n';
    assert.throws(
      () => resolve(ALL, '/tmp/shard-1.txt', () => manifestContent),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'ожидалась ошибка Error, а не что-то иное (в т.ч. не тихий return undefined)');
        assert.ok(
          err.message.includes('ghostFile.test.js'),
          `сообщение об ошибке обязано называть конкретный отсутствующий файл: ${err.message}`
        );
        return true;
      },
      'отсутствующий в allFiles файл манифеста обязан приводить к исключению'
    );
  });

  test('пустое содержимое манифеста ("") — возвращает пустой список (валидный случай нулевого шарда), без throw', () => {
    const result = resolve(ALL, '/tmp/shard-empty.txt', () => '');
    assert.deepStrictEqual(result, []);
  });

  test('пустые/пробельные строки и хвостовой перевод строки в манифесте отфильтровываются', () => {
    const manifestContent = '\n  \nagentMessage.test.js\n\n   \n';
    const result = resolve(ALL, '/tmp/shard-ws.txt', () => manifestContent);
    assert.deepStrictEqual(result, ['agentMessage.test.js']);
  });

  test('resolveTestFiles не зависит от MOCHA_GREP — фильтрация по grep применяется ПОВЕРХ, отдельным механизмом раннера', () => {
    const manifestContent = 'canonicalNames.test.js\n';
    const before = process.env.MOCHA_GREP;
    try {
      process.env.MOCHA_GREP = 'что-то совсем не связанное с файлами шарда';
      const result = resolve(ALL, '/tmp/shard-grep.txt', () => manifestContent);
      assert.deepStrictEqual(result, ['canonicalNames.test.js'], 'MOCHA_GREP не должен влиять на выбор файлов — только на фильтрацию тестов внутри них');
    } finally {
      if (before === undefined) {
        delete process.env.MOCHA_GREP;
      } else {
        process.env.MOCHA_GREP = before;
      }
    }
  });
});
