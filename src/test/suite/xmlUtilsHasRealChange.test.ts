import * as assert from 'assert';
import { hasRealChange } from '../../infra/xml/XmlUtils';

/**
 * Контракт IDMP: `hasRealChange(original, updated)` — единая точка сравнения
 * "до" и "после" мутации XML, нечувствительная к стилю переводов строк (CRLF/LF),
 * но чувствительная к любому содержательному отличию. Используется в
 * ObjectXmlReader.updateTypeInObject/updatePropertyInObject вместо сырого `===`
 * ДО normalizeEol-записи, чтобы устранить false-positive "изменение" на CRLF-файлах.
 */
suite('XmlUtils — hasRealChange (контракт IDMP)', () => {
  test('одинаковый текст с разным стилем EOL (CRLF vs LF) — изменений нет', () => {
    const original = '<Type>\r\n\t<v8:Type>xs:string</v8:Type>\r\n</Type>';
    const updated = '<Type>\n\t<v8:Type>xs:string</v8:Type>\n</Type>';
    assert.strictEqual(hasRealChange(original, updated), false);
  });

  test('идентичные строки без разницы в EOL — изменений нет', () => {
    const xml = '<Properties>\r\n\t<Name>Тест</Name>\r\n</Properties>';
    assert.strictEqual(hasRealChange(xml, xml), false);
  });

  test('реальное семантическое отличие обнаруживается независимо от EOL-стиля', () => {
    const original = '<Type>\r\n\t<v8:Type>xs:string</v8:Type>\r\n</Type>';
    const updated = '<Type>\n\t<v8:Type>xs:number</v8:Type>\n</Type>';
    assert.strictEqual(hasRealChange(original, updated), true);
  });

  test('смешанный EOL внутри одного из вариантов — всё равно нет изменений при совпадающем содержимом', () => {
    const original = '<A>\r\n<B>1</B>\n<C>2</C>\r\n</A>';
    const updated = '<A>\n<B>1</B>\n<C>2</C>\n</A>';
    assert.strictEqual(hasRealChange(original, updated), false);
  });
});
