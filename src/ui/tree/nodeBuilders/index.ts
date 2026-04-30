import { MetadataNode, NodeKind } from '../TreeNode';
import { createLeafMetaObjectHandler } from './createLeafMetaObjectHandler';
import { ObjectHandler } from './_types';
import { accountingRegisterHandler } from './accountingRegister';
import { accumulationRegisterHandler } from './accumulationRegister';
import { botHandler } from './bot';
import { businessProcessHandler } from './businessProcess';
import { calculationRegisterHandler } from './calculationRegister';
import { catalogHandler } from './catalog';
import { chartOfAccountsHandler } from './chartOfAccounts';
import { chartOfCalculationTypesHandler } from './chartOfCalculationTypes';
import { chartOfCharacteristicTypesHandler } from './chartOfCharacteristicTypes';
import { commonAttributeHandler } from './commonAttribute';
import { commonModuleHandler } from './commonModule';
import { configurationHandler } from './configuration';
import { constantHandler } from './constant';
import { dataProcessorHandler } from './dataProcessor';
import { documentHandler } from './document';
import { documentNumeratorHandler } from './documentNumerator';
import { documentJournalHandler } from './documentJournal';
import { enumHandler } from './enum';
import { eventSubscriptionHandler } from './eventSubscription';
import { exchangePlanHandler } from './exchangePlan';
import { externalDataSourceHandler } from './externalDataSource';
import { filterCriterionHandler } from './filterCriterion';
import { httpServiceHandler } from './httpService';
import { functionalOptionHandler } from './functionalOption';
import { functionalOptionsParameterHandler } from './functionalOptionsParameter';
import { informationRegisterHandler } from './informationRegister';
import { integrationServiceHandler } from './integrationService';
import { interfaceObjectHandler } from './interfaceObject';
import { paletteColorHandler } from './paletteColor';
import { reportHandler } from './report';
import { roleHandler } from './role';
import { scheduledJobHandler } from './scheduledJob';
import { sequenceHandler } from './sequence';
import { sessionParameterHandler } from './sessionParameter';
import { settingsStorageHandler } from './settingsStorage';
import { structuredMetaChildHandler } from './structuredMetaChildHandler';
import { styleHandler } from './style';
import { subsystemHandler } from './subsystem';
import { taskHandler } from './task';
import { webSocketClientHandler } from './webSocketClient';
import { webServiceHandler } from './webService';
import { wsReferenceHandler } from './wsReference';

const definedTypeHandler = createLeafMetaObjectHandler('DefinedType');
const commonFormHandler = createLeafMetaObjectHandler('CommonForm');
const commonCommandHandler = createLeafMetaObjectHandler('CommonCommand');
const commandGroupHandler = createLeafMetaObjectHandler('CommandGroup');
const commonPictureHandler = createLeafMetaObjectHandler('CommonPicture');
const commonTemplateHandler = createLeafMetaObjectHandler('CommonTemplate');
const styleItemHandler = createLeafMetaObjectHandler('StyleItem');
const xdtoPackageHandler = createLeafMetaObjectHandler('XDTOPackage');

/**
 * Реестр обработчиков по типу объекта из ChildObjects в Configuration.xml.
 * Каждый тип из навигатора — отдельный модуль в этой папке.
 */
const HANDLER_REGISTRY = new Map<string, ObjectHandler>([
  ['configuration', configurationHandler],
  ['extension', configurationHandler],
  ['Subsystem', subsystemHandler],
  ['DefinedType', definedTypeHandler],
  ['CommonForm', commonFormHandler],
  ['CommonCommand', commonCommandHandler],
  ['CommandGroup', commandGroupHandler],
  ['CommonPicture', commonPictureHandler],
  ['CommonTemplate', commonTemplateHandler],
  ['StyleItem', styleItemHandler],
  ['XDTOPackage', xdtoPackageHandler],
  ['CommonModule', commonModuleHandler],
  ['SessionParameter', sessionParameterHandler],
  ['Role', roleHandler],
  ['CommonAttribute', commonAttributeHandler],
  ['Catalog', catalogHandler],
  ['Document', documentHandler],
  ['DocumentNumerator', documentNumeratorHandler],
  ['Enum', enumHandler],
  ['ExchangePlan', exchangePlanHandler],
  ['Constant', constantHandler],
  ['FilterCriterion', filterCriterionHandler],
  ['EventSubscription', eventSubscriptionHandler],
  ['ScheduledJob', scheduledJobHandler],
  ['Sequence', sequenceHandler],
  ['DocumentJournal', documentJournalHandler],
  ['Report', reportHandler],
  ['DataProcessor', dataProcessorHandler],
  ['ChartOfCharacteristicTypes', chartOfCharacteristicTypesHandler],
  ['ChartOfAccounts', chartOfAccountsHandler],
  ['ChartOfCalculationTypes', chartOfCalculationTypesHandler],
  ['InformationRegister', informationRegisterHandler],
  ['AccumulationRegister', accumulationRegisterHandler],
  ['AccountingRegister', accountingRegisterHandler],
  ['CalculationRegister', calculationRegisterHandler],
  ['BusinessProcess', businessProcessHandler],
  ['Task', taskHandler],
  ['ExternalDataSource', externalDataSourceHandler],
  ['FunctionalOption', functionalOptionHandler],
  ['FunctionalOptionsParameter', functionalOptionsParameterHandler],
  ['SettingsStorage', settingsStorageHandler],
  ['Style', styleHandler],
  ['WSReference', wsReferenceHandler],
  ['WebSocketClient', webSocketClientHandler],
  ['IntegrationService', integrationServiceHandler],
  ['Bot', botHandler],
  ['Interface', interfaceObjectHandler],
  ['PaletteColor', paletteColorHandler],
  ['WebService', webServiceHandler],
  ['HTTPService', httpServiceHandler],
]);

/** Возвращает обработчик для указанного типа объекта или undefined */
export function getObjectHandler(objectType: string): ObjectHandler | undefined {
  return HANDLER_REGISTRY.get(objectType);
}

/** Возвращает обработчик для типа узла дерева, если он зарегистрирован */
export function getNodeHandler(nodeKind: NodeKind): ObjectHandler | undefined {
  return HANDLER_REGISTRY.get(nodeKind);
}

/** Возвращает обработчик для конкретного узла дерева, если он зарегистрирован */
export function getHandlerForNode(node: MetadataNode): ObjectHandler | undefined {
  if (node.metaContext && structuredMetaChildHandler.canShowProperties?.(node)) {
    return structuredMetaChildHandler;
  }
  return getNodeHandler(node.nodeKind);
}
