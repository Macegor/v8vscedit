import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationXmlEditor, type EditResult } from '../xml/ConfigurationXmlEditor';
import type {
  DefaultRolesListOptions,
  DefaultRolesListResult,
  DefaultRolesMutationOptions,
  DefaultRolesMutationResult,
  DefaultRolesSetOptions,
} from './types';

/**
 * Управление списком ролей по умолчанию в Configuration.xml.
 *
 * DefaultRoles — корневое свойство Configuration, которое задаёт роли,
 * назначаемые новым пользователям информационной базы. Свойство нельзя менять
 * через предметный путь без отдельной поддержки корневого узла, поэтому здесь
 * собраны точечные операции для скриптов и MCP.
 */
export class RoleDefaultRolesService {
  constructor(private readonly editor: ConfigurationXmlEditor = new ConfigurationXmlEditor()) {}

  list(options: DefaultRolesListOptions): DefaultRolesListResult {
    const configXmlPath = resolveConfigXmlPath(options.configPath);
    const roles = readDefaultRoles(configXmlPath);
    return { configXmlPath, roles };
  }

  add(options: DefaultRolesMutationOptions): DefaultRolesMutationResult {
    const configXmlPath = resolveConfigXmlPath(options.configPath);
    const result = this.editor.addDefaultRole(configXmlPath, options.role);
    return this.toResult(configXmlPath, result);
  }

  remove(options: DefaultRolesMutationOptions): DefaultRolesMutationResult {
    const configXmlPath = resolveConfigXmlPath(options.configPath);
    const result = this.editor.removeDefaultRole(configXmlPath, options.role);
    return this.toResult(configXmlPath, result);
  }

  set(options: DefaultRolesSetOptions): DefaultRolesMutationResult {
    const configXmlPath = resolveConfigXmlPath(options.configPath);
    const result = this.editor.setDefaultRoles(configXmlPath, [...options.roles]);
    return this.toResult(configXmlPath, result);
  }

  private toResult(configXmlPath: string, result: EditResult): DefaultRolesMutationResult {
    return {
      success: result.success,
      changed: result.changed,
      configXmlPath,
      roles: readDefaultRoles(configXmlPath),
      changedFiles: result.changedFiles,
      warnings: result.warnings,
      errors: result.errors,
    };
  }
}

function resolveConfigXmlPath(input: string): string {
  const resolved = path.resolve(input);
  if (path.basename(resolved).toLowerCase() === 'configuration.xml') {
    return resolved;
  }
  return path.join(resolved, 'Configuration.xml');
}

function readDefaultRoles(configXmlPath: string): string[] {
  if (!fs.existsSync(configXmlPath)) {
    return [];
  }
  const xml = fs.readFileSync(configXmlPath, 'utf-8');
  const props = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1];
  if (!props) {
    return [];
  }
  const inner = /<DefaultRoles>([\s\S]*?)<\/DefaultRoles>/.exec(props)?.[1];
  if (!inner) {
    return [];
  }
  return Array.from(inner.matchAll(/<xr:Item\s+xsi:type="xr:MDObjectRef">([^<]+)<\/xr:Item>/g)).map((m) => m[1].trim());
}
