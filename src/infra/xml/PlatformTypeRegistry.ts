/**
 * Платформенный реестр типов для свойств метаданных и форм.
 *
 * Чистый infra-сервис: только `fs`/`path` и домен; импорт `vscode` запрещён.
 * Источник правды — `domain/CanonicalNames.ts` (`BASE_TYPES`, `REF_KIND_MAP`).
 * Используется панелью свойств и MCP-инструментами выбора типа.
 *
 * Контексты использования:
 *  - `metadataAttribute` — тип реквизита прикладного объекта (метаданные);
 *  - `formAttribute`     — тип реквизита управляемой формы;
 *  - `commandParameter`  — тип параметра команды;
 *  - `eventSource`       — источник подписки на событие.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigXmlReader } from './ConfigXmlReader';
import {
  BASE_TYPES,
  REF_KIND_MAP,
  type BaseTypeInfo,
  type RefKindInfo,
} from '../../domain/CanonicalNames';

/** Допустимые контексты вызова реестра. */
export type TypeContext = 'metadataAttribute' | 'formAttribute' | 'commandParameter' | 'eventSource';

/** Группа реестра для выпадающего списка типов. */
export type PlatformTypeGroupKind = 'primitive' | 'reference' | 'defined' | 'compositeData';

/** Один тип в реестре. */
export interface PlatformTypeOption {
  /** Каноническая русская форма (`Строка`, `СправочникСсылка.Контрагенты`). */
  readonly canonical: string;
  /** Каноническая английская форма для XML (`String`, `CatalogRef.Контрагенты`). */
  readonly english: string;
  /** Группа для отображения в дереве выбора. */
  readonly group: PlatformTypeGroupKind;
}

/** Группа реестра — стандартные типы либо корень метаданных. */
export interface PlatformTypeGroup {
  /** Идентификатор группы (`base`, `Catalog`, `Document`, …). */
  readonly id: string;
  /** Заголовок для отображения. */
  readonly title: string;
  /** Список типов группы. */
  readonly items: readonly PlatformTypeOption[];
}

// ─── XML-токены ──────────────────────────────────────────────────────────

/**
 * XML-токены непримитивных платформенных типов. Примитивы (`Строка`/`Число`/…)
 * получают токен из `BASE_TYPES.xmlPrimitive`. Сюда попадают типы, требующие
 * специального префикса (`v8:`/`v8ui:`).
 */
const NON_PRIMITIVE_XML_TOKEN: Record<string, string> = {
  УникальныйИдентификатор: 'v8:UUID',
  Тип:                     'v8:Type',
  ОписаниеТипов:           'v8:TypeDescription',
  СписокЗначений:          'v8:ValueListType',
  ТаблицаЗначений:         'v8:ValueTable',
  ДеревоЗначений:          'v8:ValueTree',
  ТабличныйДокумент:       'v8:SpreadsheetDocument',
  Картинка:                'v8ui:Picture',
  ФорматированнаяСтрока:   'v8ui:FormattedString',
  // `ДвоичныеДанные` намеренно не имеет токена — на уровне MCP это значение
  // не пишется напрямую (платформа выдаёт `xs:base64Binary` без квалификаторов,
  // что неотличимо от `ХранилищеЗначения`). Запись через MCP — ошибка.
};

/** Контексты, в которых разрешён каждый базовый тип. */
const BASE_TYPE_CONTEXTS: Record<string, readonly TypeContext[]> = {
  Строка:                  ['metadataAttribute', 'formAttribute'],
  Число:                   ['metadataAttribute', 'formAttribute'],
  Булево:                  ['metadataAttribute', 'formAttribute'],
  Дата:                    ['metadataAttribute', 'formAttribute'],
  ДатаВремя:               ['metadataAttribute', 'formAttribute'],
  ХранилищеЗначения:       ['metadataAttribute', 'formAttribute'],
  УникальныйИдентификатор: ['metadataAttribute', 'formAttribute'],
  ДвоичныеДанные:          ['metadataAttribute', 'formAttribute'],
  Картинка:                ['metadataAttribute', 'formAttribute'],
  Тип:                     ['formAttribute'],
  ОписаниеТипов:           ['formAttribute'],
  СписокЗначений:          ['formAttribute'],
  ТаблицаЗначений:         ['formAttribute'],
  ДеревоЗначений:          ['formAttribute'],
  ТабличныйДокумент:       ['formAttribute'],
  ФорматированнаяСтрока:   ['formAttribute'],
};

