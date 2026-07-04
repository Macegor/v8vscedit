import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { BasedOnXmlService } from '../../infra/xml/BasedOnXmlService';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';
import { ExchangePlanContentService } from '../../infra/xml/ExchangePlanContentService';
import { SubsystemXmlService } from '../../infra/xml/SubsystemXmlService';
import { SupportMode, type SupportInfoService } from '../../infra/support/SupportInfoService';
import type { RepositoryService } from '../../infra/repository/RepositoryService';
import { MetadataNode } from '../../ui/tree/TreeNode';
import type { MetaTreeNodeContext } from '../../ui/tree/TreeNodeModel';
import { PropertiesViewController } from '../../ui/views/properties/PropertiesViewController';
import { TypeRegistryService } from '../../ui/views/properties/TypeRegistryService';

/**
 * CHARACTERIZATION-тесты перед декомпозицией God-класса
 * `PropertiesViewController` (1287 строк). Задача — застраховать ДВА чистых
 * кластера, которые планируется вынести в свободные функции:
 *
 *  1) edit-lock резолвер (isEditLockedBySupport/isEditLockedByRepository/
 *     resolveEditLockReason/resolveNodeSupportMode) — разветвление по
 *     node.nodeKind при определении, КАКОЙ xmlPath/uuid передаётся в
 *     supportService;
 *  2) классификация/snapshot узлов (isConfigurationRootNode/
 *     isSubsystemMembershipNode/resolveBasedOnKind).
 *
 * Рефакторинг — чистая косметика без изменения поведения, поэтому тест
 * обязан быть ЗЕЛЁНЫМ на текущем HEAD. Приватные методы вызываются через
 * структурное приведение типа (`as unknown as { ... }`) — тот же паттерн,
 * что уже применяется в mcpToolsCatalog.test.ts/mcpServerAfterMutationGate.test.ts
 * для приватных членов, которые пока не публичны в контракте класса.
 */

// Реальный объект из выгрузки example: Catalog "Банки" содержит Attribute
// "КоррСчет" с известным uuid — этого достаточно, чтобы зафиксировать, какой
// xmlPath/uuid резолвер вычисляет для узла типа Attribute, не поднимая
// ParentConfigurations.bin (реальная инфраструктура поддержки требует бинарный
// файл хранилища, которого в примере нет; фиксируем именно ветвление вызова).
const BANKS_XML_PATH = path.resolve(
  __dirname,
  '../../../example/2.21/src/cf/Catalogs/Банки.xml'
);
const BANKS_ATTRIBUTE_NAME = 'КоррСчет';
const BANKS_ATTRIBUTE_UUID = '4a11d434-d753-49c6-b402-697eee429f34';

// Catalog "АвтоматическиеСкидки" содержит TabularSection "ВремяПоДнямНедели"
// с дочерним Attribute "Выбран" (в дереве отображается как узел Column) —
// нужен для проверки ветки resolveNodeSupportMode по Column (uuid колонки
// извлекается из вложенного ChildObjects табличной части, а не с корня).
const DISCOUNTS_XML_PATH = path.resolve(
  __dirname,
  '../../../example/2.21/src/cf/Catalogs/АвтоматическиеСкидки.xml'
);
const DISCOUNTS_TABULAR_SECTION = 'ВремяПоДнямНедели';
const DISCOUNTS_COLUMN_NAME = 'Выбран';
const DISCOUNTS_COLUMN_UUID = '516337b6-a882-45f0-9f35-a72588fca1d0';

/** Фейковый supportService, фиксирующий, с каким xmlPath/uuid его вызвали. */
class RecordingSupportService {
  readonly byUuidCalls: { xmlPath: string; uuid: string }[] = [];
  readonly byPathCalls: string[] = [];
  private nextMode: SupportMode = SupportMode.None;

  setNextMode(mode: SupportMode): void {
    this.nextMode = mode;
  }

  getSupportModeByUuid(xmlPath: string, uuid: string): SupportMode {
    this.byUuidCalls.push({ xmlPath, uuid });
    return this.nextMode;
  }

  getSupportMode(xmlPath: string): SupportMode {
    this.byPathCalls.push(xmlPath);
    return this.nextMode;
  }
}

