/**
 * Эмиттеры команд формы: `emitCommands` (полный блок `<Commands>` при сборке
 * формы) и `buildCommandXml` (legacy-хелпер для FormEditService).
 */
import { buildLocalizedTag, validateName, type IdAllocator } from '../FormShared';
import type { FormCommandDefinition } from '../types';
import { escapeXml, titleFromName } from './formBuilderShared';

export function emitCommands(lines: string[], cmds: readonly FormCommandDefinition[] | undefined, indent: string, id: IdAllocator): void {
  if (!cmds || cmds.length === 0) {return;}
  lines.push(`${indent}<Commands>`);
  for (const cmd of cmds) {
    validateName(cmd.name, 'Имя команды формы');
    const cmdId = id.nextCommand();
    lines.push(`${indent}\t<Command name="${escapeXml(cmd.name)}" id="${String(cmdId)}">`);
    const inner = `${indent}\t\t`;
    const cmdTitle = cmd.title ?? titleFromName(cmd.name);
    if (cmdTitle) {
      lines.push(...buildLocalizedTag(inner, 'Title', cmdTitle).split('\n'));
    }
    if (cmd.action) {
      lines.push(`${inner}<Action>${escapeXml(cmd.action)}</Action>`);
    }
    if (cmd.shortcut) {
      lines.push(`${inner}<Shortcut>${escapeXml(cmd.shortcut)}</Shortcut>`);
    }
    if (cmd.picture) {
      lines.push(`${inner}<Picture>`);
      lines.push(`${inner}\t<xr:Ref>${escapeXml(cmd.picture)}</xr:Ref>`);
      lines.push(`${inner}\t<xr:LoadTransparent>true</xr:LoadTransparent>`);
      lines.push(`${inner}</Picture>`);
    }
    const representation = (cmd as { representation?: string }).representation;
    if (representation) {
      lines.push(`${inner}<Representation>${escapeXml(representation)}</Representation>`);
    }
    lines.push(`${indent}\t</Command>`);
  }
  lines.push(`${indent}</Commands>`);
}

// ─── Legacy edit helper (используется FormEditService) ──────────────────────

export function buildCommandXml(cmd: FormCommandDefinition, indent: string, id: number): string {
  const lines: string[] = [];
  validateName(cmd.name, 'Имя команды формы');
  lines.push(`${indent}<Command name="${escapeXml(cmd.name)}" id="${String(id)}">`);
  const inner = `${indent}\t`;
  if (cmd.title) {
    lines.push(...buildLocalizedTag(inner, 'Title', cmd.title).split('\n'));
  }
  if (cmd.shortcut) {
    lines.push(`${inner}<Shortcut>${escapeXml(cmd.shortcut)}</Shortcut>`);
  }
  if (cmd.actions?.length) {
    for (const action of cmd.actions) {
      lines.push(`${inner}<Action${action.callType ? ` callType="${escapeXml(action.callType)}"` : ''}>${escapeXml(action.handler)}</Action>`);
    }
  } else {
    lines.push(`${inner}<Action${cmd.callType ? ` callType="${escapeXml(cmd.callType)}"` : ''}>${escapeXml(cmd.action ?? `${cmd.name}Обработка`)}</Action>`);
  }
  lines.push(`${indent}</Command>`);
  return lines.join('\n');
}
