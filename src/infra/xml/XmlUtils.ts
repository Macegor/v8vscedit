/**
 * Низкоуровневые помощники для работы с XML-выгрузкой 1С.
 *
 * Все эти функции рассчитаны на предсказуемую структуру 1С XML и специально
 * не используют полноценный XML-парсер, чтобы иметь возможность точно отсекать
 * нужные фрагменты (например, главный `<ChildObjects>` корневого объекта при
 * наличии вложенных `<ChildObjects>` у табличных частей).
 *
 * ⚠ Новые функции парсинга должны создаваться ТОЛЬКО в этом модуле — по
 * архитектурному правилу вне `infra/xml/**` regex-парсинг XML запрещён.
 */

/** Извлекает текст первого вхождения тега без атрибутов */
export function extractSimpleTag(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${tagName}>([^<]*)<\/${tagName}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

/** Извлекает синоним из `<Synonym><v8:item><v8:content>...</v8:content>` */
export function extractSynonym(xml: string): string {
  const synMatch = xml.match(/<Synonym>([\s\S]*?)<\/Synonym>/);
  if (!synMatch) {
    return '';
  }
  const contentMatch = synMatch[1].match(/<v8:content>([^<]*)<\/v8:content>/);
  return contentMatch ? contentMatch[1].trim() : '';
}

/**
 * Извлекает содержимое первого `<tagName>...</tagName>` с учётом вложенности
 * (для `<ChildObjects>`, который может содержать вложенный `<ChildObjects>`).
 */
export function extractNestingAwareBlock(xml: string, tagName: string): string | null {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const openIdx = xml.indexOf(openTag);
  if (openIdx === -1) {
    return null;
  }

  let depth = 1;
  let pos = openIdx + openTag.length;

  while (depth > 0 && pos < xml.length) {
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose === -1) {
      break;
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + openTag.length;
    } else {
      depth--;
      if (depth === 0) {
        return xml.substring(openIdx + openTag.length, nextClose);
      }
      pos = nextClose + closeTag.length;
    }
  }
  return null;
}

/**
 * Возвращает содержимое первого блока `<ChildObjects>` — «реквизиты, ТЧ, формы на уровне объекта».
 */
export function extractMainChildObjectsInnerXml(xml: string): string | null {
  return extractNestingAwareBlock(xml, 'ChildObjects');
}

/**
 * Находит в блоке XML полный фрагмент дочернего элемента по тегу и значению `<Name>`.
 */
export function findChildElementFullXmlInBlock(
  block: string,
  childTag: string,
  elementName: string
): string | null {
  const openRe = new RegExp(`<${childTag}(?=[\\s/>])[^>]*>`, 'g');
  const closeTag = `</${childTag}>`;

  let m: RegExpExecArray | null;
  while ((m = openRe.exec(block)) !== null) {
    const startIdx = m.index;
    const startContent = m.index + m[0].length;
    const endIdx = block.indexOf(closeTag, startContent);
    if (endIdx === -1) {
      continue;
    }
    const inner = block.substring(startContent, endIdx);
    const elName = extractSimpleTag(inner, 'Name') ?? '';
    if (elName === elementName) {
      return block.substring(startIdx, endIdx + closeTag.length);
    }
  }
  return null;
}

/**
 * Извлекает полный XML-фрагмент дочернего объекта из главного `<ChildObjects>`.
 */
export function extractChildMetaElementXml(
  xml: string,
  childTag: string,
  elementName: string
): string | null {
  const mainBlock = extractMainChildObjectsInnerXml(xml);
  if (!mainBlock) {
    return null;
  }
  return findChildElementFullXmlInBlock(mainBlock, childTag, elementName);
}

/**
 * Возвращает XML колонки табличной части по имени ТЧ и имени колонки.
 */
export function extractColumnXmlFromTabularSection(
  objectXml: string,
  sectionName: string,
  columnName: string
): string | null {
  const tsXml = extractChildMetaElementXml(objectXml, 'TabularSection', sectionName);
  if (!tsXml) {
    return null;
  }
  const tsInner = extractNestingAwareBlock(tsXml, 'ChildObjects');
  if (!tsInner) {
    return null;
  }
  return findChildElementFullXmlInBlock(tsInner, 'Attribute', columnName);
}
