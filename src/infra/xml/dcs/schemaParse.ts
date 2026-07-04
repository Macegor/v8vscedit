import type {
  SkdCalculatedFieldDefinition,
  SkdFieldDefinition,
  SkdInfoMode,
  SkdInfoResult,
  SkdParameterDefinition,
  SkdSettingsVariantDefinition,
} from '../DataCompositionSchemaService';
import {
  matchBlocks,
  readMlText,
  readSectionTexts,
  readText,
  readValueType,
  resolveType,
} from './dcsShared';

export function parseSchema(xml: string): Omit<SkdInfoResult, 'templatePath' | 'lines'> {
  return {
    dataSets: matchBlocks(xml, 'dataSet').map((block) => ({
      name: readText(block, 'name'),
      type: block.includes('DataSetQuery') ? 'Query' : block.includes('DataSetObject') ? 'Object' : block.includes('DataSetUnion') ? 'Union' : 'Unknown',
      query: readText(block, 'query'),
      fields: matchBlocks(block, 'field').map((field) => ({
        dataPath: readText(field, 'dataPath'),
        field: readText(field, 'field'),
        title: readMlText(field, 'title'),
        type: readValueType(field),
      })).filter((field) => field.dataPath || field.field),
    })),
    calculatedFields: matchBlocks(xml, 'calculatedField').map((block) => ({
      dataPath: readText(block, 'dataPath'),
      expression: readText(block, 'expression'),
      title: readMlText(block, 'title'),
      type: readValueType(block),
    })),
    totalFields: matchBlocks(xml, 'totalField').map((block) => ({ dataPath: readText(block, 'dataPath'), expression: readText(block, 'expression') })),
    parameters: matchBlocks(xml, 'parameter').map((block) => ({
      name: readText(block, 'name'),
      title: readMlText(block, 'title'),
      type: readValueType(block),
      hidden: readText(block, 'availableAsField') === 'false',
    })),
    variants: matchBlocks(xml, 'settingsVariant').map((block) => ({
      name: readText(block, 'name'),
      title: readMlText(block, 'title'),
      selection: readSectionTexts(block, 'selection', 'field'),
      filters: readSectionTexts(block, 'filter', 'left'),
      order: readSectionTexts(block, 'order', 'field'),
    })),
  };
}

export function buildInfoLines(info: Omit<SkdInfoResult, 'templatePath' | 'lines'>, mode: SkdInfoMode, name?: string): string[] {
  const lines: string[] = [];
  if (mode === 'overview' || mode === 'full') {
    lines.push('=== DataCompositionSchema ===');
    lines.push(`Наборы данных: ${String(info.dataSets.length)}`);
    lines.push(`Поля: ${String(info.dataSets.reduce((sum, dataSet) => sum + dataSet.fields.length, 0))}`);
    lines.push(`Вычисляемые поля: ${String(info.calculatedFields.length)}`);
    lines.push(`Итоги: ${String(info.totalFields.length)}`);
    lines.push(`Параметры: ${String(info.parameters.length)}`);
    lines.push(`Варианты: ${String(info.variants.length)}`);
  }
  if (mode === 'query' || mode === 'full') {
    const dataSets = name ? info.dataSets.filter((dataSet) => dataSet.name === name) : info.dataSets;
    for (const dataSet of dataSets) {
      lines.push('', `--- Query: ${dataSet.name} ---`, dataSet.query || '<пусто>');
    }
  }
  if (mode === 'fields' || mode === 'full') {
    lines.push('', '--- Fields ---');
    for (const dataSet of info.dataSets) {
      const fields = name ? dataSet.fields.filter((field) => field.dataPath === name || field.title === name) : dataSet.fields;
      if (fields.length > 0) {
        lines.push(`  ${dataSet.name}: ${fields.map((field) => field.dataPath).join(', ')}`);
      }
    }
  }
  if (mode === 'calculated' || mode === 'full') {
    lines.push('', '--- Calculated ---', ...info.calculatedFields.map((field) => `  ${field.dataPath} = ${field.expression}`));
  }
  if (mode === 'resources' || mode === 'full') {
    lines.push('', '--- Resources ---', ...info.totalFields.map((field) => `  ${field.dataPath}: ${field.expression}`));
  }
  if (mode === 'params' || mode === 'full') {
    lines.push('', '--- Parameters ---', ...info.parameters.map((param) => `  ${param.name}: ${param.type || '<тип не задан>'}${param.hidden ? ' [hidden]' : ''}`));
  }
  if (mode === 'variant' || mode === 'full') {
    const variants = name ? info.variants.filter((variant) => variant.name === name) : info.variants;
    lines.push('', '--- Variants ---', ...variants.map((variant) => `  ${variant.name}: selection=${variant.selection.join(', ') || 'Auto'}`));
  }
  return lines;
}

