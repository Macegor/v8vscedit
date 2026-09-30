import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createIdAllocator } from '../../infra/xml/form/FormShared';
import { FormToolsService } from '../../infra/xml';
import { EXAMPLE_ROOT, writeFormCopy } from './support/formFixtures';
import { skipWithoutCorpus } from './support/corpus';

/**
 * Тесты `createIdAllocator` после переноса на `maxIdByKind` (см. бриф задачи —
 * секция "Целевое API реализации"). Проверяет: (1) инвариант, от которого
 * зависят байт-goldens `formBuildersGolden.test.ts` (не редактируются);
 * (2) что allocator теперь видит id 11 новых тегов и BaseForm-регион;
 * (3) E2E-согласованность генератора и валидатора (defect B на практике).
 */

const OSTATKI_FORM = path.join(EXAMPLE_ROOT, '2.20', 'src', 'cf', 'Reports', 'ОстаткиТоваровНаСкладах', 'Forms', 'ФормаОтчета', 'Ext', 'Form.xml');
const RASHODY_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cf', 'Documents', 'РасходыПриИмпорте', 'Forms', 'ФормаДокумента', 'Ext', 'Form.xml');
const POLZOVATELI_CFE_FORM = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cfe', 'EVOLC', 'Catalogs', 'Пользователи', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml');

function readFixture(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

suite('createIdAllocator — T-18: инвариант байт-goldens (formBuildersGolden.test.ts)', () => {
  test('createIdAllocator(\'\') стартует счётчики с 1/1/1', () => {
    const allocator = createIdAllocator('');
    assert.strictEqual(allocator.nextElement(), 1);
    assert.strictEqual(allocator.nextAttribute(), 1);
    assert.strictEqual(allocator.nextCommand(), 1);
  });
});

suite('createIdAllocator — T-19: учёт 11 новых тегов и независимость пространств', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('nextElement() учитывает id одного из 11 новых тегов (SpreadSheetDocumentField), даже перекрывая floor расширения', () => {
    // Донор без BaseForm: инъекция SpreadSheetDocumentField с id=1000050 — заведомо
    // выше пола расширения (999999) — старый allocator (не знающий об этом теге)
    // такой id вообще не увидит и даст неверный (заниженный) nextElement().
    const donor = readFixture(OSTATKI_FORM);
    const mutated = donor.replace(
      '<SpreadSheetDocumentField name="Результат" id="3">',
      '<SpreadSheetDocumentField name="Результат" id="1000050">'
    );
    assert.notStrictEqual(mutated, donor);
    const allocator = createIdAllocator(mutated);
    const next = allocator.nextElement();
    assert.ok(next > 1000050, `nextElement() должен учитывать SpreadSheetDocumentField id=1000050, получили ${String(next)}`);
  });

  test('nextElement() строго больше 180 на реальной CFE-форме с ColumnGroup id=180', () => {
    const xml = readFixture(POLZOVATELI_CFE_FORM);
    const allocator = createIdAllocator(xml);
    assert.ok(allocator.nextElement() > 180);
  });

  test('nextAttribute() не зависит от Column-id (инъекция большого id колонки в реальный донор)', () => {
    const donor = readFixture(RASHODY_FORM);
    const mutated = donor.replace('<Column name="ИспользоватьХарактеристики" id="1">', '<Column name="ИспользоватьХарактеристики" id="9999999">');
    assert.notStrictEqual(mutated, donor);
    const allocator = createIdAllocator(mutated);
    // Максимум по факту файла (grep <Attribute ... id=) — id="37", т.е. следующий id=38.
    assert.strictEqual(allocator.nextAttribute(), 38);
  });
});

suite('createIdAllocator — T-20: BaseForm-форма', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('все три счётчика >= 1000000 на реальной CFE-форме с BaseForm', () => {
    const xml = readFixture(POLZOVATELI_CFE_FORM);
    const allocator = createIdAllocator(xml);
    assert.ok(allocator.nextElement() >= 1000000);
    assert.ok(allocator.nextAttribute() >= 1000000);
    assert.ok(allocator.nextCommand() >= 1000000);
  });

  test('максимум по документу включает id, существующий ТОЛЬКО внутри BaseForm (выше пола расширения)', () => {
    const donor = readFixture(OSTATKI_FORM);
    const withBase = donor.replace('</Form>', '\t<BaseForm version="2.21">\n\t\t<Button name="ИзБазовой" id="1500000"/>\n\t</BaseForm>\n</Form>');
    assert.notStrictEqual(withBase, donor);
    const allocator = createIdAllocator(withBase);
    const next = allocator.nextElement();
    assert.ok(next > 1500000, `nextElement() должен учитывать id внутри BaseForm (1500000), получили ${String(next)}`);
  });
});

suite('createIdAllocator — T-21: E2E-согласованность генератора и валидатора (defect B на практике)', () => {
  // `example/` не отслеживается git — без корпуса сьют пропускается, а не падает
  // (единый гейт: support/corpus.ts).
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });

  test('FormToolsService.edit на форме, где новый вид поля владеет фактическим максимумом id, не создаёт коллизию', () => {
    // Мутация: SpreadSheetDocumentField получает id=6 — ровно на 1 больше старого
    // (некорректного) максимума 5, вычисляемого без учёта этого тега. Если
    // allocator по-прежнему слеп к SpreadSheetDocumentField, edit() присвоит
    // новому полю id=6 — коллизия с уже существующим SpreadSheetDocumentField.
    const donor = readFixture(OSTATKI_FORM).replace(
      '<SpreadSheetDocumentField name="Результат" id="3">',
      '<SpreadSheetDocumentField name="Результат" id="6">'
    );
    const formPath = writeFormCopy(donor);

    const service = new FormToolsService();
    service.edit({
      formPath,
      definition: {
        attributes: [{ name: 'НовыйРеквизит', type: 'string(50)' }],
        elements: [{ input: 'НовоеПоле', path: 'НовыйРеквизит' }],
      },
    });

    const validation = service.validate({ formPath, detailed: true });
    const dupLines = validation.lines.filter((l) => l.includes('Duplicate'));
    assert.deepStrictEqual(dupLines, [], `edit() не должен создавать коллизию id:\n${validation.lines.join('\n')}`);
  });

  test('FormToolsService.edit на форме с ValueTable-атрибутом (AdditionalColumns) не путает Column-id с element-id', () => {
    // Регресс на defect C/аллокатор: donor уже содержит колонки с id 1..7 в
    // AdditionalColumns — они не должны участвовать в подсчёте element-id.
    const donor = readFixture(RASHODY_FORM);
    const formPath = writeFormCopy(donor);
    const service = new FormToolsService();
    service.edit({
      formPath,
      definition: {
        attributes: [{ name: 'ЕщёОдинРеквизит', type: 'string(50)' }],
        elements: [{ input: 'ЕщёОдноПоле', path: 'ЕщёОдинРеквизит' }],
      },
    });
    const validation = service.validate({ formPath, detailed: true });
    const dupLines = validation.lines.filter((l) => l.includes('Duplicate'));
    assert.deepStrictEqual(dupLines, [], `edit() не должен создавать коллизию id:\n${validation.lines.join('\n')}`);
  });
});
