import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../../extension';
import type { CommandServices } from '../../ui/commands/_shared';
import type { ChildTag } from '../../domain/ChildTag';
import { META_TYPES, getMetaFolder, type MetaKind } from '../../domain/MetaTypes';
import { ObjectXmlReader } from '../../infra/xml/ObjectXmlReader';
import { isOnecAvailable, readOnecEnv } from '../suite/support/onecEnv';

/**
 * E2E-матрица генерации: по КАЖДОМУ виду метаданных прогоняется полный
 * жизненный цикл через команды/сервисы расширения и реальную загрузку в базу 1С:
 *   создать → загрузить → добавить дочерние → загрузить → изменить свойства →
 *   загрузить → удалить дочерние → загрузить → удалить объект → обновить.
 *
 * Каждая фаза, где ожидается валидный XML, вызывает `updateChangedConfigurations`;
 * возврат false (платформа отклонила сгенерированный XML) валит тест — так падение
 * теста = реальный баг генератора, с точностью до вида и фазы.
 *
 * Набор дочерних элементов НЕ хардкодится: он выводится из `META_TYPES[kind].childTags`
 * (реестр — единственный источник правды). Добавили тег в реестр — матрица сама
 * начнёт его создавать/менять/удалять.
 *
 * Режимы запуска:
 *   - полный прогон:   `npm run test:e2e`
 *   - в разрезе вида:  `E2E_KIND=Catalog npm run test:e2e`
 *                      `E2E_KIND=Catalog,Document npm run test:e2e`
 *
 * Без платформы/базы из env.json тесты пропускаются, а не падают.
 */

const OBJECT_PREFIX = 'E2E';

// Виды, которые платформа 1С принимает как самодостаточный ПУСТОЙ объект
// (проверено `/LoadConfigFromFiles` + `/UpdateDBCfg` на базе 2.20). Полный
// жизненный цикл с загрузкой на каждой фазе.
const LOADABLE_EMPTY: readonly MetaKind[] = [
  'Catalog', 'Document', 'Enum', 'Report', 'DataProcessor',
  'ChartOfAccounts', 'ChartOfCharacteristicTypes', 'ChartOfCalculationTypes',
  'Task', 'ExchangePlan',
  'Constant', 'CommonModule', 'CommandGroup', 'Subsystem',
  'DefinedType', 'SessionParameter', 'FilterCriterion', 'SettingsStorage',
  'Role', 'Language', 'CommonForm', 'CommonAttribute', 'StyleItem', 'Bot', 'CommonTemplate',
];

// Виды, которые как пустой объект платформа НЕ принимает, но принимают после
// добавления обязательного содержимого (регистр с измерением+ресурсом). Для них
// загрузка проверяется начиная с фазы «добавить дочерние»; фаза «создать» и фаза
// «удалить дочерние» оставляют объект в структурно валидном, но неполном для БД
// состоянии — там проверяется только генерация и well-formed, без загрузки.
const LOADABLE_WITH_CHILDREN: readonly MetaKind[] = [
  'InformationRegister', 'AccumulationRegister',
];

type LoadCheck = 'empty' | 'withChildren';

interface Scenario {
  readonly kind: MetaKind;
  readonly loadCheck: LoadCheck;
}

const SCENARIOS: readonly Scenario[] = [
  ...LOADABLE_EMPTY.map((kind): Scenario => ({ kind, loadCheck: 'empty' })),
  ...LOADABLE_WITH_CHILDREN.map((kind): Scenario => ({ kind, loadCheck: 'withChildren' })),
];

// Порядок добавления дочерних: контейнеры (ТЧ) до вложенных колонок, простые
// ссылки (форма/команда/макет) — в конце. Из этого списка берутся только теги,
// объявленные у вида в META_TYPES.childTags.
const CHILD_ADD_ORDER: readonly ChildTag[] = [
  'Attribute', 'AddressingAttribute', 'Dimension', 'Resource',
  'TabularSection', 'EnumValue', 'Form', 'Command', 'Template',
];

// Теги, свойства которых умеет менять ObjectXmlReader.updatePropertyInObject.
// Форма и макет правку свойств через этот сервис не поддерживают — только
// добавление/удаление.
type EditableTarget =
  | 'Attribute' | 'AddressingAttribute' | 'Dimension' | 'Resource'
  | 'TabularSection' | 'Command' | 'EnumValue' | 'Column';

