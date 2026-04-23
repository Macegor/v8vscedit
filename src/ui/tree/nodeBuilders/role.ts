import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import { extractSimpleTag, extractSynonym } from '../../../infra/xml';
import {
  HandlerContext,
  LocalizedStringValue,
  ObjectHandler,
  ObjectPropertiesCollection,
} from './_types';

// ---------------------------------------------------------------------------
// Роль (Role) в выгрузке 1С:
//
// Регистрация в Configuration.xml: теги <Role>Имя</Role> в <ChildObjects> —
// порядок узлов в навигаторе совпадает с порядком этих тегов (см. parseConfigXml).
//
// Метаданные: Roles/ИмяРоли.xml (плоская выгрузка) или Roles/ИмяРоли/ИмяРоли.xml.
// Права и глобальные флаги: Roles/ИмяРоли/Ext/Rights.xml — каталог Ext в дереве
// не раскрываем, для панели свойств читаются только три корневых флага Rights.
//
// Свойства метаданных (файл Role *.xml):
//   Name        — имя
//   Synonym     — синоним (локализованная строка)
//   Comment     — комментарий
//
// Глобальные флаги (корень Rights.xml, см. спецификацию ролей 1С):
//   setForNewObjects                  — права для новых объектов конфигурации
//   setForAttributesByDefault         — права для реквизитов по умолчанию
//   independentRightsOfChildObjects   — независимые права подчинённых объектов
// ---------------------------------------------------------------------------

const FOLDER_NAME = 'Roles';

/** Человекочитаемые подписи известных полей роли */
const ROLE_FIELD_TITLES: Record<string, string> = {
  Name: 'Имя',
  Synonym: 'Синоним',
  Comment: 'Комментарий',
  setForNewObjects: 'Устанавливать права для новых объектов конфигурации',
  setForAttributesByDefault: 'Устанавливать права для реквизитов по умолчанию',
  independentRightsOfChildObjects: 'Независимые права подчинённых объектов',
};

export const roleHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    const descriptor = getNodeDescriptor('Role');
    const folderPath = path.join(ctx.configRoot, FOLDER_NAME);

    /** Имена в порядке следования тегов <Role> в Configuration.xml */
    return ctx.names.map((name) => {
      const xmlPath = resolveRoleMetadataXml(folderPath, name);

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = name.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const node = buildNode(descriptor, {
        label: name,
        kind: 'Role',
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        xmlPath,
        childrenLoader: undefined,
        ownershipTag,
      });

      let cachedSynonym: string | undefined;
      Object.defineProperty(node, 'tooltip', {
        get: () => {
          if (cachedSynonym !== undefined) {
            return cachedSynonym;
          }
          if (xmlPath) {
            try {
              const xml = fs.readFileSync(xmlPath, 'utf-8');
              cachedSynonym = extractSynonym(xml) || '';
            } catch {
              cachedSynonym = '';
            }
          } else {
            cachedSynonym = '';
          }
          return cachedSynonym;
        },
        enumerable: true,
        configurable: true,
      });

      return node;
    });
  },

  canShowProperties(node) {
    return node.nodeKind === 'Role' && Boolean(node.xmlPath);
  },

  getProperties(node) {
    if (!node.xmlPath || !fs.existsSync(node.xmlPath)) {
      return [];
    }

    const xml = fs.readFileSync(node.xmlPath, 'utf-8');
    const props: ObjectPropertiesCollection = [];

    props.push({
      key: 'Name',
      title: ROLE_FIELD_TITLES.Name,
      kind: 'string',
      value: extractSimpleTag(xml, 'Name') ?? node.label,
    });
    props.push({
      key: 'Synonym',
      title: ROLE_FIELD_TITLES.Synonym,
      kind: 'localizedString',
      value: extractLocalizedString(xml, 'Synonym'),
    });
    props.push({
      key: 'Comment',
      title: ROLE_FIELD_TITLES.Comment,
      kind: 'string',
      value: extractSimpleTag(xml, 'Comment') ?? '',
    });

    const rightsPath = resolveRoleRightsXml(node.xmlPath, node.label);
    if (rightsPath && fs.existsSync(rightsPath)) {
      const rightsXml = fs.readFileSync(rightsPath, 'utf-8');
      props.push({
        key: 'setForNewObjects',
        title: ROLE_FIELD_TITLES.setForNewObjects,
        kind: 'boolean',
        value: extractBooleanFromSimpleTag(rightsXml, 'setForNewObjects'),
      });
      props.push({
        key: 'setForAttributesByDefault',
        title: ROLE_FIELD_TITLES.setForAttributesByDefault,
        kind: 'boolean',
        value: extractBooleanFromSimpleTag(rightsXml, 'setForAttributesByDefault'),
      });
      props.push({
        key: 'independentRightsOfChildObjects',
        title: ROLE_FIELD_TITLES.independentRightsOfChildObjects,
        kind: 'boolean',
        value: extractBooleanFromSimpleTag(rightsXml, 'independentRightsOfChildObjects'),
      });
    }

    return props;
  },
};

/**
 * Резолвит путь к XML метаданных роли (плоская или вложенная структура каталога Roles).
 */
function resolveRoleMetadataXml(folderPath: string, name: string): string | undefined {
  const deep = path.join(folderPath, name, `${name}.xml`);
  if (fs.existsSync(deep)) {
    return deep;
  }

  const flat = path.join(folderPath, `${name}.xml`);
  if (fs.existsSync(flat)) {
    return flat;
  }

  return undefined;
}

/**
 * Путь к Ext/Rights.xml: при выгрузке «в папку» XML лежит в Roles/Имя/Имя.xml;
 * при плоском варианте — Roles/Имя.xml, а права всё равно в Roles/Имя/Ext/Rights.xml.
 */
function resolveRoleRightsXml(metadataXmlPath: string, roleName: string): string | undefined {
  const dir = path.dirname(metadataXmlPath);
  const fileBase = path.basename(metadataXmlPath, '.xml');
  const rightsPath =
    fileBase === roleName && path.basename(dir) === roleName
      ? path.join(dir, 'Ext', 'Rights.xml')
      : path.join(dir, roleName, 'Ext', 'Rights.xml');
  return fs.existsSync(rightsPath) ? rightsPath : undefined;
}

/** Локализованная строка в секции tagName (как в общем модуле) */
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

/** Булево из простого тега со значением true/false */
function extractBooleanFromSimpleTag(xml: string, tagName: string): boolean {
  return (extractSimpleTag(xml, tagName) ?? '').trim().toLowerCase() === 'true';
}
