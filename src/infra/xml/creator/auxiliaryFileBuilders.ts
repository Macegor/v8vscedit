import * as fs from 'fs';
import * as path from 'path';
import type { FormatRuleset } from '../format/FormatRuleset';
import {
  buildLocalizedTag,
  escapeXml,
  newUuid,
  splitCamelCase,
  writeTextFile,
  type TemplateType,
} from './creatorShared';

export function ensureTemplateContentFiles(templateDir: string, templateType: TemplateType, formatVersion: string): string[] {
  const extDir = path.join(templateDir, 'Ext');
  fs.mkdirSync(extDir, { recursive: true });
  switch (templateType) {
    case 'TextDocument': {
      const filePath = path.join(extDir, 'Template.txt');
      return writeTextFile(filePath, '') ? [filePath] : [];
    }
    case 'HTMLDocument': {
      const descriptorPath = path.join(extDir, 'Template.xml');
      const htmlPath = path.join(extDir, 'Template', 'ru.html');
      return [
        writeTextFile(descriptorPath, buildHtmlTemplateDescriptorXml(formatVersion)) ? descriptorPath : undefined,
        writeTextFile(htmlPath, buildHtmlDocumentTemplate()) ? htmlPath : undefined,
      ].filter((item): item is string => Boolean(item));
    }
    case 'BinaryData':
    case 'AddIn': {
      const filePath = path.join(extDir, 'Template.bin');
      if (fs.existsSync(filePath)) {
        return [];
      }
      fs.writeFileSync(filePath, Buffer.alloc(0));
      return [filePath];
    }
    case 'DataCompositionSchema': {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildDataCompositionSchemaTemplateXml()) ? [filePath] : [];
    }
    case 'DataCompositionAppearanceTemplate': {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildDataCompositionAppearanceTemplateXml()) ? [filePath] : [];
    }
    case 'GraphicalSchema': {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildGraphicalSchemaTemplateXml(formatVersion)) ? [filePath] : [];
    }
    case 'SpreadsheetDocument':
    default: {
      const filePath = path.join(extDir, 'Template.xml');
      return writeTextFile(filePath, buildSpreadsheetDocumentTemplateXml()) ? [filePath] : [];
    }
  }
}

export function buildEmptyRightsXml(formatVersion: string): string {
  // Пустой Rights.xml роли без явно выданных прав. Использует тот же неймспейс
  // и атрибут version, что и `RoleRightsXml.serializeRightsXml`, чтобы платформа
  // 1С приняла файл как роль формата, совпадающего с Configuration.xml. Без
  // явной версии 1С трактует файл как 2.18 и отказывается загружать вместе
  // с конфигурацией других версий.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Rights xmlns="http://v8.1c.ru/8.2/roles" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Rights" version="${formatVersion}">`,
    '\t<setForNewObjects>false</setForNewObjects>',
    '\t<setForAttributesByDefault>true</setForAttributesByDefault>',
    '\t<independentRightsOfChildObjects>false</independentRightsOfChildObjects>',
    '</Rights>',
    '',
  ].join('\n');
}

export function buildBusinessProcessFlowchartXml(formatVersion: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Flowchart xmlns="http://v8.1c.ru/8.3/MDClasses" version="${formatVersion}"/>`,
    '',
  ].join('\n');
}

/**
 * Дескриптор формы `Forms/<Имя>.xml` — отдельный `MetaDataObject` с описанием
 * формы (uuid + свойства). На него ссылается `<Form>Имя</Form>` в ChildObjects
 * владельца, а содержимое формы лежит в `Forms/<Имя>/Ext/Form.xml`. Минимальный
 * набор свойств снят с эталона 2.20 (пустая форма объекта): без FormType и
 * UsePurposes платформа 1С форму не принимает.
 */
export function buildFormDescriptorXml(name: string, formatVersion: string, ruleset: FormatRuleset): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject ${ruleset.metaDataObjectXmlns} version="${formatVersion}">`,
    `\t<Form uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
    '\t\t\t<FormType>Managed</FormType>',
    '\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>',
    '\t\t\t<UsePurposes>',
    '\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>',
    '\t\t\t</UsePurposes>',
    '\t\t</Properties>',
    '\t</Form>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

export function buildManagedFormXml(formatVersion: string): string {
  // Минимальный каркас пустой управляемой формы (namespace `xcf/logform`).
  // Ровно как в эталоне 2.20: только AutoCommandBar + пустые Attributes, без
  // WindowOpeningMode/Group и без префикса pal. Ранее лишний корневой
  // `<Group>` и pal вызывали XDTO-исключение при чтении формы платформой 2.20.
  // Набор префиксов и порядок элементов совпадают с реальными формами донора.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:dcssch="http://v8.1c.ru/8.1/data-composition-system/schema" xmlns:dcsset="http://v8.1c.ru/8.1/data-composition-system/settings" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${formatVersion}">`,
    '\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>',
    '\t<Attributes/>',
    '</Form>',
    '',
  ].join('\n');
}

