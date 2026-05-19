import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import {
  buildEventSourceInnerXml,
  EventSubscriptionPropertyService,
} from '../../ui/views/properties/EventSubscriptionPropertyService';
import { parseMetadataType } from '../../ui/views/properties/MetadataTypeService';
import type { EnumPropertyValue, MetadataTypeValue } from '../../ui/views/properties/_types';

suite('eventSubscriptionProperties', () => {
  test('показывает Source как состав типов, а Event как зависимый список', () => {
    const service = new EventSubscriptionPropertyService();
    const props = service.buildProperties(buildEventSubscriptionXml([
      '<v8:Type>cfg:DocumentObject.ЗаказПокупателя</v8:Type>',
    ].join('\n'), 'BeforeWrite'), undefined);

    const source = props.find((item) => item.key === 'Source');
    assert.ok(source);
    assert.strictEqual(source.kind, 'metadataType');
    assert.strictEqual(source.title, 'Источник');
    assert.strictEqual((source.value as MetadataTypeValue).items[0].canonical, 'DocumentObject.ЗаказПокупателя');
    assert.strictEqual((source.value as MetadataTypeValue).items[0].display, 'ДокументОбъект.ЗаказПокупателя');

    const event = props.find((item) => item.key === 'Event');
    assert.ok(event);
    assert.strictEqual(event.kind, 'enum');
    const value = event.value as EnumPropertyValue;
    assert.ok(value.allowedValues.some((option) => option.value === 'BeforeWrite' && option.label === 'Перед записью'));
    assert.ok(value.allowedValues.some((option) => option.value === 'Posting'));
  });

  test('для нескольких источников оставляет только общие события', () => {
    const service = new EventSubscriptionPropertyService();
    const source = parseMetadataType([
      '<v8:Type>cfg:DocumentObject.ЗаказПокупателя</v8:Type>',
      '<v8:Type>cfg:CatalogObject.Номенклатура</v8:Type>',
    ].join('\n'));

    const events = service.getEventOptionsForSource(source, undefined).map((option) => option.value);
    assert.ok(events.includes('BeforeWrite'));
    assert.ok(events.includes('OnWrite'));
    assert.ok(events.includes('BeforeDelete'));
    assert.ok(events.includes('OnCopy'));
    assert.ok(events.includes('Filling'));
    assert.ok(events.includes('FillCheckProcessing'));
    assert.ok(!events.includes('Posting'));
    assert.ok(!events.includes('OnSetNewNumber'));
    assert.ok(!events.includes('OnSetNewCode'));
  });

  test('раскрывает определяемые типы при расчете общих событий', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-event-sub-'));
    fs.mkdirSync(path.join(root, 'DefinedTypes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'EventSubscriptions'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Configuration.xml'), '<MetaDataObject><Configuration><Properties><Name>Тест</Name></Properties></Configuration></MetaDataObject>', 'utf-8');
    fs.writeFileSync(
      path.join(root, 'DefinedTypes', 'ДокументыДляПодписки.xml'),
      [
        '<MetaDataObject>',
        '<DefinedType>',
        '<Properties>',
        '<Name>ДокументыДляПодписки</Name>',
        '<Type>',
        '<v8:Type>cfg:DocumentObject.ЗаказПокупателя</v8:Type>',
        '<v8:Type>cfg:DocumentObject.РеализацияТоваров</v8:Type>',
        '</Type>',
        '</Properties>',
        '</DefinedType>',
        '</MetaDataObject>',
      ].join('\n'),
      'utf-8'
    );
    const eventXmlPath = path.join(root, 'EventSubscriptions', 'ПередЗаписью.xml');
    fs.writeFileSync(eventXmlPath, buildEventSubscriptionXml('<v8:TypeSet>cfg:DefinedType.ДокументыДляПодписки</v8:TypeSet>', 'BeforeWrite'), 'utf-8');

    const service = new EventSubscriptionPropertyService();
    const source = parseMetadataType([
      '<v8:TypeSet>cfg:DefinedType.ДокументыДляПодписки</v8:TypeSet>',
      '<v8:Type>cfg:CatalogObject.Номенклатура</v8:Type>',
    ].join('\n'));
    const events = service.getEventOptionsForSource(source, eventXmlPath).map((option) => option.value);

    assert.ok(events.includes('BeforeWrite'));
    assert.ok(events.includes('OnWrite'));
    assert.ok(!events.includes('Posting'));
    assert.ok(!events.includes('OnSetNewNumber'));
  });

  test('формирует Source XML без квалификаторов и с TypeSet для определяемых и общих типов', () => {
    const inner = buildEventSourceInnerXml({
      items: [
        { canonical: 'DefinedType.Документы', display: 'ОпределяемыйТип.Документы', group: 'defined' },
        { canonical: 'DocumentObject', display: 'ДокументОбъект', group: 'reference' },
        { canonical: 'DocumentObject.Заказ', display: 'ДокументОбъект.Заказ', group: 'reference' },
        { canonical: 'CatalogObject.Номенклатура', display: 'СправочникОбъект.Номенклатура', group: 'reference' },
      ],
      stringQualifiers: { length: 50, allowedLength: 'Variable' },
      presentation: '',
      rawInnerXml: '',
    });

    assert.ok(inner.includes('<v8:TypeSet>cfg:DefinedType.Документы</v8:TypeSet>'));
    assert.ok(inner.includes('<v8:TypeSet>cfg:DocumentObject</v8:TypeSet>'));
    assert.ok(inner.includes('<v8:Type>cfg:DocumentObject.Заказ</v8:Type>'));
    assert.ok(inner.includes('<v8:Type>cfg:CatalogObject.Номенклатура</v8:Type>'));
    assert.ok(!inner.includes('StringQualifiers'));
  });

  test('записывает новый Source подписки на событие', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-event-sub-'));
    const xmlPath = path.join(dir, 'EventSubscription.xml');
    fs.writeFileSync(xmlPath, buildEventSubscriptionXml('<v8:Type>cfg:DocumentObject.ЗаказПокупателя</v8:Type>', 'BeforeWrite'), 'utf-8');

    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'EventSubscription',
      targetName: 'ПередЗаписью',
      propertyName: 'Source',
      typeInnerXml: '<v8:TypeSet>cfg:DefinedType.Документы</v8:TypeSet>',
    });

    assert.strictEqual(changed, true);
    const saved = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(saved.includes('<Source>'));
    assert.ok(saved.includes('<v8:TypeSet>cfg:DefinedType.Документы</v8:TypeSet>'));
    assert.ok(saved.includes('<Event>BeforeWrite</Event>'));
  });
});

function buildEventSubscriptionXml(sourceInner: string, event: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject>',
    '<EventSubscription>',
    '<Properties>',
    '<Name>ПередЗаписью</Name>',
    '<Source>',
    sourceInner,
    '</Source>',
    `<Event>${event}</Event>`,
    '<Handler>CommonModule.Модуль.Процедура</Handler>',
    '</Properties>',
    '</EventSubscription>',
    '</MetaDataObject>',
  ].join('\n');
}
