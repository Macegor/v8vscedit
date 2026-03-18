import * as fs from 'fs';
import * as path from 'path';
import { Node } from 'web-tree-sitter';
import { BslParserService } from './BslParserService';

/** Метаданные общего модуля конфигурации 1С. */
export interface CommonModuleInfo {
  /** Имя модуля (ОбщегоНазначения, ОбщегоНазначенияБЭДКлиент и т.д.) */
  name: string;
  /** Синоним на русском */
  synonymRu: string;
  /** Методы видны без указания имени модуля */
  global: boolean;
  /** Доступен в серверном контексте */
  server: boolean;
  /** Доступен в клиентском контексте управляемого приложения */
  clientManagedApplication: boolean;
  /** Доступен в клиентском контексте обычного приложения */
  clientOrdinaryApplication: boolean;
  /** Методы доступны на клиенте через серверный вызов */
  serverCall: boolean;
  /** Привилегированный режим */
  privileged: boolean;
  /** Путь к Module.bsl для lazy-загрузки экспортных методов */
  bslPath: string | null;
}

/** Экспортный метод общего модуля. */
export interface ExportMethod {
  name: string;
  isFunction: boolean;
  /** Строка параметров: "Знач Пар1, Пар2 = 0" */
  params: string;
}

/**
 * Центральный сервис контекста конфигурации 1С.
 * Хранит метаданные всех общих модулей из cf/ и cfe/.
 * Экспортные методы загружаются лениво при первом обращении.
 */
export class BslContextService {
  private modules = new Map<string, CommonModuleInfo>();
  /** Ключ — нижний регистр имени модуля для регистронезависимого поиска. */
  private modulesByLower = new Map<string, CommonModuleInfo>();
  private methodCache = new Map<string, ExportMethod[]>();
  private parserService: BslParserService;

  constructor(parserService: BslParserService) {
    this.parserService = parserService;
  }

  /**
   * Инициализирует сервис: ищет cf/ и cfe/ в корневых папках воркспейса
   * и парсит все CommonModules/*.xml.
   */
  async initialize(workspaceRoots: string[]): Promise<void> {
    this.modules.clear();
    this.modulesByLower.clear();
    this.methodCache.clear();

    const configRoots = await this.resolveConfigRoots(workspaceRoots);
    for (const cfRoot of configRoots) {
      await this.loadCommonModulesFromRoot(cfRoot);
    }
  }

  /** Возвращает все загруженные общие модули. */
  getModules(): CommonModuleInfo[] {
    return Array.from(this.modules.values());
  }

  /** Ищет модуль по имени (регистронезависимо). */
  getModuleByName(name: string): CommonModuleInfo | undefined {
    return this.modulesByLower.get(name.toLowerCase());
  }

  /**
   * Возвращает экспортные методы модуля.
   * Результат кэшируется после первого чтения.
   */
  async getExportMethods(moduleName: string): Promise<ExportMethod[]> {
    const key = moduleName.toLowerCase();

    if (this.methodCache.has(key)) {
      return this.methodCache.get(key)!;
    }

    const info = this.modulesByLower.get(key);
    if (!info || !info.bslPath) {
      return [];
    }

    const methods = await this.parseExportMethods(info.bslPath);
    this.methodCache.set(key, methods);
    return methods;
  }

  /** Сбрасывает весь кэш (вызывается при изменении Configuration.xml). */
  invalidate(): void {
    this.modules.clear();
    this.modulesByLower.clear();
    this.methodCache.clear();
  }

  /**
   * Находит директории cf/ и cfe/ в корневых папках воркспейса.
   * Поиск ведётся на двух уровнях глубины:
   *   <root>/cf/             → cfRoot = <root>/cf
   *   <root>/<sub>/cf/       → cfRoot = <root>/<sub>/cf   (например, example/cf)
   *   <root>/Configuration.xml → cfRoot = <root>           (fallback)
   */
  private async resolveConfigRoots(workspaceRoots: string[]): Promise<string[]> {
    const result: string[] = [];
    const seen = new Set<string>();

    const addIfConfig = async (dir: string): Promise<void> => {
      if (seen.has(dir)) {
        return;
      }
      if (await fileExists(path.join(dir, 'Configuration.xml'))) {
        seen.add(dir);
        result.push(dir);
      }
    };

    for (const root of workspaceRoots) {
      // Уровень 1: <root>/cf/, <root>/cfe/, <root>/
      for (const sub of ['cf', 'cfe']) {
        await addIfConfig(path.join(root, sub));
      }
      await addIfConfig(root);

      // Уровень 2: <root>/<any>/ и <root>/<any>/cf/, <root>/<any>/cfe/
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        const subDir = path.join(root, entry.name);
        for (const cfSub of ['cf', 'cfe']) {
          await addIfConfig(path.join(subDir, cfSub));
        }
        await addIfConfig(subDir);
      }
    }

