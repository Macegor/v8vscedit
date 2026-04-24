import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { MetadataNode } from '../TreeNode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import { extractSimpleTag, extractSynonym } from '../../../infra/xml';
import {
  HandlerContext,
  LocalizedStringValue,
  ObjectHandler,
  ObjectPropertiesCollection,
} from './_types';

const FOLDER_NAME = 'Subsystems';

/** Ссылка на узел подсистемы: уникальность по пути к XML (имена вроде «БРМК» могут повторяться в разных ветках) */
interface SubsystemNodeRef {
  /** Имя для отображения (из Configuration.xml или из XML объекта) */
  label: string;
  /** Абсолютный путь к файлу описания подсистемы */
  xmlPath: string;
  /** Каталог «дома» подсистемы: рядом лежит папка Subsystems с дочерними описаниями */
  homeDir: string;
}

export const subsystemHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    const descriptor = getNodeDescriptor('Subsystem');
    const subsystemsRoot = path.join(ctx.configRoot, FOLDER_NAME);

    const buildSubsystemNode = (ref: SubsystemNodeRef, visitedXmlPaths: Set<string>): MetadataNode => {
      if (visitedXmlPaths.has(ref.xmlPath)) {
        return buildLeafDuplicate(ref);
      }
      visitedXmlPaths.add(ref.xmlPath);

      const xml = safeReadFile(ref.xmlPath);
      const objectName = extractSimpleTag(xml, 'Name') ?? ref.label;
      const synonym = xml ? extractSynonym(xml) : '';

      const childNamesOrdered = uniqueStrings(
        extractChildSubsystems(xml).filter((childName) => childName !== objectName)
      );

      const childRefs: SubsystemNodeRef[] = [];
      for (const childName of childNamesOrdered) {
        const childXmlPath = resolveChildSubsystemXml(ref.homeDir, childName);
        if (!childXmlPath) {
          continue;
        }
        childRefs.push({
          label: childName,
          xmlPath: childXmlPath,
          homeDir: getSubsystemHomeDir(childXmlPath, childName),
        });
      }

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = objectName.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const nextVisited = new Set(visitedXmlPaths);
      const node = buildNode(descriptor, {
        label: objectName,
        kind: 'Subsystem',
        collapsibleState: childRefs.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        xmlPath: ref.xmlPath,
        childrenLoader: childRefs.length > 0
          ? () => childRefs.map((childRef) => buildSubsystemNode(childRef, nextVisited))
          : undefined,
        ownershipTag,
      });

      if (synonym) {
        node.tooltip = synonym;
      }

      return node;
    };

    /** Корневые подсистемы — только объявления из Configuration.xml, порядок как в файле */
    const result: MetadataNode[] = [];
    for (const name of ctx.names) {
      const xmlPath = resolveRootSubsystemXml(subsystemsRoot, name);
      if (!xmlPath) {
        continue;
      }
      const homeDir = getSubsystemHomeDir(xmlPath, name);
      result.push(
        buildSubsystemNode(
          { label: name, xmlPath, homeDir },
          new Set<string>()
        )
      );
    }

    return result;
  },

  canShowProperties(node) {
    return node.nodeKind === 'Subsystem' && Boolean(node.xmlPath);
  },

  getProperties(node) {
    if (!node.xmlPath || !fs.existsSync(node.xmlPath)) {
      return [];
    }

    const xml = fs.readFileSync(node.xmlPath, 'utf-8');

    return [
      {
        key: 'Name',
        title: 'Имя',
        kind: 'string',
        value: extractSimpleTag(xml, 'Name') ?? node.textLabel,
      },
      {
        key: 'Synonym',
        title: 'Синоним',
        kind: 'localizedString',
        value: extractLocalizedString(xml, 'Synonym'),
      },
      {
        key: 'Comment',
        title: 'Комментарий',
        kind: 'string',
        value: extractSimpleTag(xml, 'Comment') ?? '',
      },
      {
        key: 'IncludeHelpInContents',
        title: 'Включать справку в содержание',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'IncludeHelpInContents'),
      },
      {
        key: 'IncludeInCommandInterface',
        title: 'Включать в командный интерфейс',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'IncludeInCommandInterface'),
      },
      {
        key: 'UseOneCommand',
        title: 'Использовать одну команду',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'UseOneCommand'),
      },
      {
        key: 'Explanation',
        title: 'Пояснение',
        kind: 'localizedString',
        value: extractLocalizedString(xml, 'Explanation'),
      },
      {
        key: 'PictureRef',
        title: 'Картинка (ссылка)',
        kind: 'string',
        value: extractPictureRef(xml),
      },
      {
        key: 'PictureLoadTransparent',
        title: 'Картинка: загружать прозрачный фон',
        kind: 'boolean',
        value: extractPictureLoadTransparent(xml),
      },
    ];
  },
};

