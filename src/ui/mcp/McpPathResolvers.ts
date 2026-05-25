import * as path from 'path';
import {
  parseCanonicalPath,
  type ParsedCanonicalPath,
} from '../../domain/CanonicalNames';
import { getMetaFolder, type MetaKind } from '../../domain/MetaTypes';
import type { MetadataNode } from '../tree/TreeNode';
import type { McpMetadataPathService } from './McpMetadataPathService';

/**
 * Резолверы канонических путей в физические пути файлов и каталогов
 * для MCP-инструментов V8McpServer. Все функции — тонкие обёртки над
 * {@link McpMetadataPathService.resolveNode}: они находят узел и возвращают
 * нужный сервису путь (XML объекта, Form.xml, Rights.xml, …).
 *
 * Канонические пути формируются по правилам §1 плана `MCP_REFACTORING_PLAN.md`.
 */

/**
 * Возвращает XML-путь объекта/подсистемы по каноническому пути.
 * Падает с понятной ошибкой, если у узла нет XML-файла.
 */
export function resolveObjectXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (!node.xmlPath) {
    throw new Error(`Узел "${canonical}" не имеет XML-файла.`);
  }
  return node.xmlPath;
}

/**
 * Резолвит канонический путь формы (`Справочники.X.Форма.Y` или
 * `ОбщиеФормы.X`) в путь к файлу-дескриптору формы. Все формо-инструменты
 * (info/validate/edit/compile) принимают этот путь и сами достраивают
 * `Ext/Form.xml` при необходимости.
 */
export function resolveFormXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (node.nodeKind !== 'Form' && node.nodeKind !== 'CommonForm') {
    throw new Error(
      `Путь "${canonical}" должен указывать на форму (Справочники.X.Форма.Y или ОбщиеФормы.X), ` +
      `получено ${node.nodeKind}.`,
    );
  }
  if (!node.xmlPath) {
    throw new Error(`Форма "${canonical}" не имеет XML-файла.`);
  }
  return node.xmlPath;
}

/**
 * Резолвит канонический путь макета (`Справочники.X.Макет.Y` или
 * `ОбщиеМакеты.X`) в путь к XML-файлу макета.
 */
export function resolveTemplateXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (node.nodeKind !== 'Template' && node.nodeKind !== 'CommonTemplate') {
    throw new Error(
      `Путь "${canonical}" должен указывать на макет (Справочники.X.Макет.Y или ОбщиеМакеты.X), ` +
      `получено ${node.nodeKind}.`,
    );
  }
  if (!node.xmlPath) {
    throw new Error(`Макет "${canonical}" не имеет XML-файла.`);
  }
  return node.xmlPath;
}

/**
 * Резолвит канонический путь роли (`Роли.X`) в путь к её Rights.xml.
 * RoleRightsService принимает либо XML-метаданные роли, либо Rights.xml,
 * либо каталог роли — здесь возвращается xmlPath метаданных, который
 * сервис сам преобразует в Rights.xml.
 */
export function resolveRoleXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (node.nodeKind !== 'Role') {
    throw new Error(`Путь "${canonical}" должен указывать на роль (Роли.X), получено ${node.nodeKind}.`);
  }
  if (!node.xmlPath) {
    throw new Error(`Роль "${canonical}" не имеет XML-файла.`);
  }
  return node.xmlPath;
}

/**
 * Резолвит канонический путь подсистемы (`Подсистема.X.Y`) в её XML-файл.
 */
export function resolveSubsystemXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (node.nodeKind !== 'Subsystem') {
    throw new Error(`Путь "${canonical}" должен указывать на подсистему (Подсистема.X.Y), получено ${node.nodeKind}.`);
  }
  if (!node.xmlPath) {
    throw new Error(`Подсистема "${canonical}" не имеет XML-файла.`);
  }
  return node.xmlPath;
}

/**
 * Резолвит канонический путь подсистемы в путь к её `CommandInterface.xml`.
 * Файл может не существовать — CommandInterfaceService умеет создавать его
 * при необходимости (флаг `createIfMissing`).
 */
export function resolveCommandInterfaceXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (node.nodeKind !== 'Subsystem') {
    throw new Error(
      `Путь "${canonical}" должен указывать на подсистему — CommandInterface.xml ` +
      `создаётся рядом с её XML.`,
    );
  }
  if (!node.xmlPath) {
    throw new Error(`Подсистема "${canonical}" не имеет XML-файла.`);
  }
  // CommandInterface.xml живёт в каталоге подсистемы: <homeDir>/Ext/CommandInterface.xml,
  // где homeDir — каталог рядом с XML с тем же именем, что и сама подсистема.
  const subsystemDir = path.join(path.dirname(node.xmlPath), path.basename(node.xmlPath, '.xml'));
  return path.join(subsystemDir, 'Ext', 'CommandInterface.xml');
}

