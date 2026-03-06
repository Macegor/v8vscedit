import { NodeKind } from '../MetadataNode';
import { NodeDescriptor } from './_types';

import { configurationDescriptor } from './root/configuration';
import { extensionDescriptor } from './root/extension';

import { groupCommonDescriptor } from './groups/group-common';
import { groupTypeDescriptor } from './groups/group-type';

import { SubsystemDescriptor } from './common/Subsystem';
import { CommonModuleDescriptor } from './common/CommonModule';
import { SessionParameterDescriptor } from './common/SessionParameter';
import { RoleDescriptor } from './common/Role';
import { DefinedTypeDescriptor } from './common/DefinedType';
import { CommonFormDescriptor } from './common/CommonForm';
import { CommonCommandDescriptor } from './common/CommonCommand';
import { CommonTemplateDescriptor } from './common/CommonTemplate';
import { CommonPictureDescriptor } from './common/CommonPicture';
import { StyleItemDescriptor } from './common/StyleItem';
import { LanguageDescriptor } from './common/Language';
import { HTTPServiceDescriptor } from './common/HTTPService';
import { WebServiceDescriptor } from './common/WebService';
import { FunctionalOptionDescriptor } from './common/FunctionalOption';

import { ConstantDescriptor } from './objects/Constant';
import { FilterCriterionDescriptor } from './objects/FilterCriterion';
import { EventSubscriptionDescriptor } from './objects/EventSubscription';
import { ScheduledJobDescriptor } from './objects/ScheduledJob';
import { SequenceDescriptor } from './objects/Sequence';
import { CatalogDescriptor } from './objects/Catalog';
import { DocumentDescriptor } from './objects/Document';
import { DocumentJournalDescriptor } from './objects/DocumentJournal';
import { EnumDescriptor } from './objects/Enum';
import { ReportDescriptor } from './objects/Report';
import { DataProcessorDescriptor } from './objects/DataProcessor';
import { ChartOfCharacteristicTypesDescriptor } from './objects/ChartOfCharacteristicTypes';
import { ChartOfAccountsDescriptor } from './objects/ChartOfAccounts';
import { ChartOfCalculationTypesDescriptor } from './objects/ChartOfCalculationTypes';
import { InformationRegisterDescriptor } from './objects/InformationRegister';
import { AccumulationRegisterDescriptor } from './objects/AccumulationRegister';
import { AccountingRegisterDescriptor } from './objects/AccountingRegister';
import { CalculationRegisterDescriptor } from './objects/CalculationRegister';
import { BusinessProcessDescriptor } from './objects/BusinessProcess';
import { TaskDescriptor } from './objects/Task';
import { ExchangePlanDescriptor } from './objects/ExchangePlan';

import { AttributeDescriptor } from './children/Attribute';
import { TabularSectionDescriptor } from './children/TabularSection';
import { ColumnDescriptor } from './children/Column';
import { FormDescriptor } from './children/Form';
import { CommandDescriptor } from './children/Command';
import { TemplateDescriptor } from './children/Template';
import { DimensionDescriptor } from './children/Dimension';
import { ResourceDescriptor } from './children/Resource';
import { EnumValueDescriptor } from './children/EnumValue';

/** Реестр статических дескрипторов по типу узла */
const NODE_DESCRIPTORS: Record<NodeKind, NodeDescriptor> = {
  // Корни
  configuration: configurationDescriptor,
  extension: extensionDescriptor,

  // Группы
  'group-common': groupCommonDescriptor,
  'group-type': groupTypeDescriptor,

  // Общие объекты
  Subsystem: SubsystemDescriptor,
  CommonModule: CommonModuleDescriptor,
  SessionParameter: SessionParameterDescriptor,
  Role: RoleDescriptor,
  CommonForm: CommonFormDescriptor,
  CommonCommand: CommonCommandDescriptor,
  CommonPicture: CommonPictureDescriptor,
  StyleItem: StyleItemDescriptor,
  DefinedType: DefinedTypeDescriptor,
  FunctionalOption: FunctionalOptionDescriptor,
  Language: LanguageDescriptor,

  // Объекты верхнего уровня
  Constant: ConstantDescriptor,
  Catalog: CatalogDescriptor,
  Document: DocumentDescriptor,
  Enum: EnumDescriptor,
  InformationRegister: InformationRegisterDescriptor,
  AccumulationRegister: AccumulationRegisterDescriptor,
  AccountingRegister: AccountingRegisterDescriptor,
  CalculationRegister: CalculationRegisterDescriptor,
  Report: ReportDescriptor,
  DataProcessor: DataProcessorDescriptor,
  BusinessProcess: BusinessProcessDescriptor,
  Task: TaskDescriptor,
  ExchangePlan: ExchangePlanDescriptor,
  ChartOfCharacteristicTypes: ChartOfCharacteristicTypesDescriptor,
  ChartOfAccounts: ChartOfAccountsDescriptor,
  ChartOfCalculationTypes: ChartOfCalculationTypesDescriptor,
  DocumentJournal: DocumentJournalDescriptor,
  ScheduledJob: ScheduledJobDescriptor,
  EventSubscription: EventSubscriptionDescriptor,
  HTTPService: HTTPServiceDescriptor,
  WebService: WebServiceDescriptor,
  FilterCriterion: FilterCriterionDescriptor,
  Sequence: SequenceDescriptor,

  // Дочерние элементы
  Attribute: AttributeDescriptor,
  TabularSection: TabularSectionDescriptor,
  Column: ColumnDescriptor,
  Form: FormDescriptor,
  Command: CommandDescriptor,
  Template: TemplateDescriptor,
  Dimension: DimensionDescriptor,
  Resource: ResourceDescriptor,
  EnumValue: EnumValueDescriptor,
};

/** Возвращает статический дескриптор для указанного типа узла */
export function getNodeDescriptor(kind: NodeKind): NodeDescriptor | undefined {
  return NODE_DESCRIPTORS[kind];
}

