/**
 * Тесты декомпозированных tools добавления (E8): `v8vscedit_add_<root>` и
 * `v8vscedit_add_<child>`. Проверяют:
 *  - регистрацию ожидаемых tools через мок-McpServer;
 *  - happy-path добавления корневого справочника, реквизита и колонки ТЧ
 *    через реальный `MetadataXmlCreator` на временном configRoot;
 *  - валидацию совместимости типа владельца (`add_dimension` к справочнику
 *    должен падать с понятной ошибкой).
 *
 * Тесты не запускают `V8McpServer` целиком — это интеграционная зона.
 * Здесь проверяется именно фабрика регистрации и её колбэки.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import { CHILD_ADD_TOOLS, ROOT_ADD_KINDS, registerAllAddTools, toSnakeCase } from '../../ui/mcp/McpAddToolsRegistration';
import { EXTENSION_MCP_TOOLS } from '../../infra/ai/AiMcpConfiguration';
import { META_TYPES } from '../../domain/MetaTypes';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataNode } from '../../ui/tree/TreeNode';
import type {
  McpConfigurationOverview,
  McpMetadataPathService,
} from '../../ui/mcp/McpMetadataPathService';
import type { MetadataMutationService } from '../../ui/commands/metadata/MetadataMutationService';

interface RegisteredTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

interface MockMcpServer {
  readonly tools: Map<string, RegisteredTool>;
  registerTool: (name: string, config: { title: string; description: string }, handler: (args: Record<string, unknown>) => Promise<CallToolResult>) => void;
}

function createMockServer(): MockMcpServer {
  const tools = new Map<string, RegisteredTool>();
  return {
    tools,
    registerTool: (name, config, handler) => {
      tools.set(name, { name, title: config.title, description: config.description, handler });
    },
  };
}

suite('McpAddToolsRegistration', () => {
  test('toSnakeCase корректно переводит англ. имена типов', () => {
    assert.strictEqual(toSnakeCase('Catalog'), 'catalog');
    assert.strictEqual(toSnakeCase('CommonModule'), 'common_module');
    assert.strictEqual(toSnakeCase('ChartOfCharacteristicTypes'), 'chart_of_characteristic_types');
    assert.strictEqual(toSnakeCase('HTTPService'), 'http_service');
    assert.strictEqual(toSnakeCase('XDTOPackage'), 'xdto_package');
    assert.strictEqual(toSnakeCase('WSReference'), 'ws_reference');
  });

  test('ROOT_ADD_KINDS не содержит типов без folder или с неподдерживаемой группой', () => {
    for (const kind of ROOT_ADD_KINDS) {
      const def = META_TYPES[kind];
      assert.ok(def, `тип "${kind}" должен быть в META_TYPES`);
      assert.ok(def.folder, `у "${kind}" должен быть folder`);
      assert.ok(
        def.group === 'common' || def.group === 'top' || def.group === 'documents-branch',
        `группа "${kind}" должна быть common/top/documents-branch, получено "${def.group}"`,
      );
      assert.ok(def.englishKind, `у "${kind}" должен быть englishKind для построения имени tool-а`);
    }
  });

  test('registerAllAddTools регистрирует ожидаемые корневые tools', () => {
    const server = createMockServer();
    const ctx = createRegistrationContext();
    registerAllAddTools(server as never, ctx);

    // Точный список из требований E8 — проверяем, что каждый есть.
    const expectedRootTools = [
      'v8vscedit_add_subsystem',
      'v8vscedit_add_common_module',
      'v8vscedit_add_session_parameter',
      'v8vscedit_add_role',
      'v8vscedit_add_common_attribute',
      'v8vscedit_add_exchange_plan',
      'v8vscedit_add_filter_criterion',
      'v8vscedit_add_event_subscription',
      'v8vscedit_add_scheduled_job',
      'v8vscedit_add_functional_option',
      'v8vscedit_add_functional_options_parameter',
      'v8vscedit_add_defined_type',
      'v8vscedit_add_settings_storage',
      'v8vscedit_add_common_form',
      'v8vscedit_add_common_command',
      'v8vscedit_add_command_group',
      'v8vscedit_add_common_template',
      'v8vscedit_add_common_picture',
      'v8vscedit_add_xdto_package',
      'v8vscedit_add_web_service',
      'v8vscedit_add_http_service',
      'v8vscedit_add_ws_reference',
      'v8vscedit_add_integration_service',
      'v8vscedit_add_style_item',
      'v8vscedit_add_style',
      'v8vscedit_add_language',
      'v8vscedit_add_constant',
      'v8vscedit_add_catalog',
      'v8vscedit_add_document',
      'v8vscedit_add_document_journal',
      'v8vscedit_add_document_numerator',
      'v8vscedit_add_sequence',
      'v8vscedit_add_enum',
      'v8vscedit_add_report',
      'v8vscedit_add_data_processor',
      'v8vscedit_add_chart_of_characteristic_types',
      'v8vscedit_add_chart_of_accounts',
      'v8vscedit_add_chart_of_calculation_types',
      'v8vscedit_add_information_register',
      'v8vscedit_add_accumulation_register',
      'v8vscedit_add_accounting_register',
      'v8vscedit_add_calculation_register',
      'v8vscedit_add_business_process',
      'v8vscedit_add_task',
      'v8vscedit_add_external_data_source',
    ];
    for (const name of expectedRootTools) {
      assert.ok(server.tools.has(name), `должен быть зарегистрирован ${name}`);
    }
  });

  test('registerAllAddTools регистрирует все дочерние tools из CHILD_ADD_TOOLS', () => {
    const server = createMockServer();
    const ctx = createRegistrationContext();
    registerAllAddTools(server as never, ctx);

    const expectedChildTools = [
      'v8vscedit_add_attribute',
      'v8vscedit_add_addressing_attribute',
      'v8vscedit_add_tabular_section',
      'v8vscedit_add_command',
      'v8vscedit_add_template',
      'v8vscedit_add_dimension',
      'v8vscedit_add_resource',
      'v8vscedit_add_enum_value',
      'v8vscedit_add_column',
      'v8vscedit_add_url_template',
      'v8vscedit_add_method',
    ];
    for (const name of expectedChildTools) {
      assert.ok(server.tools.has(name), `должен быть зарегистрирован ${name}`);
    }
    assert.strictEqual(CHILD_ADD_TOOLS.length, expectedChildTools.length,
      'CHILD_ADD_TOOLS должен содержать ровно столько же дескрипторов');
  });

  test('ПАРИТЕТ: каждый фактически зарегистрированный tool добавления присутствует в каталоге EXTENSION_MCP_TOOLS', () => {
    // Реальная сверка перечней: берём рантайм-набор tools добавления (root + child),
    // как их регистрирует registerAllAddTools, и требуем, чтобы каждый был описан
    // в EXTENSION_MCP_TOOLS. Ловит рассинхрон вида «новый add-tool забыли внести
    // в каталог для ИИ-агента» (требование CLAUDE.md, «Перенос новой функции», п.4).
    const server = createMockServer();
    registerAllAddTools(server as never, createRegistrationContext());

    const catalogued = new Set(EXTENSION_MCP_TOOLS.map((tool) => tool.name));
    const missing = [...server.tools.keys()].filter((name) => !catalogued.has(name));
    assert.deepStrictEqual(
      missing,
      [],
      `эти зарегистрированные add-tools отсутствуют в EXTENSION_MCP_TOOLS: ${missing.join(', ')}`
    );
  });

  test('v8vscedit_add_catalog добавляет справочник в configRoot', async () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-catalog-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');

    const server = createMockServer();
    const ctx = createRegistrationContext({ configRoot });
    registerAllAddTools(server as never, ctx);

    const tool = server.tools.get('v8vscedit_add_catalog');
    assert.ok(tool, 'add_catalog должен быть зарегистрирован');
    const result = await tool.handler({ name: 'Контрагенты' });
    const text = extractText(result);
    if (result.isError) {
      assert.fail(`add_catalog вернул ошибку: ${text}`);
    }
    const parsed = JSON.parse(text) as { success: boolean; changedFiles: readonly string[]; errors: readonly string[] };
    assert.strictEqual(parsed.success, true, `success=false: ${JSON.stringify(parsed.errors)}`);
    assert.ok(fs.existsSync(path.join(configRoot, 'Catalogs', 'Контрагенты.xml')),
      'XML справочника должен быть создан');
    const configXml = fs.readFileSync(path.join(configRoot, 'Configuration.xml'), 'utf-8');
    assert.ok(configXml.includes('<Catalog>Контрагенты</Catalog>'),
      `Configuration.xml должен содержать регистрацию <Catalog>Контрагенты</Catalog>; xml=${configXml.slice(0, 300)}`);
  });

  test('v8vscedit_add_attribute добавляет реквизит к справочнику', async () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-attribute-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');

    // Сначала создаём сам справочник напрямую через MetadataXmlCreator.
    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Контрагенты' }).success, true);
    const catalogXmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты.xml');

    const catalogNode = createObjectNode('Контрагенты', 'Catalog', catalogXmlPath);
    const server = createMockServer();
    const ctx = createRegistrationContext({
      configRoot,
      nodes: { 'Справочники.Контрагенты': catalogNode },
    });
    registerAllAddTools(server as never, ctx);

    const tool = server.tools.get('v8vscedit_add_attribute');
    assert.ok(tool);
    const result = await tool.handler({ path: 'Справочники.Контрагенты', name: 'ИНН' });
    assertOk(result);

    const xml = fs.readFileSync(catalogXmlPath, 'utf-8');
    assert.ok(xml.includes('<Attribute'), 'XML должен содержать тег Attribute');
    assert.ok(xml.includes('<Name>ИНН</Name>'), 'XML должен содержать <Name>ИНН</Name>');
  });

  test('v8vscedit_add_column добавляет колонку в табличную часть', async () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-column-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Catalog', name: 'Контрагенты' }).success, true);
    const catalogXmlPath = path.join(configRoot, 'Catalogs', 'Контрагенты.xml');
    assert.strictEqual(
      creator.addChildElement({ ownerObjectXmlPath: catalogXmlPath, childTag: 'TabularSection', name: 'КонтактныеЛица' }).success,
      true,
    );

    const tsNode = createTabularSectionNode('КонтактныеЛица', catalogXmlPath);
    const server = createMockServer();
    const ctx = createRegistrationContext({
      configRoot,
      nodes: { 'Справочники.Контрагенты.КонтактныеЛица': tsNode },
    });
    registerAllAddTools(server as never, ctx);

    const tool = server.tools.get('v8vscedit_add_column');
    assert.ok(tool);
    const result = await tool.handler({
      path: 'Справочники.Контрагенты.КонтактныеЛица',
      name: 'Должность',
    });
    assertOk(result);

    const xml = fs.readFileSync(catalogXmlPath, 'utf-8');
    assert.ok(xml.includes('<Name>Должность</Name>'),
      'XML справочника должен содержать колонку Должность в табличной части');
  });

  test('v8vscedit_add_dimension в справочник → ошибка о несовместимом типе владельца', async () => {
    const catalogNode = createObjectNode('Контрагенты', 'Catalog', '/tmp/Catalogs/Контрагенты.xml');
    const server = createMockServer();
    const ctx = createRegistrationContext({
      nodes: { 'Справочники.Контрагенты': catalogNode },
    });
    registerAllAddTools(server as never, ctx);

    const tool = server.tools.get('v8vscedit_add_dimension');
    assert.ok(tool);
    const result = await tool.handler({ path: 'Справочники.Контрагенты', name: 'Валюта' });
    // Ожидаем ошибку: справочник не входит в allowedOwnerKinds для измерения.
    assert.strictEqual(result.isError, true);
    const text = extractText(result);
    assert.ok(/измерение/i.test(text), `ожидалось упоминание «измерение», получено: ${text}`);
    assert.ok(/Справочник/i.test(text), `ожидалось упоминание справочника, получено: ${text}`);
  });
});

// ─── Утилиты тестов ───────────────────────────────────────────────────────

function buildEmptyConfigXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`;
}

function createObjectNode(name: string, kind: MetadataNode['nodeKind'], xmlPath: string): MetadataNode {
  return new MetadataNode({
    label: name,
    nodeKind: kind,
    xmlPath,
  }, vscode.TreeItemCollapsibleState.None);
}

function createTabularSectionNode(name: string, ownerXmlPath: string): MetadataNode {
  return new MetadataNode({
    label: name,
    nodeKind: 'TabularSection',
    xmlPath: ownerXmlPath,
    metaContext: {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: ownerXmlPath,
    },
  }, vscode.TreeItemCollapsibleState.Collapsed);
}

interface RegistrationContextOptions {
  readonly configRoot?: string;
  readonly nodes?: Readonly<Record<string, MetadataNode>>;
}

function createRegistrationContext(options: RegistrationContextOptions = {}): {
  readonly paths: McpMetadataPathService;
  readonly mutations: MetadataMutationService;
  readonly afterMutation: (changedFiles: readonly string[]) => void;
  readonly wrapAsync: (fn: () => Promise<unknown>) => Promise<CallToolResult>;
} {
  const paths = createPathsStub(options);
  const mutations = createMutationsStub();
  return {
    paths,
    mutations,
    afterMutation: () => {
      // В тестах пост-мутация неважна — refresh tree и т.п. не вызываем.
    },
    wrapAsync: async (fn) => {
      try {
        const value = await fn();
        return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    },
  };
}

/**
 * Стаб `McpMetadataPathService`: возвращает заранее подготовленные узлы по
 * каноническим путям и фиктивный overview с одним configRoot. Реальный сервис
 * требует `MetadataTreeProvider`, поэтому тестовая версия минимальна и
 * содержит только методы, вызываемые из McpAddToolsRegistration.
 */
