import * as fs from 'fs';
import * as path from 'path';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, printLogFile, runDesignerAndPrintResult, safeRemoveDir, writeUtf8BomLines } from '../core/onecCommon';
import {
  buildHashSnapshot,
  buildScopeKey,
  collectCurrentHashes,
  diffHashSnapshots,
  isSupportedConfigFile,
  isTemplateContentConfigFile,
  loadHashCache,
  patchHashSnapshot,
  saveHashCache,
} from '../core/hashCache';
import { resolveConfigDir } from '../core/projectLayout';
import type { CliArgs } from '../core/types';
import { saveMetadataCacheForEntry } from '../../infra/cache/MetadataCache';

export async function importGitChanges(args: CliArgs): Promise<number> {
  const projectRoot = path.resolve(getString(args, 'ProjectRoot', process.cwd()));
  const format = getString(args, 'Format', 'Hierarchical');
  const target = getString(args, 'Target', 'cf');
  const extension = getString(args, 'Extension', '');
  const configDir = getString(args, 'ConfigDir', '') || resolveConfigDir(projectRoot, target === 'cfe' ? 'cfe' : 'cf', extension);
  const dryRun = getBool(args, 'DryRun');
  const allExtensions = getBool(args, 'AllExtensions');

  if (!['Hierarchical', 'Plain'].includes(format)) {
    throw new Error('Error: -Format must be Hierarchical or Plain');
  }
  if (!fs.existsSync(configDir)) {
    throw new Error(`Error: config directory not found: ${configDir}`);
  }

  const normalizedTarget = target === 'cfe' ? 'cfe' : 'cf';
  const scopeKey = buildScopeKey(normalizedTarget, configDir, extension);
  const previousSnapshot = loadHashCache(projectRoot, scopeKey);
  const currentSnapshot = buildHashSnapshot(scopeKey, configDir);
  const diff = diffHashSnapshots(previousSnapshot, currentSnapshot);
  const hasRename = detectPotentialRename(previousSnapshot.files, currentSnapshot.files, diff.added, diff.deleted);
  const forceFullLoad = hasRename;

  const changedFiles = [...diff.added, ...diff.modified];
  if (changedFiles.length === 0 && diff.deleted.length === 0) {
    console.log('No hash changes found');
    return 0;
  }

  console.log(`Hash changes detected: added=${String(diff.added.length)}, modified=${String(diff.modified.length)}, deleted=${String(diff.deleted.length)}`);
  if (forceFullLoad) {
    console.log('Обнаружено переименование объектов. Включен принудительный полный режим загрузки.');
  }
  const configFiles = collectConfigFiles(configDir, changedFiles, false);
  const filesForLoad = Array.from(new Set(configFiles));

  if (!forceFullLoad) {
    if (filesForLoad.length === 0 && diff.deleted.length === 0) {
      console.log('No configuration files found in changes');
      return 0;
    }
    console.log(`Files for loading: ${String(filesForLoad.length)}`);
    filesForLoad.forEach((item) => console.log(`  ${item}`));
  }

  if (dryRun) {
    console.log('');
    if (forceFullLoad) {
      console.log('DryRun mode - full load will be executed');
    } else {
      console.log('DryRun mode - partial load will be executed');
    }
    console.log('DryRun mode - no changes applied');
    return 0;
  }

  const connection = resolveConnection(args);
  const tempDir = createTempDir('db_load_git_');
  try {
    const designerArgs: string[] = [
      '/LoadConfigFromFiles',
      configDir,
      '-Format',
      format,
      '-updateConfigDumpInfo',
    ];
    if (!forceFullLoad) {
      const listFile = path.join(tempDir, 'load_list.txt');
      writeUtf8BomLines(listFile, filesForLoad);
      designerArgs.push('-listFile', listFile, '-partial');
    }

    if (target === 'cfe' || extension) {
      designerArgs.push('-Extension', extension);
    } else if (allExtensions) {
      designerArgs.push('-AllExtensions');
    }

    const outFile = path.join(tempDir, 'load_log.txt');
    designerArgs.push('/Out', outFile, '/DisableStartupDialogs');

    console.log('');
    console.log(forceFullLoad ? 'Executing full configuration load...' : 'Executing partial configuration load...');
    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Load completed successfully',
      'Error loading configuration'
    );
    printLogFile(outFile);
    if (exitCode === 0) {
      if (forceFullLoad) {
        saveHashCache(projectRoot, currentSnapshot);
      } else {
        const changedHashes = collectCurrentHashes(configDir, changedFiles);
        const patched = patchHashSnapshot(previousSnapshot, changedHashes, diff.deleted);
        saveHashCache(projectRoot, patched);
      }
      saveMetadataCacheForEntry(projectRoot, scopeKey, { kind: normalizedTarget, rootPath: configDir });
    }
    return exitCode;
  } finally {
    safeRemoveDir(tempDir);
  }
}

export function collectConfigFiles(configDir: string, changedFiles: string[], includeMissingFiles: boolean): string[] {
  const configFiles: string[] = [];
  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized || !isSupportedConfigFile(normalized)) {
      continue;
    }

    if (normalized.endsWith('.xml')) {
      const fullPath = path.join(configDir, normalized);
      if ((includeMissingFiles || fs.existsSync(fullPath)) && !configFiles.includes(normalized)) {
        configFiles.push(normalized);
      }
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
    const objectXmlFullPath = path.join(configDir, objectXml);
    if (!includeMissingFiles && !fs.existsSync(objectXmlFullPath)) {
      continue;
    }

    if (!configFiles.includes(objectXml)) {
      configFiles.push(objectXml);
    }
    if (!configFiles.includes(normalized)) {
      configFiles.push(normalized);
    }

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

function addTemplateContentLoadFiles(
  configDir: string,
  relativePath: string,
  includeMissingFiles: boolean,
  configFiles: string[]
): void {
  const templateXml = resolveTemplateXmlFromContent(configDir, relativePath, includeMissingFiles);
  if (templateXml && !configFiles.includes(templateXml)) {
    configFiles.push(templateXml);
  }

  const ownerXml = resolveOwnerXmlFromNestedTemplate(relativePath);
  if (ownerXml) {
    const ownerXmlFullPath = path.join(configDir, ownerXml);
    if ((includeMissingFiles || fs.existsSync(ownerXmlFullPath)) && !configFiles.includes(ownerXml)) {
      configFiles.push(ownerXml);
    }
  }

  const contentFullPath = path.join(configDir, relativePath);
  if ((includeMissingFiles || fs.existsSync(contentFullPath)) && !configFiles.includes(relativePath)) {
    configFiles.push(relativePath);
  }
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

function detectPotentialRename(
  previousFiles: Record<string, string>,
  currentFiles: Record<string, string>,
  added: string[],
  deleted: string[]
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
  for (const item of added) {
    const hash = currentFiles[item];
    if (hash && deletedHashes.has(hash)) {
      return true;
    }
  }
  return false;
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
