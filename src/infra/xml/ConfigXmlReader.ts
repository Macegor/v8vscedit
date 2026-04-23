import * as fs from 'fs';
import { ConfigInfo } from '../../domain/Configuration';
import { extractSimpleTag, extractSynonym } from './XmlUtils';

/**
 * Читает `Configuration.xml` (конфигурация или расширение) и возвращает
 * нормализованную структуру {@link ConfigInfo}.
 */
export class ConfigXmlReader {
  /** Путь передаётся для каждого вызова — класс не хранит состояния */
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

  /**
   * Разбирает блок `<ChildObjects>`:
   *   `<ТипОбъекта>ИмяОбъекта</ТипОбъекта>` → `{ ТипОбъекта: [ИмяОбъекта, …] }`
   */
  private parseChildObjects(xml: string): Map<string, string[]> {
    const result = new Map<string, string[]>();

    const childBlockMatch = xml.match(/<ChildObjects>([\s\S]*?)<\/ChildObjects>/);
    if (!childBlockMatch) {
      return result;
    }

    const block = childBlockMatch[1];
    const re = /<([A-Za-z][A-Za-z0-9]*)>([^<]+)<\/\1>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const tag = m[1];
      const objName = m[2].trim();
      if (!result.has(tag)) {
        result.set(tag, []);
      }
      result.get(tag)!.push(objName);
    }

    return result;
  }
}
