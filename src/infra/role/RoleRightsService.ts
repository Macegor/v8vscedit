import { ConfigurationXmlEditor } from '../xml/ConfigurationXmlEditor';
import { RoleCompileService } from './RoleCompileService';
import { RoleDefaultRolesService } from './RoleDefaultRolesService';
import { RoleInfoService } from './RoleInfoService';
import { RoleRightsEditService } from './RoleRightsEditService';
import { RoleValidateService } from './RoleValidateService';
import { resolveRightsXmlPath } from './RoleRightsXml';
import type {
  DefaultRolesListOptions,
  DefaultRolesListResult,
  DefaultRolesMutationOptions,
  DefaultRolesMutationResult,
  DefaultRolesSetOptions,
  RoleCompileOptions,
  RoleCompileResult,
  RoleInfoOptions,
  RoleInfoResult,
  RoleRightsEditOptions,
  RoleRightsEditResult,
  RoleValidationOptions,
  RoleValidationResult,
} from './types';

/**
 * Фасад для всех операций над ролями 1С. Делегирует в специализированные
 * сервисы каталога `role/`. Сохраняется ради совместимости — вызывающий код
 * (`Container`, `RoleRightsCommands`, MCP) знает только этот класс.
 */
export class RoleRightsService {
  private readonly configEditor = new ConfigurationXmlEditor();
  private readonly infoService = new RoleInfoService();
  private readonly validateService = new RoleValidateService();
  private readonly compileService = new RoleCompileService(this.configEditor);
  private readonly editService = new RoleRightsEditService();
  private readonly defaultRolesService = new RoleDefaultRolesService(this.configEditor);

  info(options: RoleInfoOptions): RoleInfoResult {
    return this.infoService.info(options);
  }

  validate(options: RoleValidationOptions): RoleValidationResult {
    return this.validateService.validate(options);
  }

  compile(options: RoleCompileOptions): RoleCompileResult {
    return this.compileService.compile(options);
  }

  edit(options: RoleRightsEditOptions): RoleRightsEditResult {
    return this.editService.edit(options);
  }

  listDefaultRoles(options: DefaultRolesListOptions): DefaultRolesListResult {
    return this.defaultRolesService.list(options);
  }

  addDefaultRole(options: DefaultRolesMutationOptions): DefaultRolesMutationResult {
    return this.defaultRolesService.add(options);
  }

  removeDefaultRole(options: DefaultRolesMutationOptions): DefaultRolesMutationResult {
    return this.defaultRolesService.remove(options);
  }

  setDefaultRoles(options: DefaultRolesSetOptions): DefaultRolesMutationResult {
    return this.defaultRolesService.set(options);
  }

  resolveRightsPath(inputPath: string): string | null {
    return resolveRightsXmlPath(inputPath);
  }
}
