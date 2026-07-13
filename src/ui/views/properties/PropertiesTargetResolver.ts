import * as fs from 'fs';
import * as path from 'path';
import type { MetadataNode } from '../../tree/TreeNode';
import { getObjectLocationFromXml } from '../../../infra/fs';
import { extractXmlAttribute } from '../../../infra/xml';
import type { TypeRegistryFilter } from './TypeRegistryService';

export function resolveTypeTarget(node: MetadataNode, propertyName = 'Type'): {
  xmlPath: string;
  targetKind:
    | 'Attribute'
    | 'AddressingAttribute'
    | 'Dimension'
    | 'Resource'
    | 'Column'
    | 'SessionParameter'
    | 'CommonAttribute'
    | 'Constant'
    | 'DefinedType'
    | 'EventSubscription'
    | 'CommonCommand'
    | 'Command';
  targetName: string;
  tabularSectionName?: string;
} | null {
  if (!node.xmlPath) {
    return null;
  }
  if (propertyName === 'Source' && node.nodeKind === 'EventSubscription') {
    return {
      xmlPath: node.xmlPath,
      targetKind: 'EventSubscription',
      targetName: node.textLabel,
    };
  }
  if (propertyName === 'CommandParameterType') {
    if (node.nodeKind === 'CommonCommand') {
      return {
        xmlPath: node.xmlPath,
        targetKind: 'CommonCommand',
        targetName: node.textLabel,
      };
    }
    if (node.nodeKind === 'Command') {
      return {
        xmlPath: node.metaContext?.ownerObjectXmlPath ?? node.xmlPath,
        targetKind: 'Command',
        targetName: node.textLabel,
      };
    }
    return null;
  }
  if (
    node.nodeKind === 'SessionParameter' ||
    node.nodeKind === 'CommonAttribute' ||
    node.nodeKind === 'Constant' ||
    node.nodeKind === 'DefinedType'
  ) {
    return {
      xmlPath: node.xmlPath,
      targetKind: node.nodeKind,
      targetName: node.textLabel,
    };
  }
  const supported: Partial<Record<string, 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column'>> = {
    Attribute: 'Attribute',
    AddressingAttribute: 'AddressingAttribute',
    Dimension: 'Dimension',
    Resource: 'Resource',
    Column: 'Column',
  };
  const targetKind = supported[node.nodeKind];
  if (!targetKind) {
    return null;
  }
  return {
    xmlPath: node.metaContext?.ownerObjectXmlPath ?? node.xmlPath,
    targetKind,
    targetName: node.textLabel,
    tabularSectionName: node.metaContext?.tabularSectionName,
  };
}

export function resolveTypeRegistryFilter(key: string): TypeRegistryFilter {
  if (key === 'Source') {
    return 'eventSource';
  }
  if (key === 'CommandParameterType') {
    return 'commandParameter';
  }
  return 'value';
}

export function resolvePropertyTarget(node: MetadataNode): {
  xmlPath: string;
  targetKind: 'Self' | 'StandardAttribute' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'Command' | 'EnumValue' | 'URLTemplate' | 'Method';
  targetName: string;
  tabularSectionName?: string;
  urlTemplateName?: string;
} | null {
  if (!node.xmlPath) {
    return null;
  }
  const directKinds: Partial<Record<string, 'StandardAttribute' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'Command' | 'EnumValue' | 'URLTemplate' | 'Method'>> = {
    StandardAttribute: 'StandardAttribute',
    Attribute: 'Attribute',
    AddressingAttribute: 'AddressingAttribute',
    Dimension: 'Dimension',
    Resource: 'Resource',
    Column: 'Column',
    TabularSection: 'TabularSection',
    Command: 'Command',
    EnumValue: 'EnumValue',
    URLTemplate: 'URLTemplate',
    Method: 'Method',
  };
  const mapped = directKinds[node.nodeKind];
  if (mapped) {
    return {
      xmlPath: node.metaContext?.ownerObjectXmlPath ?? node.xmlPath,
      targetKind: mapped,
      targetName: mapped === 'StandardAttribute'
        ? node.metaContext?.standardAttributeName ?? node.textLabel
        : node.textLabel,
      tabularSectionName: node.metaContext?.tabularSectionName,
      urlTemplateName: node.metaContext?.urlTemplateName,
    };
  }
  if (node.nodeKind === 'Form') {
    const filePath = resolveNestedObjectDefinitionPath(node, 'Forms');
    if (!filePath) {
      return null;
    }
    return { xmlPath: filePath, targetKind: 'Self', targetName: node.textLabel };
  }
  if (node.nodeKind === 'Command') {
    const filePath = resolveNestedObjectDefinitionPath(node, 'Commands');
    if (!filePath) {
      return null;
    }
    return { xmlPath: filePath, targetKind: 'Self', targetName: node.textLabel };
  }
  if (node.nodeKind === 'Template') {
    const filePath = resolveNestedObjectDefinitionPath(node, 'Templates');
    if (!filePath) {
      return null;
    }
    return { xmlPath: filePath, targetKind: 'Self', targetName: node.textLabel };
  }
  return { xmlPath: node.xmlPath, targetKind: 'Self', targetName: node.textLabel };
}

function resolveNestedObjectDefinitionPath(
  node: MetadataNode,
  folderName: 'Forms' | 'Commands' | 'Templates'
): string | null {
  const ownerXmlPath = node.metaContext?.ownerObjectXmlPath ?? node.xmlPath;
  if (!ownerXmlPath) {
    return null;
  }
  const location = getObjectLocationFromXml(ownerXmlPath);
  const candidates = [
    path.join(location.objectDir, folderName, node.textLabel, `${node.textLabel}.xml`),
    path.join(location.objectDir, folderName, `${node.textLabel}.xml`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function extractUuidFromXml(xml: string | null): string | null {
  if (!xml) {
    return null;
  }
  return extractXmlAttribute(xml, 'uuid')?.toLowerCase() ?? null;
}

export function isValidMetadataName(value: string): boolean {
  return /^[\p{L}][\p{L}\p{Nd}_]*$/u.test(value);
}

export function isRootObjectNode(
  node: MetadataNode,
  target: { targetKind: 'Self' | 'StandardAttribute' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'Command' | 'EnumValue' | 'URLTemplate' | 'Method' }
): boolean {
  if (target.targetKind !== 'Self') {
    return false;
  }
  const ownerXmlPath = node.metaContext?.ownerObjectXmlPath;
  if (ownerXmlPath && ownerXmlPath !== node.xmlPath) {
    return false;
  }
  if (node.nodeKind === 'configuration' || node.nodeKind === 'extension' || node.nodeKind.startsWith('group-')) {
    return false;
  }
  return node.nodeKind !== 'NumeratorsBranch' && node.nodeKind !== 'SequencesBranch';
}
