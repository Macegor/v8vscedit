import type {
  MetadataDateQualifiers,
  MetadataNumberQualifiers,
  MetadataStringQualifiers,
  MetadataTypeItem,
  MetadataTypeValue,
} from './_types';
import {
  canonicalToXmlToken,
  extractFirstBalancedBlock,
  extractRepeatedSimpleTagValues,
  extractSimpleTag,
  tokenToCanonical,
  type TypeContext,
} from '../../../infra/xml';

/**
 * Сервис разбора и сборки блока `<Type>` объекта метаданных.
 *
 * Источник правды о соответствии русских/английских имён и XML-токенов —
 * `infra/xml/PlatformTypeRegistry`. Здесь — только разбор XML и форматирование
 * выходного представления. Поле `MetadataTypeItem.canonical` хранит английскую
 * форму (`String`, `UUID`, `CatalogRef.X`), `display` — русскую.
 */

// ─── Карты «английская форма ↔ русская/тип-группа» ───────────────────────

/**
 * Английское имя базового типа → его токен в `<v8:Type>`. Список совпадает
 * с `BASE_TYPES.english`. Использовать `canonicalToXmlToken` напрямую нельзя:
 * там вход — русская форма, а `MetadataTypeItem.canonical` хранит английскую.
 */
const ENGLISH_BASE_PRIMITIVE_TOKENS: Record<string, string> = {
  String: 'xs:string',
  Number: 'xs:decimal',
  Boolean: 'xs:boolean',
  Date: 'xs:dateTime',
  DateTime: 'xs:dateTime',
  BinaryData: 'xs:base64Binary',
};

/** Английское имя → токен формы (только для тех, у кого токен не `xs:*`). */
const ENGLISH_BASE_FORM_TOKENS: Record<string, string> = {
  ValueStorage: 'v8:ValueStorage',
  UUID: 'v8:UUID',
  Type: 'v8:Type',
  TypeDescription: 'v8:TypeDescription',
  ValueList: 'v8:ValueListType',
  ValueTable: 'v8:ValueTable',
  ValueTree: 'v8:ValueTree',
  Array: 'v8:Array',
  FixedArray: 'v8:FixedArray',
  Structure: 'v8:Structure',
  FixedStructure: 'v8:FixedStructure',
  SpreadsheetDocument: 'v8:SpreadsheetDocument',
  Picture: 'v8ui:Picture',
  FormattedString: 'v8ui:FormattedString',
};

/** Английское имя → русское для базовых типов. */
const ENGLISH_BASE_TO_DISPLAY: Record<string, string> = {
  String: 'Строка',
  Number: 'Число',
  Boolean: 'Булево',
  Date: 'Дата',
  DateTime: 'ДатаВремя',
  ValueStorage: 'ХранилищеЗначения',
  UUID: 'УникальныйИдентификатор',
  Type: 'Тип',
  TypeDescription: 'ОписаниеТипов',
  ValueList: 'СписокЗначений',
  ValueTable: 'ТаблицаЗначений',
  ValueTree: 'ДеревоЗначений',
  Array: 'Массив',
  FixedArray: 'ФиксированныйМассив',
  Structure: 'Структура',
  FixedStructure: 'ФиксированнаяСтруктура',
  SpreadsheetDocument: 'ТабличныйДокумент',
  Picture: 'Картинка',
  FormattedString: 'ФорматированнаяСтрока',
  BinaryData: 'ДвоичныеДанные',
};

/**
 * Резолвит «сырое» имя типа из XML (`xs:string`, `v8:UUID`, `d5p1:CatalogRef.X`)
 * в каноническую английскую форму, которая хранится в `MetadataTypeItem.canonical`.
 */
function resolveCanonical(rawType: string): string {
  // Сначала пробуем как XML-токен.
  const russian = tokenToCanonical(rawType);
  if (russian) {
    // По русской форме найдём английскую через обратный маппинг.
    const english = russianToEnglish(russian);
    if (english) {
      return english;
    }
  }
  // Снимаем неймспейс-префикс и возвращаем как есть (для устаревших форм).
  return rawType.replace(/^d\d+p\d+:/, '').replace(/^cfg:/, '');
}

function russianToEnglish(russian: string): string | undefined {
  for (const [english, rus] of Object.entries(ENGLISH_BASE_TO_DISPLAY)) {
    if (rus === russian) {
      return english;
    }
  }
  // Ссылочный тип `Префикс.Имя` — пробуем разобрать.
  const dotIndex = russian.indexOf('.');
  if (dotIndex <= 0) {
    return undefined;
  }
  // Используем `canonicalToXmlToken` в произвольном контексте, чтобы получить
  // английскую форму вида `CatalogRef.X`. Если ни metadataAttribute, ни
  // formAttribute не подходят — возвращаем undefined.
  for (const ctx of ['metadataAttribute', 'formAttribute'] as TypeContext[]) {
    const token = canonicalToXmlToken(russian, ctx);
    if (token && !token.startsWith('xs:') && !token.startsWith('v8:') && !token.startsWith('v8ui:')) {
      return token;
    }
  }
  return undefined;
}