export function parseField(value: string): Required<Pick<SkdFieldDefinition, 'dataPath' | 'field' | 'title' | 'type' | 'role' | 'restrict'>> {
  let text = value;
  const title = /\[([^\]]+)\]/.exec(text)?.[1] ?? '';
  text = text.replace(/\s*\[[^\]]+\]/, '');
  const role = /@(\w+)/.exec(text)?.[1] ?? '';
  text = text.replace(/\s*@\w+/g, '');
  const restrict = [...text.matchAll(/#(\w+)/g)].map((match) => match[1]);
  text = text.replace(/\s*#\w+/g, '');
  const [name, type = ''] = text.split(':');
  const dataPath = name.trim();
  return { dataPath, field: dataPath, title, type: resolveType(type.trim()), role, restrict };
}

export function normalizeField(field: SkdFieldDefinition): ReturnType<typeof parseField> {
  const dataPath = field.dataPath ?? field.field ?? '';
  return { dataPath, field: field.field ?? dataPath, title: field.title ?? '', type: resolveType(field.type ?? ''), role: field.role ?? '', restrict: [...(field.restrict ?? [])] };
}

export function parseCalculated(value: string): Required<Pick<SkdCalculatedFieldDefinition, 'dataPath' | 'expression' | 'title' | 'type'>> & { restrict: string[] } {
  let text = value;
  const restrict = [...text.matchAll(/#(\w+)/g)].map((match) => match[1]);
  text = text.replace(/\s*#\w+/g, '');
  const [left, expression = ''] = text.split(/=(.+)/);
  const title = /\[([^\]]+)\]/.exec(left)?.[1] ?? '';
  const cleanLeft = left.replace(/\s*\[[^\]]+\]/, '');
  const [dataPath, type = ''] = cleanLeft.split(':');
  return { dataPath: dataPath.trim(), expression: expression.trim(), title, type: resolveType(type.trim()), restrict };
}

export function normalizeCalculated(field: SkdCalculatedFieldDefinition): ReturnType<typeof parseCalculated> {
  const rawRestrict = field.restrict ?? [];
  return {
    dataPath: field.dataPath ?? field.name ?? '',
    expression: field.expression ?? '',
    title: field.title ?? '',
    type: resolveType(field.type ?? ''),
    restrict: typeof rawRestrict === 'string' ? rawRestrict.split(/\s+/).map((item) => item.replace(/^#/, '')).filter(Boolean) : [...rawRestrict],
  };
}

export function parseParameter(value: string): SkdParameterDefinition {
  let text = value;
  const autoHidden = text.includes('@hidden');
  text = text.replace(/\s*@\w+/g, '');
  const title = /\[([^\]]+)\]/.exec(text)?.[1] ?? '';
  text = text.replace(/\s*\[[^\]]+\]/, '');
  // split возвращает string[], но второй элемент может быть undefined при отсутствии "=".
  const parts = text.split(/=(.+)/);
  const left = parts[0];
  const rawValue = parts[1] as string | undefined;
  const [name, type = ''] = left.split(':');
  return { name: name.trim(), title, type: resolveType(type.trim()), value: rawValue?.trim(), hidden: autoHidden };
}

export function parseVariant(value: string): SkdSettingsVariantDefinition {
  const title = /\[([^\]]+)\]/.exec(value)?.[1];
  const name = value.replace(/\s*\[[^\]]+\]/, '').trim();
  return { name, title: title ?? name, selection: ['Auto'], structure: 'details' };
}
