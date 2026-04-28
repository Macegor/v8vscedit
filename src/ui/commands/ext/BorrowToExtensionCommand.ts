import * as path from 'path';
import * as vscode from 'vscode';
import { MetaKind } from '../../../domain/MetaTypes';
import { ConfigEntry } from '../../../domain/Configuration';
import { CfeBorrowService } from '../../../infra/cfe/CfeBorrowService';
import { updateMetadataCacheAfterAdd, MetadataCacheAddTarget } from '../../../infra/cache/MetadataCache';
import { getObjectLocationFromXml, resolveObjectXmlPath } from '../../../infra/fs/MetaPathResolver';
import { parseConfigXml } from '../../../infra/xml';
import { MetadataNode } from '../../tree/TreeNode';
import { CommandServices, NodeArg } from '../_shared';

/** Дочерние типы узлов дерева, для которых нужно заимствовать родительский объект */
const CHILD_KINDS = new Set<string>([
  'Attribute', 'AddressingAttribute', 'TabularSection', 'Column',
  'Dimension', 'Resource', 'EnumValue', 'Template', 'Command',
]);

/** Дочерние типы, которые сами являются отдельными XML-файлами внутри объекта */
const FORM_KIND = 'Form';

/**
 * Описание, что именно нужно заимствовать из команды.
 * Формируется из выбранного узла дерева.
 */
interface BorrowTarget {
  /** Корень конфигурации-источника */
  cfDir: string;
  /** Тип объекта для заимствования (Catalog, Document, ...) */
  typeName: string;
  /** Имя объекта */
  objectName: string;
  /** Имя формы — только если нужно заимствовать именно форму */
  formName?: string;
  /**
   * Тег дочернего элемента для регистрации в ChildObjects родительского XML.
   * Например: 'Attribute', 'TabularSection', 'Dimension'.
   * Для колонки ТЧ — 'TabularSection' (заимствуется вся ТЧ).
   */
  childTag?: string;
  /** Имя дочернего элемента (значение тега childTag) */
  childName?: string;
}

const borrowService = new CfeBorrowService();

/** Регистрирует команду «Добавить в расширение» в контекстном меню навигатора */
export function registerBorrowToExtensionCommand(
  context: vscode.ExtensionContext,
  services: CommandServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'v8vscedit.borrowToExtension',
      async (node: NodeArg) => {
        await borrowToExtension(node, services);
      }
    )
  );
}

async function borrowToExtension(node: NodeArg, services: CommandServices): Promise<void> {
  const metaNode = node instanceof MetadataNode ? node : undefined;

  const borrowTarget = resolveBorrowTarget(metaNode);
  if (!borrowTarget) {
    await vscode.window.showWarningMessage(
      'Заимствование недоступно для выбранного узла.'
    );
    return;
  }

  const cfeEntries = services.treeProvider.getEntries().filter((e) => e.kind === 'cfe');
  if (cfeEntries.length === 0) {
    await vscode.window.showWarningMessage('В проекте нет расширений для заимствования.');
    return;
  }

  // Проверяем, что источник — основная конфигурация (CF), а не другое расширение
  const sourceEntry = services.treeProvider.getEntries()
    .find((e) => isSameConfigRoot(e.rootPath, borrowTarget.cfDir));
  if (sourceEntry?.kind === 'cfe') {
    await vscode.window.showWarningMessage(
      'Нельзя заимствовать объекты из другого расширения.'
    );
    return;
  }

  const extEntry = cfeEntries.length === 1
    ? cfeEntries[0]
    : await pickExtensionEntry(cfeEntries);

  if (!extEntry) {
    return;
  }

  await runBorrow(borrowTarget, extEntry, services);
}

/**
 * Определяет, что заимствовать на основе выбранного узла дерева.
 * - Формы — заимствует родительский объект + форму.
 * - Дочерние элементы (реквизиты, ТЧ, ...) — заимствует родительский объект
 *   и регистрирует конкретный элемент в ChildObjects.
 * - Корневые объекты — заимствует напрямую.
 */
