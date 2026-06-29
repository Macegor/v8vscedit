import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import type { ConfigInfo } from '../../domain/Configuration';
import {
  extractSimpleTag,
  extractSynonym,
  findFirstElement,
  getElementChildren,
  getElementName,
  isTextNode,
  type XmlNodeList,
} from './XmlUtils';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  // Декодируем 5 предопределённых XML-сущностей (&amp; &lt; &gt; &quot; &apos;)
  // при чтении: иначе сырые «&amp;» ломают сравнение имён и вывод. Симметрия
  // сохраняется записью через escapeXmlText, который кодирует те же сущности обратно.
  processEntities: true,
});

// ВНИМАНИЕ: локальный collectText намеренно НЕ рекурсивный, в отличие от
// XmlUtils.collectText (тот спускается в дочерние элементы). Здесь читаются имена
// объектов из <ChildObjects> (`<Catalog>Имя</Catalog>` — прямой текстовый узел),
// где рекурсия не нужна. Объединять с XmlUtils-версией нельзя: поведение разойдётся
// на вложенных узлах (латентное расхождение, требует отдельного решения).
function collectText(nodes: XmlNodeList): string {
  let result = '';
  for (const node of nodes) {
    if (isTextNode(node)) {
      result += node['#text'];
    }
  }
  return result.trim();
}

/**
 * Читает `Configuration.xml` и возвращает нормализованную структуру
 * конфигурации или расширения.
 */
export class ConfigXmlReader {
  read(configXmlPath: string): ConfigInfo {
    const xml = fs.readFileSync(configXmlPath, 'utf-8');
    const nodes = parser.parse(xml) as XmlNodeList;
    const kind: 'cf' | 'cfe' = findFirstElement(nodes, 'ConfigurationExtensionPurpose') ? 'cfe' : 'cf';

    return {
      kind,
      name: extractSimpleTag(xml, 'Name') ?? '',
      synonym: extractSynonym(xml),
      version: extractSimpleTag(xml, 'Version') ?? '',
      namePrefix: extractSimpleTag(xml, 'NamePrefix') ?? '',
      childObjects: this.parseChildObjects(nodes),
    };
  }

  private parseChildObjects(nodes: XmlNodeList): Map<string, string[]> {
    const result = new Map<string, string[]>();
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

      const values = result.get(tagName);
      if (values) {
        values.push(objectName);
      } else {
        result.set(tagName, [objectName]);
      }
    }

    return result;
  }
}
