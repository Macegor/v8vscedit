import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { buildNode } from '../nodes/_base';
import { getNodeDescriptor } from '../nodes/index';
import { extractSynonym } from '../../../infra/xml';
import {
  EnumPropertyOption,
  EnumPropertyValue,
  HandlerContext,
  ObjectHandler,
  ObjectPropertiesCollection,
} from './_types';
import {
  extractTopLevelPropertiesChildren,
  formatUnknownPropertyInner,
  parseLocalizedStringSection,
} from '../../views/properties/MetadataXmlPropertiesService';
import { parseMetadataType } from '../../views/properties/MetadataTypeService';

// ---------------------------------------------------------------------------
// Общий реквизит (CommonAttribute) в выгрузке 1С:
//
// Регистрация: теги <CommonAttribute>Имя</CommonAttribute> в Configuration.xml —
// порядок узлов совпадает с порядком этих тегов.
//
// Файлы: CommonAttributes/Имя.xml или CommonAttributes/Имя/Имя.xml.
// Вложенные каталоги с детализацией в дереве не показываются.
// ---------------------------------------------------------------------------

const FOLDER_NAME = 'CommonAttributes';

/** Подписи свойств общего реквизита в панели свойств (рус.) */
const PROPERTY_TITLES: Record<string, string> = {
  Name: 'Имя',
  Synonym: 'Синоним',
  Comment: 'Комментарий',
  Type: 'Тип',
  PasswordMode: 'Режим пароля',
  Format: 'Формат',
  EditFormat: 'Формат редактирования',
  ToolTip: 'Подсказка',
  MarkNegatives: 'Отметка отрицательных',
  Mask: 'Маска',
  MultiLine: 'Многострочный режим',
  ExtendedEdit: 'Расширенное редактирование',
  MinValue: 'Минимальное значение',
  MaxValue: 'Максимальное значение',
  FillFromFillingValue: 'Заполнять из значения заполнения',
  FillValue: 'Значение заполнения',
  FillChecking: 'Проверка заполнения',
  ChoiceFoldersAndItems: 'Выбор папок и элементов',
  ChoiceParameterLinks: 'Связи параметров выбора',
  ChoiceParameters: 'Параметры выбора',
  QuickChoice: 'Быстрый выбор',
  CreateOnInput: 'Создание при вводе',
  ChoiceForm: 'Форма выбора',
  LinkByType: 'Связь по типу',
  ChoiceHistoryOnInput: 'История выбора при вводе',
  Content: 'Состав',
  AutoUse: 'Автоиспользование',
  DataSeparation: 'Разделение данных',
  SeparatedDataUse: 'Использование разделённых данных',
  DataSeparationValue: 'Значение разделения данных',
  DataSeparationUse: 'Использование разделения данных',
  ConditionalSeparation: 'Условное разделение',
  UsersSeparation: 'Разделение пользователей',
  AuthenticationSeparation: 'Разделение аутентификации',
  ConfigurationExtensionsSeparation: 'Разделение расширений конфигурации',
  Indexing: 'Индексирование',
  FullTextSearch: 'Полнотекстовый поиск',
  DataHistory: 'История данных',
};

/** Теги со значением true/false в выгрузке */
const BOOLEAN_PROPERTY_TAGS = new Set([
  'PasswordMode',
  'MarkNegatives',
  'MultiLine',
  'ExtendedEdit',
  'FillFromFillingValue',
]);

/** Значения DontUse / Use / Auto — единые подписи для всех свойств, где они встречаются */
const ENUM_AUTO_DONT_USE_USE: EnumPropertyOption[] = [
  { value: 'DontUse', label: 'Не использовать' },
  { value: 'Use', label: 'Использовать' },
  { value: 'Auto', label: 'Авто' },
];

const ENUM_DONT_USE_USE: EnumPropertyOption[] = [
  { value: 'DontUse', label: 'Не использовать' },
  { value: 'Use', label: 'Использовать' },
];

/** Проверка заполнения реквизита (FillChecking) */
const ENUM_FILL_CHECKING: EnumPropertyOption[] = [
  { value: 'DontCheck', label: 'Не проверять' },
  { value: 'ShowError', label: 'Выдавать ошибку' },
];

/** Выбор папок и элементов при подборе */
const ENUM_CHOICE_FOLDERS_AND_ITEMS: EnumPropertyOption[] = [
  { value: 'Folders', label: 'Папки' },
  { value: 'Items', label: 'Элементы' },
  { value: 'FoldersAndItems', label: 'Папки и элементы' },
];

/** Использование разделённых данных (SeparatedDataUse) */
const ENUM_SEPARATED_DATA_USE: EnumPropertyOption[] = [
  { value: 'Independently', label: 'Независимо' },
  { value: 'TogetherWithMainData', label: 'Совместно с основными данными' },
];

/** Индексирование */
const ENUM_INDEXING: EnumPropertyOption[] = [
  { value: 'DontIndex', label: 'Не индексировать' },
  { value: 'Index', label: 'Индексировать' },
  { value: 'IndexWithAdditionalOrder', label: 'Индексировать с дополнительным упорядочиванием' },
];

