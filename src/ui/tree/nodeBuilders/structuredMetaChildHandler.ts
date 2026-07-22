import * as fs from 'fs';
import * as path from 'path';
import type { MetadataNode, NodeKind } from '../TreeNode';
import {
  extractChildMetaElementXml,
  extractColumnXmlFromTabularSection,
  extractMethodXmlFromUrlTemplate,
  ensureStandardAttributeXml,
  extractStandardAttributeXml,
} from '../../../infra/xml';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import type { ObjectHandler, ObjectPropertiesCollection } from './_types';
import {
  buildCommandProperties,
  buildEnumValueProperties,
  buildFormLikeProperties,
  buildHttpMethodProperties,
  buildStandardAttributeProperties,
  buildTabularSectionProperties,
  buildTemplateMetaProperties,
  buildTypedFieldProperties,
  buildUrlTemplateProperties,
} from '../../views/properties/PropertyBuilder';
import {
  readInheritedObjectXmlForBorrowed,
  resolveInheritedDefinitionXmlPath,
} from '../../views/properties/BorrowedPropertiesResolver';
import { enrichCommandInterfaceGroupOptions } from '../../views/properties/CommandInterfaceGroupOptions';

/** Виды дочерних узлов, для которых есть общий разбор свойств из XML */
const SUPPORTED_CHILD_KINDS = new Set<NodeKind>([
  'Attribute',
  'StandardAttribute',
  'AddressingAttribute',
  'Dimension',
  'Resource',
  'TabularSection',
  'Column',
  'Form',
  'Command',
  'Template',
  'EnumValue',
  'URLTemplate',
  'Method',
]);

/**
 * Обработчик свойств дочерних элементов объекта метаданных (реквизит, ТЧ, форма, …).
 * Используется панелью свойств, когда у узла задан {@link MetadataNode.metaContext}.
 */
export const structuredMetaChildHandler: ObjectHandler = {
  buildTreeNodes() {
    return [];
  },

  canShowProperties(node: MetadataNode): boolean {
    return Boolean(node.metaContext && node.xmlPath && SUPPORTED_CHILD_KINDS.has(node.nodeKind));
  },

  getProperties(node: MetadataNode): ObjectPropertiesCollection {
    const ownerXml = node.xmlPath;
    if (!ownerXml || !node.metaContext) {
      return [];
    }

    const objectMainXmlPath = node.metaContext.ownerObjectXmlPath ?? ownerXml;
    if (!fs.existsSync(objectMainXmlPath)) {
      return [];
    }

    const objectXml = fs.readFileSync(objectMainXmlPath, 'utf-8');
    const inheritedObjectXml = readInheritedObjectXmlForBorrowed(objectMainXmlPath);
    const { nodeKind } = node;
    const label = node.textLabel;
    const tsName = node.metaContext.tabularSectionName;
    const urlTemplateName = node.metaContext.urlTemplateName;

    try {
      switch (nodeKind) {
        case 'Attribute':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'Attribute', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'Attribute', label) : null,
            node.metaContext.rootMetaKind
          );
        case 'StandardAttribute': {
          const standardAttributeName = node.metaContext.standardAttributeName ?? label;
          const localXml = tsName
            ? extractStandardAttributeXml(objectXml, standardAttributeName, tsName)
            : ensureStandardAttributeXml(objectMainXmlPath, standardAttributeName, node.metaContext.rootMetaKind);
          const inheritedXml = inheritedObjectXml
            ? extractStandardAttributeXml(inheritedObjectXml, standardAttributeName, tsName)
            : null;
          return propsFromElementXml(localXml, 'standardAttribute', inheritedXml);
        }
        case 'AddressingAttribute':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'AddressingAttribute', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'AddressingAttribute', label) : null,
            node.metaContext.rootMetaKind
          );
        case 'Dimension':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'Dimension', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'Dimension', label) : null,
            node.metaContext.rootMetaKind
          );
        case 'Resource':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'Resource', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'Resource', label) : null,
            node.metaContext.rootMetaKind
          );
        case 'EnumValue':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'EnumValue', label),
            'enumValue',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'EnumValue', label) : null
          );
        case 'TabularSection':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'TabularSection', label),
            'tabular',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'TabularSection', label) : null
          );
        case 'Column': {
          if (!tsName) {
            return [];
          }
          return propsFromElementXml(
            extractColumnXmlFromTabularSection(objectXml, tsName, label),
            'typed',
            inheritedObjectXml ? extractColumnXmlFromTabularSection(inheritedObjectXml, tsName, label) : null,
            node.metaContext.rootMetaKind
          );
        }
        case 'Form': {
          const formPath = resolveFormDefinitionXmlPath(objectMainXmlPath, label);
          const inheritedFormPath = inheritedObjectXml
            ? resolveInheritedDefinitionXmlPath(objectMainXmlPath, 'Forms', label)
            : null;
          const inlineFormXml = extractChildMetaElementXml(objectXml, 'Form', label);
          const inheritedInlineFormXml = inheritedObjectXml
            ? extractChildMetaElementXml(inheritedObjectXml, 'Form', label)
            : null;
          if (!formPath && !inheritedFormPath && !inlineFormXml && !inheritedInlineFormXml) {
            return notFoundProps('Файл описания формы не найден');
          }
          return buildFormLikeProperties(
            formPath ? readXmlOrEmpty(formPath) : inlineFormXml ?? '',
            inheritedFormPath ? readXmlOrEmpty(inheritedFormPath) : inheritedInlineFormXml
          );
        }
        case 'Command': {
          const commandXml = extractChildMetaElementXml(objectXml, 'Command', label);
          const inheritedCommandXml = inheritedObjectXml
            ? extractChildMetaElementXml(inheritedObjectXml, 'Command', label)
            : null;
          if (!commandXml && !inheritedCommandXml) {
            return notFoundProps('Описание команды не найдено в XML объекта');
          }
          return enrichCommandInterfaceGroupOptions(
            buildCommandProperties(commandXml ?? '', inheritedCommandXml),
            getObjectLocationFromXml(objectMainXmlPath).configRoot
          );
        }
        case 'Template': {
          const tplPath = resolveTemplateDefinitionXmlPath(objectMainXmlPath, label);
          const inheritedTplPath = inheritedObjectXml
            ? resolveInheritedDefinitionXmlPath(objectMainXmlPath, 'Templates', label)
            : null;
          if (!tplPath && !inheritedTplPath) {
            return notFoundProps('Файл макета не найден');
          }
          return buildTemplateMetaProperties(readXmlOrEmpty(tplPath), readXmlOrEmpty(inheritedTplPath));
        }
        case 'URLTemplate': {
          const localXml = extractChildMetaElementXml(objectXml, 'URLTemplate', label);
          const inheritedXml = inheritedObjectXml
            ? extractChildMetaElementXml(inheritedObjectXml, 'URLTemplate', label)
            : null;
          if (!localXml && !inheritedXml) {
            return [];
          }
          return buildUrlTemplateProperties(localXml ?? '', inheritedXml);
        }
        case 'Method': {
          if (!urlTemplateName) {
            return [];
          }
          const localXml = extractMethodXmlFromUrlTemplate(objectXml, urlTemplateName, label);
          const inheritedXml = inheritedObjectXml
            ? extractMethodXmlFromUrlTemplate(inheritedObjectXml, urlTemplateName, label)
            : null;
          if (!localXml && !inheritedXml) {
            return [];
          }
          return buildHttpMethodProperties(localXml ?? '', inheritedXml);
        }
        default:
          return [];
      }
    } catch {
      return [];
    }
  },
};

