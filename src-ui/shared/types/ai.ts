export type AiMcpProfile = 'reference' | 'workspace' | 'extension';

export interface AiMcpSettings {
  readonly extensionAutoStart: boolean;
  readonly extensionHost: string;
  readonly extensionPort: number;
  readonly bslAnalyzerAutoStart: boolean;
  readonly bslAnalyzerReferenceEnabled: boolean;
  readonly bslAnalyzerWorkspaceEnabled: boolean;
  readonly bslAnalyzerWorkspaceSourceDir: string;
  readonly bslAnalyzerEmbeddingUrl: string;
  readonly bslAnalyzerEmbeddingApiKey: string;
  readonly bslAnalyzerEmbeddingModel: string;
  readonly bslAnalyzerNaparnikToken: string;
  readonly bslAnalyzerOnecUrl: string;
  readonly bslAnalyzerOnecUser: string;
  readonly bslAnalyzerOnecPassword: string;
}

export interface AiMcpToolInfo {
  readonly profile: AiMcpProfile;
  readonly name: string;
  readonly description: string;
  readonly requirement: string;
}

export interface ExtensionMcpStatus {
  readonly running: boolean;
  readonly endpoint?: string;
}

export interface BslAnalyzerMcpProfileStatus {
  readonly profile: 'reference' | 'workspace';
  readonly enabled: boolean;
  readonly running: boolean;
  readonly pid: number | null;
  readonly commandLine: string;
  readonly lastError: string | null;
}

export interface BslAnalyzerMcpStatus {
  readonly profiles: readonly BslAnalyzerMcpProfileStatus[];
}

export interface AiMcpSnapshot {
  readonly settings: AiMcpSettings;
  readonly extensionStatus: ExtensionMcpStatus;
  readonly bslAnalyzerStatus: BslAnalyzerMcpStatus;
  readonly extensionTools: readonly AiMcpToolInfo[];
  readonly bslAnalyzerTools: readonly AiMcpToolInfo[];
  readonly docs: {
    readonly readmeUrl: string;
    readonly toolsUrl: string;
  };
}

export type AiMcpUiMessage =
  | { readonly type: 'refresh' }
  | { readonly type: 'save'; readonly settings: AiMcpSettings }
  | { readonly type: 'startExtensionMcp' }
  | { readonly type: 'stopExtensionMcp' }
  | { readonly type: 'startBslAnalyzerMcp' }
  | { readonly type: 'stopBslAnalyzerMcp' }
  | { readonly type: 'installAiSkills' };
