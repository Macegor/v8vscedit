import type { LocalizedStringValue } from './_types';
import {
  extractRootMetadataObjectElementXml,
  extractRootMetadataObjectPropertiesInnerXml,
  extractTagInnerXml,
  hasSelfClosingXmlTag,
  parseLocalizedStringSection,
} from '../../../infra/xml';
import { PROPERTY_TITLE_RU } from '../../../infra/xml/PropertySchema';
import { getPropertyTitle } from './PropertyPresentationRegistry';

/** Извлекает внутренность первого блока Properties корневого тега объекта (Catalog, ExchangePlan, …) */
export function extractRootObjectPropertiesInnerXml(fullXml: string): string | null {
  return extractRootMetadataObjectPropertiesInnerXml(fullXml);
}

export function extractRootObjectElementXml(fullXml: string): string | null {
  return extractRootMetadataObjectElementXml(fullXml);
}

/** Внутренность блока Properties внутри XML-фрагмента элемента */
export function extractPropertiesInnerFromElement(elementXml: string): string | null {
  return extractTagInnerXml(elementXml, 'Properties');
}

/** Локализованная строка свойства (как в общем модуле) */
export function extractLocalizedStringValue(xml: string, tagName: string): LocalizedStringValue {
  const inner = extractTagInnerXml(xml, tagName);
  if (inner === null) {
    return { presentation: '', values: [] };
  }
  return parseLocalizedStringSection(inner);
}

export function isBooleanScalar(value: string | undefined): value is string {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === 'false';
}

export function summarizeTypeBlock(propertiesSource: string): string {
  return extractTypePropertyInner(propertiesSource, 'Type');
}

export function extractTypePropertyInner(propertiesSource: string, key: string): string {
  return extractTagInnerXml(propertiesSource, key)?.trim() ?? '';
}

export function propertyTitle(key: string): string {
  return getPropertyTitle(key, PROPERTY_TITLE_RU);
}

/**
 * Нормализует значение простого тега; вынесено из цикла, чтобы параметр не сужался CFA до только `undefined`.
 */
export function coalesceSimpleTagText(simple: string | undefined): string {
  return simple ?? '';
}

export function hasSelfClosingProperty(xml: string, key: string): boolean {
  return hasSelfClosingXmlTag(xml, key);
}

export function stripXmlTagNamespacePrefix(tagName: string): string {
  const colon = tagName.indexOf(':');
  return colon >= 0 ? tagName.slice(colon + 1) : tagName;
}
