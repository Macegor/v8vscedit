import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationXmlEditor, SubsystemToolsService, SubsystemXmlService } from '../../infra/xml';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { McpPropertyService } from '../../ui/mcp/McpPropertyService';

suite('McpPropertyService', () => {
  test('возвращает enum-контракт конкретного свойства конкретного реквизита', () => {
    const xmlPath = path.resolve(__dirname, '../../../example/2.20/src/cf/Catalogs/Пользователи.xml');
    const node = createAttributeNode(xmlPath);
    const service = new McpPropertyService(new ConfigurationXmlEditor());

    const contract = service.getPropertyContract(node, 'FillChecking');

    assert.strictEqual(contract.propertyKey, 'FillChecking');
    assert.strictEqual(contract.kind, 'enum');
    assert.strictEqual(contract.supportedBySetProperty, true);
    assert.deepStrictEqual(
      contract.allowedValues?.map((item) => item.value),
      ['DontCheck', 'ShowError', 'ShowWarning']
    );
  });

  test('возвращает и записывает ключевые свойства регламентного задания после штатного создания', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-scheduled-job-'));
    try {
      fs.writeFileSync(path.join(root, 'Configuration.xml'), buildConfigXml(), 'utf-8');
      const creator = new MetadataXmlCreator();
      const created = creator.addRootObject({
        configRoot: root,
        kind: 'ScheduledJob',
        name: 'ев_ТестовоеРегламентноеЗадание',
      });
      assert.strictEqual(created.success, true);

      const xmlPath = path.join(root, 'ScheduledJobs', 'ев_ТестовоеРегламентноеЗадание.xml');
      const node = createScheduledJobNode(xmlPath);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const contracts = service.getPropertyContracts(node);
      const byKey = new Map(contracts.map((item) => [item.propertyKey, item]));

      assert.strictEqual(byKey.get('MethodName')?.kind, 'string');
      assert.strictEqual(byKey.get('MethodName')?.currentValue, '');
      assert.strictEqual(byKey.get('Use')?.kind, 'boolean');
      assert.strictEqual(byKey.get('Use')?.currentValue, false);
      assert.strictEqual(byKey.get('Predefined')?.kind, 'boolean');
      assert.strictEqual(byKey.get('Predefined')?.currentValue, false);

      assert.strictEqual(
        service.setProperty(node, 'MethodName', 'ОбщийМодуль.ев_ТестовыйМодуль.ТестоваяПроцедура').success,
        true
      );
      assert.strictEqual(service.setProperty(node, 'Use', true).success, true);
      assert.strictEqual(service.setProperty(node, 'Predefined', true).success, true);

      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<MethodName>CommonModule.ев_ТестовыйМодуль.ТестоваяПроцедура</MethodName>'));
      assert.ok(saved.includes('<Use>true</Use>'));
      assert.ok(saved.includes('<Predefined>true</Predefined>'));

      assert.strictEqual(
        service.setProperty(node, 'MethodName', 'ев_ТестовыйМодуль.ВыполнитьТестовуюОбработку').success,
        true
      );
      const savedShortMethodName = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(savedShortMethodName.includes('<MethodName>CommonModule.ев_ТестовыйМодуль.ВыполнитьТестовуюОбработку</MethodName>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('возвращает базовые свойства для корневых объектов после штатного создания', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-root-props-'));
    try {
      fs.writeFileSync(path.join(root, 'Configuration.xml'), buildConfigXml(), 'utf-8');
      const creator = new MetadataXmlCreator();
      const service = new McpPropertyService(new ConfigurationXmlEditor());
      const cases: { kind: Parameters<typeof createRootNode>[1]; expected: readonly string[] }[] = [
        { kind: 'DocumentNumerator', expected: ['NumberType', 'NumberLength', 'CheckUnique'] },
        { kind: 'Report', expected: ['UseStandardCommands', 'DefaultForm', 'IncludeHelpInContents'] },
        { kind: 'DataProcessor', expected: ['UseStandardCommands', 'DefaultForm', 'ExtendedPresentation'] },
        { kind: 'InformationRegister', expected: ['InformationRegisterPeriodicity', 'WriteMode', 'MainFilterOnPeriod'] },
        { kind: 'AccumulationRegister', expected: ['RegisterType', 'EnableTotalsSplitting'] },
        { kind: 'FilterCriterion', expected: ['Type', 'UseStandardCommands', 'DefaultForm'] },
        { kind: 'FunctionalOptionsParameter', expected: ['Use'] },
        { kind: 'CommonForm', expected: ['FormType', 'IncludeHelpInContents', 'UseStandardCommands'] },
        { kind: 'EventSubscription', expected: ['Source', 'Event', 'Handler'] },
        { kind: 'SessionParameter', expected: ['Type'] },
      ];

      for (const item of cases) {
        const name = `${item.kind}Тест`;
        const created = creator.addRootObject({ configRoot: root, kind: item.kind, name });
        assert.strictEqual(created.success, true, `${item.kind}: объект не создан`);
        const xmlPath = resolveCreatedRootXmlPath(root, item.kind, name);
        const node = createRootNode(xmlPath, item.kind, name);
        const keys = service.getPropertyContracts(node).map((contract) => contract.propertyKey);
        for (const key of item.expected) {
          assert.ok(keys.includes(key), `${item.kind}: не найдено свойство ${key}`);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('возвращает базовые свойства для дочерних объектов после штатного создания', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-child-props-'));
    try {
      fs.writeFileSync(path.join(root, 'Configuration.xml'), buildConfigXml(), 'utf-8');
      const creator = new MetadataXmlCreator();
      assert.strictEqual(creator.addRootObject({ configRoot: root, kind: 'Catalog', name: 'Владелец' }).success, true);
      const ownerXmlPath = path.join(root, 'Catalogs', 'Владелец.xml');
      assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXmlPath, childTag: 'Attribute', name: 'Реквизит' }).success, true);
      assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXmlPath, childTag: 'TabularSection', name: 'ТабличнаяЧасть' }).success, true);
      assert.strictEqual(creator.addChildElement({
        ownerObjectXmlPath: ownerXmlPath,
        childTag: 'Column',
        tabularSectionName: 'ТабличнаяЧасть',
        name: 'Колонка',
      }).success, true);
      assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXmlPath, childTag: 'Command', name: 'Команда' }).success, true);
      assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXmlPath, childTag: 'Form', name: 'Форма' }).success, true);
      assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXmlPath, childTag: 'Template', name: 'Макет' }).success, true);
      const service = new McpPropertyService(new ConfigurationXmlEditor());
      const cases: { node: MetadataNode; expected: readonly string[] }[] = [
        { node: createChildNode(ownerXmlPath, 'Attribute', 'Реквизит'), expected: ['Type', 'FillChecking', 'Indexing'] },
        { node: createChildNode(ownerXmlPath, 'TabularSection', 'ТабличнаяЧасть'), expected: ['FillChecking', 'LineNumberLength'] },
        { node: createChildNode(ownerXmlPath, 'Column', 'Колонка', 'ТабличнаяЧасть'), expected: ['Type', 'FillChecking', 'Indexing'] },
        { node: createChildNode(ownerXmlPath, 'Command', 'Команда'), expected: ['Group', 'CommandParameterType', 'Representation'] },
        { node: createChildNode(ownerXmlPath, 'Form', 'Форма'), expected: ['FormType', 'IncludeHelpInContents', 'UseStandardCommands'] },
        { node: createChildNode(ownerXmlPath, 'Template', 'Макет'), expected: ['TemplateType'] },
      ];

      for (const item of cases) {
        const keys = service.getPropertyContracts(item.node).map((contract) => contract.propertyKey);
        for (const key of item.expected) {
          assert.ok(keys.includes(key), `${item.node.nodeKind}: не найдено свойство ${key}`);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('возвращает и записывает свойства подсистемы через общий MCP-сервис свойств', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-subsystem-props-'));
    try {
      fs.writeFileSync(path.join(root, 'Configuration.xml'), buildConfigXml(), 'utf-8');
      const created = new SubsystemToolsService().compile({
        outputDir: root,
        definition: {
          name: 'Продажи',
          synonym: 'Продажи',
          includeInCommandInterface: true,
        },
      });
      const node = createSubsystemNode(created.subsystemPath, 'Продажи');
      const service = new McpPropertyService(new ConfigurationXmlEditor(), new SubsystemXmlService());

      const byKey = new Map(service.getPropertyContracts(node).map((item) => [item.propertyKey, item]));
      assert.strictEqual(byKey.get('Synonym')?.kind, 'localizedString');
      assert.strictEqual(byKey.get('IncludeInCommandInterface')?.kind, 'boolean');
      assert.strictEqual(byKey.get('PictureRef')?.kind, 'string');

      assert.strictEqual(service.setProperty(node, 'Синоним', 'Продажи и CRM').success, true);
      assert.strictEqual(service.setProperty(node, 'IncludeInCommandInterface', false).success, true);
      assert.strictEqual(service.setProperty(node, 'PictureRef', 'CommonPicture.ИконкаПродаж').success, true);

      const saved = fs.readFileSync(created.subsystemPath, 'utf-8');
      assert.ok(saved.includes('<v8:content>Продажи и CRM</v8:content>'));
      assert.ok(saved.includes('<IncludeInCommandInterface>false</IncludeInCommandInterface>'));
      assert.ok(saved.includes('<xr:Ref>CommonPicture.ИконкаПродаж</xr:Ref>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('точечно меняет состав подсистемы через общий сервис подсистем', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-subsystem-content-'));
    try {
      fs.writeFileSync(path.join(root, 'Configuration.xml'), buildConfigXml(), 'utf-8');
      const creator = new MetadataXmlCreator();
      assert.strictEqual(creator.addRootObject({ configRoot: root, kind: 'Catalog', name: 'Товары' }).success, true);
      assert.strictEqual(creator.addRootObject({ configRoot: root, kind: 'DataProcessor', name: 'Загрузка' }).success, true);
      const subsystem = new SubsystemToolsService().compile({
        outputDir: root,
        definition: {
          name: 'Продажи',
          content: ['Catalog.Товары'],
        },
      });
      const service = new SubsystemXmlService();

      const changed = service.editContentRefs(subsystem.subsystemPath, {
        add: ['DataProcessor.Загрузка'],
        remove: ['Catalog.Товары'],
      });

      assert.strictEqual(changed.changed, true);
      assert.deepStrictEqual(changed.added, ['DataProcessor.Загрузка']);
      assert.deepStrictEqual(changed.removed, ['Catalog.Товары']);
      assert.deepStrictEqual(changed.contentRefs, ['DataProcessor.Загрузка']);
      assert.deepStrictEqual(changed.changedFiles, [subsystem.subsystemPath]);
      const saved = fs.readFileSync(subsystem.subsystemPath, 'utf-8');
      assert.ok(!saved.includes('Catalog.Товары'));
      assert.ok(saved.includes('DataProcessor.Загрузка'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('запрещает недопустимое enum-значение до записи XML', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-prop-'));
    try {
      const catalogDir = path.join(root, 'Catalogs');
      fs.mkdirSync(catalogDir, { recursive: true });
      const xmlPath = path.join(catalogDir, 'Пользователи.xml');
      fs.copyFileSync(path.resolve(__dirname, '../../../example/2.20/src/cf/Catalogs/Пользователи.xml'), xmlPath);
      const before = fs.readFileSync(xmlPath, 'utf-8');
      const node = createAttributeNode(xmlPath);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      assert.throws(
        () => service.setProperty(node, 'FillChecking', 'BadValue'),
        /Недопустимое значение/
      );
      assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('не разрешает простую запись типизированного значения заполнения', () => {
    const xmlPath = path.resolve(__dirname, '../../../example/2.20/src/cf/Catalogs/Пользователи.xml');
    const node = createAttributeNode(xmlPath);
    const service = new McpPropertyService(new ConfigurationXmlEditor());

    const contract = service.getPropertyContract(node, 'FillValue');

    assert.strictEqual(contract.supportedBySetProperty, false);
    assert.throws(
      () => service.setProperty(node, 'FillValue', 'Тест'),
      /специализированного инструмента/
    );
  });

  test('принимает русские имена свойств и типов при смене типа', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-type-'));
    try {
      const xmlPath = path.join(root, 'Параметр.xml');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setType(node, 'Тип', {
        items: ['Число'],
        numberQualifiers: { digits: 15, fractionDigits: 2 },
      });

      assert.strictEqual(result.success, true);
      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<v8:Type>xs:decimal</v8:Type>'));
      assert.ok(saved.includes('<v8:Digits>15</v8:Digits>'));
      assert.ok(saved.includes('<v8:FractionDigits>2</v8:FractionDigits>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('принимает длину и точность прямо в изменении типа', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-type-flat-'));
    try {
      const xmlPath = path.join(root, 'Параметр.xml');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setType(node, 'Тип', {
        value: 'Число',
        length: 15,
        precision: 2,
      });

      assert.strictEqual(result.success, true);
      const saved = fs.readFileSync(xmlPath, 'utf-8');
      assert.ok(saved.includes('<v8:Type>xs:decimal</v8:Type>'));
      assert.ok(saved.includes('<v8:Digits>15</v8:Digits>'));
      assert.ok(saved.includes('<v8:FractionDigits>2</v8:FractionDigits>'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('для свойства metadataType в notes указан tool смены значения', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-meta-notes-'));
    try {
      const xmlPath = path.join(root, 'Параметр.xml');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const contract = service.getPropertyContract(node, 'Type');

      assert.strictEqual(contract.kind, 'metadataType');
      assert.strictEqual(contract.supportedBySetProperty, false);
      assert.ok(contract.notes.length > 0, 'notes должны быть заполнены для metadataType');
      assert.ok(
        contract.notes.some((note) => note.includes('v8vscedit_list_available_types')),
        'notes должны упоминать v8vscedit_list_available_types'
      );
      assert.ok(
        contract.notes.some((note) => note.includes('v8vscedit_set_type')),
        'notes должны упоминать v8vscedit_set_type'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('запрещает ссылочный тип CFE, если объект не заимствован в расширение', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-cfe-type-'));
    try {
      fs.mkdirSync(path.join(root, 'SessionParameters'), { recursive: true });
      const configPath = path.join(root, 'Configuration.xml');
      const xmlPath = path.join(root, 'SessionParameters', 'Параметр.xml');
      fs.writeFileSync(configPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <Configuration>',
        '    <Properties>',
        '      <Name>Расширение</Name>',
        '      <NamePrefix>ев_</NamePrefix>',
        '      <ConfigurationExtensionPurpose>Customization</ConfigurationExtensionPurpose>',
        '    </Properties>',
        '    <ChildObjects>',
        '      <Catalog>ев_Пользователи</Catalog>',
        '      <SessionParameter>Параметр</SessionParameter>',
        '    </ChildObjects>',
        '  </Configuration>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      fs.writeFileSync(xmlPath, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MetaDataObject>',
        '  <SessionParameter>',
        '    <Properties>',
        '      <Name>Параметр</Name>',
        '      <Type>',
        '        <v8:Type>xs:string</v8:Type>',
        '      </Type>',
        '    </Properties>',
        '  </SessionParameter>',
        '</MetaDataObject>',
      ].join('\n'), 'utf-8');
      const node = new MetadataNode({
        label: 'Параметр',
        nodeKind: 'SessionParameter',
        xmlPath,
      }, vscode.TreeItemCollapsibleState.None);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const available = service.getAvailableTypes(node, 'Тип').flatMap((group) => group.items.map((item) => item.value));
      assert.ok(available.includes('СправочникСсылка.ев_Пользователи'));
      assert.ok(!available.includes('СправочникСсылка.Пользователи'));

      assert.throws(
        () => service.setType(node, 'Тип', 'СправочникСсылка.Пользователи'),
        /Недопустимые типы/
      );
      const result = service.setType(node, 'Тип', 'СправочникСсылка.ев_Пользователи');
      assert.strictEqual(result.success, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function createAttributeNode(ownerXmlPath: string): MetadataNode {
  // Берём имя первого реквизита из XML владельца, чтобы тест не зависел от
  // конкретного справочника example/.
  const xml = fs.readFileSync(ownerXmlPath, 'utf-8');
  const attributeNameMatch = /<Attribute[\s>][^]*?<Name>([^<]+)<\/Name>/.exec(xml);
  if (!attributeNameMatch) {
    throw new Error(`В ${ownerXmlPath} нет ни одного реквизита для теста`);
  }
  return new MetadataNode({
    label: attributeNameMatch[1],
    nodeKind: 'Attribute',
    xmlPath: ownerXmlPath,
    metaContext: {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: ownerXmlPath,
    },
  }, vscode.TreeItemCollapsibleState.None);
}

function createScheduledJobNode(xmlPath: string): MetadataNode {
  return new MetadataNode({
    label: 'ев_ТестовоеРегламентноеЗадание',
    nodeKind: 'ScheduledJob',
    xmlPath,
  }, vscode.TreeItemCollapsibleState.None);
}

function createSubsystemNode(xmlPath: string, label: string): MetadataNode {
  return new MetadataNode({
    label,
    nodeKind: 'Subsystem',
    xmlPath,
  }, vscode.TreeItemCollapsibleState.None);
}

function createRootNode(
  xmlPath: string,
  kind:
    | 'DocumentNumerator'
    | 'Report'
    | 'DataProcessor'
    | 'InformationRegister'
    | 'AccumulationRegister'
    | 'FilterCriterion'
    | 'FunctionalOptionsParameter'
    | 'CommonForm'
    | 'EventSubscription'
    | 'SessionParameter',
  label: string
): MetadataNode {
  return new MetadataNode({
    label,
    nodeKind: kind,
    xmlPath,
  }, vscode.TreeItemCollapsibleState.None);
}

function createChildNode(
  ownerXmlPath: string,
  kind: 'Attribute' | 'TabularSection' | 'Column' | 'Command' | 'Form' | 'Template',
  label: string,
  tabularSectionName?: string
): MetadataNode {
  return new MetadataNode({
    label,
    nodeKind: kind,
    xmlPath: ownerXmlPath,
    metaContext: {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: ownerXmlPath,
      tabularSectionName,
    },
  }, vscode.TreeItemCollapsibleState.None);
}

function buildConfigXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<MetaDataObject>',
    '  <Configuration>',
    '    <Properties>',
    '      <Name>Тест</Name>',
    '      <Synonym/>',
    '      <Comment/>',
    '    </Properties>',
    '    <ChildObjects/>',
    '  </Configuration>',
    '</MetaDataObject>',
  ].join('\n');
}

function resolveCreatedRootXmlPath(root: string, kind: Parameters<typeof createRootNode>[1], name: string): string {
  const folders: Record<Parameters<typeof createRootNode>[1], string> = {
    DocumentNumerator: 'DocumentNumerators',
    Report: 'Reports',
    DataProcessor: 'DataProcessors',
    InformationRegister: 'InformationRegisters',
    AccumulationRegister: 'AccumulationRegisters',
    FilterCriterion: 'FilterCriteria',
    FunctionalOptionsParameter: 'FunctionalOptionsParameters',
    CommonForm: 'CommonForms',
    EventSubscription: 'EventSubscriptions',
    SessionParameter: 'SessionParameters',
  };
  return path.join(root, folders[kind], `${name}.xml`);
}