/** Группа в реестре для базового типа. */
function baseTypeGroup(russian: string): PlatformTypeGroupKind {
  if (russian === 'ТаблицаЗначений' || russian === 'ДеревоЗначений' || russian === 'СписокЗначений' || russian === 'ОписаниеТипов' || russian === 'Тип') {
    return 'compositeData';
  }
  return 'primitive';
}

// ─── Выбор суффиксов ссылочных типов по контексту ────────────────────────

/**
 * Допустимые суффиксы ссылочных производных по контексту. `ОпределяемыйТип`
 * (пустой `suffix` в `REF_KIND_MAP`) обрабатывается отдельно: он допустим
 * везде, кроме `eventSource`.
 */
const ALLOWED_SUFFIXES_BY_CONTEXT: Record<TypeContext, readonly string[]> = {
  metadataAttribute: ['Ссылка'],
  formAttribute:     ['Ссылка', 'Объект', 'Менеджер', 'Выборка', 'Список', 'НаборЗаписей', 'КлючЗаписи', 'МенеджерЗаписи', 'Перерасчет', 'ТочкаМаршрутаСсылка'],
  commandParameter:  ['Ссылка'],
  eventSource:       ['Объект', 'НаборЗаписей', 'МенеджерЗначения'],
};

function isDefinedTypeAllowed(context: TypeContext): boolean {
  return context === 'metadataAttribute' || context === 'formAttribute' || context === 'commandParameter';
}

// ─── Базовая группа ──────────────────────────────────────────────────────

/** Возвращает базовую группу типов реестра, отфильтрованную по контексту. */
function buildBaseGroup(context: TypeContext): PlatformTypeGroup {
  if (context === 'commandParameter') {
    return { id: 'base', title: 'Стандартные типы', items: [] };
  }
  if (context === 'eventSource') {
    // У источника подписки нет универсальных базовых типов — только
    // конкретные `*Объект`/`*НаборЗаписей` из конфигурации и
    // `КонстантаМенеджерЗначения`. Базовую группу оставляем пустой.
    return { id: 'base', title: 'Стандартные типы', items: [] };
  }
  const items: PlatformTypeOption[] = [];
  for (const base of BASE_TYPES) {
    const allowed = BASE_TYPE_CONTEXTS[base.russian];
    if (!allowed.includes(context)) {
      continue;
    }
    items.push({
      canonical: base.russian,
      english: base.english,
      group: baseTypeGroup(base.russian),
    });
  }
  return { id: 'base', title: 'Стандартные типы', items };
}

// ─── Группы по корням метаданных (ссылочные типы) ────────────────────────

/**
 * Группирует производные ссылочные типы по `metaKind` и фильтрует по контексту.
 * Производит пары (русский, английский) для каждого имени из `Configuration.xml`.
 */
function buildReferenceGroups(configXmlPath: string, context: TypeContext): PlatformTypeGroup[] {
  let names: Map<string, string[]>;
  try {
    names = new ConfigXmlReader().read(configXmlPath).childObjects;
  } catch {
    return [];
  }

  const allowedSuffixes = new Set(ALLOWED_SUFFIXES_BY_CONTEXT[context]);
  const defAllowed = isDefinedTypeAllowed(context);

  // Группируем `RefKindInfo` по metaKind.
  const refsByKind = new Map<string, RefKindInfo[]>();
  for (const ref of REF_KIND_MAP) {
    const bucket = refsByKind.get(ref.metaKind);
    if (bucket) {
      bucket.push(ref);
    } else {
      refsByKind.set(ref.metaKind, [ref]);
    }
  }

  // Для eventSource дополнительно нужен `КонстантаМенеджерЗначения` —
  // он живёт в той же группе `Constant`.
  const groups: PlatformTypeGroup[] = [];
  for (const [metaKind, refs] of refsByKind) {
    const objectNames = names.get(metaKind) ?? [];
    if (objectNames.length === 0) {
      continue;
    }
    const items: PlatformTypeOption[] = [];
    for (const ref of refs) {
      if (ref.suffix === '') {
        // Определяемый тип — особая ветка.
        if (!defAllowed) {
          continue;
        }
        for (const name of objectNames) {
          items.push({
            canonical: `${ref.russianBase}.${name}`,
            english: `${ref.englishCanonical}.${name}`,
            group: 'defined',
          });
        }
        continue;
      }
      if (!allowedSuffixes.has(ref.suffix)) {
        continue;
      }
      for (const name of objectNames) {
        items.push({
          canonical: `${ref.russianBase}${ref.suffix}.${name}`,
          english: `${ref.englishCanonical}.${name}`,
          group: 'reference',
        });
      }
    }
    if (items.length > 0) {
      groups.push({ id: metaKind, title: metaKind, items });
    }
  }
  return groups;
}

