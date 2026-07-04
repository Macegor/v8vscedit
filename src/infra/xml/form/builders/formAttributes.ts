/**
 * Эмиттеры реквизитов формы: `emitAttributes` (полный блок `<Attributes>`
 * при сборке формы) и `buildAttributeXml` (legacy-хелпер для FormEditService).
 * Типы разрешаются через общий `emitType` из formBuilderShared.
 */
import { buildLocalizedTag, validateName, type IdAllocator } from '../FormShared';
import type { FormAttributeDefinition } from '../types';
import { emitType, escapeXml, titleFromName, xmlStr } from './formBuilderShared';

export function emitAttributes(lines: string[], attrs: readonly FormAttributeDefinition[] | undefined, indent: string, id: IdAllocator): void {
  if (!attrs || attrs.length === 0) {return;}
  lines.push(`${indent}<Attributes>`);
  for (const attr of attrs) {
    validateName(attr.name, 'Имя реквизита формы');
    const attrId = id.nextAttribute();
    lines.push(`${indent}\t<Attribute name="${escapeXml(attr.name)}" id="${String(attrId)}">`);
    const inner = `${indent}\t\t`;
    let attrTitle = (attr as { title?: string }).title;
    if (!attrTitle && attr.main !== true) {
      attrTitle = titleFromName(attr.name);
    }
    if (attrTitle) {
      lines.push(...buildLocalizedTag(inner, 'Title', attrTitle).split('\n'));
    }
    if (attr.type) {
      emitType(lines, attr.type, inner);
    } else {
      lines.push(`${inner}<Type/>`);
    }
    if (attr.main === true) {
      lines.push(`${inner}<MainAttribute>true</MainAttribute>`);
    }
    let mainSaved = false;
    if (attr.main === true && attr.type) {
      const t = attr.type;
      mainSaved = /^(CatalogObject|DocumentObject|ChartOfAccountsObject|ChartOfCalculationTypesObject|ChartOfCharacteristicTypesObject|ExchangePlanObject|BusinessProcessObject|TaskObject)\./.test(t) || t.includes('RecordManager.');
    }
    if (attr.savedData === true || mainSaved) {
      lines.push(`${inner}<SavedData>true</SavedData>`);
    }
    const fillChecking = (attr as { fillChecking?: string }).fillChecking;
    if (fillChecking) {
      lines.push(`${inner}<FillChecking>${escapeXml(fillChecking)}</FillChecking>`);
    }
    if (attr.columns && attr.columns.length > 0) {
      lines.push(`${inner}<Columns>`);
      for (const col of attr.columns) {
        const colId = id.nextAttribute();
        lines.push(`${inner}\t<Column name="${escapeXml(col.name)}" id="${String(colId)}">`);
        const colTitle = (col as { title?: string }).title;
        if (colTitle) {
          lines.push(...buildLocalizedTag(`${inner}\t\t`, 'Title', colTitle).split('\n'));
        }
        emitType(lines, col.type ?? '', `${inner}\t\t`);
        lines.push(`${inner}\t</Column>`);
      }
      lines.push(`${inner}</Columns>`);
    }
    if (attr.settings) {
      const s = attr.settings;
      lines.push(`${inner}<Settings xsi:type="DynamicList">`);
      const si = `${inner}\t`;
      if (s.mainTable) {
        lines.push(`${si}<MainTable>${escapeXml(xmlStr(s.mainTable))}</MainTable>`);
      }
      const mq = s.manualQuery ? 'true' : 'false';
      lines.push(`${si}<ManualQuery>${mq}</ManualQuery>`);
      const ddr = s.dynamicDataRead ? 'true' : 'false';
      lines.push(`${si}<DynamicDataRead>${ddr}</DynamicDataRead>`);
      lines.push(`${inner}</Settings>`);
    }
    lines.push(`${indent}\t</Attribute>`);
  }
  lines.push(`${indent}</Attributes>`);
}

// ─── Legacy edit helper (используется FormEditService) ──────────────────────

export function buildAttributeXml(attr: FormAttributeDefinition, indent: string, id: number): string {
  const lines: string[] = [];
  validateName(attr.name, 'Имя реквизита формы');
  lines.push(`${indent}<Attribute name="${escapeXml(attr.name)}" id="${String(id)}">`);
  const inner = `${indent}\t`;
  const attrTitle = (attr as { title?: string }).title;
  if (attrTitle) {
    lines.push(...buildLocalizedTag(inner, 'Title', attrTitle).split('\n'));
  }
  if (attr.type) {
    emitType(lines, attr.type, inner);
  } else {
    lines.push(`${inner}<Type/>`);
  }
  if (attr.main === true) {lines.push(`${inner}<MainAttribute>true</MainAttribute>`);}
  if (attr.savedData === true) {lines.push(`${inner}<SavedData>true</SavedData>`);}
  if (attr.columns?.length) {
    lines.push(`${inner}<Columns>`);
    let columnId = 1;
    for (const col of attr.columns) {
      lines.push(`${inner}\t<Column name="${escapeXml(col.name)}" id="${String(columnId++)}">`);
      emitType(lines, col.type ?? '', `${inner}\t\t`);
      lines.push(`${inner}\t</Column>`);
    }
    lines.push(`${inner}</Columns>`);
  }
  if (attr.settings) {
    const s = attr.settings;
    lines.push(`${inner}<Settings xsi:type="DynamicList">`);
    if (s.mainTable) {
      lines.push(`${inner}\t<MainTable>${escapeXml(xmlStr(s.mainTable))}</MainTable>`);
    }
    if (s.dynamicDataRead === true) {
      lines.push(`${inner}\t<DynamicDataRead>true</DynamicDataRead>`);
    }
    lines.push(`${inner}</Settings>`);
  }
  lines.push(`${indent}</Attribute>`);
  return lines.join('\n');
}
