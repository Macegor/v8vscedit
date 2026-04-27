import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ChildTag } from '../../domain/ChildTag';
import { MetaKind } from '../../domain/MetaTypes';
import {
  extractChildMetaElementXml,
  extractChildMetaElementsXml,
  extractColumnXmlFromTabularSection,
  extractColumnsXmlFromTabularSection,
} from '../xml/XmlUtils';

export type MetadataGitDecorationStatus = 'added' | 'modified' | 'deleted';

export interface MetadataGitDecorationTarget {
  kind: 'child' | 'group' | 'paths';
  ownerXmlPath: string;
  childKind: MetaKind | ChildTag | 'Column';
  name?: string;
  tabularSectionName?: string;
  paths?: string[];
}

interface ObjectGitSnapshot {
  currentXml: string | null;
  headXml: string | null;
  fileChanged: boolean;
  fileAdded: boolean;
}

/**
 * Вычисляет git-состояние вложенных элементов, которые физически живут в XML объекта.
 * Штатный Git-декоратор VS Code видит только файл целиком, поэтому для реквизитов
 * нужен отдельный diff конкретного XML-блока.
 */
export class GitMetadataStatusService {
  private gitRoot: string | null | undefined;
  private readonly objectCache = new Map<string, ObjectGitSnapshot>();

  constructor(private readonly workspaceRoot: string) {}

  clear(): void {
    this.objectCache.clear();
  }

  getStatus(target: MetadataGitDecorationTarget): MetadataGitDecorationStatus | undefined {
    if (target.kind === 'paths') {
      return this.getPathsStatus(target.paths ?? []);
    }

    const snapshot = this.getObjectSnapshot(target.ownerXmlPath);
    if (!snapshot.fileChanged) {
      return undefined;
    }

    if (target.kind === 'group') {
      return this.getGroupStatus(snapshot, target);
    }

    if (!target.name) {
      return undefined;
    }

    if (snapshot.fileAdded || !snapshot.headXml) {
      return 'added';
    }

    const currentBlock = this.extractTargetXml(snapshot.currentXml, target);
    const headBlock = this.extractTargetXml(snapshot.headXml, target);
    if (currentBlock && !headBlock) {
      return 'added';
    }
    if (!currentBlock && headBlock) {
      return 'deleted';
    }
    if (currentBlock && headBlock && normalizeComparableXml(currentBlock) !== normalizeComparableXml(headBlock)) {
      return 'modified';
    }

    return undefined;
  }

  private getPathsStatus(filePaths: string[]): MetadataGitDecorationStatus | undefined {
    let hasAdded = false;
    let hasModified = false;
    let hasDeleted = false;

    for (const filePath of filePaths) {
      const status = this.getFileDecorationStatus(filePath);
      hasAdded = hasAdded || status === 'added';
      hasModified = hasModified || status === 'modified';
      hasDeleted = hasDeleted || status === 'deleted';
    }

    if (hasModified || (hasAdded && hasDeleted)) {
      return 'modified';
    }
    if (hasAdded) {
      return 'added';
    }
    if (hasDeleted) {
      return 'deleted';
    }
    return undefined;
  }

  private getGroupStatus(
    snapshot: ObjectGitSnapshot,
    target: MetadataGitDecorationTarget
  ): MetadataGitDecorationStatus | undefined {
    if (snapshot.fileAdded || !snapshot.headXml) {
      return 'modified';
    }

    const current = this.extractGroupXml(snapshot.currentXml, target);
    const head = this.extractGroupXml(snapshot.headXml, target);
    const names = new Set([...current.keys(), ...head.keys()]);

    for (const name of names) {
      const currentXml = current.get(name);
      const headXml = head.get(name);
      if (!currentXml || !headXml || normalizeComparableXml(currentXml) !== normalizeComparableXml(headXml)) {
        return 'modified';
      }
    }

    return undefined;
  }

  private getObjectSnapshot(ownerXmlPath: string): ObjectGitSnapshot {
    const key = path.resolve(ownerXmlPath).toLowerCase();
    const cached = this.objectCache.get(key);
    if (cached) {
      return cached;
    }

    const currentXml = readTextFile(ownerXmlPath);
    const fileStatus = this.getFileStatus(ownerXmlPath);
    const snapshot: ObjectGitSnapshot = {
      currentXml,
      headXml: fileStatus.changed ? this.readHeadFile(ownerXmlPath) : currentXml,
      fileChanged: fileStatus.changed,
      fileAdded: fileStatus.added,
    };
    this.objectCache.set(key, snapshot);
    return snapshot;
  }

  private getFileStatus(filePath: string): { changed: boolean; added: boolean } {
    const status = this.getFileDecorationStatus(filePath);
    return {
      changed: Boolean(status),
      added: status === 'added',
    };
  }

  private getFileDecorationStatus(filePath: string): MetadataGitDecorationStatus | undefined {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return undefined;
    }

    try {
      const output = execFileSync('git', ['-C', gitRoot, 'status', '--porcelain', '--', filePath], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const line = output.split(/\r?\n/).find((item) => item.trim().length > 0);
      if (!line) {
        return undefined;
      }

      const status = line.slice(0, 2);
      if (status.includes('D')) {
        return 'deleted';
      }
      if (status.includes('A') || status === '??') {
        return 'added';
      }
      return 'modified';
    } catch {
      return undefined;
    }
  }

  private readHeadFile(filePath: string): string | null {
    const gitRoot = this.getGitRoot();
    if (!gitRoot) {
      return null;
    }

    const relativePath = path.relative(gitRoot, filePath).split(path.sep).join('/');
    try {
      return execFileSync('git', ['-C', gitRoot, 'show', `HEAD:${relativePath}`], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }

  private getGitRoot(): string | null {
    if (this.gitRoot !== undefined) {
      return this.gitRoot;
    }

    try {
      this.gitRoot = execFileSync('git', ['-C', this.workspaceRoot, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      this.gitRoot = null;
    }

    return this.gitRoot;
  }

  private extractTargetXml(xml: string | null, target: MetadataGitDecorationTarget): string | null {
    if (!xml || !target.name) {
      return null;
    }

    if (target.childKind === 'Column') {
      return target.tabularSectionName
        ? extractColumnXmlFromTabularSection(xml, target.tabularSectionName, target.name)
        : null;
    }

    return extractChildMetaElementXml(xml, target.childKind, target.name);
  }

  private extractGroupXml(xml: string | null, target: MetadataGitDecorationTarget): Map<string, string> {
    if (!xml) {
      return new Map();
    }

    if (target.childKind === 'Column') {
      const columns = target.tabularSectionName
        ? extractColumnsXmlFromTabularSection(xml, target.tabularSectionName)
        : [];
      return new Map(columns.map((item) => [item.name, item.xml]));
    }

    return new Map(extractChildMetaElementsXml(xml, target.childKind).map((item) => [item.name, item.xml]));
  }
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function normalizeComparableXml(xml: string): string {
  return xml
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .trim();
}
