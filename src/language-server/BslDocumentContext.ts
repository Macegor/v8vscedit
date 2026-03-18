import * as fs from 'fs';
import { Node } from 'web-tree-sitter';
import { Position } from 'vscode-languageserver/node';
import { BslContextService } from './BslContextService';
import { BslParserService } from './BslParserService';
import { uriToFsPath } from './lspUtils';

/**
 * Контекст выполнения конкретного BSL-документа на позиции курсора.
 *
 * В 1С различаются:
 * - Серверный контекст (Server=true)
 * - Управляемое приложение / тонкий клиент (ClientManagedApplication=true)
 * - Обычное приложение / толстый клиент (ClientOrdinaryApplication=true)
 *
 * Это РАЗНЫЕ контексты — модуль с Server+ClientOrdinaryApplication недоступен
 * из управляемого клиента, даже если вызывающий модуль тоже имеет ClientOrdinaryApplication.
 */
export interface DocumentBslContext {
  /** Доступен серверный контекст (Server=true) */
  isServer: boolean;
  /**
   * Доступен контекст управляемого приложения (ClientManagedApplication=true).
   * НЕ включает обычное приложение — это отдельный, несовместимый контекст.
   */
  isClient: boolean;
  /** Имя текущего общего модуля (если документ — Module.bsl общего модуля) */
  moduleName: string | null;
  /** Директива компиляции текущей процедуры/функции, если найдена */
  directive: string | null;
}

/**
 * Директивы компиляции 1С → контекст выполнения.
 * Ключи — нижний регистр без символа &.
 */
const DIRECTIVE_CONTEXT: Record<string, { isServer: boolean; isClient: boolean }> = {
  насервере: { isServer: true, isClient: false },
  atserver: { isServer: true, isClient: false },
  насерверебезконтекста: { isServer: true, isClient: false },
  atservernocontext: { isServer: true, isClient: false },
  наклиенте: { isServer: false, isClient: true },
  atclient: { isServer: false, isClient: true },
  наклиентенасерверебезконтекста: { isServer: true, isClient: true },
  atclientatservernocontext: { isServer: true, isClient: true },
  наклиентенасервере: { isServer: true, isClient: true },
  atclientatserver: { isServer: true, isClient: true },
};

/**
 * Определяет контекст BSL-документа на позиции курсора.
 *
 * Алгоритм:
 * 1. Определяем контекст модуля (из индекса сервиса или прямо из XML).
 * 2. Ищем процедуру/функцию, в которой находится курсор.
 * 3. Если у неё есть директива компиляции — она уточняет контекст.
 * 4. Директива сужает контекст до пересечения с контекстом модуля.
 */
export async function getDocumentContext(
  uri: string,
  text: string,
  position: Position,
  service: BslContextService,
  parserService: BslParserService,
): Promise<DocumentBslContext> {
  const fsPath = uriToFsPath(uri).replace(/\\/g, '/');

  // Шаг 1: базовый контекст модуля
  const moduleBase = await resolveModuleBaseContext(fsPath, service);

  // Шаг 2: ищем директиву компиляции в текущей функции
  const directive = await findCompilationDirective(text, position, uri, parserService);

  // Шаг 3: если директива найдена — применяем пересечение с контекстом модуля
  if (directive) {
    const dirCtx = DIRECTIVE_CONTEXT[directive.toLowerCase()];
    if (dirCtx) {
      // Директива сужает допустимый контекст
      const isServer = moduleBase.isServer && dirCtx.isServer;
      const isClient = moduleBase.isClient && dirCtx.isClient;

      // Защита: если пересечение пустое (директива несовместима с модулем),
      // доверяем директиве — программист явно указал контекст
      return {
        isServer: (isServer || isClient) ? isServer : dirCtx.isServer,
        isClient: (isServer || isClient) ? isClient : dirCtx.isClient,
        moduleName: moduleBase.moduleName,
        directive,
      };
    }
  }

  return { ...moduleBase, directive: null };
}

// ── Контекст модуля ──────────────────────────────────────────────────────────

interface ModuleBaseContext {
  isServer: boolean;
  isClient: boolean;
  moduleName: string | null;
}