/** Фейковый repositoryService, фиксирующий вызов isEditRestricted. */
class RecordingRepositoryService {
  readonly calls: string[] = [];
  private nextRestricted = false;

  setNextRestricted(restricted: boolean): void {
    this.nextRestricted = restricted;
  }

  isEditRestricted(filePath: string): boolean {
    this.calls.push(filePath);
    return this.nextRestricted;
  }
}

interface EditLockPrivateApi {
  isEditLockedBySupport(node: MetadataNode): boolean;
  isEditLockedByRepository(node: MetadataNode): boolean;
  resolveEditLockReason(node: MetadataNode): 'support' | 'repository' | undefined;
  resolveNodeSupportMode(node: MetadataNode): SupportMode;
}

interface ClassificationPrivateApi {
  isConfigurationRootNode(node: MetadataNode): boolean;
  isSubsystemMembershipNode(node: MetadataNode): boolean;
  resolveBasedOnKind(node: MetadataNode): 'Catalog' | 'Document' | null;
}

function createController(
  supportService?: SupportInfoService,
  repositoryService?: RepositoryService
): PropertiesViewController {
  return new PropertiesViewController(
    new SubsystemXmlService(),
    new ExchangePlanContentService(),
    new TypeRegistryService(),
    new ConfigurationXmlEditor(),
    new BasedOnXmlService(),
    {
      refreshActiveView: () => undefined,
      replaceActiveNode: () => undefined,
    },
    supportService,
    repositoryService
  );
}

function asEditLockApi(controller: PropertiesViewController): EditLockPrivateApi {
  return controller as unknown as EditLockPrivateApi;
}

function asClassificationApi(controller: PropertiesViewController): ClassificationPrivateApi {
  return controller as unknown as ClassificationPrivateApi;
}

function makeAttributeNode(
  xmlPath: string,
  label: string,
  metaContext?: MetaTreeNodeContext
): MetadataNode {
  return new MetadataNode(
    {
      label,
      nodeKind: 'Attribute',
      xmlPath,
      metaContext,
    },
    vscode.TreeItemCollapsibleState.None
  );
}

function makeColumnNode(
  xmlPath: string,
  label: string,
  tabularSectionName: string
): MetadataNode {
  return new MetadataNode(
    {
      label,
      nodeKind: 'Column',
      xmlPath,
      metaContext: { rootMetaKind: 'Catalog', tabularSectionName, ownerObjectXmlPath: xmlPath },
    },
    vscode.TreeItemCollapsibleState.None
  );
}

