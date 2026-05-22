import * as vscode from 'vscode';

interface BslSurroundCommand {
  readonly id: string;
  readonly snippetName: string;
}

interface BslRangeFormatter {
  formatRange(
    document: vscode.TextDocument,
    range: vscode.Range,
    options?: vscode.FormattingOptions,
  ): Promise<boolean>;
}

const BSL_LANGUAGE_ID = 'bsl';

const BSL_SURROUND_COMMANDS: readonly BslSurroundCommand[] = [
  {
    id: 'v8vscedit.bsl.surround.if',
    snippetName: 'Окружить: Если'
  },
  {
    id: 'v8vscedit.bsl.surround.ifElse',
    snippetName: 'Окружить: Если иначе'
  },
  {
    id: 'v8vscedit.bsl.surround.try',
    snippetName: 'Окружить: Попытка'
  },
  {
    id: 'v8vscedit.bsl.surround.while',
    snippetName: 'Окружить: Пока'
  },
  {
    id: 'v8vscedit.bsl.surround.forEach',
    snippetName: 'Окружить: Для каждого'
  },
  {
    id: 'v8vscedit.bsl.surround.procedure',
    snippetName: 'Окружить: Процедура'
  },
  {
    id: 'v8vscedit.bsl.surround.function',
    snippetName: 'Окружить: Функция'
  },
  {
    id: 'v8vscedit.bsl.surround.region',
    snippetName: 'Окружить: Область'
  }
];

export function registerBslSurroundCommands(
  context: vscode.ExtensionContext,
  getFormatter: () => BslRangeFormatter | undefined = () => undefined
): void {
  for (const command of BSL_SURROUND_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command.id, async () => {
        const beforeEditor = vscode.window.activeTextEditor;
        const beforeDocument = beforeEditor?.document;
        const beforeSelection = beforeEditor?.selection;
        const beforeLineCount = beforeDocument?.lineCount ?? 0;

        await vscode.commands.executeCommand('editor.action.insertSnippet', {
          langId: BSL_LANGUAGE_ID,
          name: command.snippetName
        });

        const afterEditor = vscode.window.activeTextEditor;
        if (!beforeDocument || !beforeSelection || afterEditor?.document.uri.toString() !== beforeDocument.uri.toString()) {
          return;
        }

        await waitForEditorUpdate();
        const range = getChangedLineRange(beforeDocument, beforeSelection, beforeLineCount);
        await getFormatter()?.formatRange(beforeDocument, range, getFormattingOptions(afterEditor));
      })
    );
  }
}

function getChangedLineRange(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  beforeLineCount: number
): vscode.Range {
  const addedLines = Math.max(0, document.lineCount - beforeLineCount);
  const startLine = clampLine(document, selection.start.line);
  const endLine = clampLine(document, Math.max(selection.end.line + addedLines, startLine));
  return new vscode.Range(
    new vscode.Position(startLine, 0),
    document.lineAt(endLine).range.end
  );
}

function clampLine(document: vscode.TextDocument, line: number): number {
  return Math.max(0, Math.min(line, document.lineCount - 1));
}

function getFormattingOptions(editor: vscode.TextEditor): vscode.FormattingOptions {
  return {
    tabSize: typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4,
    insertSpaces: typeof editor.options.insertSpaces === 'boolean' ? editor.options.insertSpaces : true,
  };
}

function waitForEditorUpdate(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
