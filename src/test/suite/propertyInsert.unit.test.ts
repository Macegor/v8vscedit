import * as assert from 'assert';
import { requirePropertyInsert } from './support/propertyOrderCorpus';

/**
 * Механика вставки свойства в `<Properties>` корня по канону
 * (`insertPropertyBlockInOrder`) — чистые строки, без ФС и без корпуса.
 *
 * Функция не знает видов метаданных: место вставки берётся из таблицы порядка
 * по паре «вид владельца + ключ». Здесь таблица используется как данность на
 * ДВУХ видах с однозначным порядком (подтверждён эталоном):
 *  - `Report`: Name, Synonym, Comment, UseStandardCommands, DefaultForm,
 *    AuxiliaryForm, MainDataCompositionSchema, DefaultSettingsForm,
 *    AuxiliarySettingsForm, DefaultVariantForm, AuxiliaryVariantForm,
 *    VariantsStorage, SettingsStorage, IncludeHelpInContents,
 *    ExtendedPresentation, Explanation;
 *  - `Catalog`: ObjectBelonging (ранг 0), Name, Synonym, Comment, …,
 *    DefaultObjectForm, …, IncludeHelpInContents, BasedOn, DataLockFields, …,
 *    ObjectPresentation, …, Explanation.
 *
 * Модуль `infra/xml/properties/PropertyInsert.ts` на фазе «красный» ещё не
 * существует — загрузка ленивая (см. `support/propertyOrderCorpus.ts`).
 */

type Eol = '\n' | '\r\n';

/** Содержимое `<Properties>`: строки тегов на заданной глубине, закрывающий отступ — на уровень выше. */
function propsInner(indent: string, tags: readonly string[], eol: Eol = '\n'): string {
  return `${eol}${tags.map((tag) => `${indent}${tag}`).join(eol)}${eol}${indent.slice(0, -1)}`;
}

function insert(props: string, ownerKind: string | undefined, key: string, block: string): string {
  return requirePropertyInsert().insertPropertyBlockInOrder(props, ownerKind, key, block);
}

/** Глубина 3 — свойства корня в выгрузке; глубина 4 — отступ глубже (вставка отступа берётся у якоря, а не константа). */
const INDENTS: readonly string[] = ['\t\t\t', '\t\t\t\t'];

const MULTILINE_SYNONYM = (indent: string, eol: Eol = '\n'): string =>
  [
    '<Synonym>',
    `${indent}\t<v8:item>`,
    `${indent}\t\t<v8:lang>ru</v8:lang>`,
    `${indent}\t\t<v8:content>Отчёт</v8:content>`,
    `${indent}\t</v8:item>`,
    `${indent}</Synonym>`,
  ].join(eol);

