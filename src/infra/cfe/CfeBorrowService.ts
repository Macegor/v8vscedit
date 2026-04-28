import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationXmlEditor } from '../xml/ConfigurationXmlEditor';
import {
  extractChildMetaElementXml,
  extractNestingAwareBlock,
  findChildElementsFullXmlInBlock,
} from '../xml/XmlUtils';

/**
 * Карта типов метаданных → папка в структуре выгрузки 1С.
 * Дублирует subset из META_TYPES.folder, но этот модуль не зависит от vscode,
 * поэтому не импортирует доменный реестр напрямую.
 */
const FOLDER_MAP: Record<string, string> = {
  Catalog: 'Catalogs',
  Document: 'Documents',
  Enum: 'Enums',
  CommonModule: 'CommonModules',
  CommonPicture: 'CommonPictures',
  CommonCommand: 'CommonCommands',
  CommonTemplate: 'CommonTemplates',
  ExchangePlan: 'ExchangePlans',
  Report: 'Reports',
  DataProcessor: 'DataProcessors',
  InformationRegister: 'InformationRegisters',
  AccumulationRegister: 'AccumulationRegisters',
  ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
  ChartOfAccounts: 'ChartsOfAccounts',
  AccountingRegister: 'AccountingRegisters',
  ChartOfCalculationTypes: 'ChartsOfCalculationTypes',
  CalculationRegister: 'CalculationRegisters',
  BusinessProcess: 'BusinessProcesses',
  Task: 'Tasks',
  Subsystem: 'Subsystems',
  Role: 'Roles',
  Constant: 'Constants',
  FunctionalOption: 'FunctionalOptions',
  DefinedType: 'DefinedTypes',
  FunctionalOptionsParameter: 'FunctionalOptionsParameters',
  CommonForm: 'CommonForms',
  DocumentJournal: 'DocumentJournals',
  SessionParameter: 'SessionParameters',
  StyleItem: 'StyleItems',
  EventSubscription: 'EventSubscriptions',
  ScheduledJob: 'ScheduledJobs',
  SettingsStorage: 'SettingsStorages',
  FilterCriterion: 'FilterCriteria',
  CommandGroup: 'CommandGroups',
  DocumentNumerator: 'DocumentNumerators',
  Sequence: 'Sequences',
  IntegrationService: 'IntegrationServices',
  XDTOPackage: 'XDTOPackages',
  WebService: 'WebServices',
  HTTPService: 'HTTPServices',
  WSReference: 'WSReferences',
  CommonAttribute: 'CommonAttributes',
  Style: 'Styles',
};

/** Типы, для которых XML-оболочка заимствованного объекта содержит пустой `<ChildObjects/>` */
const TYPES_WITH_CHILD_OBJECTS = new Set<string>([
  'Catalog', 'Document', 'ExchangePlan', 'ChartOfAccounts',
  'ChartOfCharacteristicTypes', 'ChartOfCalculationTypes',
  'BusinessProcess', 'Task', 'Enum',
  'InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister',
]);

/** Свойства CommonModule, которые копируются из источника в заимствованный объект */
const COMMON_MODULE_PROPS = [
  'Global', 'ClientManagedApplication', 'Server',
  'ExternalConnection', 'ClientOrdinaryApplication', 'ServerCall',
];

/** Дочерние объекты, которые в XML должны быть полноценными блоками, а не текстовыми ссылками */
const STRUCTURED_CHILD_TAGS = new Set<string>([
  'Attribute', 'AddressingAttribute', 'Dimension', 'Resource',
  'EnumValue', 'TabularSection', 'Command',
]);

/**
 * Описание GeneratedType для блока InternalInfo.
 * Значения по типу объекта — порт аналогичной таблицы из cfe-borrow.py.
 */
