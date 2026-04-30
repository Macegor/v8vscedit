/**
 * Публичное API слоя `infra/xml`. Экспортирует парсеры XML, схемы свойств и
 * низкоуровневые утилиты. Дополнительно предоставляет «тонкие» функции-фасады
 * для обратной совместимости с кодом, который исторически работал с
 * `ConfigParser` (`parseConfigXml`, `parseObjectXml`, `resolveObjectXmlPath`).
 */
import { ConfigXmlReader } from './ConfigXmlReader';
import { ObjectXmlReader } from './ObjectXmlReader';
import { MetaPathResolver } from '../fs/MetaPathResolver';
import { ConfigInfo } from '../../domain/Configuration';
import { MetaObject, MetaChild } from '../../domain/MetaObject';
import { MetaKind } from '../../domain/MetaTypes';

export * from './XmlUtils';
export * from './ConfigXmlReader';
export * from './ObjectXmlReader';
export * from './ConfigurationXmlEditor';
export * from './MetadataXmlCreator';
export * from './MetadataXmlRemover';
export * from './PropertySchema';
export * from './SubsystemXmlService';
export * from './TypedFieldPropertyRules';
export type { ConfigInfo } from '../../domain/Configuration';
export type { MetaObject, MetaChild } from '../../domain/MetaObject';

/** Алиас исторического типа `ObjectInfo` — совпадает с {@link MetaObject} */
export type ObjectInfo = MetaObject;

const configReader = new ConfigXmlReader();
const objectReader = new ObjectXmlReader();
const pathResolver = new MetaPathResolver();

/** Парсит `Configuration.xml` → {@link ConfigInfo} */
export function parseConfigXml(configXmlPath: string): ConfigInfo {
  return configReader.read(configXmlPath);
}

/** Парсит XML объекта метаданных → {@link MetaObject} или `null`, если файл не читается */
export function parseObjectXml(xmlPath: string): MetaObject | null {
  return objectReader.read(xmlPath);
}

/** Обновляет XML-блок `<Type>` для выбранного элемента метаданных */
export function updateObjectTypeProperty(
  xmlPath: string,
  options: {
    targetKind: 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'SessionParameter' | 'CommonAttribute';
    targetName: string;
    tabularSectionName?: string;
    typeInnerXml: string;
  }
): boolean {
  return objectReader.updateTypeInObject(xmlPath, options);
}

/** Обновляет скалярное/локализованное свойство в блоке `<Properties>` */
export function updateObjectProperty(
  xmlPath: string,
  options: {
    targetKind: 'Self' | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource' | 'Column' | 'TabularSection' | 'EnumValue';
    targetName: string;
    tabularSectionName?: string;
    propertyKey: string;
    valueKind: 'string' | 'boolean' | 'localizedString';
    value: string | boolean;
  }
): boolean {
  return objectReader.updatePropertyInObject(xmlPath, options);
}

/**
 * Находит XML-файл объекта в структуре выгрузки конфигурации.
 * Делегирует в {@link MetaPathResolver}.
 */
export function resolveObjectXmlPath(
  configRoot: string,
  objectType: string,
  objectName: string
): string | null {
  return pathResolver.resolveXml(configRoot, objectType as MetaKind, objectName);
}