const EDIT_TARGET: Partial<Record<ChildTag | 'Column', EditableTarget>> = {
  Attribute: 'Attribute', AddressingAttribute: 'AddressingAttribute',
  Dimension: 'Dimension', Resource: 'Resource', TabularSection: 'TabularSection',
  Command: 'Command', EnumValue: 'EnumValue', Column: 'Column',
};

interface ChildOp {
  readonly childTag: ChildTag | 'Column';
  readonly name: string;
  readonly tabularSectionName?: string;
  readonly templateType?: 'TextDocument';
  readonly editTarget?: EditableTarget;
}

/** Строит список дочерних операций вида из реестра META_TYPES. */
function childOpsFor(kind: MetaKind): ChildOp[] {
  const tags = META_TYPES[kind].childTags ?? [];
  const ops: ChildOp[] = [];
  for (const tag of CHILD_ADD_ORDER) {
    if (!tags.includes(tag)) {
      continue;
    }
    const name = `${OBJECT_PREFIX}${kind}${tag}`;
    if (tag === 'TabularSection') {
      ops.push({ childTag: 'TabularSection', name, editTarget: 'TabularSection' });
      ops.push({ childTag: 'Column', name: `${OBJECT_PREFIX}${kind}Column`, tabularSectionName: name, editTarget: 'Column' });
      continue;
    }
    ops.push({
      childTag: tag,
      name,
      templateType: tag === 'Template' ? 'TextDocument' : undefined,
      editTarget: EDIT_TARGET[tag],
    });
  }
  return ops;
}

/** Общее состояние набора, заполняется в suiteSetup самого верхнего suite. */
const harness: { services?: CommandServices; configRoot: string; available: boolean } = {
  configRoot: '',
  available: false,
};

const reader = new ObjectXmlReader();

