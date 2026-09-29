/**
 * Пункты меню пакетной выгрузки/загрузки ВСЕХ расширений в CFE-файлы должны
 * быть в контекстном меню узла-контейнера расширений (`extensions-root`), и
 * ТОЛЬКО там. Контекстное меню формируется в
 * `UniversalPanelViewProvider.getNodeActions()` (запрет №14 CLAUDE.md — не
 * через `package.json → menus`), приватный метод достижим лишь через
 * начальное состояние и `childrenLoaded` (см. `support/universalPanelHarness.ts`).
 *
 * Отрицательные проверки так же важны, как положительная: пакетная операция
 * работает со ВСЕЙ базой, и пункт на корне основной конфигурации, на
 * конкретном расширении или на обычном объекте метаданных ввёл бы пользователя
 * в заблуждение (он решил бы, что выгружается именно этот узел). Одиночные
 * пункты CF-файла на корне конфигурации/расширения при этом остаются.
 *
 * Дерево — настоящие фикстуры `example/` (2.20 cf + 2.21 cfe/EVOLC).
 */
import * as assert from 'assert';
import {
  createUniversalPanelFixture,
  type TreeNodeDtoLike,
  type UniversalPanelFixture,
} from './support/universalPanelHarness';

const DUMP_ALL_COMMAND_ID = 'v8vscedit.dumpAllExtensionsToCfe';
const LOAD_ALL_COMMAND_ID = 'v8vscedit.loadAllExtensionsFromCfe';
const SINGLE_DUMP_COMMAND_ID = 'v8vscedit.dumpConfigurationToCf';
const SINGLE_LOAD_COMMAND_ID = 'v8vscedit.loadConfigurationFromCf';

function commandsOf(node: TreeNodeDtoLike): string[] {
  return node.actions.map((action) => action.command);
}

suite('UniversalPanelViewProvider — пункты меню пакетной выгрузки/загрузки всех расширений', function () {
  this.timeout(60_000);
  let fixture: UniversalPanelFixture;

  suiteSetup(() => {
    fixture = createUniversalPanelFixture();
  });

  suiteTeardown(() => {
    fixture.dispose();
  });

  test('узел-контейнер расширений (extensions-root) содержит ОБА пункта с непустыми заголовком и иконкой', () => {
    const extensionsRoot = fixture.rootNodes.find((node) => node.kind === 'extensions-root');
    assert.ok(extensionsRoot, `в корнях дерева не найден контейнер расширений: ${JSON.stringify(fixture.rootNodes.map((n) => n.kind))}`);

    for (const commandId of [DUMP_ALL_COMMAND_ID, LOAD_ALL_COMMAND_ID]) {
      const action = extensionsRoot.actions.find((item) => item.command === commandId);
      assert.ok(action, `у extensions-root нет пункта ${commandId}, реально: ${JSON.stringify(commandsOf(extensionsRoot))}`);
      assert.ok(action.label.trim().length > 0, `у ${commandId} пустой заголовок`);
      assert.ok(action.icon, `у ${commandId} нет иконки`);
    }
  });

  test('пункты на extensions-root не дублируются', () => {
    const extensionsRoot = fixture.rootNodes.find((node) => node.kind === 'extensions-root');
    assert.ok(extensionsRoot);
    const commands = commandsOf(extensionsRoot);
    assert.strictEqual(commands.filter((id) => id === DUMP_ALL_COMMAND_ID).length, 1);
    assert.strictEqual(commands.filter((id) => id === LOAD_ALL_COMMAND_ID).length, 1);
  });

  test('корень основной конфигурации (configuration-hasXml) пакетных пунктов НЕ содержит, одиночные пункты CF остаются', () => {
    const configRoot = fixture.rootNodes.find((node) => node.kind === 'configuration');
    assert.ok(configRoot, 'в корнях дерева не найден узел configuration');
    const commands = commandsOf(configRoot);
    assert.ok(!commands.includes(DUMP_ALL_COMMAND_ID), `пакетная выгрузка на корне конфигурации: ${JSON.stringify(commands)}`);
    assert.ok(!commands.includes(LOAD_ALL_COMMAND_ID), `пакетная загрузка на корне конфигурации: ${JSON.stringify(commands)}`);
    assert.ok(commands.includes(SINGLE_DUMP_COMMAND_ID), 'одиночная выгрузка CF на корне конфигурации не должна пропасть');
    assert.ok(commands.includes(SINGLE_LOAD_COMMAND_ID), 'одиночная загрузка CF на корне конфигурации не должна пропасть');
  });

  test('корень конкретного расширения (extension-hasXml) пакетных пунктов НЕ содержит, одиночные пункты CF остаются', async () => {
    const extensionsRoot = fixture.rootNodes.find((node) => node.kind === 'extensions-root');
    assert.ok(extensionsRoot);
    const children = await fixture.loadChildren(extensionsRoot.id);
    const extensionNode = children.find((node) => node.kind === 'extension');
    assert.ok(extensionNode, `среди детей контейнера расширений не найден узел extension: ${JSON.stringify(children.map((n) => n.kind))}`);
    const commands = commandsOf(extensionNode);
    assert.ok(!commands.includes(DUMP_ALL_COMMAND_ID), `пакетная выгрузка на узле расширения: ${JSON.stringify(commands)}`);
    assert.ok(!commands.includes(LOAD_ALL_COMMAND_ID), `пакетная загрузка на узле расширения: ${JSON.stringify(commands)}`);
    assert.ok(commands.includes(SINGLE_DUMP_COMMAND_ID));
    assert.ok(commands.includes(SINGLE_LOAD_COMMAND_ID));
  });

  test('обычный объект метаданных (справочник из example/2.20) пакетных пунктов НЕ содержит', async () => {
    const configRoot = fixture.rootNodes.find((node) => node.kind === 'configuration');
    assert.ok(configRoot);
    const level1 = await fixture.loadChildren(configRoot.id);
    const catalogsGroup = level1.find((node) => node.label === 'Справочники');
    assert.ok(catalogsGroup, `в детях корня конфигурации нет группы "Справочники": ${JSON.stringify(level1.map((n) => n.label))}`);
    const level2 = await fixture.loadChildren(catalogsGroup.id);
    assert.ok(level2.length > 0, 'в example/2.20/src/cf должен быть хотя бы один справочник');
    const catalog = level2[0];
    assert.strictEqual(catalog.kind, 'Catalog');
    const commands = commandsOf(catalog);
    assert.ok(!commands.includes(DUMP_ALL_COMMAND_ID), `пакетная выгрузка на справочнике: ${JSON.stringify(commands)}`);
    assert.ok(!commands.includes(LOAD_ALL_COMMAND_ID), `пакетная загрузка на справочнике: ${JSON.stringify(commands)}`);
  });

  test('группа метаданных ("Справочники") пакетных пунктов НЕ содержит', async () => {
    const configRoot = fixture.rootNodes.find((node) => node.kind === 'configuration');
    assert.ok(configRoot);
    const level1 = await fixture.loadChildren(configRoot.id);
    const catalogsGroup = level1.find((node) => node.label === 'Справочники');
    assert.ok(catalogsGroup);
    const commands = commandsOf(catalogsGroup);
    assert.ok(!commands.includes(DUMP_ALL_COMMAND_ID));
    assert.ok(!commands.includes(LOAD_ALL_COMMAND_ID));
  });
});