function createPathsStub(options: RegistrationContextOptions): McpMetadataPathService {
  const overview: { mainConfigurations: McpConfigurationOverview[]; extensions: McpConfigurationOverview[] } = {
    mainConfigurations: options.configRoot
      ? [{
        configuration: path.basename(options.configRoot),
        rootPath: options.configRoot,
        configXmlPath: path.join(options.configRoot, 'Configuration.xml'),
        kind: 'cf',
        name: path.basename(options.configRoot),
        synonym: '',
        version: '',
        namePrefix: '',
        objectCounts: [],
      }]
      : [],
    extensions: [],
  };
  const nodes = options.nodes ?? {};
  return {
    getWorkspaceOverview: () => overview,
    resolveNode: (canonical: string) => {
      if (!Object.prototype.hasOwnProperty.call(nodes, canonical)) {
        throw new Error(`Метаданные по пути "${canonical}" не найдены.`);
      }
      return nodes[canonical];
    },
  } as unknown as McpMetadataPathService;
}

/** Канонические типы макетов, поддерживаемые `MetadataXmlCreator`. */
type StubTemplateType =
  | 'SpreadsheetDocument' | 'TextDocument' | 'HTMLDocument' | 'BinaryData'
  | 'DataCompositionSchema' | 'DataCompositionAppearanceTemplate'
  | 'GraphicalSchema' | 'AddIn';

