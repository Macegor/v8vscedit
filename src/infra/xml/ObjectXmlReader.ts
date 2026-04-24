import * as fs from 'fs';
import { MetaObject, MetaChild } from '../../domain/MetaObject';
import {
  extractChildMetaElementXml,
  extractColumnXmlFromTabularSection,
  extractMainChildObjectsInnerXml,
  extractNestingAwareBlock,
  extractSimpleTag,
  extractSynonym,
} from './XmlUtils';

/**
 * Читает XML-файл объекта метаданных (Справочник, Документ, Регистр …) и
 * возвращает структуру с дочерними элементами (реквизиты, ТЧ, формы, макеты, команды).
 */
export class ObjectXmlReader {
  read(xmlPath: string): MetaObject | null {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return null;
    }

    const rootTagMatch = xml.match(/<MetaDataObject[^>]*>\s*<([A-Za-z][A-Za-z0-9]*)\s/);
    if (!rootTagMatch) {
      return null;
    }

    return {
      tag: rootTagMatch[1],
      name: extractSimpleTag(xml, 'Name') ?? '',
      synonym: extractSynonym(xml),
      children: this.parseChildren(xml),
    };
  }

  /**
   * Парсит дочерние элементы из главного `<ChildObjects>`.
   *
   * Порядок элементов в выгрузке:
   *   Attribute… → TabularSection… → Form… → Command… → Template…
   * Чтобы не поймать `Attribute`, принадлежащие колонкам ТЧ, реквизиты
   * извлекаются только из части ДО первого `<TabularSection>`.
   */
  private parseChildren(xml: string): MetaChild[] {
    const result: MetaChild[] = [];

    const mainBlock = extractMainChildObjectsInnerXml(xml);
    if (!mainBlock) {
      return result;
    }

    const tsStart = mainBlock.search(/<TabularSection(?=[\s/>])/);
    const attrBlock = tsStart >= 0 ? mainBlock.slice(0, tsStart) : mainBlock;
    for (const ctag of ['Attribute', 'Dimension', 'Resource']) {
      this.extractComplex(attrBlock, ctag, result);
    }

    this.extractComplex(mainBlock, 'EnumValue', result);
    this.extractComplex(mainBlock, 'TabularSection', result);

    for (const tag of ['Form', 'Template'] as const) {
      const simpleRe = new RegExp(`<${tag}>([^<]+)<\/${tag}>`, 'g');
      let m: RegExpExecArray | null;
      while ((m = simpleRe.exec(mainBlock)) !== null) {
        result.push({ tag, name: m[1].trim(), synonym: '' });
      }
    }

    this.extractComplex(mainBlock, 'Command', result);
    this.extractComplex(mainBlock, 'AddressingAttribute', result);

    return result;
  }

  /**
   * Извлекает дочерние элементы «с атрибутами» (реквизиты, ТЧ, команды, …).
   * Для табличной части дополнительно заполняет `columns` её собственным `<ChildObjects>`.
   */
  private extractComplex(block: string, tag: string, result: MetaChild[]): void {
    const openRe = new RegExp(`<${tag}(?=[\\s/>])[^>]*>`, 'g');
    const closeTag = `</${tag}>`;

    let m: RegExpExecArray | null;
    while ((m = openRe.exec(block)) !== null) {
      const startContent = m.index + m[0].length;
      const endIdx = block.indexOf(closeTag, startContent);
      if (endIdx === -1) {
        continue;
      }
      const inner = block.substring(startContent, endIdx);
      const name = extractSimpleTag(inner, 'Name') ?? '';
      const synonym = extractSynonym(inner);

      if (tag === 'TabularSection') {
        const tsChildBlock = extractNestingAwareBlock(inner, 'ChildObjects');
        const columns: MetaChild[] = [];
        if (tsChildBlock) {
          this.extractComplex(tsChildBlock, 'Attribute', columns);
        }
        result.push({ tag, name, synonym, columns });
      } else {
        result.push({ tag, name, synonym });
      }
    }
  }

  /**
   * Обновляет блок `<Type>` у выбранного элемента метаданных.
   * Возвращает `true`, если файл был изменён и сохранён.
   */
  updateTypeInObject(
    xmlPath: string,
    options: {
      targetKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'SessionParameter' | 'CommonAttribute';
      targetName: string;
      tabularSectionName?: string;
      typeInnerXml: string;
    }
  ): boolean {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return false;
    }

    const normalizedType = indentTypeInner(options.typeInnerXml);
    let targetXml: string | null = null;
    if (options.targetKind === 'Column') {
      if (!options.tabularSectionName) {
        return false;
      }
      targetXml = extractColumnXmlFromTabularSection(xml, options.tabularSectionName, options.targetName);
    } else if (options.targetKind === 'SessionParameter' || options.targetKind === 'CommonAttribute') {
      targetXml = xml;
    } else {
      targetXml = extractChildMetaElementXml(xml, options.targetKind, options.targetName);
    }

    if (!targetXml) {
      return false;
    }

    const updatedTarget = updateTypeInElement(targetXml, normalizedType);
    if (updatedTarget === targetXml) {
      return false;
    }

    const updatedXml = xml.replace(targetXml, updatedTarget);
    if (updatedXml === xml) {
      return false;
    }

    fs.writeFileSync(xmlPath, updatedXml, 'utf-8');
    return true;
  }

  /**
   * Обновляет значение свойства в блоке `<Properties>` выбранного элемента метаданных.
   * Возвращает `true`, если файл был изменён и сохранён.
   */
  updatePropertyInObject(
    xmlPath: string,
    options: {
      targetKind: 'Self' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue';
      targetName: string;
      tabularSectionName?: string;
      propertyKey: string;
      valueKind: 'string' | 'boolean' | 'localizedString';
      value: string | boolean;
    }
  ): boolean {
    let xml: string;
    try {
      xml = fs.readFileSync(xmlPath, 'utf-8');
    } catch {
      return false;
    }

    let targetXml: string | null;
    if (options.targetKind === 'Self') {
      targetXml = xml;
    } else if (options.targetKind === 'Column') {
      if (!options.tabularSectionName) {
        return false;
      }
      targetXml = extractColumnXmlFromTabularSection(xml, options.tabularSectionName, options.targetName);
    } else {
      targetXml = extractChildMetaElementXml(xml, options.targetKind, options.targetName);
    }

    if (!targetXml) {
      return false;
    }

    const updatedTarget = updatePropertyInElement(targetXml, options.propertyKey, options.valueKind, options.value);
    if (updatedTarget === targetXml) {
      return false;
    }

    const updatedXml = options.targetKind === 'Self'
      ? updatedTarget
      : xml.replace(targetXml, updatedTarget);
    if (updatedXml === xml) {
      return false;
    }
    fs.writeFileSync(xmlPath, updatedXml, 'utf-8');
    return true;
  }
}

