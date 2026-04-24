import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { ConfigInfo } from '../../domain/Configuration';
import { extractSimpleTag, extractSynonym } from './XmlUtils';

type XmlTextNode = { '#text': string };
type XmlElementNode = { [tagName: string]: XmlNodeList };
type XmlNode = XmlTextNode | XmlElementNode;
type XmlNodeList = XmlNode[];

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  processEntities: false,
});

function isTextNode(node: XmlNode): node is XmlTextNode {
  return Object.prototype.hasOwnProperty.call(node, '#text');
}

function getElementName(node: XmlNode): string | null {
  if (isTextNode(node)) {
    return null;
  }
  const [name] = Object.keys(node);
  return name ?? null;
}

function getElementChildren(node: XmlNode): XmlNodeList {
  if (isTextNode(node)) {
    return [];
  }
  const name = getElementName(node);
  return name ? (node[name] ?? []) : [];
}

function collectText(nodes: XmlNodeList): string {
  let result = '';
  for (const node of nodes) {
    if (isTextNode(node)) {
      result += node['#text'];
    }
  }
  return result.trim();
}

function findFirstElement(nodes: XmlNodeList, tagName: string): XmlElementNode | null {
  for (const node of nodes) {
    const name = getElementName(node);
    if (!name) {
      continue;
    }
    if (name === tagName) {
      return node as XmlElementNode;
    }
    const found = findFirstElement(getElementChildren(node), tagName);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Читает `Configuration.xml` и возвращает нормализованную структуру
 * конфигурации или расширения.
 */
export class ConfigXmlReader {
  read(configXmlPath: string): ConfigInfo {
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const kind: 'cf' | 'cfe' = xml.includes('<ConfigurationExtensionPurpose>') ? 'cfe' : 'cf';

    return {
      kind,
      name: extractSimpleTag(xml, 'Name') ?? '',
      synonym: extractSynonym(xml),
      version: extractSimpleTag(xml, 'Version') ?? '',
      namePrefix: extractSimpleTag(xml, 'NamePrefix') ?? '',
      childObjects: this.parseChildObjects(xml),
    };
  }

  private parseChildObjects(xml: string): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const nodes = parser.parse(xml) as XmlNodeList;
    const childObjects = findFirstElement(nodes, 'ChildObjects');
    if (!childObjects) {
      return result;
    }

    for (const child of getElementChildren(childObjects)) {
      const tagName = getElementName(child);
      if (!tagName) {
        continue;
      }

      const objectName = collectText(getElementChildren(child));
      if (!objectName) {
        continue;
      }

      if (!result.has(tagName)) {
        result.set(tagName, []);
      }
      result.get(tagName)!.push(objectName);
    }

    return result;
  }
}