function resolveBorrowTarget(node: MetadataNode | undefined): BorrowTarget | null {
  if (!node?.xmlPath) {
    return null;
  }

  const nodeKind = node.nodeKind as string;

  if (nodeKind === FORM_KIND && node.metaContext?.ownerObjectXmlPath) {
    const ownerXml = node.metaContext.ownerObjectXmlPath;
    const loc = getObjectLocationFromXml(ownerXml);
    const parentTypeName = metaKindToTypeName(node.metaContext.rootMetaKind);
    if (!parentTypeName) {
      return null;
    }
    return {
      cfDir: loc.configRoot,
      typeName: parentTypeName,
      objectName: loc.objectName,
      formName: node.model.label,
    };
  }

  if (CHILD_KINDS.has(nodeKind) && node.metaContext?.ownerObjectXmlPath) {
    const ownerXml = node.metaContext.ownerObjectXmlPath;
    const loc = getObjectLocationFromXml(ownerXml);
    const parentTypeName = metaKindToTypeName(node.metaContext.rootMetaKind);
    if (!parentTypeName) {
      return null;
    }

    // Для колонки ТЧ заимствуем саму ТЧ целиком
    const childTag = nodeKind === 'Column' ? 'TabularSection' : nodeKind;
    const childName = nodeKind === 'Column'
      ? node.metaContext.tabularSectionName
      : node.model.label;

    if (!childName) {
      return null;
    }

    return {
      cfDir: loc.configRoot,
      typeName: parentTypeName,
      objectName: loc.objectName,
      childTag,
      childName,
    };
  }

  // Корневой объект метаданных — заимствуем напрямую
  if (node.xmlPath) {
    const loc = getObjectLocationFromXml(node.xmlPath);
    const typeName = metaKindToTypeName(node.nodeKind);
    if (!typeName) {
      return null;
    }
    return {
      cfDir: loc.configRoot,
      typeName,
      objectName: loc.objectName,
    };
  }

  return null;
}

