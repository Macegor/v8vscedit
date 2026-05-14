import * as fs from 'fs';
import * as path from 'path';
import { MetaPathResolver } from '../fs/MetaPathResolver';
import { ConfigXmlReader } from './ConfigXmlReader';
import { ObjectXmlReader } from './ObjectXmlReader';
import { extractNestingAwareBlock } from './XmlUtils';

export type BasedOnMetaKind = 'Catalog' | 'Document';

export interface BasedOnReferenceItem {
  ref: string;
  kind: BasedOnMetaKind;
  name: string;
  xmlPath: string;
}

export interface BasedOnSnapshot {
  objectRef: string;
  basedOn: BasedOnReferenceItem[];
  basedFor: BasedOnReferenceItem[];
  available: BasedOnReferenceItem[];
}

export interface BasedOnEditResult {
  changed: boolean;
  changedFiles: string[];
}

export interface BasedOnReadOptions {
  /**
   * Обратные ссылки требуют чтения XML всех справочников и документов.
   * Для быстрого открытия панели свойств можно использовать уже готовый индекс
   * и не строить его синхронно на первом клике.
   */
  includeReverse?: boolean;
}

interface AvailableObjectsCache {
  configMtimeMs: number;
  items: BasedOnReferenceItem[];
}

interface BasedOnIndexCache {
  configMtimeMs: number;
  available: BasedOnReferenceItem[];
  basedOnByRef: Map<string, string[]>;
  basedForByRef: Map<string, string[]>;
}

const SUPPORTED_KINDS: readonly BasedOnMetaKind[] = ['Catalog', 'Document'];

/** Двусторонний редактор связей «Ввод на основании» для справочников и документов. */
export class BasedOnXmlService {
  private readonly configReader = new ConfigXmlReader();
  private readonly pathResolver = new MetaPathResolver();
  private readonly objectReader = new ObjectXmlReader();
  private readonly availableCache = new Map<string, AvailableObjectsCache>();
  private readonly indexCache = new Map<string, BasedOnIndexCache>();
  private readonly pendingPreload = new Map<string, Promise<void>>();
  private cacheGeneration = 0;

  readSnapshot(
    configRoot: string,
    objectKind: BasedOnMetaKind,
    objectName: string,
    options: BasedOnReadOptions = {}
  ): BasedOnSnapshot {
    const objectRef = this.buildRef(objectKind, objectName);
    const normalizedRoot = normalizeRoot(configRoot);
    const available = this.readAvailableObjects(configRoot);
    const byRef = new Map(available.map((item) => [item.ref, item]));
    const current = byRef.get(objectRef);
    const basedOnRefs = current ? this.readBasedOnRefs(current.xmlPath) : [];
    const cachedIndex = this.getFreshIndex(normalizedRoot, configRoot);
    const basedForRefs = cachedIndex
      ? cachedIndex.basedForByRef.get(objectRef) ?? []
      : options.includeReverse === false
        ? []
        : this.buildIndexSync(configRoot).basedForByRef.get(objectRef) ?? [];

    return {
      objectRef,
      basedOn: basedOnRefs.map((ref) => byRef.get(ref) ?? this.buildMissingItem(configRoot, ref)).filter(isReferenceItem),
      basedFor: basedForRefs.map((ref) => byRef.get(ref) ?? this.buildMissingItem(configRoot, ref)).filter(isReferenceItem),
      available,
    };
  }

  setBasedOn(configRoot: string, objectKind: BasedOnMetaKind, objectName: string, refs: string[]): BasedOnEditResult {
    const xmlPath = this.pathResolver.resolveXml(configRoot, objectKind, objectName);
    if (!xmlPath) {
      return { changed: false, changedFiles: [] };
    }
    const result = this.writeBasedOn(xmlPath, uniqueRefs(refs));
    if (result.changed) {
      this.invalidate(configRoot);
    }
    return result;
  }