// ─── Главный публичный API ───────────────────────────────────────────────

/**
 * Возвращает реестр доступных типов для указанного контекста.
 *
 * `configXmlPath` — путь к `Configuration.xml` корня (для генерации
 * ссылочных типов). Если путь не задан или файл недоступен — возвращается
 * только базовая группа (для `metadataAttribute`/`formAttribute`) либо
 * пустой массив (для `commandParameter`/`eventSource`).
 */
export function getPlatformTypeRegistry(
  configXmlPath: string | undefined,
  context: TypeContext,
): PlatformTypeGroup[] {
  const result: PlatformTypeGroup[] = [];
  const base = buildBaseGroup(context);
  if (base.items.length > 0) {
    result.push(base);
  } else if (context === 'metadataAttribute' || context === 'formAttribute') {
    // Базовая группа должна возвращаться (даже если пустая) для метаданных/форм —
    // но при текущем фильтре она непустая, поэтому код сюда не попадает.
    result.push(base);
  }

  if (configXmlPath && fs.existsSync(configXmlPath)) {
    result.push(...buildReferenceGroups(configXmlPath, context));
  }
  return result;
}

// ─── Конверсия токенов ───────────────────────────────────────────────────

/** Карта примитивных XML-токенов в русские базовые типы. */
const PRIMITIVE_TOKEN_TO_RUSSIAN = new Map<string, string>();
for (const base of BASE_TYPES) {
  if (base.xmlPrimitive) {
    // `ДвоичныеДанные` и `ХранилищеЗначения` оба используют `xs:base64Binary`.
    // По наличию квалификаторов отличить нельзя, поэтому при чтении возвращаем
    // более частый случай — `ХранилищеЗначения` (так делал прежний код).
    if (!PRIMITIVE_TOKEN_TO_RUSSIAN.has(base.xmlPrimitive)) {
      PRIMITIVE_TOKEN_TO_RUSSIAN.set(base.xmlPrimitive, base.russian);
    }
  }
}

/** Карта токенов формы (`v8:UUID` и т.п.) в русские имена. */
const NON_PRIMITIVE_TOKEN_TO_RUSSIAN = new Map<string, string>();
for (const [russian, token] of Object.entries(NON_PRIMITIVE_XML_TOKEN)) {
  NON_PRIMITIVE_TOKEN_TO_RUSSIAN.set(token, russian);
}

/** Карта английского имени производного типа → `RefKindInfo`. */
const ENGLISH_REF_INDEX = new Map<string, RefKindInfo>();
for (const ref of REF_KIND_MAP) {
  ENGLISH_REF_INDEX.set(ref.englishCanonical, ref);
}

/** Карта базового типа: английское имя → русское. */
const ENGLISH_BASE_TO_RUSSIAN = new Map<string, string>();
for (const base of BASE_TYPES) {
  ENGLISH_BASE_TO_RUSSIAN.set(base.english, base.russian);
}

/**
 * Преобразует XDTO-токен или каноническое английское имя в каноническую
 * русскую форму. Поддерживает:
 *  - примитивы `xs:string` / `xs:decimal` / … → `Строка`, `Число`, …;
 *  - токены форм `v8:UUID`, `v8:ValueTable` → `УникальныйИдентификатор`, …;
 *  - английские имена `String`, `Catalog`, `CatalogRef.X` → русские формы;
 *  - токены с префиксом неймспейса (`d5p1:CatalogRef.X`, `cfg:DefinedType.X`).
 *
 * Возвращает `undefined`, если токен не распознан.
 */
