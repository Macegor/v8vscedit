import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { MetaKind } from '../../domain/MetaTypes';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { MetadataXmlRemover } from '../../infra/xml/MetadataXmlRemover';
import { getMetaFolder } from '../../domain/MetaTypes';
import { importAndUpdate, isOnecAvailable, readOnecEnv } from './support/onecEnv';

/**
 * Интеграционный тест генератора: на реальной тестовой базе из `example/2.20/env.json`
 * создаёт/меняет/удаляет объекты метаданных и прогоняет `/LoadConfigFromFiles` +
 * `/UpdateDBCfg`. Падение = платформа 1С НЕ приняла сгенерированный XML, то есть
 * реальный баг генератора. Если платформа/база недоступны (CI, sandbox) — тесты
 * пропускаются, а не падают.
 */
const PROJECT_ROOT = path.resolve(__dirname, '../../../example/2.20');
const CONFIG_ROOT = path.join(PROJECT_ROOT, 'src', 'cf');

// Виды, которые платформа 1С принимает как самодостаточный ПУСТОЙ объект
// (проверено реальным `/LoadConfigFromFiles` + `/UpdateDBCfg` на базе 2.20).
const KINDS: MetaKind[] = [
  'Catalog', 'Document', 'Enum',
  'ChartOfAccounts', 'ChartOfCharacteristicTypes', 'ChartOfCalculationTypes',
  'Task', 'ExchangePlan', 'Report', 'DataProcessor',
  'Constant', 'CommonModule', 'CommandGroup', 'Subsystem',
  'DefinedType', 'SessionParameter', 'FilterCriterion',
  'SettingsStorage', 'Role', 'Language', 'CommonForm', 'CommonAttribute',
  'StyleItem', 'Bot', 'CommonTemplate',
];

// Виды, которые 1С НЕ принимает как пустой объект — требуют пользовательского
// содержимого (это не баг генератора, XML структурно валиден). Здесь не
// проверяются на загрузку; при создании такого объекта пользователь обязан
// заполнить недостающее (см. сообщения платформы в скобках):
//   BusinessProcess (задача), InformationRegister/AccumulationRegister/
//   AccountingRegister/CalculationRegister (измерения/ресурсы/регистратор/
//   план расчёта), DocumentJournal (регистрируемые документы),
//   WebService (пространство имён + операции), HTTPService (корневой URL +
//   шаблоны), EventSubscription (источник/событие/обработчик),
//   ScheduledJob (метод), FunctionalOption (хранение),
//   FunctionalOptionsParameter (использование), CommonCommand (группа).

function objectName(kind: MetaKind): string {
  return `ГенТест${kind}`;
}

function objectXmlPath(kind: MetaKind, name: string): string {
  const folder = getMetaFolder(kind);
  return folder ? path.join(CONFIG_ROOT, folder, `${name}.xml`) : '';
}

function removeAllTestObjects(): void {
  const remover = new MetadataXmlRemover();
  for (const kind of KINDS) {
    const name = objectName(kind);
    if (objectXmlPath(kind, name) && fs.existsSync(objectXmlPath(kind, name))) {
      remover.removeRootObject({ configRoot: CONFIG_ROOT, kind, name });
    }
  }
}

suite('Интеграция генератора 2.20: загрузка сгенерированного XML в 1С', function () {
  // Запуск конфигуратора 1С долгий — снимаем ограничение Mocha по времени.
  this.timeout(20 * 60 * 1000);

  // Интеграция реально грузит конфигурацию в базу 1С и применяет к БД — это
  // медленно и мутирует базу. Поэтому включается только явным opt-in
  // `V8_ONEC_INTEGRATION=1 npm test` И при доступной платформе/базе из env.json.
  // Без переменной обычный `npm test` не трогает базу и не тормозит.
  const env = readOnecEnv(PROJECT_ROOT);
  const available = process.env.V8_ONEC_INTEGRATION === '1' && isOnecAvailable(env);

  suiteTeardown(() => {
    if (available) {
      // Возвращаем фикстуру к базовому состоянию, что бы ни случилось.
      removeAllTestObjects();
    }
  });

  test('создание всех основных видов + LoadConfigFromFiles + UpdateDBCfg', async function () {
    if (!available || !env) {
      this.skip();
      return;
    }
    removeAllTestObjects();
    const creator = new MetadataXmlCreator();
    for (const kind of KINDS) {
      const result = creator.addRootObject({
        configRoot: CONFIG_ROOT,
        kind,
        name: objectName(kind),
        templateType: kind === 'CommonTemplate' ? 'SpreadsheetDocument' : undefined,
      });
      assert.strictEqual(result.success, true, `генерация ${kind}: ${result.errors.join('; ')}`);
    }

    const { importExit, updateExit } = await importAndUpdate(env, 'cf');
    assert.strictEqual(importExit, 0, 'LoadConfigFromFiles отклонил сгенерированный XML');
    assert.strictEqual(updateExit, 0, 'UpdateDBCfg завершился с ошибкой');
  });

  test('добавление дочерних элементов к справочнику + загрузка/обновление', async function () {
    if (!available || !env) {
      this.skip();
      return;
    }
    const creator = new MetadataXmlCreator();
    const ownerXml = objectXmlPath('Catalog', objectName('Catalog'));
    assert.ok(fs.existsSync(ownerXml), 'справочник из первого теста должен существовать');

    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Attribute', name: 'ГенТестРеквизит' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'TabularSection', name: 'ГенТестТЧ' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Column', name: 'ГенТестКолонка', tabularSectionName: 'ГенТестТЧ' }).success, true);
    assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Form', name: 'ГенТестФорма' }).success, true);

    const { importExit, updateExit } = await importAndUpdate(env, 'cf');
    assert.strictEqual(importExit, 0, 'LoadConfigFromFiles отклонил объект с дочерними элементами');
    assert.strictEqual(updateExit, 0, 'UpdateDBCfg завершился с ошибкой');
  });

  test('удаление всех тестовых видов + загрузка/обновление', async function () {
    if (!available || !env) {
      this.skip();
      return;
    }
    removeAllTestObjects();
    const { importExit, updateExit } = await importAndUpdate(env, 'cf');
    assert.strictEqual(importExit, 0, 'LoadConfigFromFiles после удаления завершился с ошибкой');
    assert.strictEqual(updateExit, 0, 'UpdateDBCfg после удаления завершился с ошибкой');
  });
});