interface GeneratedTypeDef { prefix: string; category: string }
const GENERATED_TYPES: Record<string, GeneratedTypeDef[]> = {
  Catalog: [
    { prefix: 'CatalogObject', category: 'Object' },
    { prefix: 'CatalogRef', category: 'Ref' },
    { prefix: 'CatalogSelection', category: 'Selection' },
    { prefix: 'CatalogList', category: 'List' },
    { prefix: 'CatalogManager', category: 'Manager' },
  ],
  Document: [
    { prefix: 'DocumentObject', category: 'Object' },
    { prefix: 'DocumentRef', category: 'Ref' },
    { prefix: 'DocumentSelection', category: 'Selection' },
    { prefix: 'DocumentList', category: 'List' },
    { prefix: 'DocumentManager', category: 'Manager' },
  ],
  Enum: [
    { prefix: 'EnumRef', category: 'Ref' },
    { prefix: 'EnumManager', category: 'Manager' },
    { prefix: 'EnumList', category: 'List' },
  ],
  Constant: [
    { prefix: 'ConstantManager', category: 'Manager' },
    { prefix: 'ConstantValueManager', category: 'ValueManager' },
    { prefix: 'ConstantValueKey', category: 'ValueKey' },
  ],
  InformationRegister: [
    { prefix: 'InformationRegisterRecord', category: 'Record' },
    { prefix: 'InformationRegisterManager', category: 'Manager' },
    { prefix: 'InformationRegisterSelection', category: 'Selection' },
    { prefix: 'InformationRegisterList', category: 'List' },
    { prefix: 'InformationRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'InformationRegisterRecordKey', category: 'RecordKey' },
    { prefix: 'InformationRegisterRecordManager', category: 'RecordManager' },
  ],
  AccumulationRegister: [
    { prefix: 'AccumulationRegisterRecord', category: 'Record' },
    { prefix: 'AccumulationRegisterManager', category: 'Manager' },
    { prefix: 'AccumulationRegisterSelection', category: 'Selection' },
    { prefix: 'AccumulationRegisterList', category: 'List' },
    { prefix: 'AccumulationRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'AccumulationRegisterRecordKey', category: 'RecordKey' },
  ],
  AccountingRegister: [
    { prefix: 'AccountingRegisterRecord', category: 'Record' },
    { prefix: 'AccountingRegisterManager', category: 'Manager' },
    { prefix: 'AccountingRegisterSelection', category: 'Selection' },
    { prefix: 'AccountingRegisterList', category: 'List' },
    { prefix: 'AccountingRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'AccountingRegisterRecordKey', category: 'RecordKey' },
  ],
  CalculationRegister: [
    { prefix: 'CalculationRegisterRecord', category: 'Record' },
    { prefix: 'CalculationRegisterManager', category: 'Manager' },
    { prefix: 'CalculationRegisterSelection', category: 'Selection' },
    { prefix: 'CalculationRegisterList', category: 'List' },
    { prefix: 'CalculationRegisterRecordSet', category: 'RecordSet' },
    { prefix: 'CalculationRegisterRecordKey', category: 'RecordKey' },
  ],
  ChartOfAccounts: [
    { prefix: 'ChartOfAccountsObject', category: 'Object' },
    { prefix: 'ChartOfAccountsRef', category: 'Ref' },
    { prefix: 'ChartOfAccountsSelection', category: 'Selection' },
    { prefix: 'ChartOfAccountsList', category: 'List' },
    { prefix: 'ChartOfAccountsManager', category: 'Manager' },
  ],
  ChartOfCharacteristicTypes: [
    { prefix: 'ChartOfCharacteristicTypesObject', category: 'Object' },
    { prefix: 'ChartOfCharacteristicTypesRef', category: 'Ref' },
    { prefix: 'ChartOfCharacteristicTypesSelection', category: 'Selection' },
    { prefix: 'ChartOfCharacteristicTypesList', category: 'List' },
    { prefix: 'ChartOfCharacteristicTypesManager', category: 'Manager' },
  ],
  ChartOfCalculationTypes: [
    { prefix: 'ChartOfCalculationTypesObject', category: 'Object' },
    { prefix: 'ChartOfCalculationTypesRef', category: 'Ref' },
    { prefix: 'ChartOfCalculationTypesSelection', category: 'Selection' },
    { prefix: 'ChartOfCalculationTypesList', category: 'List' },
    { prefix: 'ChartOfCalculationTypesManager', category: 'Manager' },
    { prefix: 'DisplacingCalculationTypes', category: 'DisplacingCalculationTypes' },
    { prefix: 'BaseCalculationTypes', category: 'BaseCalculationTypes' },
    { prefix: 'LeadingCalculationTypes', category: 'LeadingCalculationTypes' },
  ],
  BusinessProcess: [
    { prefix: 'BusinessProcessObject', category: 'Object' },
    { prefix: 'BusinessProcessRef', category: 'Ref' },
    { prefix: 'BusinessProcessSelection', category: 'Selection' },
    { prefix: 'BusinessProcessList', category: 'List' },
    { prefix: 'BusinessProcessManager', category: 'Manager' },
  ],
  Task: [
    { prefix: 'TaskObject', category: 'Object' },
    { prefix: 'TaskRef', category: 'Ref' },
    { prefix: 'TaskSelection', category: 'Selection' },
    { prefix: 'TaskList', category: 'List' },
    { prefix: 'TaskManager', category: 'Manager' },
  ],
  ExchangePlan: [
    { prefix: 'ExchangePlanObject', category: 'Object' },
    { prefix: 'ExchangePlanRef', category: 'Ref' },
    { prefix: 'ExchangePlanSelection', category: 'Selection' },
    { prefix: 'ExchangePlanList', category: 'List' },
    { prefix: 'ExchangePlanManager', category: 'Manager' },
  ],
  DocumentJournal: [
    { prefix: 'DocumentJournalSelection', category: 'Selection' },
    { prefix: 'DocumentJournalList', category: 'List' },
    { prefix: 'DocumentJournalManager', category: 'Manager' },
  ],
  Report: [
    { prefix: 'ReportObject', category: 'Object' },
    { prefix: 'ReportManager', category: 'Manager' },
  ],
  DataProcessor: [
    { prefix: 'DataProcessorObject', category: 'Object' },
    { prefix: 'DataProcessorManager', category: 'Manager' },
  ],
};

/** Пространства имён XML для MetaDataObject */
const XMLNS_DECL = [
  'xmlns="http://v8.1c.ru/8.3/MDClasses"',
  'xmlns:app="http://v8.1c.ru/8.2/managed-application/core"',
  'xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config"',
  'xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi"',
  'xmlns:ent="http://v8.1c.ru/8.1/data/enterprise"',
  'xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform"',
  'xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette"',
  'xmlns:style="http://v8.1c.ru/8.1/data/ui/style"',
  'xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system"',
  'xmlns:v8="http://v8.1c.ru/8.1/data/core"',
  'xmlns:v8ui="http://v8.1c.ru/8.1/data/ui"',
  'xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web"',
  'xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows"',
  'xmlns:xen="http://v8.1c.ru/8.3/xcf/enums"',
  'xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef"',
  'xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"',
  'xmlns:xs="http://www.w3.org/2001/XMLSchema"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
].join(' ');

export interface BorrowObjectResult {
  /** true — объект уже существовал в расширении (обновление не выполнялось) */
  alreadyBorrowed: boolean;
  /** Список созданных/изменённых файлов */
  files: string[];
}

/**
 * Сервис заимствования объектов из конфигурации 1С в расширение.
 * Портирует логику cfe-borrow.py на TypeScript без зависимости от vscode.
 */
export class CfeBorrowService {
  private readonly configEditor = new ConfigurationXmlEditor();

  /**
   * Проверяет, заимствован ли уже объект в расширении.
   * Критерий — наличие XML-файла объекта в каталоге расширения.
   */
  isObjectBorrowed(extDir: string, typeName: string, objectName: string): boolean {
    const folder = FOLDER_MAP[typeName];
    if (!folder) {
      return false;
    }
    const objFile = path.join(extDir, folder, `${objectName}.xml`);
    return fs.existsSync(objFile);
  }

  /**
   * Заимствует объект метаданных из конфигурации в расширение.
   * Если объект уже заимствован — возвращает `alreadyBorrowed: true` без изменений.
   */
  borrowObject(cfDir: string, extDir: string, typeName: string, objectName: string): BorrowObjectResult {
    if (this.isObjectBorrowed(extDir, typeName, objectName)) {
      return { alreadyBorrowed: true, files: [] };
    }

    const folder = FOLDER_MAP[typeName];
    if (!folder) {
      throw new Error(`Неизвестный тип метаданных для заимствования: "${typeName}"`);
    }

    const sourceXmlPath = this.resolveSourceXml(cfDir, folder, objectName);
    if (!sourceXmlPath) {
      throw new Error(`Исходный XML объекта не найден: ${path.join(cfDir, folder, objectName)}`);
    }

    const sourceXml = fs.readFileSync(sourceXmlPath, 'utf-8');
    const sourceUuid = this.extractUuid(sourceXml);
    if (!sourceUuid) {
      throw new Error(`Не удалось извлечь UUID из исходного XML: ${sourceXmlPath}`);
    }

    const formatVersion = this.detectFormatVersion(extDir);
    const commonModuleProps = typeName === 'CommonModule'
      ? this.extractCommonModuleProps(sourceXml)
      : {};

    const borrowedXml = this.buildBorrowedObjectXml(
      typeName, objectName, sourceUuid, formatVersion, commonModuleProps
    );

    const targetDir = path.join(extDir, folder);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, `${objectName}.xml`);
    fs.writeFileSync(targetFile, borrowedXml, 'utf-8');

    const extConfigXmlPath = path.join(extDir, 'Configuration.xml');
    this.configEditor.addChildObject(extConfigXmlPath, `${typeName}.${objectName}`);

    return { alreadyBorrowed: false, files: [targetFile, extConfigXmlPath] };
  }

  /**
   * Заимствует форму объекта.
   * Родительский объект автоматически заимствуется, если ещё не был.
   */
  borrowForm(
    cfDir: string,
    extDir: string,
    typeName: string,
    objectName: string,
    formName: string
  ): BorrowObjectResult {
    const files: string[] = [];

    const parentResult = this.borrowObject(cfDir, extDir, typeName, objectName);
    if (!parentResult.alreadyBorrowed) {
      files.push(...parentResult.files);
    }

    const folder = FOLDER_MAP[typeName];
    if (!folder) {
      throw new Error(`Неизвестный тип метаданных: "${typeName}"`);
    }

    const formMetaDir = path.join(extDir, folder, objectName, 'Forms');
    const formMetaFile = path.join(formMetaDir, `${formName}.xml`);

    if (fs.existsSync(formMetaFile)) {
      return { alreadyBorrowed: true, files: [] };
    }

    const sourceFormXmlPath = this.resolveSourceFormXml(cfDir, folder, objectName, formName);
    if (!sourceFormXmlPath) {
      throw new Error(
        `Исходный XML формы не найден: ${path.join(cfDir, folder, objectName, 'Forms', formName)}`
      );
    }
    const sourceFormXml = fs.readFileSync(sourceFormXmlPath, 'utf-8');
    const sourceFormUuid = this.extractUuid(sourceFormXml);
    if (!sourceFormUuid) {
      throw new Error(`Не удалось извлечь UUID из XML формы: ${sourceFormXmlPath}`);
    }

    const formatVersion = this.detectFormatVersion(extDir);
    fs.mkdirSync(formMetaDir, { recursive: true });

    const formMetaXml = this.buildBorrowedFormMetaXml(formName, sourceFormUuid, formatVersion);
    fs.writeFileSync(formMetaFile, formMetaXml, 'utf-8');
    files.push(formMetaFile);

    const sourceFormExtXmlPath = path.join(
      path.dirname(sourceFormXmlPath), formName, 'Ext', 'Form.xml'
    );
    if (fs.existsSync(sourceFormExtXmlPath)) {
      const sourceFormExtXml = fs.readFileSync(sourceFormExtXmlPath, 'utf-8');
      const borrowedFormExtXml = this.buildBorrowedFormExtXml(sourceFormExtXml);
      const formExtDir = path.join(formMetaDir, formName, 'Ext');
      fs.mkdirSync(formExtDir, { recursive: true });
      const formExtFile = path.join(formExtDir, 'Form.xml');
      fs.writeFileSync(formExtFile, borrowedFormExtXml, 'utf-8');
      files.push(formExtFile);

      const moduleDir = path.join(formExtDir, 'Form');
      fs.mkdirSync(moduleDir, { recursive: true });
      const moduleFile = path.join(moduleDir, 'Module.bsl');
      if (!fs.existsSync(moduleFile)) {
        fs.writeFileSync(moduleFile, '', 'utf-8');
        files.push(moduleFile);
      }
    }

    this.registerFormInParentObject(extDir, folder, objectName, formName);

    return { alreadyBorrowed: false, files };
  }

  /**
   * Заимствует дочерний элемент (реквизит, ТЧ, измерение, ...) из конфигурации в расширение.
   * Автоматически заимствует родительский объект, если он ещё не заимствован.
   * Добавляет запись `<ChildTag>childName</ChildTag>` в ChildObjects родительского XML.
   * Для колонки ТЧ передавайте childTag='TabularSection' и имя самой ТЧ.
   */
  borrowChild(
    cfDir: string,
    extDir: string,
    typeName: string,
    objectName: string,
    childTag: string,
    childName: string
  ): BorrowObjectResult {
    const files: string[] = [];

    const parentResult = this.borrowObject(cfDir, extDir, typeName, objectName);
    if (!parentResult.alreadyBorrowed) {
      files.push(...parentResult.files);
    }

    const folder = FOLDER_MAP[typeName];
    if (!folder) {
      throw new Error(`Неизвестный тип метаданных: "${typeName}"`);
    }

    const objFile = path.join(extDir, folder, `${objectName}.xml`);
    const borrowedChildXml = this.buildBorrowedChildXml(
      cfDir, folder, objectName, childTag, childName
    );
    const childAdded = this.registerChildInParentObject(objFile, childTag, childName, borrowedChildXml);

    if (!childAdded && parentResult.alreadyBorrowed) {
      return { alreadyBorrowed: true, files: [] };
    }

    if (childAdded && !files.includes(objFile)) {
      files.push(objFile);
    }

    return { alreadyBorrowed: false, files };
  }

  /** Папка типа метаданных в структуре выгрузки или undefined если тип неизвестен */
  getFolderName(typeName: string): string | undefined {
    return FOLDER_MAP[typeName];
  }

  /**
   * Добавляет `<childTag>childName</childTag>` в блок ChildObjects XML-файла объекта.
   * Возвращает true, если запись была добавлена, false — если уже присутствует или файл недоступен.
   */
  private registerChildInParentObject(
    objFile: string,
    childTag: string,
    childName: string,
    childXml?: string
  ): boolean {
    if (!fs.existsSync(objFile)) {
      return false;
    }

    let xml = fs.readFileSync(objFile, 'utf-8');

    if (extractChildMetaElementXml(xml, childTag, childName)) {
      return false;
    }

    const textChildRe = new RegExp(`\\s*<${childTag}>${escapeRegExp(childName)}</${childTag}>`);
    if (childXml && textChildRe.test(xml)) {
      xml = xml.replace(textChildRe, `\n${childXml}`);
      fs.writeFileSync(objFile, xml, 'utf-8');
      return true;
    }

    if (textChildRe.test(xml)) {
      return false;
    }

    const entry = childXml ?? `\t\t\t<${childTag}>${escapeXmlText(childName)}</${childTag}>`;

    if (/<ChildObjects\s*\/>/.test(xml)) {
      xml = xml.replace(/<ChildObjects\s*\/>/, `<ChildObjects>\n${entry}\n\t\t</ChildObjects>`);
    } else if (xml.includes('</ChildObjects>')) {
      xml = xml.replace('</ChildObjects>', `${entry}\n\t\t</ChildObjects>`);
    } else {
      return false;
    }

    fs.writeFileSync(objFile, xml, 'utf-8');
    return true;
  }

  private buildBorrowedChildXml(
    cfDir: string,
    folder: string,
    objectName: string,
    childTag: string,
    childName: string
  ): string | undefined {
    if (!STRUCTURED_CHILD_TAGS.has(childTag)) {
      return undefined;
    }

    const sourceXmlPath = this.resolveSourceXml(cfDir, folder, objectName);
    if (!sourceXmlPath) {
      throw new Error(`Исходный XML объекта не найден: ${path.join(cfDir, folder, objectName)}`);
    }

    const sourceXml = fs.readFileSync(sourceXmlPath, 'utf-8');
    const sourceChildXml = extractChildMetaElementXml(sourceXml, childTag, childName);
    if (!sourceChildXml) {
      throw new Error(`Дочерний объект не найден в исходном XML: ${childTag}.${childName}`);
    }

    return this.toBorrowedChildXml(sourceChildXml, childTag, '\t\t\t');
  }

  private toBorrowedChildXml(sourceChildXml: string, childTag: string, baseIndent: string): string {
    const sourceUuid = this.extractUuid(sourceChildXml);
    if (!sourceUuid) {
      throw new Error(`Не удалось извлечь UUID дочернего объекта: ${childTag}`);
    }

    let xml = this.normalizeChildXmlIndent(sourceChildXml.replace(/^\uFEFF/, ''), baseIndent);
    xml = this.replaceElementUuid(xml, childTag);
    xml = this.ensureInternalInfo(xml, childTag);
    xml = this.markChildAsBorrowed(xml, sourceUuid);

    if (childTag === 'TabularSection') {
      xml = this.markTabularSectionAttributesAsBorrowed(xml, baseIndent);
    }

    return xml;
  }

  private replaceElementUuid(xml: string, tagName: string): string {
    const openTagRe = new RegExp(`<${tagName}\\b[^>]*>`);
    const openTag = openTagRe.exec(xml)?.[0];
    if (!openTag) {
      return xml;
    }

    const nextOpenTag = /\suuid="[^"]*"/.test(openTag)
      ? openTag.replace(/\suuid="[^"]*"/, ` uuid="${this.newGuid()}"`)
      : openTag.replace(/>$/, ` uuid="${this.newGuid()}">`);
    return xml.replace(openTag, nextOpenTag);
  }

  private ensureInternalInfo(xml: string, tagName: string): string {
    const directInternalInfoRe = new RegExp(`<${tagName}\\b[^>]*>\\s*<InternalInfo[\\s/>]`);
    if (directInternalInfoRe.test(xml)) {
      return xml;
    }

    const openTagRe = new RegExp(`(<${tagName}\\b[^>]*>)`);
    const openTagMatch = openTagRe.exec(xml);
    if (!openTagMatch) {
      return xml;
    }

    const baseIndent = this.detectElementIndent(xml);
    return xml.replace(openTagMatch[1], `${openTagMatch[1]}\n${baseIndent}\t<InternalInfo/>`);
  }

  private markChildAsBorrowed(xml: string, sourceUuid: string): string {
    const propertiesMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml);
    if (!propertiesMatch) {
      return xml;
    }

    const propsInner = propertiesMatch[1]
      .replace(/\s*<ObjectBelonging>[\s\S]*?<\/ObjectBelonging>/, '')
      .replace(/\s*<ExtendedConfigurationObject>[\s\S]*?<\/ExtendedConfigurationObject>/, '');
    const propIndent = this.detectPropertiesIndent(propertiesMatch[1]);

    let nextInner = propsInner;
    const belonging = `\n${propIndent}<ObjectBelonging>Adopted</ObjectBelonging>`;
    if (/<Name>[\s\S]*?<\/Name>/.test(nextInner)) {
      nextInner = nextInner.replace(/(\s*<Name>)/, `${belonging}$1`);
    } else {
      nextInner = `${belonging}${nextInner}`;
    }

    const extended = `\n${propIndent}<ExtendedConfigurationObject>${sourceUuid}</ExtendedConfigurationObject>`;
    const commentRe = /<Comment\s*\/>|<Comment>[\s\S]*?<\/Comment>/;
    if (commentRe.test(nextInner)) {
      nextInner = nextInner.replace(commentRe, (comment) => `${comment}${extended}`);
    } else if (/<Name>[\s\S]*?<\/Name>/.test(nextInner)) {
      nextInner = nextInner.replace(/(<Name>[\s\S]*?<\/Name>)/, `$1${extended}`);
    } else {
      nextInner = `${nextInner}${extended}`;
    }

    return xml.replace(propertiesMatch[1], nextInner);
  }

  private markTabularSectionAttributesAsBorrowed(xml: string, baseIndent: string): string {
    const childObjectsInner = extractNestingAwareBlock(xml, 'ChildObjects');
    if (!childObjectsInner) {
      return xml;
    }

    let result = xml;
    for (const attribute of findChildElementsFullXmlInBlock(childObjectsInner, 'Attribute')) {
      const borrowedAttributeXml = this.toBorrowedChildXml(attribute.xml, 'Attribute', `${baseIndent}\t\t`);
      result = result.replace(attribute.xml, borrowedAttributeXml);
    }
    return result;
  }

  private normalizeChildXmlIndent(xml: string, baseIndent: string): string {
    const lines = xml.replace(/\r\n?/g, '\n').split('\n');
    const indents = lines
      .slice(1)
      .filter((line) => line.trim().length > 0)
      .map((line) => /^([ \t]*)/.exec(line)?.[1].length ?? 0);
    const removeCount = indents.length > 0 ? Math.min(...indents) : 0;

    return lines
      .map((line, index) => {
        if (line.trim().length === 0) {
          return '';
        }
        const normalized = index === 0 ? line.trimStart() : line.slice(removeCount);
        return `${baseIndent}${normalized}`;
      })
      .join('\n');
  }

  private detectElementIndent(xml: string): string {
    const match = /^([ \t]*)</m.exec(xml);
    return match?.[1] ?? '\t\t\t';
  }

  private detectPropertiesIndent(propsInner: string): string {
    const match = /\n([ \t]*)<[^/!]/.exec(propsInner);
    return match?.[1] ?? '\t\t\t\t';
  }

  private resolveSourceXml(cfDir: string, folder: string, objectName: string): string | null {
    const deepPath = path.join(cfDir, folder, objectName, `${objectName}.xml`);
    if (fs.existsSync(deepPath)) {
      return deepPath;
    }
    const flatPath = path.join(cfDir, folder, `${objectName}.xml`);
    if (fs.existsSync(flatPath)) {
      return flatPath;
    }
    return null;
  }

  private resolveSourceFormXml(
    cfDir: string, folder: string, objectName: string, formName: string
  ): string | null {
    const formMetaPath = path.join(cfDir, folder, objectName, 'Forms', `${formName}.xml`);
    if (fs.existsSync(formMetaPath)) {
      return formMetaPath;
    }
    return null;
  }

  private extractUuid(xml: string): string | null {
    const m = / uuid="([^"]+)"/.exec(xml);
    return m?.[1] ?? null;
  }

  private detectFormatVersion(extDir: string): string {
    const configXmlPath = path.join(extDir, 'Configuration.xml');
    if (!fs.existsSync(configXmlPath)) {
      return '2.17';
    }
    const head = fs.readFileSync(configXmlPath, 'utf-8').slice(0, 2000);
    const m = /<MetaDataObject[^>]+version="([\d.]+)"/.exec(head);
    return m?.[1] ?? '2.17';
  }

  private extractCommonModuleProps(sourceXml: string): Record<string, string> {
    const props: Record<string, string> = {};
    for (const propName of COMMON_MODULE_PROPS) {
      const m = new RegExp(`<${propName}>(true|false)<\\/${propName}>`).exec(sourceXml);
      if (m) {
        props[propName] = m[1];
      }
    }
    return props;
  }

  private buildInternalInfo(typeName: string, objectName: string): string {
    const types = GENERATED_TYPES[typeName];
    if (!types?.length) {
      return '\t\t<InternalInfo/>';
    }

    const lines: string[] = ['\t\t<InternalInfo>'];

    if (typeName === 'ExchangePlan') {
      lines.push(`\t\t\t<xr:ThisNode>${this.newGuid()}</xr:ThisNode>`);
    }

    for (const gt of types) {
      const fullName = `${gt.prefix}.${objectName}`;
      lines.push(`\t\t\t<xr:GeneratedType name="${fullName}" category="${gt.category}">`);
      lines.push(`\t\t\t\t<xr:TypeId>${this.newGuid()}</xr:TypeId>`);
      lines.push(`\t\t\t\t<xr:ValueId>${this.newGuid()}</xr:ValueId>`);
      lines.push('\t\t\t</xr:GeneratedType>');
    }

    lines.push('\t\t</InternalInfo>');
    return lines.join('\n');
  }

  private buildBorrowedObjectXml(
    typeName: string,
    objectName: string,
    sourceUuid: string,
    formatVersion: string,
    commonModuleProps: Record<string, string>
  ): string {
    const newUuid = this.newGuid();
    const internalInfo = this.buildInternalInfo(typeName, objectName);

    const lines: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<MetaDataObject ${XMLNS_DECL} version="${formatVersion}">`,
      `\t<${typeName} uuid="${newUuid}">`,
      internalInfo,
      `\t\t<Properties>`,
      `\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>`,
      `\t\t\t<Name>${objectName}</Name>`,
      `\t\t\t<Comment/>`,
      `\t\t\t<ExtendedConfigurationObject>${sourceUuid}</ExtendedConfigurationObject>`,
    ];

    if (typeName === 'CommonModule') {
      for (const propName of COMMON_MODULE_PROPS) {
        const val = commonModuleProps[propName] ?? 'false';
        lines.push(`\t\t\t<${propName}>${val}</${propName}>`);
      }
    }

    lines.push(`\t\t</Properties>`);

    if (TYPES_WITH_CHILD_OBJECTS.has(typeName)) {
      lines.push(`\t\t<ChildObjects/>`);
    }

    lines.push(`\t</${typeName}>`);
    lines.push(`</MetaDataObject>`);

    return lines.join('\n');
  }

  private buildBorrowedFormMetaXml(
    formName: string,
    sourceUuid: string,
    formatVersion: string
  ): string {
    const newUuid = this.newGuid();
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<MetaDataObject ${XMLNS_DECL} version="${formatVersion}">`,
      `\t<Form uuid="${newUuid}">`,
      `\t\t<InternalInfo/>`,
      `\t\t<Properties>`,
      `\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>`,
      `\t\t\t<Name>${formName}</Name>`,
      `\t\t\t<Comment/>`,
      `\t\t\t<ExtendedConfigurationObject>${sourceUuid}</ExtendedConfigurationObject>`,
      `\t\t\t<FormType>Managed</FormType>`,
      `\t\t</Properties>`,
      `\t</Form>`,
      `</MetaDataObject>`,
    ].join('\n');
  }

  /**
   * Строит Form.xml для заимствованной формы.
   * Очищает ссылки на команды и DataPath привязок элементов формы,
   * добавляет блок BaseForm с исходным состоянием.
   */
  private buildBorrowedFormExtXml(sourceFormXml: string): string {
    const nsStrip = / xmlns(?::\w+)?="[^"]*"/g;

    // Определяем версию и XML-декларацию из источника
    const xmlDeclMatch = /^(<\?xml[^?]*\?>)/.exec(sourceFormXml);
    const xmlDecl = xmlDeclMatch?.[1] ?? '<?xml version="1.0" encoding="UTF-8"?>';
    const formTagMatch = /(<Form[^>]*>)/.exec(sourceFormXml);
    const formTag = formTagMatch?.[1] ?? '<Form>';
    const formVersionMatch = /version="([^"]+)"/.exec(formTag);
    const formVersion = formVersionMatch?.[1] ?? '2.17';

    const cleanFormXml = (xml: string): string => {
      let result = xml.replace(nsStrip, '');
      // Команды и DataPath очищаем, чтобы не было битых ссылок в расширении
      result = result.replace(/<CommandName>[^<]*<\/CommandName>/g, '<CommandName>0</CommandName>');
      result = result.replace(/\s*<DataPath>[^<]*<\/DataPath>/g, '');
      result = result.replace(/\s*<TitleDataPath>[^<]*<\/TitleDataPath>/g, '');
      result = result.replace(/\s*<RowPictureDataPath>[^<]*<\/RowPictureDataPath>/g, '');
      result = result.replace(/\s*<ExcludedCommand>[^<]*<\/ExcludedCommand>/g, '');
      result = result.replace(/\s*<Events>[\s\S]*?<\/Events>/g, '');
      return result;
    };

    const childItemsMatch = /<ChildItems>[\s\S]*?<\/ChildItems>/.exec(sourceFormXml);
    const childItemsXml = childItemsMatch
      ? cleanFormXml(childItemsMatch[0])
      : '<ChildItems/>';

    return [
      xmlDecl,
      formTag,
      `\t<ChildItems/>`,
      `\t<Attributes/>`,
      `\t<BaseForm version="${formVersion}">`,
      `\t\t${childItemsXml}`,
      `\t\t<Attributes/>`,
      `\t</BaseForm>`,
      `</Form>`,
    ].join('\n');
  }

  /** Добавляет запись о форме в ChildObjects XML-файла родительского объекта в расширении */
  private registerFormInParentObject(
    extDir: string,
    folder: string,
    objectName: string,
    formName: string
  ): void {
    const objFile = path.join(extDir, folder, `${objectName}.xml`);
    if (!fs.existsSync(objFile)) {
      return;
    }
    let xml = fs.readFileSync(objFile, 'utf-8');

    // Проверяем, не зарегистрирована ли форма
    const alreadyRegistered = new RegExp(`<Form>${escapeRegExp(formName)}</Form>`).test(xml);
    if (alreadyRegistered) {
      return;
    }

    const formEntry = `\t\t\t<Form>${formName}</Form>`;

    if (/<ChildObjects\s*\/>/.test(xml)) {
      xml = xml.replace(/<ChildObjects\s*\/>/, `<ChildObjects>\n${formEntry}\n\t\t</ChildObjects>`);
    } else {
      xml = xml.replace('</ChildObjects>', `${formEntry}\n\t\t</ChildObjects>`);
    }

    fs.writeFileSync(objFile, xml, 'utf-8');
  }

  private newGuid(): string {
    return crypto.randomUUID();
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(value: string): string {
  return escapeXml(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