export function tokenToCanonical(token: string): string | undefined {
  if (!token) {
    return undefined;
  }
  // Сначала пробуем как токен формы (`v8:UUID`, `v8ui:Picture`, …).
  const nonPrimitive = NON_PRIMITIVE_TOKEN_TO_RUSSIAN.get(token);
  if (nonPrimitive) {
    return nonPrimitive;
  }
  const primitive = PRIMITIVE_TOKEN_TO_RUSSIAN.get(token);
  if (primitive) {
    return primitive;
  }

  // Снимаем неймспейс-префикс вида `d5p1:` / `cfg:` для разбора английских имён.
  const stripped = token.replace(/^d\d+p\d+:/, '').replace(/^cfg:/, '');

  // Базовый английский тип целиком (`String`, `Number`, …).
  const baseRus = ENGLISH_BASE_TO_RUSSIAN.get(stripped);
  if (baseRus) {
    return baseRus;
  }

  // Ссылочный английский тип с именем (`CatalogRef.X`, `DefinedType.X`).
  const dotIndex = stripped.indexOf('.');
  if (dotIndex > 0) {
    const englishHead = stripped.slice(0, dotIndex);
    const name = stripped.slice(dotIndex + 1);
    const ref = ENGLISH_REF_INDEX.get(englishHead);
    if (ref) {
      if (ref.suffix === '') {
        return `${ref.russianBase}.${name}`;
      }
      return `${ref.russianBase}${ref.suffix}.${name}`;
    }
  }
  return undefined;
}

/**
 * Преобразует каноническую русскую форму в XML-токен для записи в `<v8:Type>`.
 *
 * Возвращает `undefined`, если тип не существует или недопустим в указанном
 * контексте. `ДвоичныеДанные` всегда отбивается (платформа сериализует его
 * как `xs:base64Binary` без квалификаторов — неотличимо от
 * `ХранилищеЗначения`, что делает запись через MCP двусмысленной).
 */
export function canonicalToXmlToken(canonical: string, context: TypeContext): string | undefined {
  if (!canonical) {
    return undefined;
  }
  // Запретный список: запись типа «ДвоичныеДанные» через MCP не поддерживается.
  if (canonical === 'ДвоичныеДанные') {
    return undefined;
  }

  // Базовый тип.
  for (const base of BASE_TYPES) {
    if (base.russian !== canonical) {
      continue;
    }
    const contexts = BASE_TYPE_CONTEXTS[base.russian] ?? [];
    if (!contexts.includes(context)) {
      return undefined;
    }
    if (base.xmlPrimitive) {
      return base.xmlPrimitive;
    }
    return NON_PRIMITIVE_XML_TOKEN[base.russian];
  }

  // Ссылочный тип `Префикс.Имя`.
  const dotIndex = canonical.indexOf('.');
  if (dotIndex <= 0) {
    return undefined;
  }
  const head = canonical.slice(0, dotIndex);
  const name = canonical.slice(dotIndex + 1);

  for (const ref of REF_KIND_MAP) {
    const russianFull = ref.suffix === '' ? ref.russianBase : `${ref.russianBase}${ref.suffix}`;
    if (russianFull !== head) {
      continue;
    }
    if (ref.suffix === '') {
      if (!isDefinedTypeAllowed(context)) {
        return undefined;
      }
    } else {
      const allowed = ALLOWED_SUFFIXES_BY_CONTEXT[context];
      if (!allowed.includes(ref.suffix)) {
        return undefined;
      }
    }
    return `${ref.englishCanonical}.${name}`;
  }
  return undefined;
}

/**
 * Ищет описание базового типа по русскому имени. Используется панелью свойств
 * для извлечения метаданных типа (контекст, английская форма).
 */
export function findBaseType(canonical: string): BaseTypeInfo | undefined {
  return BASE_TYPES.find((b) => b.russian === canonical);
}

/**
 * Поднимается от файла-источника к ближайшему `Configuration.xml` —
 * вспомогательный поиск, общий для панели свойств и MCP.
 */
export function resolveConfigurationXml(sourceXmlPath: string | undefined): string | null {
  if (!sourceXmlPath) {
    return null;
  }
  let current = path.dirname(sourceXmlPath);
  for (;;) {
    const cfg = path.join(current, 'Configuration.xml');
    if (fs.existsSync(cfg)) {
      return cfg;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
