import * as fs from 'fs';
import * as path from 'path';
import { getObjectLocationFromXml } from '../../../infra/fs/MetaPathResolver';
import { extractSimpleTag } from '../../../infra/xml';
import { extractFirstBalancedBlock } from './MetadataXmlPropertiesService';

type NestedDefinitionFolder = 'Forms' | 'Commands' | 'Templates';

/**
 * Ищет XML объекта основной конфигурации для заимствованного объекта расширения.
 * Сейчас проектная раскладка предполагает соседние корни `src/cf` и `src/cfe/<ИмяРасширения>`.
 */
export function readInheritedObjectXmlForBorrowed(extensionObjectXmlPath: string): string | null {
  const extensionXml = readTextFile(extensionObjectXmlPath);
  if (!extensionXml || !isBorrowedRootObjectXml(extensionXml)) {
    return null;
  }

  const inheritedPath = resolveInheritedObjectXmlPath(extensionObjectXmlPath);
  return inheritedPath ? readTextFile(inheritedPath) : null;
}

/** Возвращает путь к XML объекта основной конфигурации для объекта расширения */
export function resolveInheritedObjectXmlPath(extensionObjectXmlPath: string): string | null {
  const loc = getObjectLocationFromXml(extensionObjectXmlPath);
  const cfRoot = inferMainConfigurationRoot(loc.configRoot);
  if (!cfRoot) {
    return null;
  }

  return firstExisting([
    path.join(cfRoot, loc.folderName, loc.objectName, loc.objectName + '.xml'),
    path.join(cfRoot, loc.folderName, loc.objectName + '.xml'),
  ]);
}

/** Возвращает путь к форме/команде/макету основной конфигурации для вложенного объекта расширения */
export function resolveInheritedDefinitionXmlPath(
  extensionObjectXmlPath: string,
  folderName: NestedDefinitionFolder,
  itemName: string
): string | null {
  const inheritedObjectPath = resolveInheritedObjectXmlPath(extensionObjectXmlPath);
  if (!inheritedObjectPath) {
    return null;
  }

  const loc = getObjectLocationFromXml(inheritedObjectPath);
  return firstExisting([
    path.join(loc.objectDir, folderName, itemName, itemName + '.xml'),
    path.join(loc.objectDir, folderName, itemName + '.xml'),
  ]);
}

function isBorrowedRootObjectXml(xml: string): boolean {
  const rootProperties = extractFirstBalancedBlock(xml, 'Properties');
  if (!rootProperties) {
    return false;
  }

  return (
    (extractSimpleTag(rootProperties, 'ObjectBelonging') ?? '').trim() === 'Adopted' &&
    Boolean(extractSimpleTag(rootProperties, 'ExtendedConfigurationObject'))
  );
}

function inferMainConfigurationRoot(extensionRoot: string): string | null {
  const normalized = path.normalize(extensionRoot);
  const parent = path.dirname(normalized);
  if (path.basename(parent).toLowerCase() === 'cfe') {
    const candidate = path.join(path.dirname(parent), 'cf');
    return hasConfigurationXml(candidate) ? candidate : null;
  }

  const parts = normalized.split(path.sep);
  const cfeIndex = parts.lastIndexOf('cfe');
  if (cfeIndex < 0) {
    return null;
  }

  const prefix = parts.slice(0, cfeIndex).join(path.sep) || path.sep;
  const candidate = path.join(prefix, 'cf');
  return hasConfigurationXml(candidate) ? candidate : null;
}

function hasConfigurationXml(root: string): boolean {
  return fs.existsSync(path.join(root, 'Configuration.xml'));
}

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