async function resolveModuleBaseContext(
  fsPath: string,
  service: BslContextService,
): Promise<ModuleBaseContext> {
  // Общий модуль: .../CommonModules/{Name}/Ext/Module.bsl
  const commonModuleMatch = /CommonModules\/([^/]+)\/Ext\/Module\.bsl$/i.exec(fsPath);
  if (commonModuleMatch) {
    const moduleName = commonModuleMatch[1];

    // Сначала из индекса сервиса (быстро)
    const info = service.getModuleByName(moduleName);
    if (info) {
      return {
        // ServerCall-модуль тоже исполняется на сервере — включаем в серверный контекст
        isServer: info.server || info.privileged || info.serverCall,
        // Только ClientManagedApplication — управляемое приложение.
        // ClientOrdinaryApplication — отдельный несовместимый контекст, не смешиваем.
        isClient: info.clientManagedApplication,
        moduleName: info.name,
      };
    }

    // Fallback: читаем XML напрямую — работает до инициализации сервиса
    const xmlPath = fsPath.replace(/\/CommonModules\/([^/]+)\/Ext\/Module\.bsl$/i, '/CommonModules/$1.xml');
    const props = await readXmlProps(xmlPath);
    if (props) {
      return {
        isServer: props.server || props.privileged || props.serverCall,
        isClient: props.clientManagedApplication,
        moduleName,
      };
    }

    // Эвристика по суффиксу имени
    return { ...heuristicByName(moduleName), moduleName };
  }

  // Модуль формы: .../Forms/{FormName}/Ext/Form.bsl — клиент + сервер
  if (/\/Forms\/[^/]+\/Ext\/Form\.bsl$/i.test(fsPath)) {
    return { isServer: true, isClient: true, moduleName: null };
  }

  // ObjectModule, ManagerModule, RecordSetModule и т.д. — только сервер
  return { isServer: true, isClient: false, moduleName: null };
}

// ── Поиск директивы компиляции по позиции курсора ───────────────────────────

/**
 * Находит директиву компиляции процедуры/функции, в которой находится курсор.
 * Возвращает имя директивы без символа &, или null если директивы нет.
 *
 * В 1С аннотации стоят перед функцией как отдельные узлы:
 *   &НаКлиенте
 *   &Перед("ОригинальныйМетод")
 *   Процедура МойМетод()
 *
 * Среди них ищем именно директиву компиляции, игнорируя расширенческие
 * (&Перед, &После, &Вместо, &ИзменениеИКонтроль).
 */
async function findCompilationDirective(
  text: string,
  position: Position,
  uri: string,
  parserService: BslParserService,
): Promise<string | null> {
  await parserService.ensureInit();

  let root: Node;
  try {
    root = parserService.parse(text, uri, -1).rootNode;
  } catch {
    return null;
  }

  const children = root.namedChildren.filter((n): n is Node => n !== null);

  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== 'procedure_definition' && node.type !== 'function_definition') {
      continue;
    }

    if (!containsPosition(node, position)) {
      continue;
    }

    // Курсор внутри этой функции — ищем директиву среди предшествующих аннотаций
    let j = i - 1;
    while (j >= 0 && children[j].type === 'annotation') {
      const annText = children[j].text.replace(/^&/, '').trim();
      if (DIRECTIVE_CONTEXT[annText.toLowerCase()]) {
        return annText;
      }
      j--;
    }

    // Функция найдена, но без директивы компиляции
    return null;
  }

  // Курсор вне любой функции (код на уровне модуля)
  return null;
}

/** Проверяет, находится ли позиция внутри узла AST. */
function containsPosition(node: Node, position: Position): boolean {
  const { row: startRow, column: startCol } = node.startPosition;
  const { row: endRow, column: endCol } = node.endPosition;

  if (position.line < startRow || position.line > endRow) {
    return false;
  }
  if (position.line === startRow && position.character < startCol) {
    return false;
  }
  if (position.line === endRow && position.character > endCol) {
    return false;
  }
  return true;
}

// ── Вспомогательные функции ──────────────────────────────────────────────────

interface XmlModuleProps {
  server: boolean;
  clientManagedApplication: boolean;
  clientOrdinaryApplication: boolean;
  serverCall: boolean;
  privileged: boolean;
}

async function readXmlProps(xmlPath: string): Promise<XmlModuleProps | null> {
  let text: string;
  try {
    text = await fs.promises.readFile(xmlPath, 'utf-8');
  } catch {
    return null;
  }
  return {
    server: extractBool(text, 'Server'),
    clientManagedApplication: extractBool(text, 'ClientManagedApplication'),
    clientOrdinaryApplication: extractBool(text, 'ClientOrdinaryApplication'),
    serverCall: extractBool(text, 'ServerCall'),
    privileged: extractBool(text, 'Privileged'),
  };
}

function extractBool(text: string, tag: string): boolean {
  const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`);
  const m = re.exec(text);
  return m ? m[1].trim() === 'true' : false;
}

/**
 * Эвристика контекста по суффиксу имени модуля (используется в крайнем случае).
 * Определяет только по конвенции именования БСП.
 */
function heuristicByName(name: string): { isServer: boolean; isClient: boolean } {
  const lower = name.toLowerCase();
  // КлиентСервер / ВызовСервера — оба контекста
  if (/клиентсервер|clientserver|вызовсервера|servercall/.test(lower)) {
    return { isServer: true, isClient: true };
  }
  // Клиент — только управляемый клиент
  if (/клиент|client/.test(lower)) {
    return { isServer: false, isClient: true };
  }
  // Сервер или без суффикса — только сервер
  return { isServer: true, isClient: false };
}
