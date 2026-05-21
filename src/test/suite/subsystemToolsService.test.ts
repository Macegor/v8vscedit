import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CommandInterfaceService,
  ConfigurationScaffoldService,
  MetadataXmlCreator,
  SubsystemToolsService,
} from '../../infra/xml';

suite('SubsystemToolsService и CommandInterfaceService', () => {
  test('создаёт, читает и валидирует подсистему', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-subsystem-tools-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Конфигурация', outputDir: root });
    new MetadataXmlCreator().addRootObject({ configRoot: root, kind: 'Catalog', name: 'Товары' });

    const service = new SubsystemToolsService();
    const result = service.compile({
      outputDir: root,
      definition: {
        name: 'Продажи',
        synonym: 'Продажи',
        includeInCommandInterface: true,
        content: ['Catalog.Товары'],
        children: ['Розница'],
      },
    });

    assert.ok(fs.existsSync(result.subsystemPath));
    assert.ok(result.changedFiles.includes(path.join(root, 'Configuration.xml')));
    assert.ok(fs.readFileSync(path.join(root, 'Configuration.xml'), 'utf-8').includes('<Subsystem>Продажи</Subsystem>'));

    const info = service.info({ subsystemPath: result.subsystemPath, mode: 'full' });
    assert.strictEqual(info.subsystem?.name, 'Продажи');
    assert.deepStrictEqual(info.contentGroups?.[0]?.refs, ['Catalog.Товары']);
    assert.ok(info.lines.some((line) => line.includes('Контент: 1 объектов')));

    const validation = service.validate({ subsystemPath: result.subsystemPath, detailed: true });
    assert.strictEqual(validation.errors, 0);
  });

  test('редактирует и валидирует CommandInterface.xml', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-ci-tools-'));
    new ConfigurationScaffoldService().createConfiguration({ name: 'Конфигурация', outputDir: root });
    const subsystem = new SubsystemToolsService().compile({
      outputDir: root,
      definition: { name: 'Продажи', synonym: 'Продажи' },
    });

    const subsystemHome = path.join(path.dirname(subsystem.subsystemPath), 'Продажи');
    const ciService = new CommandInterfaceService();
    const edit = ciService.edit({
      ciPath: subsystemHome,
      createIfMissing: true,
      operations: [
        { operation: 'hide', value: ['Catalog.Товары.StandardCommand.Create'] },
        { operation: 'place', value: { command: 'Catalog.Товары.StandardCommand.Create', group: 'NavigationPanelImportant' } },
        { operation: 'order', value: { group: 'NavigationPanelImportant', commands: ['Catalog.Товары.StandardCommand.Create'] } },
        { operation: 'subsystem-order', value: ['Subsystem.Продажи'] },
        { operation: 'group-order', value: ['NavigationPanelImportant'] },
      ],
    });

    assert.strictEqual(edit.changedFiles.length, 1);
    const info = ciService.info({ ciPath: subsystemHome });
    assert.strictEqual(info.visibility[0].common, 'false');
    assert.strictEqual(info.placement[0].group, 'NavigationPanelImportant');
    assert.deepStrictEqual(info.subsystemsOrder, ['Subsystem.Продажи']);

    const validation = ciService.validate({ ciPath: subsystemHome, detailed: true });
    assert.strictEqual(validation.errors, 0);
  });
});
