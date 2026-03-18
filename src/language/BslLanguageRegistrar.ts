import * as vscode from 'vscode';
import { BslParserService } from './BslParserService';
import { BslDiagnosticsProvider } from './BslDiagnosticsProvider';
import { BslSemanticTokensProvider, BSL_LEGEND } from './providers/SemanticTokensProvider';
import { BslDocumentSymbolProvider } from './providers/DocumentSymbolProvider';
import { BslFoldingRangeProvider } from './providers/FoldingRangeProvider';
import { BslCompletionProvider } from './providers/CompletionProvider';
import { BslHoverProvider } from './providers/HoverProvider';
import { BslDefinitionProvider } from './providers/DefinitionProvider';
import type { ConfigEntry } from '../ConfigFinder';

/**
 * Регистрация всех языковых провайдеров для BSL.
 * Вызывается после того, как parserService.ensureInit() уже завершился.
 */
export function registerBslLanguage(
  context: vscode.ExtensionContext,
  parserService: BslParserService,
  getEntries: () => ConfigEntry[],
): void {
  const selector: vscode.DocumentSelector = { language: 'bsl', scheme: 'file' };

  const semanticTokensProvider = new BslSemanticTokensProvider(parserService);
  const symbolProvider = new BslDocumentSymbolProvider(parserService);
  const foldingProvider = new BslFoldingRangeProvider(parserService);
  const completionProvider = new BslCompletionProvider(parserService, getEntries);
  const hoverProvider = new BslHoverProvider(parserService);
  const definitionProvider = new BslDefinitionProvider(parserService);
  const diagnosticsProvider = new BslDiagnosticsProvider(parserService, context);

  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(selector, semanticTokensProvider, BSL_LEGEND),
    vscode.languages.registerDocumentSymbolProvider(selector, symbolProvider),
    vscode.languages.registerFoldingRangeProvider(selector, foldingProvider),
    vscode.languages.registerCompletionItemProvider(selector, completionProvider, '&', '#'),
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    // definitionProvider управляет FileSystemWatcher — нужен явный dispose
    definitionProvider,
    diagnosticsProvider,
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'bsl') {
        parserService.invalidate(e.document.uri.toString());
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId === 'bsl') {
        parserService.invalidate(doc.uri.toString());
      }
    }),
  );
}