  setBasedFor(configRoot: string, objectKind: BasedOnMetaKind, objectName: string, refs: string[]): BasedOnEditResult {
    const objectRef = this.buildRef(objectKind, objectName);
    const selected = new Set(uniqueRefs(refs));
    const changedFiles: string[] = [];

    for (const target of this.readAvailableObjects(configRoot)) {
      if (target.ref === objectRef) {
        continue;
      }
      const current = this.readBasedOnRefs(target.xmlPath);
      const hasRef = current.includes(objectRef);
      const shouldHaveRef = selected.has(target.ref);
      if (hasRef === shouldHaveRef) {
        continue;
      }
      const next = shouldHaveRef
        ? [...current, objectRef]
        : current.filter((ref) => ref !== objectRef);
      const written = this.writeBasedOn(target.xmlPath, next);
      changedFiles.push(...written.changedFiles);
    }

    const changed = changedFiles.length > 0;
    if (changed) {
      this.invalidate(configRoot);
    }
    return { changed, changedFiles };
  }

  readAvailableObjects(configRoot: string): BasedOnReferenceItem[] {
    const normalizedRoot = normalizeRoot(configRoot);
    const configXmlPath = path.join(configRoot, 'Configuration.xml');
    if (!fs.existsSync(configXmlPath)) {
      return [];
    }
    const configMtimeMs = getFileMtimeMs(configXmlPath);
    const cached = this.availableCache.get(normalizedRoot);
    if (cached?.configMtimeMs === configMtimeMs) {
      return cached.items;
    }

    const info = this.configReader.read(configXmlPath);
    const result: BasedOnReferenceItem[] = [];
    for (const kind of SUPPORTED_KINDS) {
      for (const name of info.childObjects.get(kind) ?? []) {
        const xmlPath = this.pathResolver.resolveXml(configRoot, kind, name);
        if (!xmlPath) {
          continue;
        }
        result.push({
          ref: this.buildRef(kind, name),
          kind,
          name,
          xmlPath,
        });
      }
    }
    const items = result.sort((left, right) => this.refOrder(left, right));
    this.availableCache.set(normalizedRoot, { configMtimeMs, items });
    return items;
  }

  hasPreloadedReverseIndex(configRoot: string): boolean {
    return Boolean(this.getFreshIndex(normalizeRoot(configRoot), configRoot));
  }

  preloadReverseIndex(configRoot: string): Promise<void> {
    const normalizedRoot = normalizeRoot(configRoot);
    if (this.getFreshIndex(normalizedRoot, configRoot)) {
      return Promise.resolve();
    }

    const pending = this.pendingPreload.get(normalizedRoot);
    if (pending) {
      return pending;
    }

    const generation = this.cacheGeneration;
    const promise = this.buildIndexAsync(configRoot)
      .then((index) => {
        if (this.cacheGeneration === generation) {
          this.indexCache.set(normalizedRoot, index);
        }
      })
      .finally(() => {
        this.pendingPreload.delete(normalizedRoot);
      });
    this.pendingPreload.set(normalizedRoot, promise);
    return promise;
  }

  invalidate(configRoot?: string): void {
    this.cacheGeneration += 1;
    if (!configRoot) {
      this.availableCache.clear();
      this.indexCache.clear();
      return;
    }

    const normalizedRoot = normalizeRoot(configRoot);
    this.availableCache.delete(normalizedRoot);
    this.indexCache.delete(normalizedRoot);
  }

  private readBasedOnRefs(xmlPath: string): string[] {
    try {
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      return readBasedOnRefsFromXml(xml);
    } catch {
      return [];
    }
  }

  private getFreshIndex(normalizedRoot: string, configRoot: string): BasedOnIndexCache | null {
    const index = this.indexCache.get(normalizedRoot);
    if (!index) {
      return null;
    }
    const configMtimeMs = getFileMtimeMs(path.join(configRoot, 'Configuration.xml'));
    return index.configMtimeMs === configMtimeMs ? index : null;
  }

  private buildIndexSync(configRoot: string): BasedOnIndexCache {
    const normalizedRoot = normalizeRoot(configRoot);
    const configMtimeMs = getFileMtimeMs(path.join(configRoot, 'Configuration.xml'));
    const available = this.readAvailableObjects(configRoot);
    const basedOnByRef = new Map<string, string[]>();
    for (const item of available) {
      basedOnByRef.set(item.ref, this.readBasedOnRefs(item.xmlPath));
    }
    const index = this.buildIndexFromRefs(configMtimeMs, available, basedOnByRef);
    this.indexCache.set(normalizedRoot, index);
    return index;
  }