/** Английская форма → русская (с восстановлением для ссылочных). */
function toDisplay(canonical: string): string {
  const base = ENGLISH_BASE_TO_DISPLAY[canonical];
  if (base) {
    return base;
  }
  // Ссылочный английский тип `CatalogRef.Имя`.
  const russian = tokenToCanonical(canonical);
  return russian ?? canonical;
}

/** Классификация типа для дерева выбора. */
function detectGroup(canonical: string): MetadataTypeItem['group'] {
  if (canonical.startsWith('DefinedType.')) {
    return 'defined';
  }
  if (ENGLISH_BASE_TO_DISPLAY[canonical]) {
    return 'primitive';
  }
  if (/^[A-Za-z]+(?:Ref|Object|Manager|Selection|List|RecordSet|RecordKey|RecordManager|Recalculation|ValueManager|RoutePointRef)(?:\..+)?$/.test(canonical)) {
    return 'reference';
  }
  return 'primitive';
}

/** Создает элемент состава типа из канонической записи XML */
export function buildMetadataTypeItem(canonical: string): MetadataTypeItem {
  return {
    canonical,
    display: toDisplay(canonical),
    group: detectGroup(canonical),
  };
}

/** Разбирает внутренность `<Type>...</Type>` в структурированную модель */
export function parseMetadataType(typeInner: string): MetadataTypeValue {
  const items: MetadataTypeItem[] = [];
  const seen = new Set<string>();
  const rawTypes = extractRepeatedSimpleTagValues(typeInner, 'Type');
  const typeSets = extractRepeatedSimpleTagValues(typeInner, 'TypeSet');

  for (const raw of [...rawTypes, ...typeSets]) {
    const canonical = resolveCanonical(raw);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    items.push(buildMetadataTypeItem(canonical));
  }

  const stringBlock = extractFirstBalancedBlock(typeInner, 'v8:StringQualifiers');
  const numberBlock = extractFirstBalancedBlock(typeInner, 'v8:NumberQualifiers');
  const dateBlock = extractFirstBalancedBlock(typeInner, 'v8:DateQualifiers');

  const stringQualifiers: MetadataStringQualifiers | undefined = stringBlock
    ? {
        length: parseNumber(extractSimpleTag(stringBlock, 'v8:Length')),
        allowedLength: toAllowedLength(extractSimpleTag(stringBlock, 'v8:AllowedLength')),
      }
    : undefined;
  const numberQualifiers: MetadataNumberQualifiers | undefined = numberBlock
    ? {
        digits: parseNumber(extractSimpleTag(numberBlock, 'v8:Digits')),
        fractionDigits: parseNumber(extractSimpleTag(numberBlock, 'v8:FractionDigits')),
        allowedSign: toAllowedSign(extractSimpleTag(numberBlock, 'v8:AllowedSign')),
      }
    : undefined;
  const dateQualifiers: MetadataDateQualifiers | undefined = dateBlock
    ? {
        dateFractions: toDateFractions(extractSimpleTag(dateBlock, 'v8:DateFractions')),
      }
    : undefined;

  return {
    items,
    stringQualifiers,
    numberQualifiers,
    dateQualifiers,
    presentation: items.map((item) => item.display).join(', '),
    rawInnerXml: typeInner.trim(),
  };
}