suite('PropertiesViewController — characterization: edit-lock резолвер', () => {
  test('без supportService isEditLockedBySupport всегда false, resolveNodeSupportMode — None', () => {
    const controller = createController();
    const node = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME);
    const api = asEditLockApi(controller);

    assert.strictEqual(api.isEditLockedBySupport(node), false);
    assert.strictEqual(api.resolveNodeSupportMode(node), SupportMode.None);
  });

  test('без repositoryService isEditLockedByRepository всегда false', () => {
    const controller = createController();
    const node = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME);
    const api = asEditLockApi(controller);

    assert.strictEqual(api.isEditLockedByRepository(node), false);
  });

  test('несуществующий xmlPath делает isEditLockedBySupport/isEditLockedByRepository false, вызовов сервисов не происходит', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Locked);
    const repoFake = new RecordingRepositoryService();
    repoFake.setNextRestricted(true);

    const controller = createController(
      supportFake as unknown as SupportInfoService,
      repoFake as unknown as RepositoryService
    );
    const node = makeAttributeNode('/nonexistent/path/Missing.xml', 'Отсутствующий');
    const api = asEditLockApi(controller);

    // Резолвер обязан проверять fs.existsSync ДО обращения к сервисам —
    // критично зафиксировать перед выносом, что при отсутствующем файле
    // ни supportService, ни repositoryService не вызываются вовсе.
    assert.strictEqual(api.isEditLockedBySupport(node), false);
    assert.strictEqual(api.isEditLockedByRepository(node), false);
    assert.strictEqual(supportFake.byUuidCalls.length, 0);
    assert.strictEqual(supportFake.byPathCalls.length, 0);
    assert.strictEqual(repoFake.calls.length, 0);
  });

  test('nodeKind=Attribute: resolveNodeSupportMode извлекает uuid дочернего Attribute из XML владельца и вызывает getSupportModeByUuid', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Editable);
    const controller = createController(supportFake as unknown as SupportInfoService);
    const node = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });
    const api = asEditLockApi(controller);

    const mode = api.resolveNodeSupportMode(node);

    assert.strictEqual(mode, SupportMode.Editable);
    assert.strictEqual(supportFake.byUuidCalls.length, 1, 'должен резолвиться по uuid, а не по файлу целиком');
    assert.strictEqual(supportFake.byUuidCalls[0].xmlPath, BANKS_XML_PATH);
    assert.strictEqual(
      supportFake.byUuidCalls[0].uuid,
      BANKS_ATTRIBUTE_UUID,
      'uuid должен быть извлечён именно из дочернего <Attribute>, а не из корневого <Catalog>'
    );
    assert.strictEqual(supportFake.byPathCalls.length, 0);
  });

  test('nodeKind=Column: resolveNodeSupportMode извлекает uuid из вложенного ChildObjects табличной части', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Locked);
    const controller = createController(supportFake as unknown as SupportInfoService);
    const node = makeColumnNode(DISCOUNTS_XML_PATH, DISCOUNTS_COLUMN_NAME, DISCOUNTS_TABULAR_SECTION);
    const api = asEditLockApi(controller);

    const mode = api.resolveNodeSupportMode(node);

    assert.strictEqual(mode, SupportMode.Locked);
    assert.strictEqual(supportFake.byUuidCalls.length, 1);
    assert.strictEqual(supportFake.byUuidCalls[0].xmlPath, DISCOUNTS_XML_PATH);
    assert.strictEqual(
      supportFake.byUuidCalls[0].uuid,
      DISCOUNTS_COLUMN_UUID,
      'для Column uuid должен браться из вложенной табличной части, а не из корня объекта'
    );
  });

  test('nodeKind без childTag/Column/SessionParameter/CommonAttribute — резолвер обращается к getSupportMode по всему файлу', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Editable);
    const controller = createController(supportFake as unknown as SupportInfoService);
    // Сам объект-справочник (корневой узел) — не входит ни в childTagMap, ни
    // Column/SessionParameter/CommonAttribute, поэтому обязана сработать
    // терминальная ветка getSupportMode(xmlPath) на уровне всего файла.
    const node = makeAttributeNode(BANKS_XML_PATH, 'Банки');
    (node as unknown as { model: { nodeKind: string } }).model.nodeKind = 'Catalog';
    const api = asEditLockApi(controller);

    const mode = api.resolveNodeSupportMode(node);

    assert.strictEqual(mode, SupportMode.Editable);
    assert.strictEqual(supportFake.byPathCalls.length, 1);
    assert.strictEqual(supportFake.byPathCalls[0], BANKS_XML_PATH);
    assert.strictEqual(supportFake.byUuidCalls.length, 0);
  });

  test('resolveEditLockReason отдаёт приоритет support над repository, когда заблокировано и то, и другое', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Locked);
    const repoFake = new RecordingRepositoryService();
    repoFake.setNextRestricted(true);
    const controller = createController(
      supportFake as unknown as SupportInfoService,
      repoFake as unknown as RepositoryService
    );
    const node = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });
    const api = asEditLockApi(controller);

    const reason = api.resolveEditLockReason(node);

    assert.strictEqual(reason, 'support', 'при конфликте support обязан выигрывать у repository');
    // Repository не должен даже опрашиваться, поскольку short-circuit на support уже сработал.
    assert.strictEqual(repoFake.calls.length, 0);
  });

  test('resolveEditLockReason возвращает repository, когда support не заблокирован', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Editable);
    const repoFake = new RecordingRepositoryService();
    repoFake.setNextRestricted(true);
    const controller = createController(
      supportFake as unknown as SupportInfoService,
      repoFake as unknown as RepositoryService
    );
    const node = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });
    const api = asEditLockApi(controller);

    const reason = api.resolveEditLockReason(node);

    assert.strictEqual(reason, 'repository');
  });

  test('resolveEditLockReason возвращает undefined, когда ни support, ни repository не блокируют', () => {
    const supportFake = new RecordingSupportService();
    supportFake.setNextMode(SupportMode.Editable);
    const repoFake = new RecordingRepositoryService();
    repoFake.setNextRestricted(false);
    const controller = createController(
      supportFake as unknown as SupportInfoService,
      repoFake as unknown as RepositoryService
    );
    const node = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });
    const api = asEditLockApi(controller);

    assert.strictEqual(api.resolveEditLockReason(node), undefined);
  });

  test('isEditLockedByRepository использует metaContext.ownerObjectXmlPath, если он задан, а не node.xmlPath', () => {
    const repoFake = new RecordingRepositoryService();
    repoFake.setNextRestricted(true);
    const controller = createController(undefined, repoFake as unknown as RepositoryService);
    // xmlPath намеренно указывает на несуществующий путь — реальный целевой
    // файл передан только через ownerObjectXmlPath, как это происходит для
    // дочерних узлов (Attribute/Column/...).
    const node = makeAttributeNode('/nonexistent/Missing.xml', BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });
    const api = asEditLockApi(controller);

    assert.strictEqual(api.isEditLockedByRepository(node), true);
    assert.deepStrictEqual(repoFake.calls, [BANKS_XML_PATH]);
  });
});

