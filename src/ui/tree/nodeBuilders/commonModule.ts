import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import { extractSimpleTag, extractSynonym } from '../../../infra/xml';
import {
  EnumPropertyOption,
  HandlerContext,
  LocalizedStringValue,
  ObjectHandler,
  ObjectPropertiesCollection,
} from './_types';

// ---------------------------------------------------------------------------
// Свойства объекта «Общий модуль» (CommonModule) в XML-выгрузке 1С:
//
// Name                       (string)  — имя (идентификатор)
// Synonym                    (LocalizedString) — синоним (представление для пользователя)
// Comment                    (string)  — комментарий разработчика
// Global                     (boolean) — глобальный модуль (методы доступны без указания имени модуля)
// ClientManagedApplication   (boolean) — доступен на клиенте управляемого приложения
// Server                     (boolean) — доступен на сервере
// ExternalConnection         (boolean) — доступен во внешнем соединении
// ClientOrdinaryApplication  (boolean) — доступен на клиенте обычного приложения
// ServerCall                 (boolean) — вызов сервера (клиент может вызывать экспортные методы)
// Privileged                 (boolean) — привилегированный (выполняется без проверки прав)
// ReturnValuesReuse          (enum: DontUse | DuringRequest | DuringSession)
//                                      — повторное использование возвращаемых значений
// ---------------------------------------------------------------------------

const FOLDER_NAME = 'CommonModules';
const RETURN_VALUES_REUSE_OPTIONS: EnumPropertyOption[] = [
  { value: 'DontUse', label: 'Не использовать' },
  { value: 'DuringRequest', label: 'На время вызова' },
  { value: 'DuringSession', label: 'На время сеанса' },
];

export const commonModuleHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    const descriptor = getNodeDescriptor('CommonModule');
    const folderPath = path.join(ctx.configRoot, FOLDER_NAME);

    return ctx.names.map((name) => {
      const xmlPath = resolveModuleXml(folderPath, name);

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = name.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const node = buildNode(descriptor, {
        label: name,
        kind: 'CommonModule',
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        xmlPath,
        childrenLoader: undefined,
        ownershipTag,
      });

      let cachedSynonym: string | undefined;
      Object.defineProperty(node, 'tooltip', {
        get: () => {
          if (cachedSynonym !== undefined) { return cachedSynonym; }
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
    return node.nodeKind === 'CommonModule' && Boolean(node.xmlPath);
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
        key: 'Global',
        title: 'Глобальный',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'Global'),
      },
      {
        key: 'ClientManagedApplication',
        title: 'Клиент управляемого приложения',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'ClientManagedApplication'),
      },
      {
        key: 'Server',
        title: 'Сервер',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'Server'),
      },
      {
        key: 'ExternalConnection',
        title: 'Внешнее соединение',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'ExternalConnection'),
      },
      {
        key: 'ClientOrdinaryApplication',
        title: 'Клиент обычного приложения',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'ClientOrdinaryApplication'),
      },
      {
        key: 'ServerCall',
        title: 'Вызов сервера',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'ServerCall'),
      },
      {
        key: 'Privileged',
        title: 'Привилегированный',
        kind: 'boolean',
        value: extractBooleanTag(xml, 'Privileged'),
      },
      {
        key: 'ReturnValuesReuse',
        title: 'Повторное использование возвращаемых значений',
        kind: 'enum',
        value: buildReturnValuesReuseValue(xml),
      },
    ];
  },
};

/** Резолвит путь к XML-файлу общего модуля (глубокая или плоская структура) */
function resolveModuleXml(folderPath: string, name: string): string | undefined {
  const deep = path.join(folderPath, name, `${name}.xml`);
  if (fs.existsSync(deep)) { return deep; }

  const flat = path.join(folderPath, `${name}.xml`);
  if (fs.existsSync(flat)) { return flat; }

  return undefined;
}

/** Извлекает булево свойство общего модуля */
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

/** Формирует значение перечисления ReturnValuesReuse с русскими представлениями */
function buildReturnValuesReuseValue(xml: string) {
  const current = extractSimpleTag(xml, 'ReturnValuesReuse') ?? 'DontUse';
  const currentOption = RETURN_VALUES_REUSE_OPTIONS.find((option) => option.value === current);

  return {
    current,
    currentLabel: currentOption?.label ?? current,
    allowedValues: RETURN_VALUES_REUSE_OPTIONS,
  };
}
