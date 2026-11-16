import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { SupportInfoService, SupportMode } from '../../infra/support/SupportInfoService';
import {
  LineLogger,
  makeTempDir,
  objectXml,
  removeTempDir,
  testUuid,
  writeBin,
  writeFileIn,
  type BinRecord,
} from './support/parentConfigurationsBin';

/**
 * Режим поддержки по `ParentConfigurations.bin`. Корпус `example/` не нужен:
 * выгрузка и bin синтезируются во временном каталоге (uuid эталонов взяты из
 * реальной выгрузки, структура файлов — плоская, как у платформы).
 */
const REG_UUID = '42edf505-ea06-4c6c-8063-0f457ad65ef6';
const EDITABLE_DOC_UUID = '0ff61b1f-319d-49ab-b803-5631722395e9';
const LOCKED_DOC_UUID = '820dd00c-0419-4faa-9426-4b639a281289';

const CFG_UUID = testUuid(100);
const OWNER_UUID = testUuid(101);
const CHILD_UUID = testUuid(102);

type Layout = 'deep' | 'flat';

function bump(file: string, deltaMs: number): void {
  const t = new Date(fs.statSync(file).mtimeMs + deltaMs);
  fs.utimesSync(file, t, t);
}

suite('SupportInfoService', () => {
  let tmp: string;
  let cf: string;
  let log: LineLogger;
  let service: SupportInfoService;

  setup(() => {
    tmp = makeTempDir('v8vscedit-support-');
    cf = path.join(tmp, 'cf');
    fs.mkdirSync(cf, { recursive: true });
    log = new LineLogger();
    service = new SupportInfoService(log);
  });

  teardown(() => {
    removeTempDir(tmp);
  });

  function writeBinFor(root: string, records: readonly BinRecord[]): string {
    return writeBin(root, [{ name: 'Поставщик', records }]);
  }

  suite('эталонные объекты (плоская раскладка)', () => {
    let regXml: string;
    let editableXml: string;
    let lockedXml: string;

    setup(() => {
      regXml = writeFileIn(cf, 'InformationRegisters/МК_СоставОригиналовДокументовПоПеревозке.xml',
        objectXml('InformationRegister', REG_UUID, 'МК_СоставОригиналовДокументовПоПеревозке'));
      editableXml = writeFileIn(cf, 'Documents/СчетНаОплатуПокупателю.xml',
        objectXml('Document', EDITABLE_DOC_UUID, 'СчетНаОплатуПокупателю'));
      lockedXml = writeFileIn(cf, 'Documents/СписаниеДепонированнойЗарплаты.xml',
        objectXml('Document', LOCKED_DOC_UUID, 'СписаниеДепонированнойЗарплаты'));
      writeBinFor(cf, [
        { code: 1, uuid: EDITABLE_DOC_UUID },
        { code: 0, uuid: LOCKED_DOC_UUID },
      ]);
      service.loadConfig(cf);
    });

    test('объект без записи — None, но данные конфигурации есть', () => {
      assert.strictEqual(service.getSupportMode(regXml), SupportMode.None);
      assert.strictEqual(service.hasConfigData(regXml), true);
    });

    test('код 1 — Editable, не блокирует', () => {
      assert.strictEqual(service.getSupportMode(editableXml), SupportMode.Editable);
      assert.strictEqual(service.isLocked(editableXml), false);
    });

    test('код 0 — Locked, модуль объекта и модуль формы наследуют режим', () => {
      assert.strictEqual(service.getSupportMode(lockedXml), SupportMode.Locked);
      assert.strictEqual(service.isLocked(lockedXml), true);
      const objectModule = path.join(cf, 'Documents', 'СписаниеДепонированнойЗарплаты', 'Ext', 'ObjectModule.bsl');
      const formModule = path.join(cf, 'Documents', 'СписаниеДепонированнойЗарплаты', 'Forms', 'ФормаДокумента', 'Ext', 'Form', 'Module.bsl');
      assert.strictEqual(service.getSupportMode(objectModule), SupportMode.Locked);
      assert.strictEqual(service.getSupportMode(formModule), SupportMode.Locked);
    });
  });

  test('код 2 — Removed: не блокирует', () => {
    const xml = writeFileIn(cf, 'Catalogs/Справочник.xml', objectXml('Catalog', OWNER_UUID, 'Справочник'));
    writeBinFor(cf, [{ code: 2, uuid: OWNER_UUID }]);
    service.loadConfig(cf);
    assert.strictEqual(service.getSupportMode(xml), SupportMode.Removed);
    assert.strictEqual(service.isLocked(xml), false);
  });

  const LAYOUTS: readonly Layout[] = ['deep', 'flat'];
  for (const layout of LAYOUTS) {
    suite(`содержимое Ext, раскладка ${layout}`, () => {
      let ownerXml: string;

      setup(() => {
        ownerXml = writeFileIn(cf, layout === 'deep' ? 'Documents/Док/Док.xml' : 'Documents/Док.xml',
          objectXml('Document', OWNER_UUID, 'Док'));
        writeFileIn(cf, 'Documents/Док/Forms/Ф.xml', objectXml('Form', CHILD_UUID, 'Ф'));
        writeFileIn(cf, 'Documents/Док/Commands/К.xml', objectXml('Command', CHILD_UUID, 'К'));
        writeFileIn(cf, 'Documents/Док/Templates/М.xml', objectXml('Template', CHILD_UUID, 'М'));
        // Владелец разрешён к редактированию, дочерние дескрипторы — запрещены:
        // режим дочернего ≠ режиму владельца, поэтому ошибка резолва видна.
        writeBinFor(cf, [{ code: 1, uuid: OWNER_UUID }, { code: 0, uuid: CHILD_UUID }]);
        service.loadConfig(cf);
      });

      const ownerCases: readonly string[] = ['Ext/ObjectModule.bsl', 'Ext/ManagerModule.bsl'];
      for (const rel of ownerCases) {
        test(`${rel} → режим объекта`, () => {
          assert.strictEqual(service.getSupportMode(path.join(cf, 'Documents', 'Док', ...rel.split('/'))), SupportMode.Editable);
          assert.strictEqual(service.getSupportMode(ownerXml), SupportMode.Editable);
        });
      }

      const childCases: readonly string[] = [
        'Forms/Ф/Ext/Form/Module.bsl',
        'Commands/К/Ext/CommandModule.bsl',
        'Templates/М/Ext/Template.xml',
        'Forms/Ф/Ext/Form.xml',
      ];
      for (const rel of childCases) {
        test(`${rel} → режим дочернего объекта`, () => {
          assert.strictEqual(service.getSupportMode(path.join(cf, 'Documents', 'Док', ...rel.split('/'))), SupportMode.Locked);
        });
      }

      test('нет дескриптора формы → режим объекта-владельца', () => {
        const file = path.join(cf, 'Documents', 'Док', 'Forms', 'БезДескриптора', 'Ext', 'Form', 'Module.bsl');
        assert.strictEqual(service.getSupportMode(file), SupportMode.Editable);
      });
    });
  }

  suite('модули конфигурации и граничные случаи', () => {
    test('Ext/SessionModule.bsl → режим Configuration.xml', () => {
      writeFileIn(cf, 'Configuration.xml', objectXml('Configuration', CFG_UUID, 'Конф'));
      writeBinFor(cf, [{ code: 0, uuid: CFG_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(path.join(cf, 'Ext', 'SessionModule.bsl')), SupportMode.Locked);
    });

    test('Ext/SessionModule.bsl без Configuration.xml → None', () => {
      writeBinFor(cf, [{ code: 0, uuid: CFG_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(path.join(cf, 'Ext', 'SessionModule.bsl')), SupportMode.None);
    });

    test('<Folder>/Ext/x.bsl → None', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(path.join(cf, 'Documents', 'Ext', 'x.bsl')), SupportMode.None);
    });

    test('BSL без XML объекта → None', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(path.join(cf, 'Documents', 'Нет', 'Ext', 'ObjectModule.bsl')), SupportMode.None);
    });

    test('XML без uuid → None, повторный вызов (кэш пустого значения) тоже None', () => {
      const xml = writeFileIn(cf, 'Documents/БезУуид.xml', '<?xml version="1.0"?><MetaDataObject><Document><Properties/></Document></MetaDataObject>');
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(xml), SupportMode.None);
      assert.strictEqual(service.getSupportMode(xml), SupportMode.None);
    });

    test('несуществующий XML → None без исключения', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(path.join(cf, 'Documents', 'Призрак.xml')), SupportMode.None);
    });

    test('путь вне загруженных корней → None, данных нет', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      const outside = path.join(tmp, 'other', 'Documents', 'Д.xml');
      assert.strictEqual(service.getSupportMode(outside), SupportMode.None);
      assert.strictEqual(service.hasConfigData(outside), false);
    });
  });

  suite('жизненный цикл кэша', () => {
    let docXml: string;
    let binPath: string;

    setup(() => {
      docXml = writeFileIn(cf, 'Documents/Док.xml', objectXml('Document', OWNER_UUID, 'Док'));
    });

    test('без bin — данных нет; появился bin → loadConfig → режимы', () => {
      service.loadConfig(cf);
      assert.strictEqual(service.hasConfigData(docXml), false);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.None);

      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.hasConfigData(docXml), true);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Locked);
    });

    test('повторный loadConfig без изменений — «кэш актуален», повторного разбора нет', () => {
      binPath = writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(log.includes('кэш актуален'), false);
      const linesAfterFirst = log.lines.length;
      service.loadConfig(cf);
      assert.strictEqual(log.includes('кэш актуален'), true);
      assert.strictEqual(log.lines.length, linesAfterFirst + 1, 'второй вызов пишет только строку про актуальный кэш');
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Locked);
      assert.ok(fs.existsSync(binPath));
    });

    test('новое содержимое bin → новый режим', () => {
      binPath = writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Locked);

      writeBinFor(cf, [{ code: 1, uuid: OWNER_UUID }]);
      bump(binPath, 60_000);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Editable);
    });

    test('mtime изменился при том же содержимом — кэш сохраняется (совпал хеш)', () => {
      binPath = writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      const linesAfterFirst = log.lines.length;
      bump(binPath, 60_000);
      service.loadConfig(cf);
      assert.strictEqual(log.includes('кэш актуален'), true);
      assert.strictEqual(log.lines.length, linesAfterFirst + 1);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Locked);
    });

    test('invalidate: None и hasConfigData=false; неизвестный корень не бросает', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      service.invalidate(cf);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.None);
      assert.strictEqual(service.hasConfigData(docXml), false);
      assert.doesNotThrow(() => service.invalidate(path.join(tmp, 'неизвестный')));
    });

    test('invalidate сбрасывает кэш uuid путей: после перезагрузки с другим uuid режим новый', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Locked);
      service.invalidate(cf);
      fs.writeFileSync(docXml, objectXml('Document', CHILD_UUID, 'Док'), 'utf8');
      writeBinFor(cf, [{ code: 1, uuid: CHILD_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(docXml), SupportMode.Editable);
    });
  });

  suite('getSupportModeByUuid', () => {
    setup(() => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
    });

    test('код 0 → Locked, uuid в верхнем регистре тоже', () => {
      const file = path.join(cf, 'Documents', 'Док.xml');
      assert.strictEqual(service.getSupportModeByUuid(file, OWNER_UUID), SupportMode.Locked);
      assert.strictEqual(service.getSupportModeByUuid(file, OWNER_UUID.toUpperCase()), SupportMode.Locked);
    });

    test('неизвестный uuid → None', () => {
      assert.strictEqual(service.getSupportModeByUuid(path.join(cf, 'Documents', 'Док.xml'), CHILD_UUID), SupportMode.None);
    });

    test('файл вне корней → None', () => {
      assert.strictEqual(service.getSupportModeByUuid(path.join(tmp, 'x', 'Д.xml'), OWNER_UUID), SupportMode.None);
    });
  });

  suite('несколько корней и поставщиков', () => {
    test('вложенный CFE без bin внутри CF: его файлы — None и без данных, файлы CF — по bin', () => {
      const cfeRoot = path.join(cf, 'cfe1');
      const inCf = writeFileIn(cf, 'Documents/Док.xml', objectXml('Document', OWNER_UUID, 'Док'));
      const inCfe = writeFileIn(cfeRoot, 'Documents/Док.xml', objectXml('Document', OWNER_UUID, 'Док'));
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      service.loadConfig(cfeRoot);
      assert.strictEqual(service.getSupportMode(inCf), SupportMode.Locked);
      assert.strictEqual(service.getSupportMode(inCfe), SupportMode.None);
      assert.strictEqual(service.hasConfigData(inCfe), false);
      assert.strictEqual(service.hasConfigData(inCf), true);
      assert.strictEqual(service.getSupportModeByUuid(inCfe, OWNER_UUID), SupportMode.None);
    });

    test('самый длинный префикс: /x/cf и /x/cf2 не путаются', () => {
      const cf2 = path.join(tmp, 'cf2');
      const inCf2 = writeFileIn(cf2, 'Documents/Док.xml', objectXml('Document', OWNER_UUID, 'Док'));
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(inCf2), SupportMode.None);
      assert.strictEqual(service.hasConfigData(inCf2), false);

      writeBinFor(cf2, [{ code: 1, uuid: OWNER_UUID }]);
      service.loadConfig(cf2);
      assert.strictEqual(service.getSupportMode(inCf2), SupportMode.Editable);
    });

    test('объект только во втором блоке поставщика', () => {
      const xml = writeFileIn(cf, 'Documents/Док.xml', objectXml('Document', OWNER_UUID, 'Док'));
      writeBin(cf, [
        { name: 'П1', records: [{ code: 1, uuid: CHILD_UUID }] },
        { name: 'П2', records: [{ code: 0, uuid: OWNER_UUID }] },
      ]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(xml), SupportMode.Locked);
    });

    test('корень конфигурации в двух блоках — строгий побеждает', () => {
      const cfg = writeFileIn(cf, 'Configuration.xml', objectXml('Configuration', CFG_UUID, 'Конф'));
      writeBin(cf, [
        { name: 'П1', records: [{ code: 1, uuid: CFG_UUID }] },
        { name: 'П2', records: [{ code: 0, uuid: CFG_UUID }] },
      ]);
      service.loadConfig(cf);
      assert.strictEqual(service.getSupportMode(cfg), SupportMode.Locked);
    });
  });

  suite('лог', () => {
    test('сводка по режимам и поставщикам', () => {
      writeBin(cf, [
        { name: 'Бухгалтерия', version: '3.0.1', records: [{ code: 0, uuid: OWNER_UUID }, { code: 1, uuid: CHILD_UUID }] },
        { name: 'Диадок', version: '2.23', records: [{ code: 2, uuid: testUuid(103) }] },
      ]);
      service.loadConfig(cf);
      assert.ok(log.lines.some((l) => /запрещено:?\s*1/.test(l)), `нет «запрещено 1»: ${log.lines.join(' | ')}`);
      assert.ok(log.lines.some((l) => /разрешено:?\s*1/.test(l)));
      assert.ok(log.lines.some((l) => /снято:?\s*1/.test(l)));
      assert.ok(log.includes('Бухгалтерия'));
      assert.ok(log.includes('3.0.1'));
      assert.ok(log.includes('Диадок'));
      assert.ok(log.includes('2.23'));
    });

    test('расхождение числа записей с объявленным — предупреждение', () => {
      writeBin(cf, [{ name: 'П', declaredCount: 7, records: [{ code: 0, uuid: OWNER_UUID }] }]);
      service.loadConfig(cf);
      assert.ok(log.lines.some((l) => /расхожд/i.test(l) && l.includes('7') && l.includes('1')),
        `нет предупреждения о расхождении: ${log.lines.join(' | ')}`);
    });

    test('без расхождения предупреждения нет', () => {
      writeBinFor(cf, [{ code: 0, uuid: OWNER_UUID }]);
      service.loadConfig(cf);
      assert.strictEqual(log.lines.some((l) => /расхожд/i.test(l)), false);
    });
  });
});
