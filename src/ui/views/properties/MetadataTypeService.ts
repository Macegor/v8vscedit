import {
  MetadataDateQualifiers,
  MetadataNumberQualifiers,
  MetadataStringQualifiers,
  MetadataTypeItem,
  MetadataTypeValue,
} from './_types';
import { extractSimpleTag } from '../../../infra/xml';

const TYPE_SYNONYMS: Record<string, string> = {
  'xs:string': 'String',
  'xs:decimal': 'Number',
  'xs:boolean': 'Boolean',
  'xs:dateTime': 'DateTime',
  'xs:base64Binary': 'ValueStorage',
};

const DISPLAY_BY_CANONICAL: Record<string, string> = {
  String: 'Строка',
  Number: 'Число',
  Boolean: 'Булево',
  Date: 'Дата',
  DateTime: 'ДатаВремя',
  ValueStorage: 'ХранилищеЗначения',
};

const REF_PREFIXES: Array<{ canonical: string; display: string }> = [
  { canonical: 'CatalogRef.', display: 'СправочникСсылка.' },
  { canonical: 'DocumentRef.', display: 'ДокументСсылка.' },
  { canonical: 'EnumRef.', display: 'ПеречислениеСсылка.' },
  { canonical: 'ChartOfAccountsRef.', display: 'ПланСчетовСсылка.' },
  { canonical: 'ChartOfCharacteristicTypesRef.', display: 'ПланВидовХарактеристикСсылка.' },
  { canonical: 'ChartOfCalculationTypesRef.', display: 'ПланВидовРасчетаСсылка.' },
  { canonical: 'ExchangePlanRef.', display: 'ПланОбменаСсылка.' },
  { canonical: 'BusinessProcessRef.', display: 'БизнесПроцессСсылка.' },
  { canonical: 'TaskRef.', display: 'ЗадачаСсылка.' },
];

function resolveCanonical(rawType: string): string {
  return TYPE_SYNONYMS[rawType] ?? rawType;
}

function toDisplay(canonical: string): string {
  if (DISPLAY_BY_CANONICAL[canonical]) {
    return DISPLAY_BY_CANONICAL[canonical];
  }
  for (const ref of REF_PREFIXES) {
    if (canonical.startsWith(ref.canonical)) {
      return `${ref.display}${canonical.slice(ref.canonical.length)}`;
    }
  }
  if (canonical.startsWith('DefinedType.')) {
    return `ОпределяемыйТип.${canonical.slice('DefinedType.'.length)}`;
  }
  return canonical;
}

function detectGroup(canonical: string): MetadataTypeItem['group'] {
  if (canonical.startsWith('DefinedType.')) {
    return 'defined';
  }
  if (canonical.includes('Ref.')) {
    return 'reference';
  }
  return 'primitive';
}

/** Разбирает внутренность `<Type>...</Type>` в структурированную модель */
export function parseMetadataType(typeInner: string): MetadataTypeValue {
  const items: MetadataTypeItem[] = [];
  const seen = new Set<string>();
  const rawTypes = Array.from(typeInner.matchAll(/<v8:Type(?:\s[^>]*)?>([^<]*)<\/v8:Type>/g)).map((m) => m[1].trim());
  const typeSets = Array.from(typeInner.matchAll(/<v8:TypeSet(?:\s[^>]*)?>([^<]*)<\/v8:TypeSet>/g)).map((m) => m[1].trim());

  for (const raw of [...rawTypes, ...typeSets]) {
    const clean = raw.replace(/^d\d+p\d+:/, '').replace(/^cfg:/, '');
    const canonical = resolveCanonical(clean);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    items.push({
      canonical,
      display: toDisplay(canonical),
      group: detectGroup(canonical),
    });
  }

  const stringBlockMatch = /<v8:StringQualifiers>([\s\S]*?)<\/v8:StringQualifiers>/.exec(typeInner);
  const numberBlockMatch = /<v8:NumberQualifiers>([\s\S]*?)<\/v8:NumberQualifiers>/.exec(typeInner);
  const dateBlockMatch = /<v8:DateQualifiers>([\s\S]*?)<\/v8:DateQualifiers>/.exec(typeInner);

  const stringQualifiers: MetadataStringQualifiers | undefined = stringBlockMatch
    ? {
        length: parseNumber(extractSimpleTag(stringBlockMatch[1], 'v8:Length')),
        allowedLength: toAllowedLength(extractSimpleTag(stringBlockMatch[1], 'v8:AllowedLength')),
      }
    : undefined;
  const numberQualifiers: MetadataNumberQualifiers | undefined = numberBlockMatch
    ? {
        digits: parseNumber(extractSimpleTag(numberBlockMatch[1], 'v8:Digits')),
        fractionDigits: parseNumber(extractSimpleTag(numberBlockMatch[1], 'v8:FractionDigits')),
        allowedSign: toAllowedSign(extractSimpleTag(numberBlockMatch[1], 'v8:AllowedSign')),
      }
    : undefined;
  const dateQualifiers: MetadataDateQualifiers | undefined = dateBlockMatch
    ? {
        dateFractions: toDateFractions(extractSimpleTag(dateBlockMatch[1], 'v8:DateFractions')),
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
    if (item.canonical.includes('Ref.')) {
      lines.push(`<v8:Type xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config">d5p1:${item.canonical}</v8:Type>`);
      continue;
    }
    lines.push(`<v8:Type>${toXmlPrimitive(item.canonical)}</v8:Type>`);
  }

  if (effective.numberQualifiers) {
    lines.push('<v8:NumberQualifiers>');
    lines.push(`<v8:Digits>${effective.numberQualifiers.digits ?? 10}</v8:Digits>`);
    lines.push(`<v8:FractionDigits>${effective.numberQualifiers.fractionDigits ?? 0}</v8:FractionDigits>`);
    lines.push(`<v8:AllowedSign>${effective.numberQualifiers.allowedSign ?? 'Any'}</v8:AllowedSign>`);
    lines.push('</v8:NumberQualifiers>');
  }
  if (effective.stringQualifiers) {
    lines.push('<v8:StringQualifiers>');
    lines.push(`<v8:Length>${effective.stringQualifiers.length ?? 10}</v8:Length>`);
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

/** Приводит модель типов к правилам 1С (как в meta-edit.py): добавляет дефолтные квалификаторы примитивов */
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
  switch (canonical) {
    case 'String':
      return 'xs:string';
    case 'Number':
      return 'xs:decimal';
    case 'Boolean':
      return 'xs:boolean';
    case 'Date':
    case 'DateTime':
      return 'xs:dateTime';
    case 'ValueStorage':
      return 'xs:base64Binary';
    default:
      return canonical;
  }
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