suite('insertPropertyBlockInOrder — механика вставки по канону (чистые строки)', () => {
  test('модуль PropertyInsert.ts существует и экспортирует insertPropertyBlockInOrder', () => {
    assert.strictEqual(typeof requirePropertyInsert().insertPropertyBlockInOrder, 'function');
  });

  for (const indent of INDENTS) {
    const depth = String(indent.length);

    test(`перед первым старшим якорем (глубина ${depth})`, () => {
      const before = propsInner(indent, ['<Name>О</Name>', '<Comment/>', '<Explanation/>']);
      const after = insert(before, 'Report', 'DefaultForm', '<DefaultForm/>');
      assert.strictEqual(after, propsInner(indent, ['<Name>О</Name>', '<Comment/>', '<DefaultForm/>', '<Explanation/>']));
    });

    test(`после последнего младшего, когда старших нет — закрывающий отступ сохранён (глубина ${depth})`, () => {
      const before = propsInner(indent, ['<Name>О</Name>', '<Comment/>']);
      const after = insert(before, 'Report', 'UseStandardCommands', '<UseStandardCommands>true</UseStandardCommands>');
      assert.strictEqual(
        after,
        propsInner(indent, ['<Name>О</Name>', '<Comment/>', '<UseStandardCommands>true</UseStandardCommands>'])
      );
    });

    test(`между двумя якорями: AuxiliaryVariantForm встаёт между DefaultVariantForm и VariantsStorage (глубина ${depth})`, () => {
      const before = propsInner(indent, ['<Name>О</Name>', '<DefaultVariantForm/>', '<VariantsStorage/>', '<Explanation/>']);
      const after = insert(before, 'Report', 'AuxiliaryVariantForm', '<AuxiliaryVariantForm>Report.О.Form.Ф</AuxiliaryVariantForm>');
      assert.strictEqual(
        after,
        propsInner(indent, [
          '<Name>О</Name>',
          '<DefaultVariantForm/>',
          '<AuxiliaryVariantForm>Report.О.Form.Ф</AuxiliaryVariantForm>',
          '<VariantsStorage/>',
          '<Explanation/>',
        ])
      );
    });

    test(`многострочный якорь не разрывается: вставка после закрывающего тега Synonym (глубина ${depth})`, () => {
      const before = propsInner(indent, ['<Name>О</Name>', MULTILINE_SYNONYM(indent), '<Explanation/>']);
      const after = insert(before, 'Report', 'Comment', '<Comment/>');
      assert.strictEqual(after, propsInner(indent, ['<Name>О</Name>', MULTILINE_SYNONYM(indent), '<Comment/>', '<Explanation/>']));
    });

    test(`многострочный вставляемый блок кладётся дословно (глубина ${depth})`, () => {
      const block = [
        '<BasedOn>',
        `${indent}\t<xr:Item xsi:type="xr:MDObjectRef">Document.Заказ</xr:Item>`,
        `${indent}</BasedOn>`,
      ].join('\n');
      const before = propsInner(indent, ['<Name>С</Name>', '<DefaultObjectForm/>', '<Explanation/>']);
      const after = insert(before, 'Catalog', 'BasedOn', block);
      assert.strictEqual(after, propsInner(indent, ['<Name>С</Name>', '<DefaultObjectForm/>', block, '<Explanation/>']));
    });
  }

  test('ранг 0 (ObjectBelonging у Catalog) — вставка в начало, а не «нет ранга → в конец»', () => {
    const before = propsInner('\t\t\t', ['<Name>С</Name>', '<Comment/>']);
    const after = insert(before, 'Catalog', 'ObjectBelonging', '<ObjectBelonging>Adopted</ObjectBelonging>');
    assert.strictEqual(after, propsInner('\t\t\t', ['<ObjectBelonging>Adopted</ObjectBelonging>', '<Name>С</Name>', '<Comment/>']));
  });

  test('ExtendedConfigurationObject встаёт сразу за Comment (место, снятое с 23 носителей корпуса)', () => {
    const before = propsInner('\t\t\t', ['<ObjectBelonging>Adopted</ObjectBelonging>', '<Name>С</Name>', '<Comment/>']);
    const after = insert(before, 'Catalog', 'ExtendedConfigurationObject', '<ExtendedConfigurationObject>0b4a2a1e-0000-0000-0000-000000000001</ExtendedConfigurationObject>');
    assert.strictEqual(
      after,
      propsInner('\t\t\t', [
        '<ObjectBelonging>Adopted</ObjectBelonging>',
        '<Name>С</Name>',
        '<Comment/>',
        '<ExtendedConfigurationObject>0b4a2a1e-0000-0000-0000-000000000001</ExtendedConfigurationObject>',
      ])
    );
  });

  test('нет ни одного ранжированного якоря — вставка в конец', () => {
    const before = propsInner('\t\t\t', ['<UnknownTagOne/>', '<UnknownTagTwo>x</UnknownTagTwo>']);
    const after = insert(before, 'Report', 'Name', '<Name>О</Name>');
    assert.strictEqual(after, propsInner('\t\t\t', ['<UnknownTagOne/>', '<UnknownTagTwo>x</UnknownTagTwo>', '<Name>О</Name>']));
  });

  test('ключ без ранга у известного вида — в конец, а не «угадывание» позиции', () => {
    const before = propsInner('\t\t\t', ['<Name>О</Name>', '<Comment/>', '<Explanation/>']);
    const after = insert(before, 'Report', 'FutureProperty', '<FutureProperty/>');
    assert.strictEqual(after, propsInner('\t\t\t', ['<Name>О</Name>', '<Comment/>', '<Explanation/>', '<FutureProperty/>']));
  });

  // Все три способа «правило для вида не снято»: владелец неизвестен, вид вне
  // таблицы, вид из META_TYPES без строки. Во всех — консервативный фолбэк.
  for (const ownerKind of [undefined, 'НетТакогоВида', 'Sequence'] as const) {
    test(`вид без строки (ownerKind = ${String(ownerKind)}) — ключ дописывается в конец даже при известных тегах`, () => {
      const before = propsInner('\t\t\t', ['<Name>О</Name>', '<Explanation/>']);
      const after = insert(before, ownerKind, 'Comment', '<Comment/>');
      assert.strictEqual(after, propsInner('\t\t\t', ['<Name>О</Name>', '<Explanation/>', '<Comment/>']));
    });
  }

  test('неранжированный чужой тег остаётся на месте и якорем не становится', () => {
    // Foreign тег между Name и Explanation: новый блок обязан лечь по нужную сторону от
    // него (перед Explanation), а сам тег — остаться где был.
    const between = insert(
      propsInner('\t\t\t', ['<Name>О</Name>', '<Foreign/>', '<Explanation/>']),
      'Report',
      'DefaultForm',
      '<DefaultForm/>'
    );
    assert.strictEqual(between, propsInner('\t\t\t', ['<Name>О</Name>', '<Foreign/>', '<DefaultForm/>', '<Explanation/>']));

    // Старших якорей нет: вставка сразу после последнего МЛАДШЕГО (Name), то есть
    // до чужого тега — он не «конец блока» и не якорь.
    const afterJunior = insert(propsInner('\t\t\t', ['<Name>О</Name>', '<Foreign/>']), 'Report', 'Comment', '<Comment/>');
    assert.strictEqual(afterJunior, propsInner('\t\t\t', ['<Name>О</Name>', '<Comment/>', '<Foreign/>']));
  });

  test('якорь ищется по документу, а не по каноническому порядку: первый старший в документе побеждает', () => {
    // Файл с уже нарушенным порядком (переупорядочивать существующее мы не берёмся):
    // Explanation стоит раньше Name. Вставка идёт перед ПЕРВЫМ старшим по документу.
    const before = propsInner('\t\t\t', ['<Explanation/>', '<Name>О</Name>']);
    const after = insert(before, 'Report', 'Comment', '<Comment/>');
    assert.strictEqual(after, propsInner('\t\t\t', ['<Comment/>', '<Explanation/>', '<Name>О</Name>']));
  });

  test('существующие блоки не меняются ни на байт: результат без вставленной строки равен исходнику', () => {
    const before = propsInner('\t\t\t', ['<Name>О</Name>', MULTILINE_SYNONYM('\t\t\t'), '<Comment/>', '<VariantsStorage/>', '<Explanation/>']);
    const after = insert(before, 'Report', 'DefaultVariantForm', '<DefaultVariantForm/>');
    assert.strictEqual(after.replace('\t\t\t<DefaultVariantForm/>\n', ''), before);
  });

  // CRLF: вставка обязана нести перевод строки ФАЙЛА, а не «голый» LF — иначе в
  // CRLF-выгрузке появится смешанная разметка, и весь объект уйдёт в git-дифф.
  const CRLF = '\r\n' as const;
  test('CRLF-вход: вставка перед старшим, после младшего и между якорями несёт CRLF (нет «голых» LF)', () => {
    const cases: { name: string; tags: string[]; key: string; block: string; expected: string[] }[] = [
      {
        name: 'перед старшим',
        tags: ['<Name>О</Name>', '<Explanation/>'],
        key: 'DefaultForm',
        block: '<DefaultForm/>',
        expected: ['<Name>О</Name>', '<DefaultForm/>', '<Explanation/>'],
      },
      {
        name: 'после младшего',
        tags: ['<Name>О</Name>', '<Comment/>'],
        key: 'UseStandardCommands',
        block: '<UseStandardCommands>true</UseStandardCommands>',
        expected: ['<Name>О</Name>', '<Comment/>', '<UseStandardCommands>true</UseStandardCommands>'],
      },
      {
        name: 'между',
        tags: ['<DefaultVariantForm/>', '<VariantsStorage/>'],
        key: 'AuxiliaryVariantForm',
        block: '<AuxiliaryVariantForm/>',
        expected: ['<DefaultVariantForm/>', '<AuxiliaryVariantForm/>', '<VariantsStorage/>'],
      },
    ];
    for (const item of cases) {
      const after = insert(propsInner('\t\t\t', item.tags, CRLF), 'Report', item.key, item.block);
      assert.strictEqual(after, propsInner('\t\t\t', item.expected, CRLF), item.name);
      assert.ok(!/(?<!\r)\n/.test(after), `${item.name}: в CRLF-результате остался «голый» LF`);
    }
  });

  test('CRLF-вход, фолбэк «в конец»: содержимое совпадает с LF-вариантом с точностью до перевода строки', () => {
    // Фолбэк — прежний appendPropertyAtEnd (переехал без изменений); чистоту EOL на этой
    // ветке не требуем, файл в любом случае нормализуется при записи. Требуем только,
    // чтобы порядок и текст были теми же, что и на LF.
    const tags = ['<Name>О</Name>', '<Explanation/>'];
    const crlf = insert(propsInner('\t\t\t', tags, CRLF), undefined, 'Comment', '<Comment/>');
    const lf = insert(propsInner('\t\t\t', tags), undefined, 'Comment', '<Comment/>');
    assert.strictEqual(crlf.replace(/\r\n/g, '\n'), lf);
  });

  test('пустое или пробельное содержимое <Properties>: не бросает, не теряет и не дублирует блок', () => {
    // На платформенной выгрузке недостижимо (`<Properties/>`), но код не должен падать на
    // рукописном файле. Допустимы два исхода: содержимое не тронуто либо блок вставлен ровно раз.
    for (const empty of ['', '\n\t\t', '   ']) {
      const after = insert(empty, 'Report', 'Comment', '<Comment/>');
      assert.ok(after === empty || after.split('<Comment/>').length === 2, `содержимое ${JSON.stringify(empty)} → ${JSON.stringify(after)}`);
    }
  });
});
