import * as vscode from 'vscode';
import { Node } from 'web-tree-sitter';
import { BslParserService } from '../BslParserService';
import type { ConfigEntry } from '../../ConfigFinder';

/** Ключевые слова BSL (двуязычные). */
const CORE_KEYWORDS = [
  'Если', 'If', 'Тогда', 'Then', 'ИначеЕсли', 'ElsIf', 'Иначе', 'Else',
  'КонецЕсли', 'EndIf', 'Для', 'For', 'Каждого', 'Each', 'Из', 'In',
  'По', 'To', 'Цикл', 'Do', 'КонецЦикла', 'EndDo', 'Пока', 'While',
  'Попытка', 'Try', 'Исключение', 'Except', 'КонецПопытки', 'EndTry',
  'Возврат', 'Return', 'Прервать', 'Break', 'Продолжить', 'Continue',
  'Перейти', 'Goto', 'Новый', 'New', 'Экспорт', 'Export',
  'Процедура', 'Procedure', 'КонецПроцедуры', 'EndProcedure',
  'Функция', 'Function', 'КонецФункции', 'EndFunction',
  'Перем', 'Var', 'Знач', 'Val',
  'Истина', 'True', 'Ложь', 'False', 'Неопределено', 'Undefined', 'Null',
];

/** Директивы компиляции (после &). */
const ANNOTATIONS = [
  'НаКлиенте', 'AtClient',
  'НаСервере', 'AtServer',
  'НаСервереБезКонтекста', 'AtServerNoContext',
  'НаКлиентеНаСервереБезКонтекста', 'AtClientAtServerNoContext',
  'НаКлиентеНаСервере', 'AtClientAtServer',
  'Перед', 'Before',
  'После', 'After',
  'Вместо', 'Instead',
  'ИзменениеИКонтроль', 'ChangeAndValidate',
];

/** Директивы препроцессора (после #). */
const PREPROCESSOR = [
  '#Область', '#Region',
  '#КонецОбласти', '#EndRegion',
  '#Если', '#If',
  '#ИначеЕсли', '#ElsIf',
  '#Иначе', '#Else',
  '#КонецЕсли', '#EndIf',
  '#Вставка', '#Insert',
  '#КонецВставки', '#EndInsert',
  '#Удаление', '#Delete',
  '#КонецУдаления', '#EndDelete',
];

/** Карта объектов конфигурации BSL → метаданные. */
const META_PREFIXES: Record<string, string> = {
  Catalog: 'Справочники',
  Document: 'Документы',
  Enum: 'Перечисления',
  InformationRegister: 'РегистрыСведений',
  AccumulationRegister: 'РегистрыНакопления',
  AccountingRegister: 'РегистрыБухгалтерии',
  CalculationRegister: 'РегистрыРасчёта',
  Report: 'Отчёты',
  DataProcessor: 'Обработки',
  BusinessProcess: 'БизнесПроцессы',
  Task: 'Задачи',
  ExchangePlan: 'ПланыОбмена',
  ChartOfCharacteristicTypes: 'ПланыВидовХарактеристик',
  ChartOfAccounts: 'ПланыСчетов',
  ChartOfCalculationTypes: 'ПланыВидовРасчётов',
  DocumentJournal: 'ЖурналыДокументов',
  Constant: 'Константы',
  CommonModule: 'ОбщиеМодули',
};

/**
 * Провайдер автодополнения для BSL.
 * Поддерживает директивы & и #, ключевые слова, локальные символы
 * и объекты из метаданных конфигурации.
 */
export class BslCompletionProvider implements vscode.CompletionItemProvider {
  private readonly metaCache = new Map<string, vscode.CompletionItem[]>();