/** Теги свойств с перечислимым значением и допустимые варианты (как ReturnValuesReuse в общем модуле) */
const ENUM_OPTIONS_BY_TAG: Record<string, EnumPropertyOption[]> = {
  FillChecking: ENUM_FILL_CHECKING,
  ChoiceFoldersAndItems: ENUM_CHOICE_FOLDERS_AND_ITEMS,
  QuickChoice: ENUM_AUTO_DONT_USE_USE,
  CreateOnInput: ENUM_AUTO_DONT_USE_USE,
  ChoiceHistoryOnInput: ENUM_AUTO_DONT_USE_USE,
  AutoUse: ENUM_DONT_USE_USE,
  DataSeparation: ENUM_DONT_USE_USE,
  UsersSeparation: ENUM_DONT_USE_USE,
  AuthenticationSeparation: ENUM_DONT_USE_USE,
  ConfigurationExtensionsSeparation: ENUM_DONT_USE_USE,
  SeparatedDataUse: ENUM_SEPARATED_DATA_USE,
  Indexing: ENUM_INDEXING,
  FullTextSearch: ENUM_AUTO_DONT_USE_USE,
  DataHistory: ENUM_AUTO_DONT_USE_USE,
};

export const commonAttributeHandler: ObjectHandler = {
  buildTreeNodes(ctx: HandlerContext) {
    const descriptor = getNodeDescriptor('CommonAttribute');
    const folderPath = path.join(ctx.configRoot, FOLDER_NAME);

    /** Имена в порядке следования тегов <CommonAttribute> в Configuration.xml */
    return ctx.names.map((name) => {
      const xmlPath = resolveCommonAttributeXml(folderPath, name);

      let ownershipTag: 'OWN' | 'BORROWED' | undefined;
      if (ctx.configKind === 'cfe' && ctx.namePrefix) {
        ownershipTag = name.startsWith(ctx.namePrefix) ? 'OWN' : 'BORROWED';
      }

      const node = buildNode(descriptor, {
        label: name,
        kind: 'CommonAttribute',
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
    return node.nodeKind === 'CommonAttribute' && Boolean(node.xmlPath);
  },

  getProperties(node) {
    if (!node.xmlPath || !fs.existsSync(node.xmlPath)) {
      return [];
    }

    const xml = fs.readFileSync(node.xmlPath, 'utf-8');
    const props: ObjectPropertiesCollection = [];

    for (const { tag, inner } of extractTopLevelPropertiesChildren(xml)) {
      const title = PROPERTY_TITLES[tag] ?? tag;

      if (tag === 'Name') {
        props.push({
          key: 'Name',
          title,
          kind: 'string',
          value: inner.trim() || node.label,
        });
        continue;
      }
      if (tag === 'Synonym') {
        props.push({
          key: 'Synonym',
          title,
          kind: 'localizedString',
          value: parseLocalizedStringSection(inner),
        });
        continue;
      }
      if (tag === 'Comment') {
        props.push({
          key: 'Comment',
          title,
          kind: 'string',
          value: inner.trim(),
        });
        continue;
      }
      if (tag === 'Type') {
        props.push({
          key: 'Type',
          title,
          kind: 'metadataType',
          value: parseMetadataType(inner),
        });
        continue;
      }
      if (BOOLEAN_PROPERTY_TAGS.has(tag)) {
        props.push({
          key: tag,
          title,
          kind: 'boolean',
          value: inner.trim().toLowerCase() === 'true',
        });
        continue;
      }

      const enumOptions = ENUM_OPTIONS_BY_TAG[tag];
      if (enumOptions) {
        props.push({
          key: tag,
          title,
          kind: 'enum',
          value: buildEnumPropertyValue(inner.trim(), enumOptions),
        });
        continue;
      }

      props.push({
        key: tag,
        title,
        kind: 'string',
        value: inner.trim().length > 0 ? formatUnknownPropertyInner(inner) : '',
      });
    }

    return props;
  },
};

/**
 * Формирует значение перечислимого свойства для панели (см. commonModule — ReturnValuesReuse).
 * Если в XML встретилось значение вне списка — добавляет его с подписью по общим правилам.
 */
function buildEnumPropertyValue(currentRaw: string, allowedValues: EnumPropertyOption[]): EnumPropertyValue {
  const current = currentRaw;
  const labelByValue = new Map(allowedValues.map((o) => [o.value, o.label]));
  const commonExtra: Record<string, string> = {
    Auto: 'Авто',
    DontUse: 'Не использовать',
    Use: 'Использовать',
  };

  let merged = allowedValues;
  if (current && !labelByValue.has(current)) {
    merged = [
      ...allowedValues,
      {
        value: current,
        label: commonExtra[current] ?? current,
      },
    ];
  }

  const currentLabel =
    merged.find((o) => o.value === current)?.label ??
    commonExtra[current] ??
    current;

  return { current, currentLabel, allowedValues: merged };
}

/** Путь к XML общего реквизита (плоская или вложенная структура каталога CommonAttributes) */
function resolveCommonAttributeXml(folderPath: string, name: string): string | undefined {
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