/** Канонические дочерние теги для XML-конвертера (без StandardAttribute). */
type StubChildTag = 'Attribute' | 'AddressingAttribute' | 'TabularSection' | 'Form'
  | 'Command' | 'Template' | 'Dimension' | 'Resource' | 'EnumValue' | 'Column';

/**
 * Тестовый mutation-сервис: делегирует в реальный MetadataXmlCreator,
 * чтобы XML и Configuration.xml действительно создавались на временном диске.
 */
function createMutationsStub(): MetadataMutationService {
  const creator = new MetadataXmlCreator();
  return {
    addMetadata: (input: {
      readonly target: {
        readonly kind: 'root' | 'child';
        readonly configRoot?: string;
        readonly targetKind?: MetadataNode['nodeKind'];
        readonly ownerObjectXmlPath?: string;
        readonly childTag?: StubChildTag;
        readonly tabularSectionName?: string;
      };
      readonly name: string;
      readonly templateType?: StubTemplateType;
    }) => {
      const result = input.target.kind === 'root'
        ? creator.addRootObject({
          configRoot: input.target.configRoot ?? '',
          kind: input.target.targetKind ?? 'Catalog',
          name: input.name,
          templateType: input.templateType,
        })
        : creator.addChildElement({
          ownerObjectXmlPath: input.target.ownerObjectXmlPath ?? '',
          childTag: input.target.childTag ?? 'Attribute',
          name: input.name,
          tabularSectionName: input.target.tabularSectionName,
          templateType: input.templateType,
        });
      return Promise.resolve({
        success: result.success,
        message: result.success ? 'ok' : 'fail',
        changedFiles: result.changedFiles,
        warnings: result.warnings,
        errors: result.errors,
      });
    },
  } as unknown as MetadataMutationService;
}

function assertOk(result: CallToolResult): void {
  if (result.isError) {
    assert.fail(`tool вернул ошибку: ${extractText(result)}`);
  }
  const text = extractText(result);
  const parsed = JSON.parse(text) as { success?: boolean; errors?: readonly string[] };
  assert.strictEqual(parsed.success, true, `результат должен быть успешным, errors=${JSON.stringify(parsed.errors)}`);
}

function extractText(result: CallToolResult): string {
  const part = result.content[0];
  if (part.type === 'text') {
    return part.text;
  }
  return '';
}
