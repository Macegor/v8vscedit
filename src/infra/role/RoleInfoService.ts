import {
  asArray,
  paginate,
  readRole,
  type ParsedRoleRights,
  type RightsXmlRoot,
} from './RoleRightsXml';
import type {
  RoleGlobalFlags,
  RoleInfoOptions,
  RoleInfoResult,
  RoleObjectRightsGroup,
} from './types';

export class RoleInfoService {
  info(options: RoleInfoOptions): RoleInfoResult {
    const parsed = readRole(options.rightsPath);
    const grouped = groupRights(parsed.root);
    const lines = paginate(buildInfoLines(parsed, grouped, Boolean(options.showDenied)), options.offset, options.limit);
    return {
      rightsPath: parsed.rightsPath,
      metadataPath: parsed.metadataPath,
      name: parsed.metadataName || parsed.roleFolderName,
      synonym: parsed.synonym,
      properties: readFlags(parsed.root),
      allowed: grouped.allowed,
      denied: grouped.denied,
      templates: grouped.templates,
      rls: grouped.rls,
      totalAllowed: grouped.totalAllowed,
      totalDenied: grouped.totalDenied,
      lines,
    };
  }
}

function readFlags(root: RightsXmlRoot): RoleGlobalFlags {
  return {
    setForNewObjects: root.setForNewObjects ?? '',
    setForAttributesByDefault: root.setForAttributesByDefault ?? '',
    independentRightsOfChildObjects: root.independentRightsOfChildObjects ?? '',
  };
}

function groupRights(root: RightsXmlRoot): {
  allowed: RoleObjectRightsGroup[];
  denied: RoleObjectRightsGroup[];
  templates: string[];
  rls: string[];
  totalAllowed: number;
  totalDenied: number;
} {
  const allowed = new Map<string, Map<string, string[]>>();
  const denied = new Map<string, Map<string, string[]>>();
  const rls: string[] = [];
  let totalAllowed = 0;
  let totalDenied = 0;
  for (const object of asArray(root.object)) {
    const objectName = object.name ?? '';
    const [type, shortName] = splitObjectName(objectName);
    if (!type || !shortName) {
      continue;
    }
    for (const right of asArray(object.right)) {
      if (!right.name || !right.value) {
        continue;
      }
      const target = right.value === 'true' ? allowed : denied;
      if (right.value === 'true') {
        totalAllowed += 1;
      } else {
        totalDenied += 1;
      }
      const typed = target.get(type) ?? new Map<string, string[]>();
      const rights = typed.get(shortName) ?? [];
      rights.push(right.restrictionByCondition ? `${right.name} [RLS]` : right.name);
      typed.set(shortName, rights);
      target.set(type, typed);
      if (right.restrictionByCondition && right.value === 'true') {
        rls.push(`${type}.${shortName} (${right.name})`);
      }
    }
  }
  return {
    allowed: toGroups(allowed),
    denied: toGroups(denied),
    templates: asArray(root.restrictionTemplate).map((item) => (item.name ?? '').replace(/\(.*/, '')).filter(Boolean),
    rls,
    totalAllowed,
    totalDenied,
  };
}

function splitObjectName(objectName: string): [string, string] {
  const index = objectName.indexOf('.');
  return index === -1 ? ['', ''] : [objectName.slice(0, index), objectName.slice(index + 1)];
}

function toGroups(source: Map<string, Map<string, string[]>>): RoleObjectRightsGroup[] {
  return [...source.entries()].map(([type, objects]) => ({
    type,
    objects: [...objects.entries()].map(([name, rights]) => ({ name, rights })),
  }));
}

function buildInfoLines(
  parsed: ParsedRoleRights,
  grouped: ReturnType<typeof groupRights>,
  showDenied: boolean
): string[] {
  const flags = readFlags(parsed.root);
  const roleName = parsed.metadataName || parsed.roleFolderName;
  const lines = [
    `=== Role: ${roleName}${parsed.synonym ? ` — "${parsed.synonym}"` : ''} ===`,
    '',
    `Properties: setForNewObjects=${flags.setForNewObjects}, setForAttributesByDefault=${flags.setForAttributesByDefault}, independentRightsOfChildObjects=${flags.independentRightsOfChildObjects}`,
    '',
  ];
  if (grouped.allowed.length > 0) {
    lines.push('Allowed rights:', '');
    appendGroups(lines, grouped.allowed, false);
  } else {
    lines.push('(no allowed rights)', '');
  }
  if (showDenied && grouped.denied.length > 0) {
    lines.push('Denied rights:', '');
    appendGroups(lines, grouped.denied, true);
  } else if (grouped.totalDenied > 0) {
    lines.push(`Denied: ${String(grouped.totalDenied)} rights`, '');
  }
  if (grouped.rls.length > 0) {
    lines.push(`RLS: ${String(grouped.rls.length)} restrictions`);
  }
  if (grouped.templates.length > 0) {
    lines.push(`Templates: ${grouped.templates.join(', ')}`);
  }
  lines.push('', '---', `Total: ${String(grouped.totalAllowed)} allowed, ${String(grouped.totalDenied)} denied`);
  return lines;
}

function appendGroups(lines: string[], groups: readonly RoleObjectRightsGroup[], denied: boolean): void {
  for (const group of groups) {
    lines.push(`  ${group.type} (${String(group.objects.length)}):`);
    for (const object of group.objects) {
      const rights = denied ? object.rights.map((item) => `-${item}`).join(', ') : object.rights.join(', ');
      lines.push(`    ${object.name}: ${rights}`);
    }
    lines.push('');
  }
}
