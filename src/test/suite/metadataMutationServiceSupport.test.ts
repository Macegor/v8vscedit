/**
 * Задача C4: add-путь метаданных (общий для MCP и UI) должен отклонять
 * добавление, если владелец/конфигурация находятся на поддержке с запретом
 * редактирования (`SupportMode.Locked`) — так же, как это уже делает
 * `V8McpServer.assertMetadataEditable` для остальных мутаций.
 *
 * `MetadataMutationService.validateRepositoryAccess` сейчас проверяет ТОЛЬКО
 * репозиторный захват и не знает про `supportService` вовсе — эти тесты
 * фиксируют ожидаемое поведение и должны падать до реализации фикса.
 *
 * Фикстуры реальные: минимальный справочник копируется из
 * `example/2.21/src/cf`, а `ParentConfigurations.bin` синтезируется на
 * временной копии с UUID этого справочника/конфигурации и нужным кодом
 * режима — формат `<uuid>,<uuid>,<mode>` совпадает с тем, что разбирает
 * `SupportInfoService.parseBinFile`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { MetadataMutationService } from '../../ui/commands/metadata/MetadataMutationService';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataXmlRemover } from '../../infra/xml/MetadataXmlRemover';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import { RepositoryService } from '../../infra/repository/RepositoryService';
import { ProjectSecretStorage } from '../../infra/environment/ProjectSecretStorage';
import type { SecretStore } from '../../infra/ai/AiSecretStorage';
import type { Logger } from '../../infra/support/Logger';
import type { CommandServices } from '../../ui/commands/_shared';

/** Фейковый SecretStore на Map — структурный контракт vscode.SecretStorage. */
function createFakeSecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(map.get(key)),
    store: (key: string, value: string) => {
      map.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

/** ProjectSecretStorage поверх Map-стора для тестов без Extension Host. */
function createFakeProjectSecretStorage(root: string): ProjectSecretStorage {
  return new ProjectSecretStorage(createFakeSecretStore(), root);
}

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.21/src/cf');
const SAMPLE_CATALOG_XML = path.join(EXAMPLE_CF, 'Catalogs', 'АвансовыйОтчетПрисоединенныеФайлы.xml');

class TestLogger implements Logger {
  readonly messages: string[] = [];
  appendLine(message: string): void {
    this.messages.push(message);
  }
}

suite('MetadataMutationService — проверка SupportMode.Locked при add (C4)', () => {
  let tempDir: string;
  let configRoot: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-add-support-'));
    configRoot = path.join(tempDir, 'cf');
    fs.mkdirSync(configRoot, { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Копирует минимальную Configuration.xml с заданным uuid конфигурации. */
  function writeConfigurationXml(configUuid: string): void {
    // BOM через экранирование \uFEFF (не литеральным невидимым символом),
    // чтобы не триггерить no-irregular-whitespace: реальные XML 1С
    // начинаются с UTF-8 BOM, и это нужно сохранить в фикстуре как есть.
    const xml = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="2.21">
  <Configuration uuid="${configUuid}">
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`;
    fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), xml, 'utf-8');
  }

  /** Копирует реальный справочник из example/2.21 в подготовленный configRoot и возвращает его uuid. */
  function copySampleCatalog(): { xmlPath: string; uuid: string } {
    const catalogsDir = path.join(configRoot, 'Catalogs');
    fs.mkdirSync(catalogsDir, { recursive: true });
    const content = fs.readFileSync(SAMPLE_CATALOG_XML, 'utf-8');
    const destName = 'ТестовыйСправочник.xml';
    fs.writeFileSync(path.join(catalogsDir, destName), content, 'utf-8');
    const uuidMatch = /uuid="([0-9a-f-]{36})"/i.exec(content);
    assert.ok(uuidMatch, 'В образце справочника должен быть uuid — иначе фикстура сломана');
    return { xmlPath: path.join(catalogsDir, destName), uuid: uuidMatch[1].toLowerCase() };
  }

  /**
   * Синтезирует `Ext/ParentConfigurations.bin` в формате, который разбирает
   * `SupportInfoService.parseBinFile`: строки `<uuid>,<uuid>,<mode>`.
   * Реальный `.bin` из example/ не подходит — там нет объектов с mode=2
   * (запрет редактирования), поэтому режим синтезируется явно под тест.
   */
  function writeParentConfigurationsBin(uuidToMode: ReadonlyMap<string, number>): void {
    const extDir = path.join(configRoot, 'Ext');
    fs.mkdirSync(extDir, { recursive: true });
    const rows = [...uuidToMode.entries()]
      .map(([uuid, mode]) => `${uuid},${uuid},${String(mode)}`)
      .join(',');
    fs.writeFileSync(path.join(extDir, 'ParentConfigurations.bin'), `{6,0,1,${rows}}`, 'latin1');
  }

  function createCommandServices(overrides: {
    supportService?: SupportInfoService;
    repositoryService: RepositoryService;
  }): CommandServices {
    const outputMessages: string[] = [];
    // Стаб полей, не участвующих в проверяемом сценарии (не задействуются до
    // ветвления по support/repository или безопасны как no-op на happy-path).
    return {
      treeProvider: { getEntries: () => [], refresh: () => undefined, refreshNodeFromCache: () => false } as unknown as CommandServices['treeProvider'],
      workspaceFolder: { uri: vscode.Uri.file(tempDir), name: 'test', index: 0 },
      metadataXmlCreator: new MetadataXmlCreator(),
      metadataXmlRemover: new MetadataXmlRemover(),
      outputChannel: { appendLine: (m: string) => outputMessages.push(m) } as unknown as vscode.OutputChannel,
      supportService: overrides.supportService,
      repositoryService: overrides.repositoryService,
      reloadEntries: () => Promise.resolve(),
      suppressConfigurationReloadForFiles: () => undefined,
      markChangedConfigurationByFiles: () => undefined,
      refreshActionsView: () => undefined,
    } as unknown as CommandServices;
  }

  test('Отклоняет добавление дочернего элемента к объекту, помеченному SupportMode.Locked', async () => {
    writeConfigurationXml('11111111-1111-1111-1111-111111111111');
    const { xmlPath: catalogXmlPath, uuid: catalogUuid } = copySampleCatalog();
    writeParentConfigurationsBin(new Map([[catalogUuid, 2]]));

    const supportService = new SupportInfoService(new TestLogger());
    supportService.loadConfig(configRoot);
    // Убедимся, что фикстура действительно даёт Locked — иначе тест бессмыслен.
    assert.strictEqual(supportService.getSupportMode(catalogXmlPath), 2, 'Фикстура должна давать SupportMode.Locked для справочника');

    const repositoryService = new RepositoryService(tempDir, createFakeProjectSecretStorage(tempDir));
    const services = createCommandServices({ supportService, repositoryService });
    const mutationService = new MetadataMutationService(services);

    const xmlBefore = fs.readFileSync(catalogXmlPath, 'utf-8');

    const result = await mutationService.addMetadata({
      target: {
        kind: 'child',
        ownerObjectXmlPath: catalogXmlPath,
        childTag: 'Attribute',
      },
      name: 'НовыйРеквизит',
    });

    assert.strictEqual(result.success, false, 'Добавление к объекту на поддержке с запретом редактирования должно быть отклонено');
    assert.ok(
      /поддерж/i.test(result.message),
      `Сообщение должно упоминать поддержку/запрет редактирования, получено: "${result.message}"`
    );

    const xmlAfter = fs.readFileSync(catalogXmlPath, 'utf-8');
    assert.strictEqual(xmlAfter, xmlBefore, 'XML объекта не должен измениться при отклонённом добавлении');
  });

  test('Отклоняет добавление корневого объекта, если корень конфигурации помечен SupportMode.Locked', async () => {
    const configUuid = '22222222-2222-2222-2222-222222222222';
    writeConfigurationXml(configUuid);
    writeParentConfigurationsBin(new Map([[configUuid, 2]]));

    const supportService = new SupportInfoService(new TestLogger());
    supportService.loadConfig(configRoot);
    const configXmlPath = path.join(configRoot, 'Configuration.xml');
    assert.strictEqual(supportService.getSupportMode(configXmlPath), 2, 'Фикстура должна давать SupportMode.Locked для корня конфигурации');

    const repositoryService = new RepositoryService(tempDir, createFakeProjectSecretStorage(tempDir));
    const services = createCommandServices({ supportService, repositoryService });
    const mutationService = new MetadataMutationService(services);

    const result = await mutationService.addMetadata({
      target: {
        kind: 'root',
        configRoot,
        configKind: 'cf',
        targetKind: 'Catalog',
      },
      name: 'НовыйСправочник',
    });

    assert.strictEqual(result.success, false, 'Добавление корневого объекта в заблокированную поддержкой конфигурацию должно быть отклонено');
    assert.ok(
      /поддерж/i.test(result.message),
      `Сообщение должно упоминать поддержку/запрет редактирования, получено: "${result.message}"`
    );
    assert.ok(
      !fs.existsSync(path.join(configRoot, 'Catalogs', 'НовыйСправочник.xml')),
      'XML нового справочника не должен быть создан при отклонённом добавлении'
    );
  });

  test('РЕГРЕССИЯ: добавление к объекту вне поддержки (SupportMode.None) без хранилища проходит успешно', async () => {
    writeConfigurationXml('33333333-3333-3333-3333-333333333333');
    const { xmlPath: catalogXmlPath } = copySampleCatalog();
    // ParentConfigurations.bin намеренно не создаём — конфигурация не на поддержке.

    const supportService = new SupportInfoService(new TestLogger());
    supportService.loadConfig(configRoot);
    assert.strictEqual(supportService.getSupportMode(catalogXmlPath), 0, 'Без ParentConfigurations.bin режим должен быть None');

    const repositoryService = new RepositoryService(tempDir, createFakeProjectSecretStorage(tempDir));
    const services = createCommandServices({ supportService, repositoryService });
    const mutationService = new MetadataMutationService(services);

    const result = await mutationService.addMetadata({
      target: {
        kind: 'child',
        ownerObjectXmlPath: catalogXmlPath,
        childTag: 'Attribute',
      },
      name: 'РеквизитБезОграничений',
    });

    assert.strictEqual(result.success, true, `Добавление должно пройти без ограничений: ${result.message}`);
    const xml = fs.readFileSync(catalogXmlPath, 'utf-8');
    assert.ok(xml.includes('<Name>РеквизитБезОграничений</Name>'), 'Реквизит должен быть добавлен в XML справочника');
  });

  test('РЕГРЕССИЯ: существующая репозиторная проверка продолжает отклонять незахваченный объект', async () => {
    writeConfigurationXml('44444444-4444-4444-4444-444444444444');
    const { xmlPath: catalogXmlPath } = copySampleCatalog();
    // Поддержки нет — проверяем, что старое поведение (репозиторная блокировка) не сломано фиксом C4.

    const repositoryService = new RepositoryService(tempDir, createFakeProjectSecretStorage(tempDir));
    const target = repositoryService.resolveTargetByXmlPath(catalogXmlPath);
    assert.ok(target, 'Должна резолвиться цель хранилища для справочника во временном configRoot');
    await repositoryService.saveBinding(target, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    repositoryService.setConnected(target, true);
    // Локальный захват не выставляем — объект должен остаться ограниченным.

    const services = createCommandServices({ repositoryService });
    const mutationService = new MetadataMutationService(services);

    const xmlBefore = fs.readFileSync(catalogXmlPath, 'utf-8');

    const result = await mutationService.addMetadata({
      target: {
        kind: 'child',
        ownerObjectXmlPath: catalogXmlPath,
        childTag: 'Attribute',
      },
      name: 'РеквизитПриЗапрете',
    });

    assert.strictEqual(result.success, false, 'Незахваченный в хранилище объект должен по-прежнему отклонять добавление');
    assert.ok(
      /хранилищ/i.test(result.message),
      `Сообщение должно упоминать хранилище (прежнее поведение), получено: "${result.message}"`
    );
    const xmlAfter = fs.readFileSync(catalogXmlPath, 'utf-8');
    assert.strictEqual(xmlAfter, xmlBefore, 'XML объекта не должен измениться при отклонённом репозиторной проверкой добавлении');
  });

  test('РЕГРЕССИЯ: репозиторная проверка отклоняет незахваченный корень конфигурации (root-ветка validateRepositoryAccess)', async () => {
    // Покрывает ветвь target.kind === 'root' внутри validateRepositoryAccess —
    // C4 оборачивает её в validateEditAccess, но сама ветвь дособытийная и
    // должна остаться доступной, если поддержка не установлена.
    writeConfigurationXml('55555555-5555-5555-5555-555555555555');
    // Поддержки нет — сработать должна именно репозиторная проверка корня.

    const repositoryService = new RepositoryService(tempDir, createFakeProjectSecretStorage(tempDir));
    const rootTarget = repositoryService.resolveTargetByConfigRoot(configRoot);
    assert.ok(rootTarget, 'Должна резолвиться цель хранилища для корня конфигурации');
    await repositoryService.saveBinding(rootTarget, {
      repoPath: '\\\\repo\\storage',
      repoUser: 'tester',
      repoPassword: 'secret',
    });
    repositoryService.setConnected(rootTarget, true);
    // Локальный захват корня не выставляем — корень должен остаться ограниченным.

    const services = createCommandServices({ repositoryService });
    const mutationService = new MetadataMutationService(services);

    const result = await mutationService.addMetadata({
      target: {
        kind: 'root',
        configRoot,
        configKind: 'cf',
        targetKind: 'Catalog',
      },
      name: 'СправочникПриЗапретеКорня',
    });

    assert.strictEqual(result.success, false, 'Незахваченный в хранилище корень должен отклонять добавление корневого объекта');
    assert.ok(
      /хранилищ/i.test(result.message),
      `Сообщение должно упоминать хранилище (репозиторная проверка корня), получено: "${result.message}"`
    );
    assert.ok(
      !fs.existsSync(path.join(configRoot, 'Catalogs', 'СправочникПриЗапретеКорня.xml')),
      'XML нового справочника не должен быть создан при отклонённом репозиторной проверкой добавлении'
    );
  });
});