suite('PropertiesViewController — characterization: классификация/snapshot узлов', () => {
  test('isConfigurationRootNode: true для configuration и extension, false для обычного объекта метаданных', () => {
    const controller = createController();
    const api = asClassificationApi(controller);

    const configNode = new MetadataNode(
      { label: 'Конфигурация', nodeKind: 'configuration', xmlPath: BANKS_XML_PATH },
      vscode.TreeItemCollapsibleState.None
    );
    const extensionNode = new MetadataNode(
      { label: 'Расширение', nodeKind: 'extension', xmlPath: BANKS_XML_PATH },
      vscode.TreeItemCollapsibleState.None
    );
    const catalogNode = makeAttributeNode(BANKS_XML_PATH, 'Банки');
    (catalogNode as unknown as { model: { nodeKind: string } }).model.nodeKind = 'Catalog';

    assert.strictEqual(api.isConfigurationRootNode(configNode), true);
    assert.strictEqual(api.isConfigurationRootNode(extensionNode), true);
    assert.strictEqual(api.isConfigurationRootNode(catalogNode), false);
  });

  test('resolveBasedOnKind: Catalog/Document — их собственный nodeKind, дочерний Attribute — null', () => {
    const controller = createController();
    const api = asClassificationApi(controller);

    const catalogNode = makeAttributeNode(BANKS_XML_PATH, 'Банки');
    (catalogNode as unknown as { model: { nodeKind: string } }).model.nodeKind = 'Catalog';
    const attributeNode = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });

    assert.strictEqual(api.resolveBasedOnKind(catalogNode), 'Catalog');
    assert.strictEqual(api.resolveBasedOnKind(attributeNode), null, 'дочерний узел (не корневой объект) не является объектом ввода на основании');
  });

  test('isSubsystemMembershipNode: true для корневого объекта метаданных с folder в META_TYPES, false для Subsystem и для дочернего узла', () => {
    const controller = createController();
    const api = asClassificationApi(controller);

    const catalogNode = makeAttributeNode(BANKS_XML_PATH, 'Банки');
    (catalogNode as unknown as { model: { nodeKind: string } }).model.nodeKind = 'Catalog';
    const subsystemNode = makeAttributeNode(BANKS_XML_PATH, 'Подсистема1');
    (subsystemNode as unknown as { model: { nodeKind: string } }).model.nodeKind = 'Subsystem';
    const attributeNode = makeAttributeNode(BANKS_XML_PATH, BANKS_ATTRIBUTE_NAME, {
      rootMetaKind: 'Catalog',
      ownerObjectXmlPath: BANKS_XML_PATH,
    });

    assert.strictEqual(api.isSubsystemMembershipNode(catalogNode), true);
    assert.strictEqual(api.isSubsystemMembershipNode(subsystemNode), false, 'Subsystem явно исключена — сама себе не может быть членом подсистемы');
    assert.strictEqual(api.isSubsystemMembershipNode(attributeNode), false, 'дочерний узел не является корневым объектом метаданных');
  });
});
