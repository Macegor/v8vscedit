/**
 * Общие зависимости доменных модулей регистрации MCP-инструментов.
 *
 * Собирается один раз в `V8McpServer.registerTools()` и передаётся в каждую
 * доменную фабрику `registerXxxTools(server, deps)`. Так все домены работают
 * с ОДНИМ экземпляром сервисов (`McpMetadataPathService`, `McpPropertyService`,
 * `MetadataMutationService`) и ОДНИМ post-mutation шлюзом `McpMutationGate`.
 */
import type { ConfigurationXmlEditor } from '../../../infra/xml';
import type { CommandServices } from '../../commands/_shared';
import type { MetadataMutationService } from '../../commands/metadata/MetadataMutationService';
import type { McpMetadataPathService } from '../McpMetadataPathService';
import type { McpPropertyService } from '../McpPropertyService';
import type { McpMutationGate } from './McpMutationGate';

/** Сервисы, доступные MCP-инструментам (без UI-провайдера AI-панели). */
export type McpCommandServices = Omit<CommandServices, 'aiMcpViewProvider'>;

/** Набор зависимостей, разделяемых всеми доменными модулями регистрации. */
export interface McpRegistrationDeps {
  readonly services: McpCommandServices;
  readonly xmlEditor: ConfigurationXmlEditor;
  readonly paths: McpMetadataPathService;
  readonly properties: McpPropertyService;
  readonly mutations: MetadataMutationService;
  readonly gate: McpMutationGate;
}
