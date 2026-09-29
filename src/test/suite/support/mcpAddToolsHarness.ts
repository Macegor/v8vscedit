import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import type { ChildTag } from '../../../domain/ChildTag';
import type { MetaKind } from '../../../domain/MetaTypes';
import { registerAllAddTools } from '../../../ui/mcp/McpAddToolsRegistration';
import type { McpMetadataPathService } from '../../../ui/mcp/McpMetadataPathService';
import type { MetadataMutationService } from '../../../ui/commands/metadata/MetadataMutationService';
import { MetadataXmlCreator } from '../../../infra/xml/MetadataXmlCreator';
import { MetadataNode } from '../../../ui/tree/TreeNode';

/**
 * Минимальная обвязка для проверки MCP-инструментов добавления на реальной ФС.
 *
 * Подменены (стабами) только зависимости от живого VS Code: дерево навигатора
 * (`McpMetadataPathService`) и `MetadataMutationService` — в реальном процессе
 * они требуют `TreeView`/`OutputChannel`, которых в тесте нет. Сама мутация
 * не подделывается: стаб делегирует в настоящий `MetadataXmlCreator`, так что
 * XML и `Configuration.xml` реально пишутся во временный каталог.
 */

export interface RegisteredTool {
  readonly handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

export interface AddToolsHarness {
  readonly tools: Map<string, RegisteredTool>;
  readonly configRoot: string;
  readonly creator: MetadataXmlCreator;
  /** Создаёт корневой объект и регистрирует его узел под канонической строкой `path`. */
  createOwner(kind: MetaKind, name: string): { readonly path: string; readonly xmlPath: string };
  call(toolName: string, args: Record<string, unknown>): Promise<CallToolResult>;
}

export function createAddToolsHarness(version = '2.21'): AddToolsHarness {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-harness-'));
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MetaDataObject version="${version}">`,
    '\t<Configuration>',
    '\t\t<Properties><Name>Тест</Name><Synonym/></Properties>',
    '\t\t<ChildObjects/>',
    '\t</Configuration>',
    '</MetaDataObject>',
    '',
  ].join('\n'), 'utf-8');

  const creator = new MetadataXmlCreator();
  const nodes: Record<string, MetadataNode> = {};
  const tools = new Map<string, RegisteredTool>();

  const server = {
    registerTool: (name: string, _config: unknown, handler: RegisteredTool['handler']) => {
      tools.set(name, { handler });
    },
  };

  const paths = {
    getWorkspaceOverview: () => ({ mainConfigurations: [], extensions: [] }),
    resolveNode: (canonical: string) => {
      if (!Object.prototype.hasOwnProperty.call(nodes, canonical)) {
        throw new Error(`Метаданные по пути "${canonical}" не найдены.`);
      }
      return nodes[canonical];
    },
  } as unknown as McpMetadataPathService;

  const mutations = {
    addMetadata: (input: {
      readonly target: { readonly ownerObjectXmlPath?: string; readonly childTag?: ChildTag | 'Column' };
      readonly name: string;
      readonly templateType?: 'SpreadsheetDocument';
    }) => {
      const result = creator.addChildElement({
        ownerObjectXmlPath: input.target.ownerObjectXmlPath ?? '',
        childTag: input.target.childTag ?? 'Attribute',
        name: input.name,
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

  registerAllAddTools(server as never, {
    paths,
    mutations,
    afterMutation: () => undefined,
    wrapAsync: async (fn) => {
      try {
        const value = await fn();
        return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  });

  return {
    tools,
    configRoot,
    creator,
    createOwner(kind, name) {
      const created = creator.addRootObject({ configRoot, kind, name });
      if (!created.success) {
        throw new Error(`addRootObject(${kind}.${name}): ${created.errors.join('; ')}`);
      }
      const xmlPath = created.changedFiles.find((f) => f.endsWith(`${name}.xml`) && !f.endsWith('Configuration.xml'));
      if (!xmlPath) {
        throw new Error(`не найден XML созданного объекта ${kind}.${name}`);
      }
      const canonical = `${kind}.${name}`;
      nodes[canonical] = new MetadataNode({ label: name, nodeKind: kind, xmlPath }, vscode.TreeItemCollapsibleState.None);
      return { path: canonical, xmlPath };
    },
    async call(toolName, args) {
      const tool = tools.get(toolName);
      if (!tool) {
        throw new Error(`tool ${toolName} не зарегистрирован`);
      }
      return tool.handler(args);
    },
  };
}

export function resultText(result: CallToolResult): string {
  const part = result.content[0];
  return part.type === 'text' ? part.text : '';
}