/**
 * Каталог подсистемы: в нём лежит папка Subsystems с XML дочерних подсистем.
 * Варианты выгрузки: Subsystems/Имя/Имя.xml или Subsystems/Имя.xml.
 */
function getSubsystemHomeDir(xmlPath: string, subsystemName: string): string {
  const dir = path.dirname(xmlPath);
  if (path.basename(dir) === subsystemName) {
    return dir;
  }
  return path.join(dir, subsystemName);
}

/** XML корневой подсистемы из каталога выгрузки Subsystems/ */
function resolveRootSubsystemXml(subsystemsRoot: string, name: string): string | undefined {
  const deep = path.join(subsystemsRoot, name, `${name}.xml`);
  if (fs.existsSync(deep)) {
    return deep;
  }
  const flat = path.join(subsystemsRoot, `${name}.xml`);
  if (fs.existsSync(flat)) {
    return flat;
  }
  return undefined;
}

/**
 * XML дочерней подсистемы относительно «дома» родителя:
 * Родитель/Home/Subsystems/Имя/Имя.xml или Родитель/Home/Subsystems/Имя.xml
 */
function resolveChildSubsystemXml(parentHomeDir: string, childName: string): string | undefined {
  const nestedRoot = path.join(parentHomeDir, 'Subsystems', childName, `${childName}.xml`);
  if (fs.existsSync(nestedRoot)) {
    return nestedRoot;
  }
  const nestedFlat = path.join(parentHomeDir, 'Subsystems', `${childName}.xml`);
  if (fs.existsSync(nestedFlat)) {
    return nestedFlat;
  }
  return undefined;
}

/** Узел-заглушка при циклической ссылке в метаданных (без повторного разворачивания того же XML) */
function buildLeafDuplicate(ref: SubsystemNodeRef) {
  const descriptor = getNodeDescriptor('Subsystem');
  return buildNode(descriptor, {
    label: `${ref.label} (цикл)`,
    kind: 'Subsystem',
    collapsibleState: vscode.TreeItemCollapsibleState.None,
    xmlPath: ref.xmlPath,
    childrenLoader: undefined,
    ownershipTag: undefined,
  });
}

/** Безопасно читает XML-файл, возвращает пустую строку при ошибке */
function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

/** Извлекает имена дочерних подсистем из первой секции ChildObjects файла подсистемы */
function extractChildSubsystems(xml: string): string[] {
  const childBlockMatch = xml.match(/<ChildObjects>([\s\S]*?)<\/ChildObjects>/);
  if (!childBlockMatch) {
    return [];
  }

  const result: string[] = [];
  for (const match of childBlockMatch[1].matchAll(/<Subsystem>([^<]+)<\/Subsystem>/g)) {
    const name = match[1].trim();
    if (name) {
      result.push(name);
    }
  }
  return result;
}

/** Извлекает булево свойство подсистемы */
function extractBooleanTag(xml: string, tagName: string): boolean {
  return (extractSimpleTag(xml, tagName) ?? '').trim().toLowerCase() === 'true';
}

/** Извлекает локализованную строку из секции вида <Synonym> */
function extractLocalizedString(xml: string, tagName: string): LocalizedStringValue {
  const sectionMatch = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(xml);
  if (!sectionMatch) {
    return { presentation: '', values: [] };
  }

  const values = Array.from(
    sectionMatch[1].matchAll(/<v8:item>\s*<v8:lang>([^<]*)<\/v8:lang>\s*<v8:content>([\s\S]*?)<\/v8:content>\s*<\/v8:item>/g)
  ).map((match) => ({
    lang: match[1].trim(),
    content: match[2].trim(),
  }));

  return {
    presentation: values[0]?.content ?? '',
    values,
  };
}

/** Возвращает ссылку на картинку подсистемы из Picture/xr:Ref */
function extractPictureRef(xml: string): string {
  const pictureSection = xml.match(/<Picture>([\s\S]*?)<\/Picture>/);
  if (!pictureSection) {
    return '';
  }
  const refMatch = pictureSection[1].match(/<xr:Ref>([^<]*)<\/xr:Ref>/);
  return refMatch ? refMatch[1].trim() : '';
}

/** Возвращает признак загрузки прозрачного фона из Picture/xr:LoadTransparent */
function extractPictureLoadTransparent(xml: string): boolean {
  const pictureSection = xml.match(/<Picture>([\s\S]*?)<\/Picture>/);
  if (!pictureSection) {
    return false;
  }
  const loadTransparentMatch = pictureSection[1].match(/<xr:LoadTransparent>([^<]*)<\/xr:LoadTransparent>/);
  return (loadTransparentMatch?.[1] ?? '').trim().toLowerCase() === 'true';
}

/** Удаляет дубликаты строк с сохранением порядка */
function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
