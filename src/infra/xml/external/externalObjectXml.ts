import { SCAFFOLD_FORMAT_VERSION } from '../format/formatRegistry';
import { escapeXmlAttribute as escapeXml } from '../XmlUtils';
import { EPF_CLASS_ID, ERF_CLASS_ID, escapeHtml, newUuid, XMLNS } from './externalObjectShared';

export function buildExternalObjectXml(options: {
  readonly type: 'ExternalDataProcessor' | 'ExternalReport';
  readonly name: string;
  readonly synonym: string;
  readonly withSkd?: boolean;
}): string {
  const classId = options.type === 'ExternalDataProcessor' ? EPF_CLASS_ID : ERF_CLASS_ID;
  const objectPrefix = options.type === 'ExternalDataProcessor' ? 'ExternalDataProcessorObject' : 'ExternalReportObject';
  const mainDcs = options.type === 'ExternalReport' && options.withSkd === true
    ? `ExternalReport.${options.name}.Template.ОсновнаяСхемаКомпоновкиДанных`
    : '';
  const reportProps = options.type === 'ExternalReport'
    ? [
        `\t\t\t${mainDcs ? `<MainDataCompositionSchema>${escapeXml(mainDcs)}</MainDataCompositionSchema>` : '<MainDataCompositionSchema/>'}`,
        '\t\t\t<DefaultSettingsForm/>',
        '\t\t\t<AuxiliarySettingsForm/>',
        '\t\t\t<DefaultVariantForm/>',
        '\t\t\t<VariantsStorage/>',
        '\t\t\t<SettingsStorage/>',
      ]
    : [];
  const childObjects = options.withSkd === true
    ? [
        '\t\t<ChildObjects>',
        '\t\t\t<Template>ОсновнаяСхемаКомпоновкиДанных</Template>',
        '\t\t</ChildObjects>',
      ].join('\n')
    : '\t\t<ChildObjects/>';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${XMLNS} version="${SCAFFOLD_FORMAT_VERSION}">`,
    `\t<${options.type} uuid="${newUuid()}">`,
    '\t\t<InternalInfo>',
    '\t\t\t<xr:ContainedObject>',
    `\t\t\t\t<xr:ClassId>${classId}</xr:ClassId>`,
    `\t\t\t\t<xr:ObjectId>${newUuid()}</xr:ObjectId>`,
    '\t\t\t</xr:ContainedObject>',
    `\t\t\t<xr:GeneratedType name="${objectPrefix}.${escapeXml(options.name)}" category="Object">`,
    `\t\t\t\t<xr:TypeId>${newUuid()}</xr:TypeId>`,
    `\t\t\t\t<xr:ValueId>${newUuid()}</xr:ValueId>`,
    '\t\t\t</xr:GeneratedType>',
    '\t\t</InternalInfo>',
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(options.name)}</Name>`,
    '\t\t\t<Synonym>',
    '\t\t\t\t<v8:item>',
    '\t\t\t\t\t<v8:lang>ru</v8:lang>',
    `\t\t\t\t\t<v8:content>${escapeXml(options.synonym)}</v8:content>`,
    '\t\t\t\t</v8:item>',
    '\t\t\t</Synonym>',
    '\t\t\t<Comment/>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    ...reportProps,
    '\t\t</Properties>',
    childObjects,
    `\t</${options.type}>`,
    '</MetaDataObject>',
    '',
  ].join('\n');
}

export function buildTemplateDescriptorXml(name: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${XMLNS} version="${SCAFFOLD_FORMAT_VERSION}">`,
    `\t<Template uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    '\t\t\t<Synonym>',
    '\t\t\t\t<v8:item>',
    '\t\t\t\t\t<v8:lang>ru</v8:lang>',
    '\t\t\t\t\t<v8:content>Основная схема компоновки данных</v8:content>',
    '\t\t\t\t</v8:item>',
    '\t\t\t</Synonym>',
    '\t\t\t<Comment/>',
    '\t\t\t<TemplateType>DataCompositionSchema</TemplateType>',
    '\t\t</Properties>',
    '\t</Template>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

export function buildEmptySkdXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema"',
    '\t\txmlns:dcscom="http://v8.1c.ru/8.1/data-composition-system/common"',
    '\t\txmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core"',
    '\t\txmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings"',
    '\t\txmlns:v8="http://v8.1c.ru/8.1/data/core"',
    '\t\txmlns:v8ui="http://v8.1c.ru/8.1/data/ui"',
    '\t\txmlns:xs="http://www.w3.org/2001/XMLSchema"',
    '\t\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<dataSource>',
    '\t\t<name>ИсточникДанных1</name>',
    '\t\t<dataSourceType>Local</dataSourceType>',
    '\t</dataSource>',
    '</DataCompositionSchema>',
    '',
  ].join('\n');
}

export function buildHelpDescriptorXml(formatVersion: string, lang: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Help xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${escapeXml(formatVersion)}">`,
    `\t<Page>${escapeXml(lang)}</Page>`,
    '</Help>',
    '',
  ].join('\n');
}

export function buildHelpHtml(title: string): string {
  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">',
    '<html>',
    '<head>',
    '    <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>',
    '    <link rel="stylesheet" type="text/css" href="v8help://service_book/service_style"/>',
    '</head>',
    '<body>',
    `    <h1>${escapeHtml(title)}</h1>`,
    '    <p>Описание.</p>',
    '</body>',
    '</html>',
  ].join('\n');
}

export function buildEmptyObjectModule(): string {
  return [
    '#Область ОписаниеПеременных',
    '',
    '#КонецОбласти',
    '',
    '#Область ПрограммныйИнтерфейс',
    '',
    '#КонецОбласти',
    '',
    '#Область СлужебныеПроцедурыИФункции',
    '',
    '#КонецОбласти',
    '',
  ].join('\n');
}
