import * as fs from 'fs';
import * as path from 'path';
import { MetadataNode, NodeKind } from '../TreeNode';
import {
  extractChildMetaElementXml,
  extractColumnXmlFromTabularSection,
} from '../../../infra/xml';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { ObjectHandler, ObjectPropertiesCollection } from './_types';
import {
  buildCommandProperties,
  buildEnumValueProperties,
  buildFormLikeProperties,
  buildTabularSectionProperties,
  buildTemplateMetaProperties,
  buildTypedFieldProperties,
} from '../../views/properties/PropertyBuilder';

/** Виды дочерних узлов, для которых есть общий разбор свойств из XML */
const SUPPORTED_CHILD_KINDS = new Set<NodeKind>([
  'Attribute',
  'AddressingAttribute',
  'Dimension',
  'Resource',
  'TabularSection',
  'Column',
  'Form',
  'Command',
  'Template',
  'EnumValue',
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
    const { nodeKind } = node;
    const label = node.textLabel;
    const tsName = node.metaContext.tabularSectionName;

    try {
      switch (nodeKind) {
        case 'Attribute':
          return propsFromElementXml(extractChildMetaElementXml(objectXml, 'Attribute', label));
        case 'AddressingAttribute':
          return propsFromElementXml(extractChildMetaElementXml(objectXml, 'AddressingAttribute', label));
        case 'Dimension':
          return propsFromElementXml(extractChildMetaElementXml(objectXml, 'Dimension', label));
        case 'Resource':
          return propsFromElementXml(extractChildMetaElementXml(objectXml, 'Resource', label));
        case 'EnumValue':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'EnumValue', label),
            'enumValue'
          );
        case 'TabularSection':
          return propsFromElementXml(extractChildMetaElementXml(objectXml, 'TabularSection', label), 'tabular');
        case 'Column': {
          if (!tsName) {
            return [];
          }
          return propsFromElementXml(
            extractColumnXmlFromTabularSection(objectXml, tsName, label)
          );
        }
        case 'Form': {
          const formPath = resolveFormDefinitionXmlPath(objectMainXmlPath, label);
          if (!formPath) {
            return notFoundProps('Файл описания формы не найден');
          }
          return buildFormLikeProperties(fs.readFileSync(formPath, 'utf-8'));
        }
        case 'Command': {
          const cmdPath = resolveCommandDefinitionXmlPath(objectMainXmlPath, label);
          if (!cmdPath) {
            return notFoundProps('Файл описания команды не найден');
          }
          return buildCommandProperties(fs.readFileSync(cmdPath, 'utf-8'));
        }
        case 'Template': {
          const tplPath = resolveTemplateDefinitionXmlPath(objectMainXmlPath, label);
          if (!tplPath) {
            return notFoundProps('Файл макета не найден');
          }
          return buildTemplateMetaProperties(fs.readFileSync(tplPath, 'utf-8'));
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
  mode: 'typed' | 'tabular' | 'enumValue' = 'typed'
): ObjectPropertiesCollection {
  if (!elementXml) {
    return [];
  }
  if (mode === 'tabular') {
    return buildTabularSectionProperties(elementXml);
  }
  if (mode === 'enumValue') {
    return buildEnumValueProperties(elementXml);
  }
  return buildTypedFieldProperties(elementXml);
}

function notFoundProps(message: string): ObjectPropertiesCollection {
  return [{ key: '_note', title: 'Примечание', kind: 'string', value: message }];
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

/** Путь к XML описания команды объекта */
function resolveCommandDefinitionXmlPath(objectMainXmlPath: string, commandName: string): string | null {
  const loc = getObjectLocationFromXml(objectMainXmlPath);
  const candidates = [
    path.join(loc.objectDir, 'Commands', commandName, `${commandName}.xml`),
    path.join(loc.objectDir, 'Commands', `${commandName}.xml`),
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
