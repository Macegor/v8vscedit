import type { SkdEditOperation, SkdEditOptions } from '../DataCompositionSchemaService';
import {
  escapeRegExp,
  escapeXmlText,
  findDirectElementRanges,
  findNestingAwareElementRange,
} from '../XmlUtils';
import {
  appendIntoSection,
  countTags,
  editFirstDataSet,
  editFirstVariantSettings,
  extractBlock,
  insertBeforeClose,
  matchBlocks,
  readText,
  removeElementByChildText,
  replaceOrInsert,
} from './dcsShared';
import {
  buildCalculatedFieldXml,
  buildDataSetXml,
  buildFieldXml,
  buildFilterXml,
  buildOrderXml,
  buildParameterXml,
  buildParameterXmlWithAutoDates,
  buildStructureXml,
  buildTotalFieldXml,
  buildVariantXml,
} from './schemaBuilders';
import { parseField, parseParameter, parseVariant } from './schemaParse';

export function applyEdit(xml: string, operation: SkdEditOperation, value: string, options: SkdEditOptions, warnings: string[]): string {
  switch (operation) {
    case 'add-field':
      return editFirstDataSet(xml, options.dataSet, (block) => insertBeforeClose(block, 'dataSet', buildFieldXml(value, '\t\t')));
    case 'add-total':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildTotalFieldXml(value));
    case 'add-calculated-field':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildCalculatedFieldXml(value));
    case 'add-parameter':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildParameterXmlWithAutoDates(value).join('\n'));
    case 'add-dataSet': {
      const [name, query] = value.includes(':') ? value.split(/:(.+)/) : [`НаборДанных${String(countTags(xml, 'dataSet') + 1)}`, value];
      return insertBeforeClose(xml, 'DataCompositionSchema', buildDataSetXml({ name: name.trim(), query: query.trim(), fields: [] }, readText(matchBlocks(xml, 'dataSource')[0] ?? '', 'name') || 'ИсточникДанных1'));
    }
    case 'add-variant':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildVariantXml(parseVariant(value), []));
    case 'add-dataSetLink':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildDataSetLinkXml(value));
    case 'add-conditionalAppearance':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'conditionalAppearance', buildConditionalAppearanceItemXml(value)));
    case 'add-drilldown':
      return insertBeforeClose(xml, 'DataCompositionSchema', buildDrilldownTemplateXml(value));
    case 'set-query':
      return editFirstDataSet(xml, options.dataSet, (block) => replaceOrInsert(block, 'query', escapeXmlText(value), 'dataSet'));
    case 'patch-query':
      return editFirstDataSet(xml, options.dataSet, (block) => block.replace('</query>', `${escapeXmlText(value)}\n</query>`));
    case 'set-outputParameter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'outputParameters', buildOutputParameterItemXml(value)));
    case 'set-structure':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'structure', extractBlock(buildStructureXml(value, ''), 'structure') ?? '', 'settings'));
    case 'modify-field':
      return editFirstDataSet(xml, options.dataSet, (block) => replaceFieldBlock(block, value, warnings));
    case 'modify-parameter':
      return replaceParameterBlock(xml, value, warnings);
    case 'modify-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => modifyFirstItemInSection(settings, 'filter', buildFilterXml(value, '')));
    case 'modify-dataParameter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'dataParameters', `<item><parameter>${escapeXmlText(value.replace(/\s*=.*/, '').trim())}</parameter></item>`));
    case 'rename-parameter': {
      const match = /^(.+?)\s*=>\s*(.+)$/.exec(value);
      if (!match) {
        warnings.push('rename-parameter ожидает формат OldName => NewName.');
        return xml;
      }
      return renameParameter(xml, match[1].trim(), match[2].trim());
    }
    case 'remove-field':
      return editFirstDataSet(xml, options.dataSet, (block) => removeElementByChildText(block, 'field', 'dataPath', value.trim()));
    case 'remove-total':
      return removeElementByChildText(xml, 'totalField', 'dataPath', value.trim());
    case 'remove-calculated-field':
      return removeElementByChildText(xml, 'calculatedField', 'dataPath', value.trim());
    case 'remove-parameter':
      return removeElementByChildText(xml, 'parameter', 'name', value.trim());
    case 'remove-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => removeSectionItemByText(settings, 'filter', 'left', value.trim()));
    case 'add-selection':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'selection', value === 'Auto' ? '<item xsi:type="dcsset:SelectedItemAuto"/>' : `<item xsi:type="dcsset:SelectedItemField"><field>${escapeXmlText(value)}</field></item>`));
    case 'add-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'filter', extractBlock(buildFilterXml(value, ''), 'filter') ?? ''));
    case 'add-order':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'order', extractBlock(buildOrderXml(value, ''), 'order') ?? ''));
    case 'clear-selection':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'selection', '', 'settings'));
    case 'clear-filter':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'filter', '', 'settings'));
    case 'clear-order':
      return editFirstVariantSettings(xml, options.variant, (settings) => replaceOrInsert(settings, 'order', '', 'settings'));
    case 'add-dataParameter':
      return editFirstVariantSettings(xml, options.variant, (settings) => appendIntoSection(settings, 'dataParameters', `<item><parameter>${escapeXmlText(value.replace(/\s*=.*/, '').trim())}</parameter><userSettingID>${escapeXmlText(value.replace(/\s*=.*/, '').trim())}</userSettingID></item>`));
    case 'reorder-parameters':
      return reorderParameters(xml, value, warnings);
  }
}