function selectedScenarios(): readonly Scenario[] {
  const filter = (process.env.E2E_KIND ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (filter.length === 0) {
    return SCENARIOS;
  }
  return SCENARIOS.filter((scenario) => filter.includes(scenario.kind));
}

function objectXmlPath(kind: MetaKind, name: string): string {
  const folder = getMetaFolder(kind);
  return folder ? path.join(harness.configRoot, folder, `${name}.xml`) : '';
}

async function loadIntoBase(): Promise<boolean> {
  return (await vscode.commands.executeCommand('v8vscedit.updateChangedConfigurations')) === true;
}

function ensureReady(ctx: Mocha.Context): CommandServices | null {
  if (!harness.available || !harness.services) {
    ctx.skip();
    return null;
  }
  return harness.services;
}

/** Помечает изменённые файлы и грузит в базу; false платформы = падение теста. */
async function loadChanged(svc: CommandServices, changedFiles: string[], phase: string): Promise<void> {
  svc.markChangedConfigurationByFiles(changedFiles);
  assert.strictEqual(await loadIntoBase(), true, `платформа отклонила: ${phase}`);
}

/** Проверяет, что XML объекта после мутации остаётся well-formed. */
function assertWellFormed(ownerXml: string, phase: string): void {
  const parsed = reader.read(ownerXml);
  assert.ok(parsed, `XML не читается ObjectXmlReader после фазы: ${phase}`);
}

function buildKindSuite(scenario: Scenario): void {
  const { kind, loadCheck } = scenario;
  const name = `${OBJECT_PREFIX}${kind}`;
  const ops = childOpsFor(kind);

  suite(`${META_TYPES[kind].label} (${kind})`, function () {
    let ownerXml = '';

    suiteSetup(() => {
      ownerXml = objectXmlPath(kind, name);
    });

    suiteTeardown(() => {
      // Возвращаем выгрузку к исходному состоянию, что бы ни случилось в фазах.
      if (harness.services && ownerXml && fs.existsSync(ownerXml)) {
        harness.services.metadataXmlRemover.removeRootObject({ configRoot: harness.configRoot, kind, name });
      }
    });

    test('создать объект → загрузить в базу', async function () {
      const svc = ensureReady(this);
      if (!svc) {
        return;
      }
      const result = svc.metadataXmlCreator.addRootObject({
        configRoot: harness.configRoot,
        kind,
        name,
        templateType: kind === 'CommonTemplate' ? 'SpreadsheetDocument' : undefined,
      });
      assert.strictEqual(result.success, true, `создание: ${result.errors.join('; ')}`);
      assertWellFormed(ownerXml, 'создать');
      // Пустой регистр в БД не грузится — откладываем загрузку до появления
      // измерения/ресурса. Файлы остаются помеченными изменёнными.
      if (loadCheck === 'empty') {
        await loadChanged(svc, result.changedFiles, 'создать объект');
      } else {
        svc.markChangedConfigurationByFiles(result.changedFiles);
      }
    });

    if (ops.length > 0) {
      test('добавить дочерние элементы → загрузить в базу', async function () {
        const svc = ensureReady(this);
        if (!svc) {
          return;
        }
        const changed: string[] = [];
        for (const op of ops) {
          const r = svc.metadataXmlCreator.addChildElement({
            ownerObjectXmlPath: ownerXml,
            childTag: op.childTag,
            name: op.name,
            tabularSectionName: op.tabularSectionName,
            templateType: op.templateType,
          });
          assert.strictEqual(r.success, true, `${op.childTag} "${op.name}": ${r.errors.join('; ')}`);
          changed.push(...r.changedFiles);
        }
        assertWellFormed(ownerXml, 'добавить дочерние');
        await loadChanged(svc, changed, 'объект с дочерними элементами');
      });
    }

    test('изменить свойства → загрузить в базу', async function () {
      const svc = ensureReady(this);
      if (!svc) {
        return;
      }
      // Правка собственного свойства объекта.
      assert.strictEqual(
        reader.updatePropertyInObject(ownerXml, {
          targetKind: 'Self',
          targetName: name,
          propertyKey: 'Comment',
          valueKind: 'string',
          value: 'E2E правка объекта',
        }),
        true,
        'свойство Comment объекта не изменилось'
      );
      // Правка свойств дочерних элементов, которые это поддерживают.
      for (const op of ops) {
        if (!op.editTarget) {
          continue;
        }
        assert.strictEqual(
          reader.updatePropertyInObject(ownerXml, {
            targetKind: op.editTarget,
            targetName: op.name,
            tabularSectionName: op.tabularSectionName,
            propertyKey: 'Comment',
            valueKind: 'string',
            value: `E2E правка ${op.editTarget}`,
          }),
          true,
          `свойство Comment у ${op.editTarget} "${op.name}" не изменилось`
        );
      }
      assertWellFormed(ownerXml, 'изменить свойства');
      await loadChanged(svc, [ownerXml], 'изменение свойств');
    });

    if (ops.length > 0) {
      test('удалить дочерние элементы → загрузить в базу', async function () {
        const svc = ensureReady(this);
        if (!svc) {
          return;
        }
        const changed: string[] = [];
        // Удаляем в обратном порядке: колонка раньше своей ТЧ.
        for (const op of [...ops].reverse()) {
          const r = svc.metadataXmlRemover.removeChildElement({
            ownerObjectXmlPath: ownerXml,
            childTag: op.childTag,
            name: op.name,
            tabularSectionName: op.tabularSectionName,
          });
          assert.strictEqual(r.success, true, `удаление ${op.childTag} "${op.name}": ${r.errors.join('; ')}`);
          changed.push(...r.changedFiles);
        }
        assertWellFormed(ownerXml, 'удалить дочерние');
        // Регистр без измерений/ресурсов снова невалиден для БД — загрузку
        // проверяем только там, где пустой объект грузится.
        if (loadCheck === 'empty') {
          await loadChanged(svc, changed, 'объект после удаления дочерних');
        } else {
          svc.markChangedConfigurationByFiles(changed);
        }
      });
    }

    test('удалить объект → обновить базу', async function () {
      const svc = ensureReady(this);
      if (!svc) {
        return;
      }
      const result = svc.metadataXmlRemover.removeRootObject({ configRoot: harness.configRoot, kind, name });
      assert.strictEqual(result.success, true, `удаление: ${result.errors.join('; ')}`);
      await loadChanged(svc, result.changedFiles, 'удаление объекта');
    });
  });
}

suite('E2E: матрица генерации по видам метаданных', function () {
  // Конфигуратор 1С долгий — снимаем ограничение Mocha по времени.
  this.timeout(60 * 60 * 1000);

  suiteSetup(async () => {
    const ext = vscode.extensions.all.find((e) => (e.packageJSON as { name?: string }).name === 'v8vscedit');
    if (!ext) {
      return;
    }
    const api = (await ext.activate()) as ExtensionApi | undefined;
    if (!api) {
      return;
    }
    harness.services = api.container.getServicesForTests();
    const workspaceRoot = harness.services.workspaceFolder.uri.fsPath;
    harness.configRoot = path.join(workspaceRoot, 'src', 'cf');
    harness.available = isOnecAvailable(readOnecEnv(workspaceRoot));
  });

  for (const scenario of selectedScenarios()) {
    buildKindSuite(scenario);
  }
});