export function buildTemplateXml(name: string, formatVersion: string, templateType: TemplateType, ruleset: FormatRuleset): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MetaDataObject ${ruleset.metaDataObjectXmlns} version="${formatVersion}">`,
    `\t<Template uuid="${newUuid()}">`,
    '\t\t<Properties>',
    `\t\t\t<Name>${escapeXml(name)}</Name>`,
    buildLocalizedTag('\t\t\t', 'Synonym', splitCamelCase(name)),
    '\t\t\t<Comment/>',
    `\t\t\t<TemplateType>${escapeXml(templateType)}</TemplateType>`,
    '\t\t</Properties>',
    '\t</Template>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}

function buildSpreadsheetDocumentTemplateXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<document xmlns="http://v8.1c.ru/8.2/data/spreadsheet" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '\t<languageSettings>',
    '\t\t<currentLanguage>ru</currentLanguage>',
    '\t\t<defaultLanguage>ru</defaultLanguage>',
    '\t\t<languageInfo>',
    '\t\t\t<id>ru</id>',
    '\t\t\t<code>Русский</code>',
    '\t\t\t<description>Русский</description>',
    '\t\t</languageInfo>',
    '\t</languageSettings>',
    '\t<columns>',
    '\t\t<size>0</size>',
    '\t</columns>',
    '</document>',
    '',
  ].join('\n');
}

function buildDataCompositionSchemaTemplateXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
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

function buildHtmlTemplateDescriptorXml(formatVersion: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<Help xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${formatVersion}">`,
    '\t<Page>ru</Page>',
    '</Help>',
    '',
  ].join('\n');
}

function buildHtmlDocumentTemplate(): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '\t<meta charset="UTF-8">',
    '\t<title></title>',
    '</head>',
    '<body>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function buildDataCompositionAppearanceTemplateXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<AppearanceTemplate xmlns="http://v8.1c.ru/8.1/data-composition-system/appearance-template" xmlns:dcscor="http://v8.1c.ru/8.1/data-composition-system/core" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '</AppearanceTemplate>',
    '',
  ].join('\n');
}

function buildGraphicalSchemaTemplateXml(formatVersion: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<GraphicalSchema xmlns="http://v8.1c.ru/8.3/xcf/scheme" xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette" xmlns:sch="http://v8.1c.ru/8.2/data/graphscheme" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="${formatVersion}">`,
    '\t<BackColor>style:FieldBackColor</BackColor>',
    '\t<GridEnabled>false</GridEnabled>',
    '\t<DrawGridMode>None</DrawGridMode>',
    '\t<GridHorizontalStep>20</GridHorizontalStep>',
    '\t<GridVerticalStep>20</GridVerticalStep>',
    '\t<PrintParameters>',
    '\t\t<TopMargin>10</TopMargin>',
    '\t\t<LeftMargin>10</LeftMargin>',
    '\t\t<BottomMargin>10</BottomMargin>',
    '\t\t<RightMargin>10</RightMargin>',
    '\t\t<BlackAndWhite>false</BlackAndWhite>',
    '\t\t<FitPageMode>Auto</FitPageMode>',
    '\t</PrintParameters>',
    '\t<Items/>',
    '</GraphicalSchema>',
    '',
  ].join('\n');
}