export function buildDataSetLinkXml(value: string): string {
  const match = /^(.+?)\s*>\s*(.+?)\s+on\s+(.+?)\s*=\s*(.+?)(?:\s*\[param\s+([^\]]+)])?$/.exec(value.trim());
  if (!match) {
    throw new Error('add-dataSetLink ожидает формат: Источник > Приёмник on Поле1 = Поле2 [param Имя].');
  }
  return [
    '\t<dataSetLink>',
    `\t\t<sourceDataSet>${escapeXmlText(match[1].trim())}</sourceDataSet>`,
    `\t\t<destinationDataSet>${escapeXmlText(match[2].trim())}</destinationDataSet>`,
    '\t\t<field>',
    `\t\t\t<sourceExpression>${escapeXmlText(match[3].trim())}</sourceExpression>`,
    `\t\t\t<destinationExpression>${escapeXmlText(match[4].trim())}</destinationExpression>`,
    match[5] ? `\t\t\t<parameter>${escapeXmlText(match[5].trim())}</parameter>` : '',
    '\t\t</field>',
    '\t</dataSetLink>',
  ].filter(Boolean).join('\n');
}

export function buildConditionalAppearanceItemXml(value: string): string {
  const match = /^(.+?)\s*=\s*(.+?)(?:\s+when\s+(.+?))?(?:\s+for\s+(.+))?$/.exec(value.trim());
  if (!match) {
    throw new Error('add-conditionalAppearance ожидает формат: Параметр = значение [when условие] [for Поле1, Поле2].');
  }
  // Опциональная группа регулярки фактически может быть undefined, тип RegExpExecArray этого не отражает.
  const rawFields = match[4] as string | undefined;
  const fields = (rawFields ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return [
    '<item>',
    '<appearance>',
    `<dcscor:item xsi:type="dcsset:SettingsParameterValue"><dcscor:parameter>${escapeXmlText(match[1].trim())}</dcscor:parameter><dcscor:value xsi:type="xs:string">${escapeXmlText(match[2].trim())}</dcscor:value></dcscor:item>`,
    '</appearance>',
    match[3] ? `<filter>${extractBlock(buildFilterXml(match[3], ''), 'filter') ?? ''}</filter>` : '',
    fields.length > 0 ? `<fields>${fields.map((field) => `<item>${escapeXmlText(field)}</item>`).join('')}</fields>` : '',
    '</item>',
  ].filter(Boolean).join('');
}

export function buildDrilldownTemplateXml(value: string): string {
  const fields = value.split(',').map((item) => item.trim()).filter(Boolean);
  return [
    '\t<template>',
    '\t\t<name>РасшифровкаРесурсов</name>',
    ...fields.map((field) => `\t\t<field>${escapeXmlText(field)}</field>`),
    '\t</template>',
  ].join('\n');
}

export function buildOutputParameterItemXml(value: string): string {
  const [name, rawValue = ''] = value.split(/=(.+)/).map((item) => item.trim());
  return `<item><parameter>${escapeXmlText(name)}</parameter><value xsi:type="xs:string">${escapeXmlText(rawValue)}</value></item>`;
}

export function replaceFieldBlock(xml: string, value: string, warnings: string[]): string {
  const field = parseField(value);
  if (!field.dataPath) {
    warnings.push('modify-field ожидает shorthand поля с именем.');
    return xml;
  }
  for (const block of matchBlocks(xml, 'field')) {
    if (readText(block, 'dataPath') === field.dataPath) {
      const fieldXml = buildFieldXml(value, '\t\t');
      return xml.replace(block, () => fieldXml);
    }
  }
  warnings.push(`Поле не найдено, добавлено новое: ${field.dataPath}.`);
  return insertBeforeClose(xml, 'dataSet', buildFieldXml(value, '\t\t'));
}

export function replaceParameterBlock(xml: string, value: string, warnings: string[]): string {
  const parsed = parseParameter(value);
  if (!parsed.name) {
    warnings.push('modify-parameter ожидает имя параметра.');
    return xml;
  }
  const replacement = buildParameterXml(parsed);
  for (const block of matchBlocks(xml, 'parameter')) {
    if (readText(block, 'name') === parsed.name) {
      return xml.replace(block, () => replacement);
    }
  }
  warnings.push(`Параметр не найден, добавлен новый: ${parsed.name}.`);
  return insertBeforeClose(xml, 'DataCompositionSchema', replacement);
}

export function modifyFirstItemInSection(xml: string, sectionTag: string, sectionXml: string): string {
  const inner = extractBlock(sectionXml, sectionTag) ?? '';
  const section = extractBlock(xml, sectionTag);
  if (section === null) {
    return appendIntoSection(xml, sectionTag, inner);
  }
  const firstItem = matchBlocks(section, 'item')[0];
  return firstItem ? xml.replace(firstItem, () => inner) : appendIntoSection(xml, sectionTag, inner);
}

export function removeSectionItemByText(xml: string, sectionTag: string, childTag: string, value: string): string {
  const section = extractBlock(xml, sectionTag);
  if (section === null) {
    return xml;
  }
  let nextSection = section;
  for (const block of matchBlocks(section, 'item')) {
    if (readText(block, childTag) === value) {
      nextSection = nextSection.replace(block, '');
    }
  }
  return xml.replace(section, () => nextSection);
}

export function reorderParameters(xml: string, value: string, warnings: string[]): string {
  const order = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (order.length === 0) {
    warnings.push('reorder-parameters получил пустой список.');
    return xml;
  }
  const blocks = matchBlocks(xml, 'parameter');
  const byName = new Map(blocks.map((block) => [readText(block, 'name'), block]));
  const sorted = [
    ...order.map((name) => byName.get(name)).filter((block): block is string => Boolean(block)),
    ...blocks.filter((block) => !order.includes(readText(block, 'name'))),
  ];
  let next = xml;
  for (const block of blocks) {
    next = next.replace(block, '');
  }
  const sortedXml = sorted.join('\n');
  return next.replace('</DataCompositionSchema>', () => `${sortedXml}\n</DataCompositionSchema>`);
}

/**
 * Прицельно переименовывает параметр СКД: меняет ТОЛЬКО `<name>` в целевом
 * `<parameter>`-блоке и текстовые ссылки на параметр (`&amp;Имя` в запросах/выражениях).
 * НЕ трогает `<dataPath>`/`<field>` набора данных и значения фильтров, даже если их
 * текст совпадает с именем параметра (это ссылки на поля результата, а не на параметр).
 */
export function renameParameter(xml: string, oldName: string, newName: string): string {
  const escapedNew = escapeXmlText(newName);
  // Параметры лежат прямыми детьми <DataCompositionSchema>. Ищем диапазон корня,
  // затем прямые <parameter> внутри него: это отсекает вложенные <parameter>
  // из dataSetLink/filter, которые не являются определением параметра схемы.
  const rootRange = findNestingAwareElementRange(xml, 'DataCompositionSchema');
  if (!rootRange) {
    return xml;
  }
  const rootInner = xml.slice(rootRange.openEnd, rootRange.closeStart);
  const paramRanges = findDirectElementRanges(rootInner, 'parameter');
  let inner = rootInner;
  // Идём с конца, чтобы подстановка не смещала ранее вычисленные диапазоны.
  for (let i = paramRanges.length - 1; i >= 0; i--) {
    const range = paramRanges[i];
    const block = inner.slice(range.start, range.end);
    const nameRange = findNestingAwareElementRange(block, 'name');
    if (!nameRange) {
      continue;
    }
    if (block.slice(nameRange.openEnd, nameRange.closeStart).trim() !== oldName) {
      continue;
    }
    const nextBlock =
      block.slice(0, nameRange.openEnd) + escapedNew + block.slice(nameRange.closeStart);
    inner = inner.slice(0, range.start) + nextBlock + inner.slice(range.end);
  }
  const result = xml.slice(0, rootRange.openEnd) + inner + xml.slice(rootRange.closeStart);
  // Ссылки на параметр в запросах/выражениях: маркер `&` (в XML — `&amp;`).
  // Границу имени задаём Unicode-aware lookahead'ом: JS `\b` работает по [A-Za-z0-9_]
  // и НЕ распознаёт конец кириллического имени (доминирующий случай 1С), поэтому
  // `&Товар` иначе не переименовывался бы. `(?![\p{L}\p{N}_])` совпадает, когда
  // следующий символ не является буквой/цифрой/подчёркиванием любого алфавита —
  // это не даёт задеть `&ТоварДва` при переименовании `&Товар`.
  return result.replace(
    new RegExp(`&amp;${escapeRegExp(oldName)}(?![\\p{L}\\p{N}_])`, 'gu'),
    () => `&amp;${escapedNew}`
  );
}
