import type { MetadataTypeItem } from './_types';
import {
  buildEventSourceItemsFromConfiguration,
} from './EventSubscriptionPropertyService';
import {
  getPlatformTypeRegistry,
  resolveConfigurationXml,
  type PlatformTypeGroup,
  type PlatformTypeOption,
  type TypeContext,
} from '../../../infra/xml';

export interface TypeRegistryTreeGroup {
  id: string;
  title: string;
  items: MetadataTypeItem[];
}

/** Набор типов, который нужен конкретному свойству панели. */
export type TypeRegistryFilter = 'value' | 'commandParameter' | 'eventSource';

/**
 * Реестр доступных типов для окна выбора свойств. Тонкая UI-обёртка над
 * `getPlatformTypeRegistry` из `infra/xml/PlatformTypeRegistry`. Возвращает
 * группы в формате, ожидаемом панелью свойств: `canonical` — английская форма
 * (для записи в XML), `display` — русская форма (для отображения и приёма
 * от MCP-агента).
 */
export class TypeRegistryService {
  getAvailableTypes(sourceXmlPath: string | undefined, filter: TypeRegistryFilter = 'value'): TypeRegistryTreeGroup[] {
    const configXml = resolveConfigurationXml(sourceXmlPath) ?? undefined;
    const context = filterToContext(filter);

    if (filter === 'eventSource') {
      // У источника подписки специфические группы — оставляем существующий
      // сервис, который строит список через `EventSubscriptionPropertyService`
      // (там зашиты особенности `Source` и определяемых типов).
      return buildEventSourceItemsFromConfiguration(sourceXmlPath);
    }

    return getPlatformTypeRegistry(configXml, context).map(toTreeGroup);
  }
}

function filterToContext(filter: TypeRegistryFilter): TypeContext {
  if (filter === 'commandParameter') {
    return 'commandParameter';
  }
  if (filter === 'eventSource') {
    return 'eventSource';
  }
  return 'metadataAttribute';
}

function toTreeGroup(group: PlatformTypeGroup): TypeRegistryTreeGroup {
  return {
    id: group.id,
    title: group.title,
    items: group.items.map(toTreeItem),
  };
}

function toTreeItem(item: PlatformTypeOption): MetadataTypeItem {
  return {
    canonical: optionCanonicalToTreeCanonical(item),
    display: item.canonical,
    group: optionGroupToTreeGroup(item.group),
  };
}

/**
 * Историческое поле `canonical` в `MetadataTypeItem` хранит английскую форму
 * для XML. Для базовых типов это короткое имя (`String`, `UUID`), для
 * ссылочных — `CatalogRef.X` и т.п. Здесь конвертируем `PlatformTypeOption`,
 * у которого `canonical` уже русский.
 */
function optionCanonicalToTreeCanonical(item: PlatformTypeOption): string {
  return item.english;
}

function optionGroupToTreeGroup(group: PlatformTypeOption['group']): MetadataTypeItem['group'] {
  if (group === 'defined') {
    return 'defined';
  }
  if (group === 'reference') {
    return 'reference';
  }
  // `compositeData` (Тип/ОписаниеТипов/ТаблицаЗначений/…) исторически
  // классифицировался как `primitive` в дереве выбора. Сохраняем поведение.
  return 'primitive';
}
