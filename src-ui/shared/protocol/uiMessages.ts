import type { AiMcpUiMessage } from '../types/ai';
import type { ProjectEnvironmentUiMessage } from '../types/environment';
import type { StandaloneServerUiMessage } from '../types/standalone';

export type UiToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refresh' }
  | AiMcpUiMessage
  | ProjectEnvironmentUiMessage
  | StandaloneServerUiMessage
  | { readonly type: 'command'; readonly command: string; readonly payload?: unknown }
  | { readonly type: 'request'; readonly requestId: string; readonly name: string; readonly payload?: unknown };