function updateTypeInElement(elementXml: string, typeInnerXml: string): string {
  const typeBlock = `<Type>\n${typeInnerXml}\n</Type>`;
  if (/<Type>[\s\S]*?<\/Type>/.test(elementXml)) {
    return elementXml.replace(/<Type>[\s\S]*?<\/Type>/, typeBlock);
  }
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  let nextPropsInner = propsInner;
  if (/<Comment[\s\S]*?<\/Comment>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Comment[\s\S]*?<\/Comment>)/, `$1\n${typeBlock}`);
  } else if (/<Name[\s\S]*?<\/Name>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Name[\s\S]*?<\/Name>)/, `$1\n${typeBlock}`);
  } else {
    nextPropsInner = `${propsInner}\n${typeBlock}`;
  }
  return elementXml.replace(propsInner, nextPropsInner);
}

function indentTypeInner(typeInnerXml: string): string {
  return typeInnerXml
    .split('\n')
    .map((line) => line.replace(/\r/g, '').trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => `\t\t\t${line}`)
    .join('\n');
}

function updatePropertyInElement(
  elementXml: string,
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString',
  value: string | boolean
): string {
  const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(elementXml);
  if (!propertiesMatch) {
    return elementXml;
  }
  const propsInner = propertiesMatch[1];
  const nextValueBlock = buildPropertyValueBlock(propertyKey, valueKind, value);
  const propertyRe = new RegExp(`<${propertyKey}>[\\s\\S]*?<\\/${propertyKey}>`);

  let nextPropsInner = propsInner;
  if (propertyRe.test(propsInner)) {
    nextPropsInner = propsInner.replace(propertyRe, nextValueBlock);
  } else if (/<Comment[\s\S]*?<\/Comment>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Comment[\s\S]*?<\/Comment>)/, `$1\n${nextValueBlock}`);
  } else if (/<Name[\s\S]*?<\/Name>/.test(propsInner)) {
    nextPropsInner = propsInner.replace(/(<Name[\s\S]*?<\/Name>)/, `$1\n${nextValueBlock}`);
  } else {
    nextPropsInner = `${propsInner}\n${nextValueBlock}`;
  }

  if (nextPropsInner === propsInner) {
    return elementXml;
  }
  return elementXml.replace(propsInner, nextPropsInner);
}

function buildPropertyValueBlock(
  propertyKey: string,
  valueKind: 'string' | 'boolean' | 'localizedString',
  value: string | boolean
): string {
  if (valueKind === 'boolean') {
    return `<${propertyKey}>${value === true ? 'true' : 'false'}</${propertyKey}>`;
  }
  if (valueKind === 'localizedString') {
    const content = escapeXmlText(String(value ?? ''));
    return [
      `<${propertyKey}>`,
      '\t\t\t\t\t<v8:item>',
      '\t\t\t\t\t\t<v8:lang>ru</v8:lang>',
      `\t\t\t\t\t\t<v8:content>${content}</v8:content>`,
      '\t\t\t\t\t</v8:item>',
      `</${propertyKey}>`,
    ].join('\n');
  }
  return `<${propertyKey}>${escapeXmlText(String(value ?? ''))}</${propertyKey}>`;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
