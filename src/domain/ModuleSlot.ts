/**
 * Слот модуля BSL у объекта метаданных.
 * Один слот = одна пара (имя файла, путь относительно каталога объекта).
 *
 * Реальные пути резолвятся в `infra/fs/MetaPathResolver.ts` — слот здесь
 * выступает лишь идентификатором набора кандидатов.
 */
export type ModuleSlot =
  /** Общий модуль (`CommonModules/<Имя>/Ext/Module.bsl`) */
  | 'CommonModule'
  /** Модуль объекта (`<Тип>/<Имя>/Ext/ObjectModule.bsl`) */
  | 'Object'
  /** Модуль менеджера (`<Тип>/<Имя>/Ext/ManagerModule.bsl`) */
  | 'Manager'
  /** Модуль менеджера значения (константы: `Constants/<Имя>/Ext/ValueManagerModule.bsl`) */
  | 'ValueManager'
  /** Модуль сервиса (Web/HTTP-сервис: `<Тип>/<Имя>/Ext/Module.bsl`) */
  | 'Service'
  /** Модуль команды общей команды (`CommonCommands/<Имя>/Ext/CommandModule.bsl`) */
  | 'CommonCommand'
  /** Модуль общей формы (`CommonForms/<Имя>/Ext/Form/Module.bsl`) */
  | 'CommonForm'
  /** Модуль формы, принадлежащей объекту (`<Тип>/<Имя>/Forms/<Форма>/Ext/Form/Module.bsl`) */
  | 'ChildForm'
  /** Модуль команды, принадлежащей объекту (`<Тип>/<Имя>/Commands/<Команда>/Ext/CommandModule.bsl`) */
  | 'ChildCommand';

/** Идентификаторы команд открытия модулей, привязанные к слотам */
export type OpenModuleCommandId =
  | 'openObjectModule'
  | 'openManagerModule'
  | 'openConstantModule'
  | 'openFormModule'
  | 'openCommandModule'
  | 'openServiceModule'
  | 'openCommonModuleCode';
