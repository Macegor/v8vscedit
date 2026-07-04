/**
 * MCP tools добавления HTTP-сервисной вложенности: `v8vscedit_add_url_template`
 * (childTag='URLTemplate', allowedOwnerKinds=['HTTPService']) и
 * `v8vscedit_add_method` (childTag='Method', владелец — узел URLTemplate,
 * флаг `inUrlTemplate` — аналог `inTabularSection` у `v8vscedit_add_column`).
 *
 * До реализации `CHILD_ADD_TOOLS` не содержит этих дескрипторов — соответствующие
 * tool-ы не регистрируются в `registerAllAddTools`, и `server.tools.get(...)`
 * возвращает `undefined` (падение на `assert.ok(tool)`).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import type { ChildTag } from '../../domain/ChildTag';
import { CHILD_ADD_TOOLS, registerAllAddTools } from '../../ui/mcp/McpAddToolsRegistration';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataNode } from '../../ui/tree/TreeNode';
import type {
  McpConfigurationOverview,
  McpMetadataPathService,
} from '../../ui/mcp/McpMetadataPathService';
import type { MetadataMutationService } from '../../ui/commands/metadata/MetadataMutationService';

interface RegisteredTool {
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
    registerTool: (name, _config, handler) => {
      tools.set(name, { handler });
    },
  };
}

suite('McpAddToolsRegistration — v8vscedit_add_url_template / v8vscedit_add_method', () => {
  test('CHILD_ADD_TOOLS содержит дескрипторы add_url_template (owner=HTTPService) и add_method (owner=URLTemplate, inUrlTemplate)', () => {
    const urlTemplateDescriptor = CHILD_ADD_TOOLS.find((d) => d.toolName === 'v8vscedit_add_url_template');
    const methodDescriptor = CHILD_ADD_TOOLS.find((d) => d.toolName === 'v8vscedit_add_method');

    assert.ok(urlTemplateDescriptor, 'должен быть дескриптор v8vscedit_add_url_template');
    assert.strictEqual(urlTemplateDescriptor.childTag, 'URLTemplate');
    assert.ok(urlTemplateDescriptor.allowedOwnerKinds.includes('HTTPService'));
    assert.strictEqual(
      urlTemplateDescriptor.inUrlTemplate,
      undefined,
      'add_url_template работает на владельце-HTTPService, а не на владельце-URLTemplate'
    );

    assert.ok(methodDescriptor, 'должен быть дескриптор v8vscedit_add_method');
    assert.strictEqual(methodDescriptor.childTag, 'Method');
    assert.strictEqual(
      methodDescriptor.inUrlTemplate,
      true,
      'add_method должен нести флаг inUrlTemplate (аналог inTabularSection у add_column)'
    );
  });

  test('registerAllAddTools регистрирует v8vscedit_add_url_template и v8vscedit_add_method', () => {
    const server = createMockServer();
    registerAllAddTools(server as never, createRegistrationContext());
    assert.ok(server.tools.has('v8vscedit_add_url_template'));
    assert.ok(server.tools.has('v8vscedit_add_method'));
  });

  test('v8vscedit_add_url_template добавляет URL-шаблон в HTTPService', async () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-url-template-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');

    const creator = new MetadataXmlCreator();
    assert.strictEqual(creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'ServiceEntry' }).success, true);
    const serviceXmlPath = path.join(configRoot, 'HTTPServices', 'ServiceEntry.xml');

    const serviceNode = new MetadataNode(
      { label: 'ServiceEntry', nodeKind: 'HTTPService', xmlPath: serviceXmlPath },
      vscode.TreeItemCollapsibleState.Collapsed
    );
    const server = createMockServer();
    registerAllAddTools(server as never, createRegistrationContext({
      configRoot,
      nodes: { 'HTTPСервисы.ServiceEntry': serviceNode },
    }));

    const tool = server.tools.get('v8vscedit_add_url_template');
    assert.ok(tool, 'v8vscedit_add_url_template должен быть зарегистрирован');
    const result = await tool.handler({ path: 'HTTPСервисы.ServiceEntry', name: 'PostEntries' });
    assertOk(result);

    const xml = fs.readFileSync(serviceXmlPath, 'utf-8');
    assert.ok(xml.includes('<URLTemplate'), 'XML должен содержать блок URLTemplate');
    assert.ok(xml.includes('<Name>PostEntries</Name>'));
  });

  test('v8vscedit_add_method добавляет метод внутрь конкретного URLTemplate (владелец — узел URLTemplate)', async () => {
    const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-method-'));
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), buildEmptyConfigXml(), 'utf-8');

    const creator = new MetadataXmlCreator();
    creator.addRootObject({ configRoot, kind: 'HTTPService', name: 'ServiceEntry' });
    const serviceXmlPath = path.join(configRoot, 'HTTPServices', 'ServiceEntry.xml');
    creator.addChildElement({
      ownerObjectXmlPath: serviceXmlPath,
      childTag: 'URLTemplate',
      name: 'PostEntries',
    });

    // Узел URLTemplate — аналог узла TabularSection для v8vscedit_add_column:
    // metaContext.urlTemplateName задаёт имя контейнера-владельца.
    const urlTemplateNode = new MetadataNode(
      {
        label: 'PostEntries',
        nodeKind: 'URLTemplate',
        xmlPath: serviceXmlPath,
        metaContext: {
          rootMetaKind: 'HTTPService',
          ownerObjectXmlPath: serviceXmlPath,
          urlTemplateName: 'PostEntries',
        },
      },
      vscode.TreeItemCollapsibleState.Collapsed
    );

    const server = createMockServer();
    registerAllAddTools(server as never, createRegistrationContext({
      configRoot,
      nodes: { 'HTTPСервисы.ServiceEntry.URLШаблон.PostEntries': urlTemplateNode },
    }));

    const tool = server.tools.get('v8vscedit_add_method');
    assert.ok(tool, 'v8vscedit_add_method должен быть зарегистрирован');
    const result = await tool.handler({
      path: 'HTTPСервисы.ServiceEntry.URLШаблон.PostEntries',
      name: 'POST',
    });
    assertOk(result);

    const xml = fs.readFileSync(serviceXmlPath, 'utf-8');
    const urlTemplateBlock = /<URLTemplate uuid="[^"]*">[\s\S]*?<\/URLTemplate>/.exec(xml)?.[0] ?? '';
    assert.ok(urlTemplateBlock.includes('<Method'), 'Method должен быть вложен внутрь блока URLTemplate');
    assert.ok(urlTemplateBlock.includes('<Name>POST</Name>'));
  });
});

// ─── Утилиты теста ────────────────────────────────────────────────────────

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
  return {
    paths: createPathsStub(options),
    mutations: createMutationsStub(),
    afterMutation: () => {
      // В тестах пост-мутация неважна.
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

/** Тестовый mutation-сервис: делегирует в реальный MetadataXmlCreator. */
function createMutationsStub(): MetadataMutationService {
  const creator = new MetadataXmlCreator();
  return {
    addMetadata: (input: {
      readonly target: {
        readonly kind: 'root' | 'child';
        readonly configRoot?: string;
        readonly targetKind?: MetadataNode['nodeKind'];
        readonly ownerObjectXmlPath?: string;
        readonly childTag?: ChildTag | 'Column';
        readonly tabularSectionName?: string;
        readonly urlTemplateName?: string;
      };
      readonly name: string;
    }) => {
      const result = input.target.kind === 'root'
        ? creator.addRootObject({
          configRoot: input.target.configRoot ?? '',
          kind: input.target.targetKind ?? 'HTTPService',
          name: input.name,
        })
        : creator.addChildElement({
          ownerObjectXmlPath: input.target.ownerObjectXmlPath ?? '',
          childTag: input.target.childTag ?? 'Attribute',
          name: input.name,
          tabularSectionName: input.target.tabularSectionName,
          urlTemplateName: input.target.urlTemplateName,
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