    return result;
  }

  /** Читает все CommonModules/*.xml из директории конфигурации. */
  private async loadCommonModulesFromRoot(cfRoot: string): Promise<void> {
    const modulesDir = path.join(cfRoot, 'CommonModules');
    let entries: fs.Dirent[];

    try {
      entries = await fs.promises.readdir(modulesDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.xml')) {
        continue;
      }

      const xmlPath = path.join(modulesDir, entry.name);
      const info = await this.parseCommonModuleXml(xmlPath, cfRoot);
      if (info) {
        this.modules.set(info.name, info);
        this.modulesByLower.set(info.name.toLowerCase(), info);
      }
    }
  }

  /**
   * Парсит XML-файл общего модуля.
   * Использует regex — не требует DOM-парсера.
   */
  private async parseCommonModuleXml(
    xmlPath: string,
    cfRoot: string,
  ): Promise<CommonModuleInfo | null> {
    let text: string;
    try {
      text = await fs.promises.readFile(xmlPath, 'utf-8');
    } catch {
      return null;
    }

    const name = extractTag(text, 'Name');
    if (!name) {
      return null;
    }

    // Синоним — первый <v8:content> внутри <Synonym>
    const synonymMatch = /<Synonym[\s\S]*?<v8:content>([\s\S]*?)<\/v8:content>/m.exec(text);
    const synonymRu = synonymMatch ? synonymMatch[1].trim() : name;

    const bslCandidate = path.join(cfRoot, 'CommonModules', name, 'Ext', 'Module.bsl');
    const bslPath = (await fileExists(bslCandidate)) ? bslCandidate : null;

    return {
      name,
      synonymRu,
      global: extractBool(text, 'Global'),
      server: extractBool(text, 'Server'),
      clientManagedApplication: extractBool(text, 'ClientManagedApplication'),
      clientOrdinaryApplication: extractBool(text, 'ClientOrdinaryApplication'),
      serverCall: extractBool(text, 'ServerCall'),
      privileged: extractBool(text, 'Privileged'),
      bslPath,
    };
  }

  /**
   * Читает BSL-файл и извлекает только экспортные процедуры/функции.
   * Парсит через tree-sitter (используется общий BslParserService).
   */
  private async parseExportMethods(bslPath: string): Promise<ExportMethod[]> {
    let text: string;
    try {
      text = await fs.promises.readFile(bslPath, 'utf-8');
    } catch {
      return [];
    }

    await this.parserService.ensureInit();
    let root: Node;
    try {
      root = this.parserService.parse(text, `file:///${bslPath.replace(/\\/g, '/')}`).rootNode;
    } catch {
      return [];
    }

    const methods: ExportMethod[] = [];

    for (const node of root.namedChildren) {
      if (!node) {
        continue;
      }
      const t = node.type;
      if (t !== 'procedure_definition' && t !== 'function_definition') {
        continue;
      }

      // Только экспортные методы
      const exportNode = node.childForFieldName('export');
      if (!exportNode) {
        continue;
      }

      const nameNode = node.childForFieldName('name');
      if (!nameNode) {
        continue;
      }

      const paramsNode = node.childForFieldName('parameters');
      const params = paramsNode ? buildParamsString(paramsNode) : '';

      methods.push({
        name: nameNode.text,
        isFunction: t === 'function_definition',
        params,
      });
    }

    return methods;
  }
}

// ── Вспомогательные функции ──────────────────────────────────────────────────

/** Извлекает текстовое содержимое тега (первое вхождение). */
function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]+)<\\/${tag}>`);
  const m = re.exec(text);
  return m ? m[1].trim() : null;
}

/** Извлекает булево значение из тега. Значение по умолчанию — false. */
function extractBool(text: string, tag: string): boolean {
  return extractTag(text, tag) === 'true';
}

/** Проверяет существование файла. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Строит строку параметров из узла параметров AST. */
function buildParamsString(paramsNode: Node): string {
  const parts: string[] = [];
  for (const param of paramsNode.namedChildren) {
    if (!param || param.type !== 'parameter') {
      continue;
    }
    let part = '';
    if (param.childForFieldName('val')) {
      part += 'Знач ';
    }
    const nameNode = param.childForFieldName('name');
    if (nameNode) {
      part += nameNode.text;
    }
    const defaultNode = param.childForFieldName('default_value');
    if (defaultNode) {
      part += ` = ${defaultNode.text}`;
    }
    parts.push(part);
  }
  return parts.join(', ');
}
