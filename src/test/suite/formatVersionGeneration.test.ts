import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MetaKind } from '../../domain/MetaTypes';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { BASELINE_RULESET } from '../../infra/xml/format/baselineRuleset';
import { FORMAT_2_20_RULESET } from '../../infra/xml/format/format2_20Ruleset';
import {
  DEFAULT_FORMAT_VERSION,
  registerFormatRuleset,
  resolveFormatRuleset,
  setFormatRulesetWarning,
} from '../../infra/xml/format/formatRegistry';

const EXAMPLE_2_20_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

// Виды → папка выгрузки. Покрывает все затронутые ветки генерации.
const KIND_FOLDER: Partial<Record<MetaKind, string>> = {
  Catalog: 'Catalogs', Document: 'Documents', DocumentJournal: 'DocumentJournals', Enum: 'Enums',
  InformationRegister: 'InformationRegisters', AccumulationRegister: 'AccumulationRegisters',
  AccountingRegister: 'AccountingRegisters', CalculationRegister: 'CalculationRegisters',
  ChartOfAccounts: 'ChartsOfAccounts', ChartOfCharacteristicTypes: 'ChartsOfCharacteristicTypes',
  ChartOfCalculationTypes: 'ChartsOfCalculationTypes', BusinessProcess: 'BusinessProcesses',
  Task: 'Tasks', ExchangePlan: 'ExchangePlans', Report: 'Reports', DataProcessor: 'DataProcessors',
  Constant: 'Constants', CommonModule: 'CommonModules', CommonCommand: 'CommonCommands',
  CommonTemplate: 'CommonTemplates', Subsystem: 'Subsystems', DefinedType: 'DefinedTypes',
  SessionParameter: 'SessionParameters', ScheduledJob: 'ScheduledJobs', FunctionalOption: 'FunctionalOptions',
  FunctionalOptionsParameter: 'FunctionalOptionsParameters', HTTPService: 'HTTPServices',
  WebService: 'WebServices', Role: 'Roles', EventSubscription: 'EventSubscriptions',
  FilterCriterion: 'FilterCriteria', CommandGroup: 'CommandGroups', XDTOPackage: 'XDTOPackages',
  Language: 'Languages', SettingsStorage: 'SettingsStorages', StyleItem: 'StyleItems',
  CommonPicture: 'CommonPictures', Bot: 'Bots', CommonForm: 'CommonForms', CommonAttribute: 'CommonAttributes',
};

