import * as assert from 'assert';
import { encode } from 'iconv-lite';
import {
  decodeProcessOutput,
  LineBufferedDecoder,
  pickMostReadableText,
  recoverGarbledText,
} from '../../infra/process/OutputDecoder';

/**
 * LineBufferedDecoder собирает строки вывода внешнего процесса по границе '\n',
 * а не по границе чанка потока: chunked-вывод может разрезать многобайтовый
 * символ ровно на стыке двух чанков, и наивное decode() каждого чанка по
 * отдельности даёт '�' на месте разрыва. Проверяем на UTF-8 (кроссплатформенно,
 * т.к. на тест-хосте decodeProcessOutput отдаёт UTF-8 как есть) — именно этот
 * баг границы чанка закрывает буферизация.
 */
suite('LineBufferedDecoder', () => {
  test('UTF-8: строки собираются корректно при разрыве буфера в середине многобайтового символа', () => {
    const fullText = 'Строка с кириллицей\nВторая строка';
    const encoded = Buffer.from(fullText, 'utf-8');

    // Режем на 1-м байте: первый символ 'С' занимает 2 байта UTF-8 (0xD0 0xA1),
    // поэтому разрез приходится ровно в середину многобайтового символа.
    const part1 = encoded.subarray(0, 1);
    const part2 = encoded.subarray(1);

    const decoder = new LineBufferedDecoder();
    const linesFromPart1 = decoder.push(part1);
    const linesFromPart2 = decoder.push(part2);
    const tail = decoder.flush();

    assert.deepStrictEqual(linesFromPart1, [], 'до символа перевода строки готовых строк быть не должно');
    assert.deepStrictEqual(linesFromPart2, ['Строка с кириллицей']);
    assert.strictEqual(tail, 'Вторая строка');
    // Ключевая проверка: символ замены '�' не появляется при разрыве символа.
    assert.ok(!linesFromPart2.join('').includes('�'));
    assert.ok(!tail.includes('�'));
  });

  test('CRLF: строки после trim не содержат хвостовой \\r', () => {
    const encoded = Buffer.from('первая\r\nвторая\r\n', 'utf-8');

    const decoder = new LineBufferedDecoder();
    const lines = decoder.push(encoded);

    assert.deepStrictEqual(lines, ['первая', 'вторая']);
    assert.ok(lines.every((line) => !line.includes('\r')));
  });

  test('хвост без завершающего \\n возвращается только явным flush()', () => {
    const decoder = new LineBufferedDecoder();
    const lines = decoder.push(Buffer.from('без перевода строки', 'utf-8'));

    assert.deepStrictEqual(lines, [], 'push не должен отдавать незавершённую строку');
    assert.strictEqual(decoder.flush(), 'без перевода строки');
    // Повторный flush на пустом хвосте не должен возвращать пустую строку как «есть данные».
    assert.strictEqual(decoder.flush(), undefined);
  });

  test('push+flush эквивалентны decodeProcessOutput полного буфера (без разбиения на чанки)', () => {
    const fullText = 'Первая строка\nВторая строка без переноса';
    const encoded = Buffer.from(fullText, 'utf-8');

    const decoder = new LineBufferedDecoder();
    const lines = decoder.push(encoded);
    const tail = decoder.flush();
    const combined = [...lines, tail].filter((v): v is string => v !== undefined).join('\n');

    const expected = decodeProcessOutput(encoded).trim();
    assert.strictEqual(combined, expected);
  });
});

/**
 * recoverGarbledText — эвристика восстановления кириллицы из «битого» UTF-8
 * (cp866/win1251), которую decodeProcessOutput применяет только на Windows.
 * Сама эвристика платформонезависима, поэтому проверяется напрямую на любой ОС.
 */
suite('recoverGarbledText', () => {
  test('cp866: битый UTF-8 восстанавливается в кириллицу без символов замены', () => {
    const encoded = encode('Строка с кириллицей', 'cp866');
    const recovered = recoverGarbledText(encoded);

    assert.strictEqual(recovered, 'Строка с кириллицей');
    assert.ok(!recovered.includes('�'));
  });

  test('win1251: битый UTF-8 восстанавливается в кириллицу с буквой Ё', () => {
    const encoded = encode('Первая строка с буквой Ё', 'win1251');
    const recovered = recoverGarbledText(encoded);

    assert.strictEqual(recovered, 'Первая строка с буквой Ё');
    assert.ok(!recovered.includes('�'));
  });

  test('чистый UTF-8 без символов замены возвращается без изменений', () => {
    const text = 'Обычный UTF-8 текст без порчи';
    assert.strictEqual(recoverGarbledText(Buffer.from(text, 'utf-8')), text);
  });
});

/**
 * decodeProcessOutput на не-Windows возвращает UTF-8 как есть (кодировка stdout
 * процесса совпадает с платформой хоста); легитимный '�' не переинтерпретируется.
 */
suite('decodeProcessOutput — платформенное поведение', () => {
  test('на не-Windows UTF-8 с символом замены не переинтерпретируется в cp866/win1251', function () {
    if (process.platform === 'win32') {
      this.skip();
      return;
    }
    const text = 'До ошибки: � после';
    assert.strictEqual(decodeProcessOutput(Buffer.from(text, 'utf-8')), text);
  });
});

/**
 * pickMostReadableText вызывается из recoverGarbledText (всегда с непустым
 * массивом кандидатов), но как самостоятельная утилита обязана не падать и на
 * пустом списке — защитный фолбэк `candidates[0] ?? ''`.
 */
suite('pickMostReadableText — edge cases', () => {
  test('пустой список кандидатов не падает и возвращает пустую строку', () => {
    assert.strictEqual(pickMostReadableText([]), '');
  });
});