  private async buildIndexAsync(configRoot: string): Promise<BasedOnIndexCache> {
    const configMtimeMs = getFileMtimeMs(path.join(configRoot, 'Configuration.xml'));
    const available = this.readAvailableObjects(configRoot);
    const basedOnByRef = new Map<string, string[]>();
    await mapWithConcurrency(available, 16, async (item) => {
      basedOnByRef.set(item.ref, await readBasedOnRefsFromFile(item.xmlPath));
    });
    return this.buildIndexFromRefs(configMtimeMs, available, basedOnByRef);
  }

  private buildIndexFromRefs(
    configMtimeMs: number,
    available: BasedOnReferenceItem[],
    basedOnByRef: Map<string, string[]>
  ): BasedOnIndexCache {
    const availableRefs = new Set(available.map((item) => item.ref));
    const basedForByRef = new Map<string, string[]>();
    for (const item of available) {
      const basedOnRefs = basedOnByRef.get(item.ref) ?? [];
      for (const ref of basedOnRefs) {
        if (!availableRefs.has(ref)) {
          continue;
        }
        const basedFor = basedForByRef.get(ref);
        if (basedFor) {
          basedFor.push(item.ref);
        } else {
          basedForByRef.set(ref, [item.ref]);
        }
      }
    }

    return {
      configMtimeMs,
      available,
      basedOnByRef,
      basedForByRef,
    };
  }

  private writeBasedOn(xmlPath: string, refs: string[]): BasedOnEditResult {
    const changed = this.objectReader.updatePropertyInObject(xmlPath, {
      targetKind: 'Self',
      targetName: '',
      propertyKey: 'BasedOn',
      valueKind: 'metadataReferenceList',
      value: uniqueRefs(refs),
    });
    return changed ? { changed: true, changedFiles: [xmlPath] } : { changed: false, changedFiles: [] };
  }

  private buildRef(kind: BasedOnMetaKind, name: string): string {
    return `${kind}.${name}`;
  }

  private buildMissingItem(configRoot: string, ref: string): BasedOnReferenceItem | null {
    const parsed = parseSupportedRef(ref);
    if (!parsed) {
      return null;
    }
    return {
      ref,
      kind: parsed.kind,
      name: parsed.name,
      xmlPath: this.pathResolver.resolveXml(configRoot, parsed.kind, parsed.name) ?? '',
    };
  }

  private refOrder(left: BasedOnReferenceItem, right: BasedOnReferenceItem): number {
    if (left.kind !== right.kind) {
      return SUPPORTED_KINDS.indexOf(left.kind) - SUPPORTED_KINDS.indexOf(right.kind);
    }
    return left.name.localeCompare(right.name, 'ru');
  }
}

function parseSupportedRef(ref: string): { kind: BasedOnMetaKind; name: string } | null {
  const dotIndex = ref.indexOf('.');
  if (dotIndex <= 0 || dotIndex >= ref.length - 1) {
    return null;
  }
  const kind = ref.slice(0, dotIndex);
  if (kind !== 'Catalog' && kind !== 'Document') {
    return null;
  }
  return { kind, name: ref.slice(dotIndex + 1) };
}

function uniqueRefs(refs: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs.map((item) => item.trim()).filter(Boolean)) {
    if (!parseSupportedRef(ref) || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    result.push(ref);
  }
  return result;
}

function isReferenceItem(item: BasedOnReferenceItem | null): item is BasedOnReferenceItem {
  return item !== null;
}

function readBasedOnRefsFromXml(xml: string): string[] {
  const inner = extractNestingAwareBlock(xml, 'BasedOn') ?? '';
  return uniqueRefs(Array.from(inner.matchAll(/<xr:Item\b[^>]*>([^<]+)<\/xr:Item>/g)).map((match) => match[1].trim()));
}

async function readBasedOnRefsFromFile(xmlPath: string): Promise<string[]> {
  try {
    const xml = await fs.promises.readFile(xmlPath, 'utf-8');
    return readBasedOnRefsFromXml(xml);
  } catch {
    return [];
  }
}

function getFileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function normalizeRoot(configRoot: string): string {
  return path.resolve(configRoot).toLowerCase();
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  const runners = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      await worker(item);
    }
  });
  await Promise.all(runners);
}