async function runBorrow(
  target: BorrowTarget,
  extEntry: ConfigEntry,
  services: CommandServices
): Promise<void> {
  const extDir = extEntry.rootPath;
  const objectLabel = target.formName
    ? `${target.typeName}.${target.objectName}.Form.${target.formName}`
    : target.childTag
      ? `${target.typeName}.${target.objectName}.${target.childTag}.${target.childName}`
      : `${target.typeName}.${target.objectName}`;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Заимствование ${objectLabel}`,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: 'обработка...' });

        let result;
        if (target.formName) {
          result = borrowService.borrowForm(
            target.cfDir, extDir, target.typeName, target.objectName, target.formName
          );
        } else if (target.childTag && target.childName) {
          result = borrowService.borrowChild(
            target.cfDir, extDir, target.typeName, target.objectName,
            target.childTag, target.childName
          );
        } else {
          result = borrowService.borrowObject(
            target.cfDir, extDir, target.typeName, target.objectName
          );
        }

        for (const file of result.files) {
          services.outputChannel.appendLine(`[borrow] ${file}`);
        }

        if (result.alreadyBorrowed) {
          if (!refreshBorrowedObjectCache(target, extEntry, services)) {
            await services.reloadEntries();
          }
          await revealBorrowedNode(target, extDir, services);
          void vscode.window.showInformationMessage(
            `Объект "${objectLabel}" уже заимствован в расширении.`
          );
        } else {
          services.suppressConfigurationReloadForFiles(result.files);
          services.markChangedConfigurationByFiles(result.files);

          if (!refreshBorrowedObjectCache(target, extEntry, services)) {
            await services.reloadEntries();
          }

          await revealBorrowedNode(target, extDir, services);

          void vscode.window.showInformationMessage(
            `Объект "${objectLabel}" успешно добавлен в расширение.`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        services.outputChannel.appendLine(`[borrow][error] ${message}`);
        void vscode.window.showErrorMessage(
          `Ошибка заимствования "${objectLabel}": ${message}`,
          'Открыть журнал'
        ).then((action) => {
          if (action === 'Открыть журнал') {
            services.outputChannel.show(true);
          }
        });
      }
    }
  );
}

function refreshBorrowedObjectCache(
  target: BorrowTarget,
  extEntry: ConfigEntry,
  services: CommandServices
): boolean {
  const addTarget: MetadataCacheAddTarget = {
    kind: 'root',
    configRoot: extEntry.rootPath,
    configKind: 'cfe',
    targetKind: target.typeName as MetaKind,
  };

  try {
    const cacheUpdate = updateMetadataCacheAfterAdd(
      services.workspaceFolder.uri.fsPath,
      extEntry,
      addTarget,
      target.objectName
    );
    if (!cacheUpdate.updatedPartially) {
      services.outputChannel.appendLine(
        '[borrow][warn] Частичное обновление кэша не удалось, кэш расширения пересобран.'
      );
    }
    if (!services.treeProvider.applyCacheSnapshot(cacheUpdate.snapshot)) {
      services.treeProvider.refresh();
    }
    return true;
  } catch (cacheErr) {
    services.outputChannel.appendLine(
      `[borrow][warn] Точечное обновление кэша не удалось, полная перезагрузка: ${cacheErr}`
    );
    return false;
  }
}

async function revealBorrowedNode(
  target: BorrowTarget,
  extDir: string,
  services: CommandServices
): Promise<void> {
  const objectXmlPath = resolveObjectXmlPath(extDir, target.typeName, target.objectName);
  if (!objectXmlPath) {
    return;
  }

  const normalizedObjectXmlPath = normalizePath(objectXmlPath);
  const expectedKind = target.formName ? FORM_KIND : target.childTag;
  const expectedLabel = target.formName ?? target.childName;

  const revealed = await services.revealTreeNode(
    (node) => {
      if (target.formName || target.childTag) {
        return Boolean(
          expectedKind &&
          expectedLabel &&
          node.nodeKind === expectedKind &&
          node.textLabel === expectedLabel &&
          node.metaContext?.ownerObjectXmlPath &&
          normalizePath(node.metaContext.ownerObjectXmlPath) === normalizedObjectXmlPath
        );
      }

      return Boolean(
        node.nodeKind === target.typeName &&
        node.textLabel === target.objectName &&
        node.xmlPath &&
        normalizePath(node.xmlPath) === normalizedObjectXmlPath
      );
    },
    extDir
  );

  if (!revealed) {
    services.outputChannel.appendLine(`[borrow][warn] Не удалось найти заимствованный узел в дереве: ${target.typeName}.${target.objectName}`);
  }
}

/** Показывает QuickPick для выбора расширения из списка */
async function pickExtensionEntry(
  entries: ConfigEntry[]
): Promise<ConfigEntry | undefined> {
  interface ExtensionPickItem extends vscode.QuickPickItem {
    entry: ConfigEntry;
  }

  const items: ExtensionPickItem[] = entries.map((entry) => {
    let name = path.basename(entry.rootPath);
    try {
      const info = parseConfigXml(path.join(entry.rootPath, 'Configuration.xml'));
      if (info.name) {
        name = info.name;
      }
    } catch {
      // оставляем имя папки
    }
    return {
      label: `$(extensions) ${name}`,
      description: entry.rootPath,
      entry,
    };
  });

  const picked = await vscode.window.showQuickPick<ExtensionPickItem>(items, {
    title: 'Выберите расширение для заимствования',
    placeHolder: 'Расширение',
  });

  return picked?.entry;
}

/**
 * Преобразует `MetaKind` в строковое имя типа метаданных 1С.
 * Для большинства типов они совпадают, но MetaKind используется
 * в нижнем регистре для служебных узлов.
 */
function metaKindToTypeName(kind: MetaKind | string): string | null {
  // Служебные и недоменные узлы не заимствуются
  const serviceKinds = new Set([
    'configuration', 'extension', 'extensions-root',
    'group-common', 'group-top', 'group-type', 'group-documents',
    'Attribute', 'AddressingAttribute', 'TabularSection', 'Column',
    'Dimension', 'Resource', 'EnumValue', 'Form', 'Command', 'Template',
  ]);
  if (serviceKinds.has(kind)) {
    return null;
  }
  // Для доменных объектов MetaKind === имя типа в XML (Catalog, Document, ...)
  return kind;
}

function isSameConfigRoot(rootA: string, rootB: string): boolean {
  return path.resolve(rootA).toLowerCase() === path.resolve(rootB).toLowerCase();
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}
