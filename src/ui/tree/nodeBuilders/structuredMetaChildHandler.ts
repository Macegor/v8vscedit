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
import {
  readInheritedObjectXmlForBorrowed,
  resolveInheritedDefinitionXmlPath,
} from '../../views/properties/BorrowedPropertiesResolver';

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
    const inheritedObjectXml = readInheritedObjectXmlForBorrowed(objectMainXmlPath);
    const { nodeKind } = node;
    const label = node.textLabel;
    const tsName = node.metaContext.tabularSectionName;

    try {
      switch (nodeKind) {
        case 'Attribute':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'Attribute', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'Attribute', label) : null
          );
        case 'AddressingAttribute':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'AddressingAttribute', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'AddressingAttribute', label) : null
          );
        case 'Dimension':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'Dimension', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'Dimension', label) : null
          );
        case 'Resource':
          return propsFromElementXml(
            extractChildMetaElementXml(objectXml, 'Resource', label),
            'typed',
            inheritedObjectXml ? extractChildMetaElementXml(inheritedObjectXml, 'Resource', label) : null
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
            inheritedObjectXml ? extractColumnXmlFromTabularSection(inheritedObjectXml, tsName, label) : null
          );
        }
        case 'Form': {
          const formPath = resolveFormDefinitionXmlPath(objectMainXmlPath, label);
          const inheritedFormPath = inheritedObjectXml
            ? resolveInheritedDefinitionXmlPath(objectMainXmlPath, 'Forms', label)
            : null;
          if (!formPath && !inheritedFormPath) {
            return notFoundProps('Файл описания формы не найден');
          }
          return buildFormLikeProperties(readXmlOrEmpty(formPath), readXmlOrEmpty(inheritedFormPath));
        }
        case 'Command': {
          const cmdPath = resolveCommandDefinitionXmlPath(objectMainXmlPath, label);
          const inheritedCmdPath = inheritedObjectXml
            ? resolveInheritedDefinitionXmlPath(objectMainXmlPath, 'Commands', label)
            : null;
          if (!cmdPath && !inheritedCmdPath) {
            return notFoundProps('Файл описания команды не найден');
          }
          return buildCommandProperties(readXmlOrEmpty(cmdPath), readXmlOrEmpty(inheritedCmdPath));
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
  mode: 'typed' | 'tabular' | 'enumValue' = 'typed',
  inheritedElementXml: string | null = null
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
  return buildTypedFieldProperties(elementXml ?? '', inheritedElementXml);
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
