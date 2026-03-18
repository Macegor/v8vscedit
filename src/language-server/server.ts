import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  TextDocuments,
  DidChangeWatchedFilesNotification,
  FileChangeType,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { BslParserService } from './BslParserService';
import { BslContextService } from './BslContextService';
import { BSL_TOKEN_TYPES, BSL_TOKEN_MODIFIERS, provideSemanticTokens } from './providers/semanticTokens';
import { computeDiagnostics } from './providers/diagnostics';
import { provideDocumentSymbols } from './providers/symbols';
import { provideFoldingRanges } from './providers/folding';
import { provideHover } from './providers/hover';
import { provideCompletionItems, invalidateMetaCache } from './providers/completion';
import { provideDefinition, invalidateDefinitionCache } from './providers/definition';
import { uriToFsPath } from './lspUtils';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const parserService = new BslParserService();
const contextService = new BslContextService(parserService);

/** Пути корневых папок воркспейса — используются для поиска Configuration.xml и BSL-файлов. */
let workspaceRoots: string[] = [];

/** Таймеры дебаунса диагностик по URI документа. */
const diagTimers = new Map<string, NodeJS.Timeout>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoots = (params.workspaceFolders ?? []).map((f) => uriToFsPath(f.uri));

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,

      completionProvider: {
        triggerCharacters: ['&', '#', '.'],
        resolveProvider: false,
      },

      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      foldingRangeProvider: true,

      semanticTokensProvider: {
        legend: {
          tokenTypes: [...BSL_TOKEN_TYPES],
          tokenModifiers: [...BSL_TOKEN_MODIFIERS],
        },
        full: true,
      },
    },
  };
});

connection.onInitialized(() => {
  // Регистрируем слежение за BSL и Configuration.xml
  connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: [
      { globPattern: '**/*.bsl' },
      { globPattern: '**/Configuration.xml' },
    ],
  });

  // Инициализируем парсер заранее — к моменту первого запроса WASM уже загружен
  parserService.ensureInit().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    connection.console.error(`BSL: ошибка инициализации парсера: ${msg}`);
  });

  // Загружаем метаданные общих модулей конфигурации
  contextService.initialize(workspaceRoots).then(() => {
    const count = contextService.getModules().length;
    connection.console.log(`BSL: загружено общих модулей: ${count}`);
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    connection.console.error(`BSL: ошибка загрузки контекста: ${msg}`);
  });
});

// ── Синхронизация документов ────────────────────────────────────────────────

documents.onDidChangeContent((change) => {
  scheduleDiagnostics(change.document);
});

documents.onDidClose((event) => {
  parserService.invalidate(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  clearDiagTimer(event.document.uri);
});

// ── Изменение файлов в воркспейсе ──────────────────────────────────────────

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    const uri = change.uri;
    if (uri.endsWith('.bsl')) {
      parserService.invalidate(uri);
      invalidateDefinitionCache();
      // Перезапускаем диагностику для открытых документов
      if (change.type !== FileChangeType.Deleted) {
        const doc = documents.get(uri);
        if (doc) {
          scheduleDiagnostics(doc);
        }
      }
    }
    if (uri.endsWith('Configuration.xml')) {
      invalidateMetaCache(uri);
      // Перезагружаем контекст общих модулей
      contextService.invalidate();
      contextService.initialize(workspaceRoots).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        connection.console.error(`BSL: ошибка перезагрузки контекста: ${msg}`);
      });
    }
  }
});

// ── Языковые провайдеры ─────────────────────────────────────────────────────

connection.languages.semanticTokens.on(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return { data: [] };
  }
  try {
    const data = await provideSemanticTokens(doc, parserService);
    return { data };
  } catch {
    return { data: [] };
  }
});

connection.onDocumentSymbol(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  try {
    return await provideDocumentSymbols(doc, parserService);
  } catch {
    return [];
  }
});

connection.onFoldingRanges(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  try {
    return await provideFoldingRanges(doc, parserService);
  } catch {
    return [];
  }
});

connection.onHover(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  try {
    return await provideHover(doc, params.position, parserService);
  } catch {
    return null;
  }
});

connection.onCompletion(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }
  try {
    return await provideCompletionItems(
      doc,
      params.position,
      params.context?.triggerCharacter,
      parserService,
      workspaceRoots,
      contextService,
    );
  } catch {
    return [];
  }
});

connection.onDefinition(async (params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }
  try {
    return await provideDefinition(doc, params.position, parserService, workspaceRoots, documents);
  } catch {
    return null;
  }
});

// ── Диагностики с дебаунсом 500 мс ─────────────────────────────────────────

function scheduleDiagnostics(document: TextDocument): void {
  const uri = document.uri;
  clearDiagTimer(uri);
  const handle = setTimeout(() => {
    computeDiagnostics(document, parserService)
      .then((diagnostics) => connection.sendDiagnostics({ uri, diagnostics }))
      .catch(() => undefined);
  }, 500);
  diagTimers.set(uri, handle);
}

function clearDiagTimer(uri: string): void {
  const existing = diagTimers.get(uri);
  if (existing) {
    clearTimeout(existing);
    diagTimers.delete(uri);
  }
}

// ── Запуск ──────────────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
