import * as fs from 'fs';
import * as path from 'path';

export function syncDirectorySnapshot(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Каталог источника не найден: ${sourceDir}`);
  }

  if (replaceDirectorySnapshot(sourceDir, targetDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  deleteMissingEntries(sourceDir, targetDir);
  copyAllEntries(sourceDir, targetDir);
}

export function copyDirectorySnapshot(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Каталог источника не найден: ${sourceDir}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  copyAllEntries(sourceDir, targetDir);
}

export function mirrorDirectorySnapshot(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Каталог источника не найден: ${sourceDir}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  deleteMissingEntries(sourceDir, targetDir);
  copyAllEntries(sourceDir, targetDir);
}

export function collectSnapshotProjectFiles(sourceDir: string, targetDir: string): string[] {
  const result = new Set<string>();
  collectSourceProjectFiles(sourceDir, targetDir, result);
  collectDeletedProjectFiles(sourceDir, targetDir, result);
  return [...result];
}

function replaceDirectorySnapshot(sourceDir: string, targetDir: string): boolean {
  const targetParent = path.dirname(targetDir);
  fs.mkdirSync(targetParent, { recursive: true });

  const backupDir = path.join(
    targetParent,
    `.${path.basename(targetDir)}.v8vscedit-backup-${String(process.pid)}-${String(Date.now())}`
  );
  let targetMoved = false;

  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, backupDir);
      targetMoved = true;
    }

    fs.renameSync(sourceDir, targetDir);
    if (targetMoved) {
      fs.rm(backupDir, { recursive: true, force: true }, () => undefined);
    }
    return true;
  } catch (error) {
    if (targetMoved && !fs.existsSync(targetDir) && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, targetDir);
    }

    if (isCrossDeviceRenameError(error)) {
      return false;
    }

    throw error;
  }
}

function isCrossDeviceRenameError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EXDEV';
}

function collectSourceProjectFiles(sourceDir: string, targetDir: string, result: Set<string>): void {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      collectSourceProjectFiles(sourcePath, targetPath, result);
      continue;
    }

    addProjectFile(targetPath, result);
  }
}

function collectDeletedProjectFiles(sourceDir: string, targetDir: string, result: Set<string>): void {
  if (!fs.existsSync(targetDir)) {
    return;
  }

  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const targetPath = path.join(targetDir, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);
    if (!fs.existsSync(sourcePath)) {
      collectExistingFilePaths(targetPath, result);
      continue;
    }

    if (entry.isDirectory()) {
      collectDeletedProjectFiles(sourcePath, targetPath, result);
    }
  }
}

function collectExistingFilePaths(filePath: string, result: Set<string>): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isDirectory()) {
    addProjectFile(filePath, result);
    return;
  }

  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    collectExistingFilePaths(path.join(filePath, entry.name), result);
  }
}

function addProjectFile(filePath: string, result: Set<string>): void {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (
    normalized.endsWith('.xml') ||
    normalized.endsWith('.bsl') ||
    normalized.endsWith('/ext/template.txt') ||
    normalized.endsWith('/ext/template.bin') ||
    /\/ext\/template\/.+\.html$/.test(normalized)
  ) {
    result.add(filePath);
  }
}

function deleteMissingEntries(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    const targetPath = path.join(targetDir, entry.name);
    const sourcePath = path.join(sourceDir, entry.name);
    if (!fs.existsSync(sourcePath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      deleteMissingEntries(sourcePath, targetPath);
    }
  }
}

function copyAllEntries(sourceDir: string, targetDir: string): void {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyAllEntries(sourcePath, targetPath);
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}
