import * as fs from 'fs';
import * as path from 'path';
import { isSupportedConfigFile, isTemplateContentConfigFile } from '../cache/HashCache';

export function collectConfigFilesForLoad(
  configDir: string,
  changedFiles: readonly string[],
  includeMissingFiles: boolean
): string[] {
  const configFiles: string[] = [];
  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized || !isSupportedConfigFile(normalized)) {
      continue;
    }

    if (normalized.endsWith('.xml')) {
      addExistingOrAllowed(configDir, normalized, includeMissingFiles, configFiles);
      continue;
    }

    if (isTemplateContentConfigFile(normalized)) {
      addTemplateContentLoadFiles(configDir, normalized, includeMissingFiles, configFiles);
      continue;
    }

    if (!normalized.endsWith('.bsl')) {
      continue;
    }

    const objectXml = resolveObjectXmlFromBsl(configDir, normalized, includeMissingFiles);
    if (!objectXml) {
      continue;
    }
    addExistingOrAllowed(configDir, objectXml, includeMissingFiles, configFiles);
    addExistingOrAllowed(configDir, normalized, includeMissingFiles, configFiles);

    const [section, objectName] = normalized.split('/');
    if (!section || !objectName) {
      continue;
    }
    const extDir = path.join(configDir, section, objectName, 'Ext');
    if (!fs.existsSync(extDir)) {
      continue;
    }
    for (const filePath of walkFiles(extDir)) {
      const relPath = path.relative(configDir, filePath).replace(/\\/g, '/');
      if (!configFiles.includes(relPath)) {
        configFiles.push(relPath);
      }
    }
  }
  return configFiles;
}

export function detectPotentialRename(
  previousFiles: Record<string, string>,
  currentFiles: Record<string, string>,
  added: readonly string[],
  deleted: readonly string[]
): boolean {
  if (added.length === 0 || deleted.length === 0) {
    return false;
  }

  const deletedSignatures = new Set(deleted.map((item) => buildRenameSignature(item)).filter((item) => item.length > 0));
  for (const item of added) {
    const signature = buildRenameSignature(item);
    if (signature && deletedSignatures.has(signature)) {
      return true;
    }
  }

  const deletedHashes = new Set(
    deleted
      .map((item) => previousFiles[item])
      .filter((item): item is string => Boolean(item))
  );
  return added.some((item) => {
    const hash = currentFiles[item];
    return Boolean(hash && deletedHashes.has(hash));
  });
}

function addTemplateContentLoadFiles(
  configDir: string,
  relativePath: string,
  includeMissingFiles: boolean,
  configFiles: string[]
): void {
  const templateXml = resolveTemplateXmlFromContent(configDir, relativePath, includeMissingFiles);
  if (templateXml) {
    addUnique(templateXml, configFiles);
  }

  const ownerXml = resolveOwnerXmlFromNestedTemplate(relativePath);
  if (ownerXml) {
    addExistingOrAllowed(configDir, ownerXml, includeMissingFiles, configFiles);
  }

  addExistingOrAllowed(configDir, relativePath, includeMissingFiles, configFiles);
}

function resolveTemplateXmlFromContent(
  configDir: string,
  relativePath: string,
  includeMissingFiles: boolean
): string | null {
  const parts = relativePath.split('/');
  const extIndex = parts.indexOf('Ext');
  if (extIndex <= 1) {
    return null;
  }

  const templateName = parts[extIndex - 1];
  const templateDir = parts.slice(0, extIndex - 1).join('/');
  const candidates = [
    `${templateDir}/${templateName}.xml`,
    `${templateDir}/${templateName}/${templateName}.xml`,
  ];

  return candidates.find((candidate) => includeMissingFiles || fs.existsSync(path.join(configDir, candidate))) ?? null;
}

function resolveOwnerXmlFromNestedTemplate(relativePath: string): string | null {
  const parts = relativePath.split('/');
  const templatesIndex = parts.indexOf('Templates');
  if (templatesIndex <= 1) {
    return null;
  }

  const section = parts[0];
  const objectName = parts[1];
  if (!section || !objectName) {
    return null;
  }

  return `${section}/${objectName}.xml`;
}

function resolveObjectXmlFromBsl(configDir: string, relativePath: string, includeMissingFiles: boolean): string | null {
  const parts = relativePath.split(/[\\/]/);
  if (parts.length < 2) {
    return null;
  }

  const section = parts[0];
  const objectName = parts[1];
  const candidates = [
    `${section}/${objectName}.xml`,
    `${section}/${objectName}/${objectName}.xml`,
  ];

  return candidates.find((candidate) => includeMissingFiles || fs.existsSync(path.join(configDir, candidate))) ?? null;
}

function walkFiles(rootDir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fullPath));
    } else {
      out.push(fullPath);
    }
  }
  return out;
}

function addExistingOrAllowed(configDir: string, relativePath: string, includeMissingFiles: boolean, configFiles: string[]): void {
  if (includeMissingFiles || fs.existsSync(path.join(configDir, relativePath))) {
    addUnique(relativePath, configFiles);
  }
}

function addUnique(relativePath: string, configFiles: string[]): void {
  if (!configFiles.includes(relativePath)) {
    configFiles.push(relativePath);
  }
}

function buildRenameSignature(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((item) => item.length > 0);
  if (parts.length < 2) {
    return '';
  }
  const section = parts[0];
  if (parts.length === 2 && normalized.endsWith('.xml')) {
    return `${section}|root-xml`;
  }
  if (parts.length >= 4) {
    return `${section}|${parts.slice(2).join('/')}`;
  }
  return `${section}|${parts[parts.length - 1]}`;
}
