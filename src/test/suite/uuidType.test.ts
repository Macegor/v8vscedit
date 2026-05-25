import * as assert from 'assert';
import {
  buildMetadataTypeInnerXml,
  parseMetadataType,
} from '../../ui/views/properties/MetadataTypeService';
import {
  canonicalToXmlToken,
  tokenToCanonical,
} from '../../infra/xml/PlatformTypeRegistry';

/**
 * Round-trip для типа `УникальныйИдентификатор`.
 *
 * Платформа 1С 8.3 сериализует тип как `<v8:Type>v8:UUID</v8:Type>` без
 * квалификаторов. Этот факт зафиксирован в `FormValidateService.VALID_CLOSED_TYPES`
 * и распространён на реквизиты прикладных объектов.
 */
suite('UUID type — round-trip', () => {
  test('tokenToCanonical (v8:UUID) → УникальныйИдентификатор', () => {
    assert.strictEqual(tokenToCanonical('v8:UUID'), 'УникальныйИдентификатор');
  });

  test('canonicalToXmlToken (УникальныйИдентификатор, metadataAttribute) → v8:UUID', () => {
    assert.strictEqual(
      canonicalToXmlToken('УникальныйИдентификатор', 'metadataAttribute'),
      'v8:UUID'
    );
  });

  test('canonicalToXmlToken (УникальныйИдентификатор, formAttribute) → v8:UUID', () => {
    assert.strictEqual(
      canonicalToXmlToken('УникальныйИдентификатор', 'formAttribute'),
      'v8:UUID'
    );
  });

  test('buildMetadataTypeInnerXml пишет v8:UUID без квалификаторов', () => {
    const xml = buildMetadataTypeInnerXml({
      items: [{ canonical: 'UUID', display: 'УникальныйИдентификатор', group: 'primitive' }],
      presentation: 'УникальныйИдентификатор',
      rawInnerXml: '',
    });

    assert.ok(xml.includes('<v8:Type>v8:UUID</v8:Type>'), `XML без UUID-токена: ${xml}`);
    assert.ok(!xml.includes('<v8:NumberQualifiers>'), 'UUID не должен иметь NumberQualifiers');
    assert.ok(!xml.includes('<v8:StringQualifiers>'), 'UUID не должен иметь StringQualifiers');
    assert.ok(!xml.includes('<v8:DateQualifiers>'), 'UUID не должен иметь DateQualifiers');
  });

  test('parseMetadataType (<v8:Type>v8:UUID</v8:Type>) → canonical UUID, display УникальныйИдентификатор', () => {
    const parsed = parseMetadataType('<v8:Type>v8:UUID</v8:Type>');
    assert.strictEqual(parsed.items.length, 1);
    assert.strictEqual(parsed.items[0].canonical, 'UUID');
    assert.strictEqual(parsed.items[0].display, 'УникальныйИдентификатор');
    assert.strictEqual(parsed.items[0].group, 'primitive');
    assert.strictEqual(parsed.stringQualifiers, undefined);
    assert.strictEqual(parsed.numberQualifiers, undefined);
  });

  test('ДвоичныеДанные при попытке записи через MCP отбивается', () => {
    assert.strictEqual(
      canonicalToXmlToken('ДвоичныеДанные', 'metadataAttribute'),
      undefined,
      'ДвоичныеДанные должен возвращать undefined'
    );
  });
});