/**
 * Резолвит канонический путь корня (`Конфигурация` / `Расширение`)
 * в путь к Configuration.xml. Бросает понятную ошибку, если путь не
 * соответствует корню конфигурации/расширения.
 */
export function resolveConfigurationXmlByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const node = paths.resolveNode(canonical, configuration);
  if (node.nodeKind !== 'configuration' && node.nodeKind !== 'extension') {
    throw new Error(
      `Путь "${canonical}" должен указывать на корень конфигурации или расширения ` +
      `(Конфигурация / Расширение), получено ${node.nodeKind}.`,
    );
  }
  if (!node.xmlPath) {
    throw new Error(`Корень "${canonical}" не имеет Configuration.xml.`);
  }
  return node.xmlPath;
}

/**
 * Возвращает каталог конфигурации (где лежит Configuration.xml) по
 * каноническому пути корня. Используется в инструментах, ожидающих
 * `outputDir`/`configPath` каталог-уровня.
 */
export function resolveConfigurationRootDirByCanonical(
  paths: McpMetadataPathService,
  canonical: string,
  configuration?: string,
): string {
  const xmlPath = resolveConfigurationXmlByCanonical(paths, canonical, configuration);
  return path.dirname(xmlPath);
}

/**
 * Преобразует канонический путь модуля расширения CFE
 * (`Справочники.X.МодульОбъекта`, `Справочники.X.Форма.Y.МодульФормы`,
 * `ОбщиеМодули.X`) в legacy-формат `Type.Name.Module`, который ожидает
 * {@link CfePatchMethodService}. Допускает несуществующие модули в
 * расширении — резолвится только структура канонического пути.
 */
export function canonicalToLegacyModulePath(canonical: string): string {
  const parsed = parseCanonicalPath(canonical);
  return buildLegacyModulePath(parsed, canonical);
}

function buildLegacyModulePath(parsed: ParsedCanonicalPath, original: string): string {
  if (parsed.kind === 'root' && parsed.metaKind === 'CommonModule') {
    return `CommonModule.${parsed.name}`;
  }
  if (parsed.kind === 'module') {
    const folderKind = legacyFolderKind(parsed.rootKind);
    if (parsed.subPath) {
      // Внутри формы поддерживается только МодульФормы.
      if (parsed.subPath.tag !== 'Form' || parsed.slot !== 'ChildForm') {
        throw new Error(`Канонический путь модуля "${original}" не поддерживается CFE patch_method.`);
      }
      return `${folderKind}.${parsed.rootName}.Form.${parsed.subPath.name}`;
    }
    const tail = legacyModuleTail(parsed.slot);
    return `${folderKind}.${parsed.rootName}.${tail}`;
  }
  throw new Error(
    `Канонический путь модуля "${original}" должен указывать на модуль объекта или формы ` +
    `(Справочники.X.МодульОбъекта, Справочники.X.Форма.Y.МодульФормы, ОбщиеМодули.X).`,
  );
}

/**
 * Возвращает «единичный» английский корень типа для legacy ModulePath —
 * `Catalog`/`Document`/…, согласно {@link CfePatchMethodService}.
 * Опирается на `getMetaFolder` (множественное число папки), отбрасывая
 * стандартный суффикс `s` или специальное окончание.
 */
function legacyFolderKind(kind: MetaKind): string {
  // CfePatchMethodService умеет понимать как форму множественную (Catalogs),
  // так и единственную (Catalog). Возвращаем имя папки — оно поддерживается.
  const folder = getMetaFolder(kind);
  if (!folder) {
    throw new Error(`У типа "${kind}" нет каталога — модуль расширения определить нельзя.`);
  }
  return folder;
}

/** Возвращает legacy-сегмент модуля по слоту (`ObjectModule`, `ManagerModule`, …). */
function legacyModuleTail(slot: string): string {
  switch (slot) {
    case 'Object': return 'ObjectModule';
    case 'Manager': return 'ManagerModule';
    case 'ValueManager': return 'ValueManagerModule';
    case 'RecordSet': return 'RecordSetModule';
    case 'Service': return 'Module';
    case 'CommonCommand': return 'CommandModule';
    case 'ChildCommand': return 'CommandModule';
    default:
      throw new Error(`Слот модуля "${slot}" не поддерживается CFE patch_method.`);
  }
}

/**
 * Резолвит каноническую цепочку «путь корня + имя» для add_form/remove_form
 * и подобных инструментов, требующих отдельный XML объекта-владельца.
 * `parentCanonical` указывает на корневой объект (`Справочники.X`).
 */
export function resolveOwnerObjectXmlByCanonical(
  paths: McpMetadataPathService,
  parentCanonical: string,
  configuration?: string,
): MetadataNode {
  const node = paths.resolveNode(parentCanonical, configuration);
  if (!node.xmlPath || node.metaContext) {
    throw new Error(
      `Путь "${parentCanonical}" должен указывать на корневой объект конфигурации ` +
      `(например, Справочники.Контрагенты).`,
    );
  }
  return node;
}