  constructor(
    private readonly parser: BslParserService,
    private readonly getEntries: () => ConfigEntry[],
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[]> {
    const linePrefix = document.lineAt(position).text.slice(0, position.character);

    // Директивы компиляции &НаКлиенте и т.д.
    if (context.triggerCharacter === '&' || /&\w*$/.test(linePrefix)) {
      return ANNOTATIONS.map((ann) => {
        const item = new vscode.CompletionItem(ann, vscode.CompletionItemKind.Keyword);
        item.insertText = ann;
        return item;
      });
    }

    // Директивы препроцессора #Область и т.д.
    if (context.triggerCharacter === '#' || /^\s*#\w*$/.test(linePrefix)) {
      return PREPROCESSOR.map((kw) => {
        const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
        item.insertText = kw.startsWith('#') ? kw.slice(1) : kw;
        return item;
      });
    }

    // Обычный ввод: ключевые слова + локальные символы + метаданные
    const items: vscode.CompletionItem[] = [];

    for (const kw of CORE_KEYWORDS) {
      items.push(new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword));
    }

    await this.parser.ensureInit();
    items.push(...this.extractLocalSymbols(document));
    items.push(...await this.buildMetaItems());

    return items;
  }

  private extractLocalSymbols(document: vscode.TextDocument): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    let root: Node;
    try {
      root = this.parser.parse(document).rootNode;
    } catch {
      return items;
    }

    const visit = (node: Node): void => {
      if (node.type === 'procedure_definition' || node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const params = this.buildParamsString(node);
          const item = new vscode.CompletionItem(nameNode.text, vscode.CompletionItemKind.Function);
          item.detail = `${node.type === 'procedure_definition' ? 'Процедура' : 'Функция'} (${params})`;
          items.push(item);
        }
      } else if (node.type === 'var_definition' || node.type === 'var_statement') {
        for (const child of node.namedChildren) {
          if (child && child.type === 'var_name') {
            items.push(new vscode.CompletionItem(child.text, vscode.CompletionItemKind.Variable));
          }
        }
      }

      for (const child of node.namedChildren) {
        if (child) {
          visit(child);
        }
      }
    };

    visit(root);
    return items;
  }

  private buildParamsString(node: Node): string {
    const paramsNode = node.childForFieldName('parameters');
    if (!paramsNode) {
      return '';
    }
    const parts: string[] = [];
    for (const param of paramsNode.namedChildren) {
      if (!param || param.type !== 'parameter') {
        continue;
      }
      const nameNode = param.childForFieldName('name');
      if (nameNode) {
        parts.push(nameNode.text);
      }
    }
    return parts.join(', ');
  }

  private async buildMetaItems(): Promise<vscode.CompletionItem[]> {
    const entries = this.getEntries();
    const items: vscode.CompletionItem[] = [];

    for (const entry of entries) {
      if (!this.metaCache.has(entry.rootPath)) {
        const entryItems = await this.parseConfigMeta(entry.rootPath);
        this.metaCache.set(entry.rootPath, entryItems);
      }
      const cached = this.metaCache.get(entry.rootPath);
      if (cached) {
        items.push(...cached);
      }
    }

    return items;
  }

  private async parseConfigMeta(rootPath: string): Promise<vscode.CompletionItem[]> {
    const configPath = vscode.Uri.file(rootPath + '/Configuration.xml');
    let text: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(configPath);
      text = Buffer.from(bytes).toString('utf-8');
    } catch {
      return [];
    }

    const items: vscode.CompletionItem[] = [];

    for (const [typeName, ruPrefix] of Object.entries(META_PREFIXES)) {
      const enPrefix = typeName + 's';
      const re = new RegExp(`<${typeName}>(.*?)<\\/${typeName}>`, 'gs');
      let match: RegExpExecArray | null;
      // eslint-disable-next-line no-cond-assign
      while ((match = re.exec(text)) !== null) {
        const name = match[1].trim();
        if (!name || name.includes('<')) {
          continue;
        }

        const itemRu = new vscode.CompletionItem(`${ruPrefix}.${name}`, vscode.CompletionItemKind.Class);
        itemRu.detail = typeName;
        items.push(itemRu);

        const itemEn = new vscode.CompletionItem(`${enPrefix}.${name}`, vscode.CompletionItemKind.Class);
        itemEn.detail = typeName;
        items.push(itemEn);
      }
    }

    return items;
  }
}