function configXml(version: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<MetaDataObject version="${version}">\n\t<Configuration>\n\t\t<Properties>\n\t\t\t<Name>Тест</Name>\n\t\t\t<Synonym/>\n\t\t</Properties>\n\t\t<ChildObjects/>\n\t</Configuration>\n</MetaDataObject>`;
}

function generate(kind: MetaKind, version: string): { xml: string; xmlPath: string } {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-fmt-'));
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), configXml(version), 'utf-8');
  const result = new MetadataXmlCreator().addRootObject({
    configRoot,
    kind,
    name: 'Тест',
    templateType: kind === 'CommonTemplate' ? 'SpreadsheetDocument' : undefined,
  });
  assert.strictEqual(result.success, true, `генерация ${kind}@${version}: ${result.errors.join('; ')}`);
  const xmlPath = path.join(configRoot, KIND_FOLDER[kind] ?? "", 'Тест.xml');
  return { xml: fs.readFileSync(xmlPath, 'utf-8'), xmlPath };
}

// Прямые дети первого (корневого) <Properties>: имена тегов по порядку.
function rootPropertyTags(xml: string): string[] {
  const match = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml);
  if (!match) {
    return [];
  }
  const tags: string[] = [];
  let depth = 0;
  const tokenRe = /<(\/?)([A-Za-z][\w:.]*)[^>]*?(\/?)>/g;
  let token: RegExpExecArray | null;
  while ((token = tokenRe.exec(match[1])) !== null) {
    const closing = token[1] === '/';
    const selfClose = token[3] === '/';
    if (depth === 0 && !closing) {
      tags.push(token[2]);
    }
    if (closing) {
      depth -= 1;
    } else if (!selfClose) {
      depth += 1;
    }
  }
  return tags;
}

function referenceRootTags(folder: string, sample: string): string[] {
  return rootPropertyTags(fs.readFileSync(path.join(EXAMPLE_2_20_CF, folder, sample), 'utf-8'));
}

// Виды с корневым блоком StandardAttributes у свежего объекта.
const SA_KINDS: MetaKind[] = [
  'Catalog', 'Document', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister',
  'ChartOfAccounts', 'ChartOfCharacteristicTypes', 'ChartOfCalculationTypes', 'BusinessProcess',
  'Task', 'ExchangePlan',
];

suite('formatRegistry — резолвинг ruleset по версии', () => {
  test('2.20 → ruleset format-2.20, 2.21/2.18 → baseline', () => {
    assert.strictEqual(resolveFormatRuleset('2.20').id, FORMAT_2_20_RULESET.id);
    assert.strictEqual(resolveFormatRuleset('2.21').id, BASELINE_RULESET.id);
    assert.strictEqual(resolveFormatRuleset(DEFAULT_FORMAT_VERSION).id, BASELINE_RULESET.id);
  });

  test('незнакомая версия → самый свежий известный ruleset + предупреждение', () => {
    const warnings: string[] = [];
    setFormatRulesetWarning((message) => warnings.push(message));
    try {
      const ruleset = resolveFormatRuleset('9.99');
      assert.strictEqual(ruleset.id, BASELINE_RULESET.id, 'baseline привязан к максимальной версии 2.21');
      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes('9.99'));
    } finally {
      setFormatRulesetWarning(() => undefined);
    }
  });

  test('registerFormatRuleset привязывает новую версию к ruleset', () => {
    registerFormatRuleset(FORMAT_2_20_RULESET, ['2.20-test']);
    assert.strictEqual(resolveFormatRuleset('2.20-test').id, FORMAT_2_20_RULESET.id);
  });
});

suite('format2_20Ruleset — дельта от baseline', () => {
  test('namespace без xmlns:pal (в baseline есть)', () => {
    assert.ok(BASELINE_RULESET.metaDataObjectXmlns.includes('xmlns:pal='));
    assert.ok(!FORMAT_2_20_RULESET.metaDataObjectXmlns.includes('xmlns:pal='));
  });

  test('AuxiliaryVariantForm отключён (в baseline включён)', () => {
    assert.strictEqual(BASELINE_RULESET.includeReportAuxiliaryVariantForm, true);
    assert.strictEqual(FORMAT_2_20_RULESET.includeReportAuxiliaryVariantForm, false);
  });

  test('standardAttributes: блок для вида с SA и пустая строка для вида без SA', () => {
    assert.ok(FORMAT_2_20_RULESET.standardAttributes('Catalog').includes('<StandardAttributes>'));
    assert.strictEqual(FORMAT_2_20_RULESET.standardAttributes('Enum'), '');
    assert.strictEqual(BASELINE_RULESET.standardAttributes('Enum'), '');
  });

  test('standardTabularSections: только план счетов', () => {
    assert.ok(FORMAT_2_20_RULESET.standardTabularSections('ChartOfAccounts').includes('<StandardTabularSections>'));
    assert.strictEqual(FORMAT_2_20_RULESET.standardTabularSections('Catalog'), '');
    assert.strictEqual(BASELINE_RULESET.standardTabularSections('Catalog'), '');
  });
});

suite('Генерация объектов по версии формата', () => {
  test('2.20: нет xmlns:pal, version="2.20"; 2.21: pal есть', () => {
    const cat20 = generate('Catalog', '2.20').xml;
    const cat21 = generate('Catalog', '2.21').xml;
    assert.ok(cat20.includes('version="2.20"'));
    assert.ok(!cat20.includes('xmlns:pal='));
    assert.ok(cat21.includes('version="2.21"'));
    assert.ok(cat21.includes('xmlns:pal='));
  });

  test('Report: AuxiliaryVariantForm только в 2.21', () => {
    assert.ok(!generate('Report', '2.20').xml.includes('<AuxiliaryVariantForm/>'));
    assert.ok(generate('Report', '2.21').xml.includes('<AuxiliaryVariantForm/>'));
  });

  test('StandardAttributes выпускается для нужных видов в обеих версиях', () => {
    for (const version of ['2.20', '2.21']) {
      for (const kind of SA_KINDS) {
        assert.ok(
          generate(kind, version).xml.includes('<StandardAttributes>'),
          `${kind}@${version} должен содержать StandardAttributes`
        );
      }
    }
  });

  test('InformationRegister (независимый непериодический) — без StandardAttributes', () => {
    assert.ok(!generate('InformationRegister', '2.20').xml.includes('<StandardAttributes>'));
    assert.ok(!generate('InformationRegister', '2.21').xml.includes('<StandardAttributes>'));
  });

  test('Enum и простые виды — без StandardAttributes', () => {
    assert.ok(!generate('Enum', '2.20').xml.includes('<StandardAttributes>'));
    assert.ok(!generate('DocumentJournal', '2.20').xml.includes('<StandardAttributes>'));
  });

  test('ChartOfAccounts содержит StandardTabularSections (ExtDimensionTypes)', () => {
    const xml = generate('ChartOfAccounts', '2.20').xml;
    assert.ok(xml.includes('<StandardTabularSections>'));
    assert.ok(xml.includes('name="ExtDimensionTypes"'));
  });

  test('CalculationRegister: полный набор свойств (были пропущены)', () => {
    const xml = generate('CalculationRegister', '2.20').xml;
    for (const tag of ['<Periodicity>Month</Periodicity>', '<ActionPeriod>false</ActionPeriod>', '<ChartOfCalculationTypes/>', '<DataLockControlMode>Automatic</DataLockControlMode>']) {
      assert.ok(xml.includes(tag), `CalculationRegister должен содержать ${tag}`);
    }
    assert.ok(xml.includes('<StandardAttributes>'));
  });

  test('FunctionalOptionsParameter содержит <Use/>', () => {
    assert.ok(generate('FunctionalOptionsParameter', '2.20').xml.includes('<Use/>'));
  });

  test('Виды из бывшей default-ветки получают свои свойства', () => {
    const cases: [MetaKind, string][] = [
      ['EventSubscription', '<Handler/>'],
      ['FilterCriterion', '<Type/>'],
      ['CommandGroup', '<Representation>Auto</Representation>'],
      ['SettingsStorage', '<DefaultSaveForm/>'],
      ['StyleItem', '<Type>Color</Type>'],
      ['CommonPicture', '<AvailabilityForChoice>false</AvailabilityForChoice>'],
      ['Bot', '<Predefined>false</Predefined>'],
      ['Language', '<LanguageCode/>'],
    ];
    for (const [kind, tag] of cases) {
      assert.ok(generate(kind, '2.20').xml.includes(tag), `${kind} должен содержать ${tag}`);
    }
  });

  test('InternalInfo: Characteristic.<Имя>, а не ChartOfCharacteristicTypesCharacteristic', () => {
    const xml = generate('ChartOfCharacteristicTypes', '2.20').xml;
    assert.ok(xml.includes('name="Characteristic.Тест"'));
    assert.ok(!xml.includes('ChartOfCharacteristicTypesCharacteristic'));
  });

  test('FilterCriterion/SettingsStorage: InternalInfo и пустой ChildObjects', () => {
    const fc = generate('FilterCriterion', '2.20').xml;
    assert.ok(fc.includes('FilterCriterionManager.Тест') && fc.includes('FilterCriterionList.Тест'));
    assert.ok(fc.includes('<ChildObjects/>'));
    const ss = generate('SettingsStorage', '2.20').xml;
    assert.ok(ss.includes('SettingsStorageManager.Тест'));
    assert.ok(ss.includes('<ChildObjects/>'));
  });

  test('Все виды парсятся ObjectXmlReader (well-formed) в обеих версиях', () => {
    const reader = new ObjectXmlReader();
    for (const version of ['2.20', '2.21']) {
      for (const kind of Object.keys(KIND_FOLDER) as MetaKind[]) {
        const { xmlPath } = generate(kind, version);
        const parsed = reader.read(xmlPath);
        assert.ok(parsed, `${kind}@${version} не прочитан ObjectXmlReader`);
        assert.strictEqual(parsed.name, 'Тест');
      }
    }
  });
});

suite('Golden: порядок свойств совпадает с эталоном 2.20', () => {
  const goldenCases: [MetaKind, string][] = [
    ['Catalog', 'Регионы.xml'],
    ['Document', 'Заказ.xml'],
    ['AccumulationRegister', 'Взаиморасчеты.xml'],
    ['AccountingRegister', 'Хозрасчетный.xml'],
    ['CalculationRegister', 'Начисления.xml'],
    ['ChartOfAccounts', 'Хозрасчетный.xml'],
    ['ChartOfCharacteristicTypes', 'ВидыСубконтоХозрасчетные.xml'],
    ['ChartOfCalculationTypes', 'ОсновныеНачисления.xml'],
    ['BusinessProcess', 'Поручение.xml'],
    ['Task', 'ЗадачаИсполнителя.xml'],
    ['ExchangePlan', 'Мобильные.xml'],
    ['EventSubscription', 'ПриЗаписиКонтрагента.xml'],
    ['FilterCriterion', 'ДокументыКонтрагента.xml'],
    ['CommandGroup', 'Информация.xml'],
    ['SettingsStorage', 'ХранилищеВариантовОтчетов.xml'],
    ['Bot', 'ОфисМенеджер.xml'],
    ['Language', 'Русский.xml'],
  ];

  for (const [kind, sample] of goldenCases) {
    test(`${kind}: теги <Properties> совпадают с эталоном`, () => {
      const folder = KIND_FOLDER[kind] ?? '';
      const generated = rootPropertyTags(generate(kind, '2.20').xml);
      const reference = referenceRootTags(folder, sample);
      assert.deepStrictEqual(generated, reference);
    });
  }
});
