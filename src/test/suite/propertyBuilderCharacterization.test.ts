import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildRootMetaObjectProperties,
  buildTypedFieldProperties,
  extractLocalizedStringValue,
  extractRootObjectPropertiesInnerXml,
  getRootPropertyKeyOrder,
} from '../../ui/views/properties/PropertyBuilder';
import type { NodeKind } from '../../ui/tree/TreeNode';
import type { EnumPropertyValue, MetadataTypeValue } from '../../ui/views/properties/_types';

/**
 * Характеризационные (снапшот) тесты `PropertyBuilder.ts` — страховочная сеть
 * ПЕРЕД декомпозицией файла на `propertyKeyOrder.ts` / `propertyExtractors.ts`.
 * Задача — зафиксировать ТЕКУЩИЙ выход публичных функций, чтобы при переносе
 * данных/логики в подмодули любая потеря, перестановка ключа или изменение
 * структуры результата тут же дали красный. Значения эталонов сняты с HEAD
 * прогоном текущего кода на реальных фикстурах — это не тесты «на будущее»,
 * а фиксация уже существующего поведения (характеризационный тест).
 */

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

suite('PropertyBuilder — характеризация перед декомпозицией', () => {
  suite('getRootPropertyKeyOrder — порядок ключей корня по всем видам метаданных', () => {
    // Виды, использующие общий дефолт COMMON_ROOT_META_PROPERTY_KEYS (ветка else
    // в getRootPropertyKeyOrder) — самая массовая группа контракта, её потеря
    // при переносе в propertyKeyOrder.ts означала бы, что COMMON_ROOT_META_PROPERTY_KEYS
    // не мигрировал или ветка по умолчанию сломана.
    const COMMON_DEFAULT_KEYS = [
      'Name', 'Synonym', 'Comment', 'ObjectBelonging', 'ExtendedConfigurationObject',
      'DefaultObjectForm', 'DefaultRecordForm', 'DefaultListForm', 'DefaultChoiceForm',
      'AuxiliaryObjectForm', 'AuxiliaryRecordForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm',
      'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString',
      'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'ChoiceHistoryOnInput',
      'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation',
      'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'BasedOn',
    ];
    const kindsWithCommonDefault: NodeKind[] = [
      'configuration', 'extension', 'extensions-root', 'group-common', 'group-type',
      'NumeratorsBranch', 'SequencesBranch', 'Subsystem', 'CommonModule', 'CommonAttribute',
      'Role', 'Bot', 'Interface', 'Constant', 'EventSubscription', 'ExternalDataSource',
      'StandardAttribute', 'Attribute', 'AddressingAttribute', 'TabularSection', 'Column',
      'Form', 'Command', 'Template', 'Dimension', 'Resource', 'EnumValue',
    ];

    for (const kind of kindsWithCommonDefault) {
      test(`${kind} -> COMMON_ROOT_META_PROPERTY_KEYS (дефолт)`, () => {
        assert.deepStrictEqual(getRootPropertyKeyOrder(kind), COMMON_DEFAULT_KEYS);
      });
    }

    test('SessionParameter и DefinedType -> ["Name","Synonym","Comment","Type"]', () => {
      const expected = ['Name', 'Synonym', 'Comment', 'Type'];
      assert.deepStrictEqual(getRootPropertyKeyOrder('SessionParameter'), expected);
      assert.deepStrictEqual(getRootPropertyKeyOrder('DefinedType'), expected);
    });

    test('CommonForm -> контракт общей формы', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('CommonForm'), [
        'Name', 'Synonym', 'Comment', 'FormType', 'IncludeHelpInContents', 'UsePurposes',
        'UseInInterfaceCompatibilityMode', 'UseStandardCommands', 'ExtendedPresentation', 'Explanation',
      ]);
    });

    test('CommonCommand -> контракт команды', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('CommonCommand'), [
        'Name', 'Synonym', 'Comment', 'Group', 'CommandParameterType', 'ParameterUseMode',
        'ModifiesData', 'OnMainServerUnavalableBehavior', 'Representation', 'ToolTip',
        'Shortcut', 'Picture', 'IncludeHelpInContents',
      ]);
    });

    test('CommandGroup -> контракт группы команд', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('CommandGroup'), [
        'Name', 'Synonym', 'Comment', 'Representation', 'ToolTip', 'Picture', 'Category',
      ]);
    });

    test('CommonPicture -> контракт общей картинки', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('CommonPicture'), [
        'Name', 'Synonym', 'Comment', 'AvailabilityForChoice', 'AvailabilityForAppearance',
      ]);
    });

    test('CommonTemplate -> TEMPLATE_META_PROPERTY_KEYS', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('CommonTemplate'), [
        'Name', 'Synonym', 'Comment', 'TemplateType',
      ]);
    });

    test('XDTOPackage -> контракт пакета XDTO', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('XDTOPackage'), [
        'Name', 'Synonym', 'Comment', 'Namespace',
      ]);
    });

    test('StyleItem и PaletteColor -> контракт элемента стиля', () => {
      const expected = ['Name', 'Synonym', 'Comment', 'Type', 'Value'];
      assert.deepStrictEqual(getRootPropertyKeyOrder('StyleItem'), expected);
      assert.deepStrictEqual(getRootPropertyKeyOrder('PaletteColor'), expected);
    });

    test('FunctionalOption -> контракт функциональной опции', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('FunctionalOption'), [
        'Name', 'Synonym', 'Comment', 'Location', 'PrivilegedGetMode', 'Content',
      ]);
    });

    test('FunctionalOptionsParameter -> контракт параметра функциональной опции', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('FunctionalOptionsParameter'), [
        'Name', 'Synonym', 'Comment', 'Use',
      ]);
    });

    test('SettingsStorage -> контракт хранилища настроек', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('SettingsStorage'), [
        'Name', 'Synonym', 'Comment', 'DefaultSaveForm', 'DefaultLoadForm',
        'AuxiliarySaveForm', 'AuxiliaryLoadForm',
      ]);
    });

    test('Style -> ["Name","Synonym","Comment"]', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Style'), ['Name', 'Synonym', 'Comment']);
    });

    test('WSReference и WebSocketClient -> контракт ссылки на веб-сервис', () => {
      const expected = ['Name', 'Synonym', 'Comment', 'LocationURL'];
      assert.deepStrictEqual(getRootPropertyKeyOrder('WSReference'), expected);
      assert.deepStrictEqual(getRootPropertyKeyOrder('WebSocketClient'), expected);
    });

    test('IntegrationService -> контракт сервиса интеграции', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('IntegrationService'), [
        'Name', 'Synonym', 'Comment', 'ExternalIntegrationServiceAddress',
      ]);
    });

    test('Language -> контракт языка', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Language'), [
        'Name', 'Synonym', 'Comment', 'LanguageCode',
      ]);
    });

    test('HTTPService -> контракт HTTP-сервиса', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('HTTPService'), [
        'Name', 'Synonym', 'Comment', 'RootURL', 'ReuseSessions', 'SessionMaxAge',
      ]);
    });

    test('WebService -> контракт веб-сервиса', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('WebService'), [
        'Name', 'Synonym', 'Comment', 'Namespace', 'XDTOPackages',
        'DescriptorFileName', 'ReuseSessions', 'SessionMaxAge',
      ]);
    });

    test('Catalog -> полный контракт справочника по разделам конфигуратора', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Catalog'), [
        'Name', 'Synonym', 'Comment', 'ObjectPresentation', 'ExtendedObjectPresentation',
        'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'ObjectBelonging',
        'ExtendedConfigurationObject', 'Hierarchical', 'HierarchyType', 'FoldersOnTop',
        'LimitLevelCount', 'LevelCount', 'Owners', 'SubordinationUse', 'CodeLength',
        'DescriptionLength', 'CodeType', 'CodeAllowedLength', 'CodeSeries', 'CheckUnique',
        'Autonumbering', 'DefaultPresentation', 'DefaultObjectForm', 'DefaultFolderForm',
        'DefaultListForm', 'DefaultChoiceForm', 'DefaultFolderChoiceForm', 'AuxiliaryObjectForm',
        'AuxiliaryFolderForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'AuxiliaryFolderChoiceForm',
        'QuickChoice', 'CreateOnInput', 'InputByString', 'SearchStringModeOnInputByString',
        'FullTextSearchOnInputByString', 'ChoiceDataGetModeOnInputByString', 'ChoiceHistoryOnInput',
        'UseStandardCommands', 'BasedOn', 'DataLockFields', 'DataLockControlMode', 'FullTextSearch',
        'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite',
        'ExecuteAfterWriteDataHistoryVersionProcessing', 'PredefinedDataUpdate', 'Characteristics',
        'EditType', 'IncludeHelpInContents',
      ]);
    });

    test('Document -> полный контракт документа по разделам конфигуратора', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Document'), [
        'Name', 'Synonym', 'Comment', 'ObjectPresentation', 'ExtendedObjectPresentation',
        'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'ObjectBelonging',
        'ExtendedConfigurationObject', 'Numerator', 'NumberType', 'NumberLength',
        'NumberAllowedLength', 'NumberPeriodicity', 'CheckUnique', 'Autonumbering',
        'DefaultObjectForm', 'DefaultListForm', 'DefaultChoiceForm', 'AuxiliaryObjectForm',
        'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'CreateOnInput', 'InputByString',
        'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString',
        'ChoiceDataGetModeOnInputByString', 'ChoiceHistoryOnInput', 'UseStandardCommands',
        'BasedOn', 'Posting', 'RealTimePosting', 'RegisterRecordsDeletion',
        'RegisterRecordsWritingOnPost', 'SequenceFilling', 'RegisterRecords',
        'PostInPrivilegedMode', 'UnpostInPrivilegedMode', 'DataLockFields', 'DataLockControlMode',
        'FullTextSearch', 'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite',
        'ExecuteAfterWriteDataHistoryVersionProcessing', 'Characteristics', 'IncludeHelpInContents',
      ]);
    });

    test('DocumentNumerator и Sequence -> контракт нумератора', () => {
      const expected = [
        'Name', 'Synonym', 'Comment', 'NumberType', 'NumberLength',
        'NumberAllowedLength', 'NumberPeriodicity', 'CheckUnique',
      ];
      assert.deepStrictEqual(getRootPropertyKeyOrder('DocumentNumerator'), expected);
      assert.deepStrictEqual(getRootPropertyKeyOrder('Sequence'), expected);
    });

    test('Enum -> контракт перечисления', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Enum'), [
        'Name', 'Synonym', 'Comment', 'ObjectBelonging', 'ExtendedConfigurationObject',
        'UseStandardCommands', 'QuickChoice', 'ChoiceMode', 'DefaultListForm', 'DefaultChoiceForm',
        'AuxiliaryListForm', 'AuxiliaryChoiceForm', 'ListPresentation', 'ExtendedListPresentation',
        'Explanation', 'ChoiceHistoryOnInput',
      ]);
    });

    test('InformationRegister и CalculationRegister -> общий контракт регистра сведений', () => {
      const expected = [
        'Name', 'Synonym', 'Comment', 'UseStandardCommands', 'EditType', 'DefaultRecordForm',
        'DefaultListForm', 'AuxiliaryRecordForm', 'AuxiliaryListForm', 'InformationRegisterPeriodicity',
        'WriteMode', 'MainFilterOnPeriod', 'IncludeHelpInContents', 'DataLockControlMode',
        'FullTextSearch', 'EnableTotalsSliceFirst', 'EnableTotalsSliceLast', 'RecordPresentation',
        'ExtendedRecordPresentation', 'ListPresentation', 'ExtendedListPresentation', 'Explanation',
        'DataHistory', 'UpdateDataHistoryImmediatelyAfterWrite', 'ExecuteAfterWriteDataHistoryVersionProcessing',
      ];
      assert.deepStrictEqual(getRootPropertyKeyOrder('InformationRegister'), expected);
      assert.deepStrictEqual(getRootPropertyKeyOrder('CalculationRegister'), expected);
    });

    test('AccumulationRegister -> контракт регистра накопления', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('AccumulationRegister'), [
        'Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultListForm', 'AuxiliaryListForm',
        'RegisterType', 'IncludeHelpInContents', 'DataLockControlMode', 'FullTextSearch',
        'EnableTotalsSplitting', 'ListPresentation', 'ExtendedListPresentation', 'Explanation',
      ]);
    });

    test('AccountingRegister -> контракт регистра бухгалтерии', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('AccountingRegister'), [
        'Name', 'Synonym', 'Comment', 'UseStandardCommands', 'IncludeHelpInContents', 'ChartOfAccounts',
        'Correspondence', 'PeriodAdjustmentLength', 'DefaultListForm', 'AuxiliaryListForm',
        'DataLockControlMode', 'EnableTotalsSplitting', 'FullTextSearch', 'ListPresentation',
        'ExtendedListPresentation', 'Explanation',
      ]);
    });

    test('Report -> контракт отчёта', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Report'), [
        'Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultForm', 'AuxiliaryForm',
        'MainDataCompositionSchema', 'DefaultSettingsForm', 'AuxiliarySettingsForm',
        'DefaultVariantForm', 'AuxiliaryVariantForm', 'VariantsStorage', 'SettingsStorage',
        'IncludeHelpInContents', 'ExtendedPresentation', 'Explanation',
      ]);
    });

    test('DataProcessor -> контракт обработки', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('DataProcessor'), [
        'Name', 'Synonym', 'Comment', 'UseStandardCommands', 'DefaultForm', 'AuxiliaryForm',
        'IncludeHelpInContents', 'ExtendedPresentation', 'Explanation',
      ]);
    });

    test('BusinessProcess -> COMMON + DOCUMENT_LIKE + поля бизнес-процесса (mergePropertyKeys)', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('BusinessProcess'), [
        'Name', 'Synonym', 'Comment', 'ObjectBelonging', 'ExtendedConfigurationObject',
        'DefaultObjectForm', 'DefaultRecordForm', 'DefaultListForm', 'DefaultChoiceForm',
        'AuxiliaryObjectForm', 'AuxiliaryRecordForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm',
        'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString',
        'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'ChoiceHistoryOnInput',
        'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation',
        'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'BasedOn',
        'UseStandardCommands', 'Numerator', 'NumberType', 'NumberLength', 'NumberAllowedLength',
        'NumberPeriodicity', 'CheckUnique', 'Autonumbering', 'Posting', 'RealTimePosting',
        'RegisterRecordsDeletion', 'RegisterRecordsWritingOnPost', 'SequenceFilling',
        'RegisterRecords', 'PostInPrivilegedMode', 'UnpostInPrivilegedMode', 'IncludeHelpInContents',
        'Task', 'CreateTaskInPrivilegedMode',
      ]);
    });

    test('Task -> COMMON + DOCUMENT_LIKE + поля задачи (mergePropertyKeys)', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('Task'), [
        'Name', 'Synonym', 'Comment', 'ObjectBelonging', 'ExtendedConfigurationObject',
        'DefaultObjectForm', 'DefaultRecordForm', 'DefaultListForm', 'DefaultChoiceForm',
        'AuxiliaryObjectForm', 'AuxiliaryRecordForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm',
        'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString',
        'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'ChoiceHistoryOnInput',
        'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation',
        'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'BasedOn',
        'UseStandardCommands', 'Numerator', 'NumberType', 'NumberLength', 'NumberAllowedLength',
        'NumberPeriodicity', 'CheckUnique', 'Autonumbering', 'Posting', 'RealTimePosting',
        'RegisterRecordsDeletion', 'RegisterRecordsWritingOnPost', 'SequenceFilling',
        'RegisterRecords', 'PostInPrivilegedMode', 'UnpostInPrivilegedMode', 'IncludeHelpInContents',
        'TaskNumberAutoPrefix', 'DescriptionLength', 'Addressing', 'MainAddressingAttribute',
        'CurrentPerformer',
      ]);
    });

    test('ExchangePlan -> COMMON + EXCHANGE_PLAN_ROOT_EXTRA_KEYS', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('ExchangePlan'), [
        'Name', 'Synonym', 'Comment', 'ObjectBelonging', 'ExtendedConfigurationObject',
        'DefaultObjectForm', 'DefaultRecordForm', 'DefaultListForm', 'DefaultChoiceForm',
        'AuxiliaryObjectForm', 'AuxiliaryRecordForm', 'AuxiliaryListForm', 'AuxiliaryChoiceForm',
        'InputByString', 'SearchStringModeOnInputByString', 'FullTextSearchOnInputByString',
        'ChoiceDataGetModeOnInputByString', 'CreateOnInput', 'ChoiceHistoryOnInput',
        'DataLockControlMode', 'FullTextSearch', 'ObjectPresentation', 'ExtendedObjectPresentation',
        'ListPresentation', 'ExtendedListPresentation', 'Explanation', 'BasedOn',
        'CodeLength', 'CodeAllowedLength', 'CodeSeries', 'CheckUnique', 'Autonumbering',
        'DefaultPresentation', 'EditType', 'Characteristics', 'StandardAttributes',
        'StandardTabularSections', 'DistributedInfoBase', 'ThisNodeBelongsToExchangePlan',
        'SendData', 'ReceiveData', 'SequentialDataExchange',
      ]);
    });

    test('ChartOfCharacteristicTypes -> CATALOG + CharacteristicExtValues/Type (mergePropertyKeys)', () => {
      const result = getRootPropertyKeyOrder('ChartOfCharacteristicTypes');
      assert.deepStrictEqual(result.slice(-2), ['CharacteristicExtValues', 'Type']);
      assert.deepStrictEqual(result.slice(0, -2), getRootPropertyKeyOrder('Catalog'));
    });

    test('ChartOfAccounts -> CATALOG + доп. поля плана счетов (mergePropertyKeys)', () => {
      const result = getRootPropertyKeyOrder('ChartOfAccounts');
      assert.deepStrictEqual(result.slice(-5), [
        'ExtDimensionTypes', 'MaxExtDimensionCount', 'CodeMask', 'AutoOrderByCode', 'OrderLength',
      ]);
      assert.deepStrictEqual(result.slice(0, -5), getRootPropertyKeyOrder('Catalog'));
    });

    test('ChartOfCalculationTypes -> CATALOG + доп. поля видов расчёта (mergePropertyKeys)', () => {
      const result = getRootPropertyKeyOrder('ChartOfCalculationTypes');
      assert.deepStrictEqual(result.slice(-3), [
        'DependenceOnCalculationTypes', 'BaseCalculationTypes', 'ActionPeriodUse',
      ]);
      assert.deepStrictEqual(result.slice(0, -3), getRootPropertyKeyOrder('Catalog'));
    });

    test('DocumentJournal -> контракт журнала документов', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('DocumentJournal'), [
        'Name', 'Synonym', 'Comment', 'DefaultForm', 'AuxiliaryForm', 'UseStandardCommands',
        'RegisteredDocuments', 'IncludeHelpInContents', 'ListPresentation',
        'ExtendedListPresentation', 'Explanation',
      ]);
    });

    test('ScheduledJob -> контракт регламентного задания', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('ScheduledJob'), [
        'Name', 'Synonym', 'Comment', 'MethodName', 'Description', 'Key', 'Use', 'Predefined',
        'RestartCountOnFailure', 'RestartIntervalOnFailure',
      ]);
    });

    test('FilterCriterion -> контракт критерия отбора', () => {
      assert.deepStrictEqual(getRootPropertyKeyOrder('FilterCriterion'), [
        'Name', 'Synonym', 'Comment', 'Type', 'UseStandardCommands', 'Content', 'DefaultForm',
        'AuxiliaryForm', 'ListPresentation', 'ExtendedListPresentation', 'Explanation',
      ]);
    });
  });

  suite('buildRootMetaObjectProperties — снапшот на реальных фикстурах example/2.20/src/cf', () => {
    // Enum взят полностью (маленький, компактный объект) — deep-equal всего массива
    // защищает и от потери ключей, и от изменения структуры/значений value.
    test('Enums/PushУведомления.xml -> полный снапшот свойств', () => {
      const xmlPath = path.join(EXAMPLE_CF, 'Enums', 'PushУведомления.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const props = buildRootMetaObjectProperties(xml, 'Enum');

      assert.deepStrictEqual(props, [
        { key: 'Name', title: 'Имя', kind: 'string', value: 'PushУведомления', readonly: false, source: 'local' },
        {
          key: 'Synonym', title: 'Синоним', kind: 'localizedString',
          value: { presentation: 'Push уведомления', values: [{ lang: 'ru', content: 'Push уведомления' }] },
          source: 'local',
        },
        { key: 'Comment', title: 'Комментарий', kind: 'localizedString', value: { presentation: '', values: [] }, source: 'local' },
        { key: 'ObjectBelonging', title: 'Владение объектом', kind: 'string', value: '', readonly: true, source: 'local' },
        { key: 'ExtendedConfigurationObject', title: 'Расширенный объект конфигурации', kind: 'string', value: '', readonly: true, source: 'local' },
        { key: 'UseStandardCommands', title: 'Использовать стандартные команды', kind: 'boolean', value: false, source: 'local' },
        { key: 'QuickChoice', title: 'Быстрый выбор', kind: 'boolean', value: true, source: 'local' },
        {
          key: 'ChoiceMode', title: 'Режим выбора', kind: 'enum',
          value: {
            current: 'BothWays', currentLabel: 'Обоими способами',
            allowedValues: [
              { value: 'FromForm', label: 'Из формы' },
              { value: 'QuickChoice', label: 'Быстрый выбор' },
              { value: 'BothWays', label: 'Обоими способами' },
            ],
          },
          source: 'local',
        },
        { key: 'DefaultListForm', title: 'Основная форма списка', kind: 'string', value: '', readonly: false, source: 'local' },
        { key: 'DefaultChoiceForm', title: 'Основная форма выбора', kind: 'string', value: '', readonly: false, source: 'local' },
        { key: 'AuxiliaryListForm', title: 'Дополнительная форма списка', kind: 'string', value: '', readonly: false, source: 'local' },
        { key: 'AuxiliaryChoiceForm', title: 'Дополнительная форма выбора', kind: 'string', value: '', readonly: false, source: 'local' },
        { key: 'ListPresentation', title: 'Представление списка', kind: 'localizedString', value: { presentation: '', values: [] }, source: 'local' },
        { key: 'ExtendedListPresentation', title: 'Расширенное представление списка', kind: 'localizedString', value: { presentation: '', values: [] }, source: 'local' },
        { key: 'Explanation', title: 'Пояснение', kind: 'localizedString', value: { presentation: '', values: [] }, source: 'local' },
        {
          key: 'ChoiceHistoryOnInput', title: 'История выбора при вводе', kind: 'enum',
          value: {
            current: 'Auto', currentLabel: 'Автоматически',
            allowedValues: [
              { value: 'Auto', label: 'Автоматически' },
              { value: 'DontUse', label: 'Не использовать' },
            ],
          },
          source: 'local',
        },
        { key: 'Characteristics', title: 'Характеристики', kind: 'string', value: '', readonly: false, source: 'local' },
      ]);
    });

    // Для Catalog/Document/InformationRegister (крупные объекты с полными
    // разделами и наследуемыми свойствами) фиксируем "широкий" снапшот —
    // порядок ключей + kind + section — ловит перестановку/потерю ключа и смену
    // раздела при переносе CATALOG_PROPERTY_SECTIONS/DOCUMENT_PROPERTY_SECTIONS,
    // не раздувая тест целиком до полного JSON каждого объекта.
    test('Catalogs/Банки.xml -> снапшот ключей/kind/раздела', () => {
      const xmlPath = path.join(EXAMPLE_CF, 'Catalogs', 'Банки.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const props = buildRootMetaObjectProperties(xml, 'Catalog');
      const shallow = props.map((item) => ({ key: item.key, kind: item.kind, section: item.section ?? null }));

      assert.deepStrictEqual(shallow, [
        { key: 'Name', kind: 'string', section: 'Основные' },
        { key: 'Synonym', kind: 'localizedString', section: 'Основные' },
        { key: 'Comment', kind: 'localizedString', section: 'Основные' },
        { key: 'ObjectPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'ExtendedObjectPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'ListPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'ExtendedListPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'Explanation', kind: 'localizedString', section: 'Основные' },
        { key: 'ObjectBelonging', kind: 'string', section: 'Служебное' },
        { key: 'ExtendedConfigurationObject', kind: 'string', section: 'Служебное' },
        { key: 'Hierarchical', kind: 'boolean', section: 'Иерархия' },
        { key: 'HierarchyType', kind: 'enum', section: 'Иерархия' },
        { key: 'FoldersOnTop', kind: 'boolean', section: 'Иерархия' },
        { key: 'LimitLevelCount', kind: 'boolean', section: 'Иерархия' },
        { key: 'LevelCount', kind: 'string', section: 'Иерархия' },
        { key: 'Owners', kind: 'metadataReferenceList', section: 'Владельцы' },
        { key: 'SubordinationUse', kind: 'enum', section: 'Владельцы' },
        { key: 'CodeLength', kind: 'string', section: 'Данные' },
        { key: 'DescriptionLength', kind: 'string', section: 'Данные' },
        { key: 'CodeType', kind: 'enum', section: 'Данные' },
        { key: 'CodeAllowedLength', kind: 'enum', section: 'Данные' },
        { key: 'CodeSeries', kind: 'enum', section: 'Нумерация' },
        { key: 'CheckUnique', kind: 'boolean', section: 'Нумерация' },
        { key: 'Autonumbering', kind: 'boolean', section: 'Нумерация' },
        { key: 'DefaultPresentation', kind: 'enum', section: 'Данные' },
        { key: 'DefaultObjectForm', kind: 'string', section: 'Формы' },
        { key: 'DefaultFolderForm', kind: 'string', section: 'Формы' },
        { key: 'DefaultListForm', kind: 'string', section: 'Формы' },
        { key: 'DefaultChoiceForm', kind: 'string', section: 'Формы' },
        { key: 'DefaultFolderChoiceForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryObjectForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryFolderForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryListForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryChoiceForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryFolderChoiceForm', kind: 'string', section: 'Формы' },
        { key: 'QuickChoice', kind: 'boolean', section: 'Поле ввода' },
        { key: 'CreateOnInput', kind: 'enum', section: 'Поле ввода' },
        { key: 'InputByString', kind: 'metadataReferenceList', section: 'Поле ввода' },
        { key: 'SearchStringModeOnInputByString', kind: 'enum', section: 'Поле ввода' },
        { key: 'FullTextSearchOnInputByString', kind: 'enum', section: 'Поле ввода' },
        { key: 'ChoiceDataGetModeOnInputByString', kind: 'enum', section: 'Поле ввода' },
        { key: 'ChoiceHistoryOnInput', kind: 'enum', section: 'Поле ввода' },
        { key: 'UseStandardCommands', kind: 'boolean', section: 'Команды' },
        { key: 'BasedOn', kind: 'metadataReferenceList', section: 'Ввод на основании' },
        { key: 'DataLockFields', kind: 'metadataReferenceList', section: 'Прочее' },
        { key: 'DataLockControlMode', kind: 'enum', section: 'Служебное' },
        { key: 'FullTextSearch', kind: 'enum', section: 'Прочее' },
        { key: 'DataHistory', kind: 'enum', section: 'Прочее' },
        { key: 'UpdateDataHistoryImmediatelyAfterWrite', kind: 'boolean', section: 'Прочее' },
        { key: 'ExecuteAfterWriteDataHistoryVersionProcessing', kind: 'boolean', section: 'Прочее' },
        { key: 'PredefinedDataUpdate', kind: 'enum', section: 'Прочее' },
        { key: 'EditType', kind: 'enum', section: 'Данные' },
        { key: 'IncludeHelpInContents', kind: 'boolean', section: 'Прочее' },
        { key: 'StandardAttributes', kind: 'string', section: 'Прочее' },
        { key: 'ChoiceMode', kind: 'enum', section: 'Прочее' },
      ]);

      // Точечная deep-проверка одного enum-свойства со сложным значением —
      // защищает от изменения структуры EnumPropertyValue при переносе экстракторов.
      const codeType = props.find((item) => item.key === 'CodeType');
      assert.ok(codeType);
      assert.deepStrictEqual(codeType.value, {
        current: 'String',
        currentLabel: 'Строка',
        allowedValues: [
          { value: 'String', label: 'Строка' },
          { value: 'Number', label: 'Число' },
        ],
      } satisfies EnumPropertyValue);
    });

    test('Documents/Заказ.xml -> снапшот ключей/kind/раздела', () => {
      const xmlPath = path.join(EXAMPLE_CF, 'Documents', 'Заказ.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const props = buildRootMetaObjectProperties(xml, 'Document');
      const shallow = props.map((item) => ({ key: item.key, kind: item.kind, section: item.section ?? null }));

      assert.deepStrictEqual(shallow, [
        { key: 'Name', kind: 'string', section: 'Основные' },
        { key: 'Synonym', kind: 'localizedString', section: 'Основные' },
        { key: 'Comment', kind: 'localizedString', section: 'Основные' },
        { key: 'ObjectPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'ExtendedObjectPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'ListPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'ExtendedListPresentation', kind: 'localizedString', section: 'Основные' },
        { key: 'Explanation', kind: 'localizedString', section: 'Основные' },
        { key: 'ObjectBelonging', kind: 'string', section: 'Служебное' },
        { key: 'ExtendedConfigurationObject', kind: 'string', section: 'Служебное' },
        { key: 'Numerator', kind: 'string', section: 'Нумерация' },
        { key: 'NumberType', kind: 'enum', section: 'Нумерация' },
        { key: 'NumberLength', kind: 'string', section: 'Нумерация' },
        { key: 'NumberAllowedLength', kind: 'enum', section: 'Нумерация' },
        { key: 'NumberPeriodicity', kind: 'enum', section: 'Нумерация' },
        { key: 'CheckUnique', kind: 'boolean', section: 'Нумерация' },
        { key: 'Autonumbering', kind: 'boolean', section: 'Нумерация' },
        { key: 'DefaultObjectForm', kind: 'string', section: 'Формы' },
        { key: 'DefaultListForm', kind: 'string', section: 'Формы' },
        { key: 'DefaultChoiceForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryObjectForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryListForm', kind: 'string', section: 'Формы' },
        { key: 'AuxiliaryChoiceForm', kind: 'string', section: 'Формы' },
        { key: 'CreateOnInput', kind: 'enum', section: 'Поле ввода' },
        { key: 'InputByString', kind: 'metadataReferenceList', section: 'Поле ввода' },
        { key: 'SearchStringModeOnInputByString', kind: 'enum', section: 'Поле ввода' },
        { key: 'FullTextSearchOnInputByString', kind: 'enum', section: 'Поле ввода' },
        { key: 'ChoiceDataGetModeOnInputByString', kind: 'enum', section: 'Поле ввода' },
        { key: 'ChoiceHistoryOnInput', kind: 'enum', section: 'Поле ввода' },
        { key: 'UseStandardCommands', kind: 'boolean', section: 'Команды' },
        { key: 'BasedOn', kind: 'metadataReferenceList', section: 'Ввод на основании' },
        { key: 'Posting', kind: 'enum', section: 'Проведение' },
        { key: 'RealTimePosting', kind: 'enum', section: 'Проведение' },
        { key: 'RegisterRecordsDeletion', kind: 'enum', section: 'Проведение' },
        { key: 'RegisterRecordsWritingOnPost', kind: 'enum', section: 'Проведение' },
        { key: 'SequenceFilling', kind: 'enum', section: 'Проведение' },
        { key: 'RegisterRecords', kind: 'string', section: 'Проведение' },
        { key: 'PostInPrivilegedMode', kind: 'boolean', section: 'Проведение' },
        { key: 'UnpostInPrivilegedMode', kind: 'boolean', section: 'Проведение' },
        { key: 'DataLockFields', kind: 'metadataReferenceList', section: 'Прочее' },
        { key: 'DataLockControlMode', kind: 'enum', section: 'Служебное' },
        { key: 'FullTextSearch', kind: 'enum', section: 'Прочее' },
        { key: 'DataHistory', kind: 'enum', section: 'Прочее' },
        { key: 'UpdateDataHistoryImmediatelyAfterWrite', kind: 'boolean', section: 'Прочее' },
        { key: 'ExecuteAfterWriteDataHistoryVersionProcessing', kind: 'boolean', section: 'Прочее' },
        { key: 'IncludeHelpInContents', kind: 'boolean', section: 'Прочее' },
        { key: 'StandardAttributes', kind: 'string', section: 'Прочее' },
      ]);
    });

    test('InformationRegisters/КурсыВалют.xml -> снапшот ключей/kind (без секций — регистр их не назначает)', () => {
      const xmlPath = path.join(EXAMPLE_CF, 'InformationRegisters', 'КурсыВалют.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const props = buildRootMetaObjectProperties(xml, 'InformationRegister');
      const shallow = props.map((item) => ({ key: item.key, kind: item.kind, section: item.section ?? null }));

      assert.deepStrictEqual(shallow, [
        { key: 'Name', kind: 'string', section: null },
        { key: 'Synonym', kind: 'localizedString', section: null },
        { key: 'Comment', kind: 'localizedString', section: null },
        { key: 'UseStandardCommands', kind: 'boolean', section: null },
        { key: 'EditType', kind: 'enum', section: null },
        { key: 'DefaultRecordForm', kind: 'string', section: null },
        { key: 'DefaultListForm', kind: 'string', section: null },
        { key: 'AuxiliaryRecordForm', kind: 'string', section: null },
        { key: 'AuxiliaryListForm', kind: 'string', section: null },
        { key: 'InformationRegisterPeriodicity', kind: 'enum', section: null },
        { key: 'WriteMode', kind: 'enum', section: null },
        { key: 'MainFilterOnPeriod', kind: 'boolean', section: null },
        { key: 'IncludeHelpInContents', kind: 'boolean', section: null },
        { key: 'DataLockControlMode', kind: 'enum', section: null },
        { key: 'FullTextSearch', kind: 'enum', section: null },
        { key: 'EnableTotalsSliceFirst', kind: 'boolean', section: null },
        { key: 'EnableTotalsSliceLast', kind: 'boolean', section: null },
        { key: 'RecordPresentation', kind: 'string', section: null },
        { key: 'ExtendedRecordPresentation', kind: 'string', section: null },
        { key: 'ListPresentation', kind: 'localizedString', section: null },
        { key: 'ExtendedListPresentation', kind: 'localizedString', section: null },
        { key: 'Explanation', kind: 'localizedString', section: null },
        { key: 'DataHistory', kind: 'enum', section: null },
        { key: 'UpdateDataHistoryImmediatelyAfterWrite', kind: 'boolean', section: null },
        { key: 'ExecuteAfterWriteDataHistoryVersionProcessing', kind: 'boolean', section: null },
        { key: 'StandardAttributes', kind: 'string', section: null },
      ]);
    });
  });

  suite('Экстракторы — точечная страховка перед переносом в propertyExtractors.ts', () => {
    test('extractRootObjectPropertiesInnerXml достаёт внутренность блока Properties корневого тега', () => {
      const xmlPath = path.join(EXAMPLE_CF, 'Enums', 'PushУведомления.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const inner = extractRootObjectPropertiesInnerXml(xml);

      assert.ok(inner, 'внутренность блока Properties должна быть найдена');
      assert.ok(inner.includes('<Name>PushУведомления</Name>'));
      assert.ok(inner.includes('<QuickChoice>true</QuickChoice>'));
      // Внешний тег Properties не должен входить во внутренность
      assert.ok(!inner.includes('<Properties>'));
    });

    test('extractRootObjectPropertiesInnerXml возвращает null для XML без блока Properties', () => {
      assert.strictEqual(extractRootObjectPropertiesInnerXml('<MetaDataObject></MetaDataObject>'), null);
    });

    test('extractLocalizedStringValue разбирает заполненную локализованную строку', () => {
      const xmlPath = path.join(EXAMPLE_CF, 'Enums', 'PushУведомления.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const inner = extractRootObjectPropertiesInnerXml(xml);
      assert.ok(inner);

      const synonym = extractLocalizedStringValue(inner, 'Synonym');
      assert.deepStrictEqual(synonym, {
        presentation: 'Push уведомления',
        values: [{ lang: 'ru', content: 'Push уведомления' }],
      });
    });

    test('extractLocalizedStringValue возвращает пустое значение для self-closing и отсутствующего тега', () => {
      const emptyResult = { presentation: '', values: [] };
      assert.deepStrictEqual(extractLocalizedStringValue('<Comment/>', 'Comment'), emptyResult);
      assert.deepStrictEqual(extractLocalizedStringValue('<Comment/>', 'NoSuchTag'), emptyResult);
    });

    test('summarizeTypeBlock/propertyTitle (через buildTypedFieldProperties): тип-зависимый контракт реквизита строкового типа', () => {
      // Реальный Attribute типа "Строка" из example/2.20/src/cf/Catalogs/Валюты.xml.
      // Косвенно проверяет summarizeTypeBlock (извлечение <Type>) и propertyTitle
      // (русские заголовки Name/Synonym/Type), от которых зависит порядок и
      // заголовки полей типизированного реквизита.
      const xmlPath = path.join(EXAMPLE_CF, 'Catalogs', 'Валюты.xml');
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      const match = /<Attribute uuid="4c8eec52-70df-4488-9517-8476b2d75189">[\s\S]*?<\/Attribute>/.exec(xml);
      assert.ok(match, 'фикстура должна содержать реквизит НаименованиеОсновнойВалюты');

      const props = buildTypedFieldProperties(match[0]);
      const keys = props.map((item) => item.key);

      assert.deepStrictEqual(keys, [
        'Name', 'Synonym', 'Comment', 'Type', 'PasswordMode', 'Format', 'EditFormat', 'ToolTip',
        'Mask', 'MultiLine', 'ExtendedEdit', 'FillFromFillingValue', 'FillValue', 'FillChecking',
        'ChoiceFoldersAndItems', 'QuickChoice', 'CreateOnInput', 'ChoiceHistoryOnInput',
        'Indexing', 'FullTextSearch', 'DataHistory', 'Use',
      ]);

      const name = props.find((item) => item.key === 'Name');
      assert.ok(name);
      assert.strictEqual(name.title, 'Имя');
      assert.strictEqual(name.value, 'НаименованиеОсновнойВалюты');

      const type = props.find((item) => item.key === 'Type');
      assert.ok(type);
      assert.strictEqual(type.title, 'Тип');
      const typeValue = type.value as MetadataTypeValue;
      assert.strictEqual(typeValue.items.length, 1);
      assert.strictEqual(typeValue.items[0].canonical, 'String');
      assert.strictEqual(typeValue.presentation, 'Строка');
      assert.deepStrictEqual(typeValue.stringQualifiers, { length: 0, allowedLength: 'Variable' });
    });
  });
});
