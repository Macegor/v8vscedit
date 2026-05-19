import * as vscode from 'vscode';

interface BslSurroundCommand {
  readonly id: string;
  readonly snippetName: string;
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

export function registerBslSurroundCommands(context: vscode.ExtensionContext): void {
  for (const command of BSL_SURROUND_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command.id, async () => {
        await vscode.commands.executeCommand('editor.action.insertSnippet', {
          langId: BSL_LANGUAGE_ID,
          name: command.snippetName
        });
      })
    );
  }
}
