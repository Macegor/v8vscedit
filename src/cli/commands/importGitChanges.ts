import * as fs from 'fs';
import * as path from 'path';
import { runProcess } from '../../infra/process';
import { getBool, getString } from '../core/args';
import { resolveConnection } from '../core/connection';
import { createTempDir, printLogFile, runDesignerAndPrintResult, safeRemoveDir, writeUtf8BomLines } from '../core/onecCommon';
import { resolveConfigDir } from '../core/projectLayout';
import { CliArgs, SourceMode } from '../core/types';

export async function importGitChanges(args: CliArgs): Promise<number> {
  const projectRoot = path.resolve(getString(args, 'ProjectRoot', process.cwd()));
  const source = getString(args, 'Source', 'All') as SourceMode;
  const commitRange = getString(args, 'CommitRange', '');
  const format = getString(args, 'Format', 'Hierarchical');
  const target = getString(args, 'Target', 'cf');
  const extension = getString(args, 'Extension', '');
  const configDir = getString(args, 'ConfigDir', '') || resolveConfigDir(projectRoot, target === 'cfe' ? 'cfe' : 'cf', extension);
  const dryRun = getBool(args, 'DryRun');
  const allExtensions = getBool(args, 'AllExtensions');

  if (!['All', 'Staged', 'Unstaged', 'Commit'].includes(source)) {
    throw new Error('Error: -Source must be All, Staged, Unstaged or Commit');
  }
  if (!['Hierarchical', 'Plain'].includes(format)) {
    throw new Error('Error: -Format must be Hierarchical or Plain');
  }
  if (!fs.existsSync(configDir)) {
    throw new Error(`Error: config directory not found: ${configDir}`);
  }
  if (source === 'Commit' && !commitRange) {
    throw new Error('Error: -CommitRange required for Source=Commit');
  }

  await ensureGitAvailable();
  const changedFiles = await collectGitChanges(configDir, source, commitRange);
  if (changedFiles.length === 0) {
    console.log('No changes found');
    return 0;
  }

  console.log(`Git changes detected: ${changedFiles.length} files`);
  const configFiles = collectConfigFiles(configDir, changedFiles);
  if (configFiles.length === 0) {
    console.log('No configuration files found in changes');
    return 0;
  }
  console.log(`Files for loading: ${configFiles.length}`);
  configFiles.forEach((item) => console.log(`  ${item}`));

  if (dryRun) {
    console.log('');
    console.log('DryRun mode - no changes applied');
    return 0;
  }

  const connection = resolveConnection(args);
  const tempDir = createTempDir('db_load_git_');
  try {
    const listFile = path.join(tempDir, 'load_list.txt');
    writeUtf8BomLines(listFile, configFiles);
    const designerArgs: string[] = [
      '/LoadConfigFromFiles',
      configDir,
      '-listFile',
      listFile,
      '-Format',
      format,
      '-partial',
      '-updateConfigDumpInfo',
    ];

    if (target === 'cfe' || extension) {
      designerArgs.push('-Extension', extension);
    } else if (allExtensions) {
      designerArgs.push('-AllExtensions');
    }

    const outFile = path.join(tempDir, 'load_log.txt');
    designerArgs.push('/Out', outFile, '/DisableStartupDialogs');

    console.log('');
    console.log('Executing partial configuration load...');
    const exitCode = await runDesignerAndPrintResult(
      connection,
      designerArgs,
      'Load completed successfully',
      'Error loading configuration'
    );
    printLogFile(outFile);
    return exitCode;
  } finally {
    safeRemoveDir(tempDir);
  }
}

async function ensureGitAvailable(): Promise<void> {
  const result = await runProcess({ command: 'git', args: ['--version'] });
  if (result.exitCode !== 0) {
    throw new Error('Error: git not found in PATH');
  }
}

async function collectGitChanges(configDir: string, source: SourceMode, commitRange: string): Promise<string[]> {
  const out: string[] = [];
  const gitRoot = await detectGitRoot(configDir);
  if (source === 'Staged') {
    console.log('Getting staged changes...');
    out.push(...await runGit(configDir, ['diff', '--cached', '--name-only']));
  } else if (source === 'Unstaged') {
    console.log('Getting unstaged changes...');
    out.push(...await runGit(configDir, ['diff', '--name-only']));
    out.push(...await runGit(configDir, ['ls-files', '--others', '--exclude-standard']));
  } else if (source === 'Commit') {
    console.log(`Getting changes from ${commitRange}...`);
    out.push(...await runGit(configDir, ['diff', '--name-only', commitRange]));
  } else {
    console.log('Getting all uncommitted changes...');
    out.push(...await runGit(configDir, ['diff', '--cached', '--name-only']));
    out.push(...await runGit(configDir, ['diff', '--name-only']));
    out.push(...await runGit(configDir, ['ls-files', '--others', '--exclude-standard']));
  }
  const normalized = out
    .map((item) => normalizeGitPathForConfig(configDir, gitRoot, item))
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(normalized));
}

async function runGit(configDir: string, args: string[]): Promise<string[]> {
  const lines: string[] = [];
  const result = await runProcess({
    command: 'git',
    args,
    cwd: configDir,
    onStdout: (chunk) => {
      chunk
        .toString('utf-8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => lines.push(line));
    },
  });
  return result.exitCode === 0 ? lines : [];
}

async function detectGitRoot(configDir: string): Promise<string | null> {
  const lines = await runGit(configDir, ['rev-parse', '--show-toplevel']);
  if (lines.length === 0) {
    return null;
  }
  return path.resolve(lines[0]);
}

function normalizeGitPathForConfig(configDir: string, gitRoot: string | null, gitPath: string): string | null {
  const trimmed = gitPath.trim().replace(/\\/g, '/');
  if (!trimmed) {
    return null;
  }
  const configAbs = path.resolve(configDir);

  // Если git уже вернул путь относительно configDir.
  const directCandidate = path.resolve(configAbs, trimmed);
  if (isWithin(directCandidate, configAbs)) {
    return path.relative(configAbs, directCandidate).replace(/\\/g, '/');
  }

  // Чаще git возвращает путь от корня репозитория — нормализуем в относительный к configDir.
  if (gitRoot) {
    const fromRoot = path.resolve(gitRoot, trimmed);
    if (isWithin(fromRoot, configAbs)) {
      return path.relative(configAbs, fromRoot).replace(/\\/g, '/');
    }
  }
  return null;
}

function isWithin(candidate: string, baseDir: string): boolean {
  const rel = path.relative(baseDir, candidate);
  if (!rel) {
    return true;
  }
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function collectConfigFiles(configDir: string, changedFiles: string[]): string[] {
  const configFiles: string[] = [];
  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized || normalized === 'ConfigDumpInfo.xml' || !/\.(xml|bsl)$/i.test(normalized)) {
      continue;
    }

    const fullPath = path.join(configDir, normalized);
    if (normalized.endsWith('.xml')) {
      if (fs.existsSync(fullPath) && !configFiles.includes(normalized)) {
        configFiles.push(normalized);
      }
      continue;
    }

    const objectXml = getObjectXmlFromBsl(normalized);
    if (!objectXml) {
      continue;
    }
    const objectXmlFullPath = path.join(configDir, objectXml);
    if (!fs.existsSync(objectXmlFullPath)) {
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

function getObjectXmlFromBsl(relativePath: string): string | null {
  const parts = relativePath.split(/[\\/]/);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}.xml`;
  }
  return null;
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
