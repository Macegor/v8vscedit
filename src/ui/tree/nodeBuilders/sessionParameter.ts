import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import { extractSynonym } from '../../../infra/xml';
import {
  HandlerContext,
  ObjectHandler,
  ObjectPropertiesCollection,
} from './_types';
import {
  extractTopLevelPropertiesChildren,
  formatMetadataTypeDescription,
  formatUnknownPropertyInner,
  parseLocalizedStringSection,
} from '../../views/properties/MetadataXmlPropertiesService';

// ---------------------------------------------------------------------------
// Свойства объекта «Параметр сеанса» (SessionParameter) в XML-выгрузке 1С:
//
// Name    (string)           — имя параметра
// Synonym (LocalizedString) — синоним
// Comment (string)          — комментарий разработчика
// Type    (составной тип)   — один или несколько <v8:Type>, примитивы с квалификаторами
//                             (<v8:StringQualifiers>, <v8:NumberQualifiers>, …)
// ---------------------------------------------------------------------------

const FOLDER_NAME = 'SessionParameters';

export const sessionParameterHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    const descriptor = getNodeDescriptor('SessionParameter');
    const folderPath = path.join(ctx.configRoot, FOLDER_NAME);

    /** Имена уже в порядке следования тегов <SessionParameter> в Configuration.xml */
    return ctx.names.map((name) => {
      const xmlPath = resolveSessionParameterXml(folderPath, name);

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = name.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const node = buildNode(descriptor, {
        label: name,
        kind: 'SessionParameter',
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
    return node.nodeKind === 'SessionParameter' && Boolean(node.xmlPath);
  },

  getProperties(node) {
    if (!node.xmlPath || !fs.existsSync(node.xmlPath)) {
      return [];
    }

    const xml = fs.readFileSync(node.xmlPath, 'utf-8');
    const props: ObjectPropertiesCollection = [];

    /** Прямые дочерние элементы <Properties> — порядок как в файле выгрузки */
    for (const { tag, inner } of extractTopLevelPropertiesChildren(xml)) {
      if (tag === 'Name') {
        props.push({
          key: 'Name',
          title: 'Имя',
          kind: 'string',
          value: inner.trim() || node.label,
        });
        continue;
      }
      if (tag === 'Synonym') {
        props.push({
          key: 'Synonym',
          title: 'Синоним',
          kind: 'localizedString',
          value: parseLocalizedStringSection(inner),
        });
        continue;
      }
      if (tag === 'Comment') {
        props.push({
          key: 'Comment',
          title: 'Комментарий',
          kind: 'string',
          value: inner.trim(),
        });
        continue;
      }
      if (tag === 'Type') {
        props.push({
          key: 'Type',
          title: 'Тип',
          kind: 'string',
          value: formatMetadataTypeDescription(inner),
        });
        continue;
      }

      props.push({
        key: tag,
        title: tag,
        kind: 'string',
        value: inner.trim().length > 0 ? formatUnknownPropertyInner(inner) : '',
      });
    }

    return props;
  },
};

/** Резолвит путь к XML параметра сеанса (глубокая или плоская структура) */
function resolveSessionParameterXml(folderPath: string, name: string): string | undefined {
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
