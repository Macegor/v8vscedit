/**
 * Публичное API слоя `infra`. Конкретные точки входа — подпапки.
 *
 * Прямой re-export через `export *` даёт конфликты имён
 * (`resolveObjectXmlPath` есть и в `xml/`, и в `fs/MetaPathResolver`).
 * Поэтому модули подключаются по именованным реэкспортам.
 */
export * from './xml';
export {
  ConfigLocator,
  FoundConfig,
  findConfigurations,
  ConfigEntry,
} from './fs/ConfigLocator';
export {
  MetaPathResolver,
  NodePathInfo,
  getObjectLocationFromXml,
  getObjectModulePath,
  getManagerModulePath,
  getConstantModulePath,
  getServiceModulePath,
  getCommonFormModulePath,
  getCommonCommandModulePath,
  getFormModulePathForChild,
  getCommandModulePathForChild,
  getCommonModuleCodePath,
  ensureCommonModuleCodePath,
} from './fs/MetaPathResolver';
export * from './fs/ObjectLocation';
export * from './support';