/** Формирует внутренность блока `<Type>` из структурной модели */
export function buildMetadataTypeInnerXml(typeValue: MetadataTypeValue): string {
  const effective = ensureDefaultQualifiers(typeValue);
  const lines: string[] = [];
  for (const item of effective.items) {
    if (item.canonical.startsWith('DefinedType.')) {
      lines.push(`<v8:TypeSet>cfg:${item.canonical}</v8:TypeSet>`);
      continue;
    }
    // Базовые формовые типы (`UUID`, `Picture` и т.п.) — токен с префиксом `v8:`/`v8ui:`.
    const formToken = ENGLISH_BASE_FORM_TOKENS[item.canonical];
    if (formToken) {
      lines.push(`<v8:Type>${formToken}</v8:Type>`);
      continue;
    }
    if (item.canonical.includes('Ref.') || isCompositeRefCanonical(item.canonical)) {
      lines.push(`<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:${item.canonical}</v8:Type>`);
      continue;
    }
    lines.push(`<v8:Type>${toXmlPrimitive(item.canonical)}</v8:Type>`);
  }

  if (effective.numberQualifiers) {
    lines.push('<v8:NumberQualifiers>');
    lines.push(`<v8:Digits>${String(effective.numberQualifiers.digits ?? 10)}</v8:Digits>`);
    lines.push(`<v8:FractionDigits>${String(effective.numberQualifiers.fractionDigits ?? 0)}</v8:FractionDigits>`);
    lines.push(`<v8:AllowedSign>${effective.numberQualifiers.allowedSign ?? 'Any'}</v8:AllowedSign>`);
    lines.push('</v8:NumberQualifiers>');
  }
  if (effective.stringQualifiers) {
    lines.push('<v8:StringQualifiers>');
    lines.push(`<v8:Length>${String(effective.stringQualifiers.length ?? 10)}</v8:Length>`);
    lines.push(`<v8:AllowedLength>${effective.stringQualifiers.allowedLength ?? 'Variable'}</v8:AllowedLength>`);
    lines.push('</v8:StringQualifiers>');
  }
  if (effective.dateQualifiers) {
    lines.push('<v8:DateQualifiers>');
    lines.push(`<v8:DateFractions>${effective.dateQualifiers.dateFractions ?? 'DateTime'}</v8:DateFractions>`);
    lines.push('</v8:DateQualifiers>');
  }

  return lines
    .map((line) => {
      if (line.startsWith('<v8:Digits>') || line.startsWith('<v8:FractionDigits>') || line.startsWith('<v8:AllowedSign>')) {
        return `\t${line}`;
      }
      if (line.startsWith('<v8:Length>') || line.startsWith('<v8:AllowedLength>')) {
        return `\t${line}`;
      }
      if (line.startsWith('<v8:DateFractions>')) {
        return `\t${line}`;
      }
      return line;
    })
    .join('\n');
}

/** Формирует тип параметра команды: только ссылочные типы конфигурации и определяемые типы, без квалификаторов. */
export function buildCommandParameterTypeInnerXml(typeValue: MetadataTypeValue): string {
  return typeValue.items
    .map((item) => {
      if (item.canonical.startsWith('DefinedType.')) {
        return `<v8:TypeSet>cfg:${item.canonical}</v8:TypeSet>`;
      }
      return `<v8:Type>cfg:${item.canonical}</v8:Type>`;
    })
    .join('\n');
}

/** Приводит модель типов к правилам 1С: добавляет дефолтные квалификаторы примитивов */
export function ensureDefaultQualifiers(typeValue: MetadataTypeValue): MetadataTypeValue {
  const hasString = typeValue.items.some((item) => item.canonical === 'String');
  const hasNumber = typeValue.items.some((item) => item.canonical === 'Number');
  const hasDateLike = typeValue.items.some((item) => item.canonical === 'Date' || item.canonical === 'DateTime');

  return {
    ...typeValue,
    stringQualifiers: hasString
      ? {
          length: typeValue.stringQualifiers?.length ?? 10,
          allowedLength: typeValue.stringQualifiers?.allowedLength ?? 'Variable',
        }
      : undefined,
    numberQualifiers: hasNumber
      ? {
          digits: typeValue.numberQualifiers?.digits ?? 10,
          fractionDigits: typeValue.numberQualifiers?.fractionDigits ?? 0,
          allowedSign: typeValue.numberQualifiers?.allowedSign ?? 'Any',
        }
      : undefined,
    dateQualifiers: hasDateLike
      ? {
          dateFractions:
            typeValue.dateQualifiers?.dateFractions ??
            (typeValue.items.some((item) => item.canonical === 'Date') ? 'Date' : 'DateTime'),
        }
      : undefined,
  };
}

function toXmlPrimitive(canonical: string): string {
  return ENGLISH_BASE_PRIMITIVE_TOKENS[canonical] ?? canonical;
}

/**
 * Определяет, выглядит ли английская форма как ссылочная производная типа
 * без суффикса `Ref` (`CatalogObject.X`, `InformationRegisterRecordSet.X`).
 */
function isCompositeRefCanonical(canonical: string): boolean {
  return /^[A-Za-z]+(?:Object|Manager|Selection|List|RecordSet|RecordKey|RecordManager|Recalculation|ValueManager|RoutePointRef)\..+$/.test(canonical);
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toAllowedLength(value: string | undefined): MetadataStringQualifiers['allowedLength'] | undefined {
  return value === 'Fixed' || value === 'Variable' ? value : undefined;
}

function toAllowedSign(value: string | undefined): MetadataNumberQualifiers['allowedSign'] | undefined {
  return value === 'Any' || value === 'Nonnegative' ? value : undefined;
}

function toDateFractions(value: string | undefined): MetadataDateQualifiers['dateFractions'] | undefined {
  return value === 'Date' || value === 'DateTime' || value === 'Time' ? value : undefined;
}