function propsFromElementXml(
  elementXml: string | null,
  mode: 'typed' | 'tabular' | 'enumValue' | 'standardAttribute' = 'typed',
  inheritedElementXml: string | null = null,
  ownerKind?: string
): ObjectPropertiesCollection {
  if (!elementXml && !inheritedElementXml) {
    return [];
  }
  if (mode === 'tabular') {
    return buildTabularSectionProperties(elementXml ?? '', inheritedElementXml);
  }
  if (mode === 'enumValue') {
    return buildEnumValueProperties(elementXml ?? '', inheritedElementXml);
  }
  if (mode === 'standardAttribute') {
    return buildStandardAttributeProperties(elementXml ?? '', inheritedElementXml);
  }
  return buildTypedFieldProperties(elementXml ?? '', inheritedElementXml, ownerKind);
}

function notFoundProps(message: string): ObjectPropertiesCollection {
  return [{ key: '_note', title: 'Примечание', kind: 'string', value: message, readonly: true }];
}

function readXmlOrEmpty(filePath: string | null): string {
  if (!filePath) {
    return '';
  }
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Путь к XML описания формы объекта */
function resolveFormDefinitionXmlPath(objectMainXmlPath: string, formName: string): string | null {
  const loc = getObjectLocationFromXml(objectMainXmlPath);
  const candidates = [
    path.join(loc.objectDir, 'Forms', formName, `${formName}.xml`),
    path.join(loc.objectDir, 'Forms', `${formName}.xml`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

/** Путь к XML макета в каталоге объекта */
function resolveTemplateDefinitionXmlPath(objectMainXmlPath: string, templateName: string): string | null {
  const loc = getObjectLocationFromXml(objectMainXmlPath);
  const candidates = [
    path.join(loc.objectDir, 'Templates', templateName, `${templateName}.xml`),
    path.join(loc.objectDir, 'Templates', `${templateName}.xml`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}
