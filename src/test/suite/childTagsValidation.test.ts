import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CHILD_TAG_CONFIG, type ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import { MetadataValidationService, type MetadataValidationIssue } from '../../infra/xml/MetadataValidationService';
import { getGeneratedPropertyKeys, getMemberPropertyKeys, listRuleOwnerKinds } from '../../infra/xml/typedField/TypedFieldOwnerRules';
import {
  EXAMPLE_GENERATIONS,
  hasExampleCorpus,
  ORDERED_OWNER_KINDS,
  scanOwnerFiles,
} from './support/childObjectsCorpus';
import { fieldOwnerKinds, OWNER_MIRROR_KEYS } from './support/typedFieldCorpus';

/**
 * Две РАЗНЫЕ оси, которые раньше были смешаны в одном `META_TYPES.childTags`:
 *  - `childTags` — «что расширение ПОКАЗЫВАЕТ в дереве и УМЕЕТ СОЗДАВАТЬ»;
 *  - `CHILD_OBJECTS_ORDER` (`SerializedChildTag`) — «что платформа РЕАЛЬНО
 *    СЕРИАЛИЗУЕТ в `<ChildObjects>`».
 * `validateChildTags` использует `childTags` как белый список с severity error
 * (`disallowed-child`), поэтому `validate_metadata` объявляла невалидной
 * эталонную выгрузку 1С: ошибка на каждом реквизите регистра и на каждом
 * макете журнала/плана. Допустимость при валидации — всегда вторая ось.
 *
 * Здесь: (1) характеризация дефекта корпусным сканом (обязана быть красной до
 * правки), (2) валидация на реальных файлах example/, (3) негативы: белый
 * список не снят, (4) регресс typed-field для расширенной выборки владельцев.
 */

/** Десять видов, у которых `childTags` неполон (см. KNOWN_CHILD_TAGS_GAP в childObjectsOrder.registry.test.ts). */
const A2_KINDS: readonly MetaKind[] = [
  'InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister',
  'DocumentJournal', 'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes',
  'BusinessProcess', 'Task',
];
const A2_TAGS: readonly ChildTag[] = ['Attribute', 'Template'];
const REGISTERS: readonly MetaKind[] = ['InformationRegister', 'AccumulationRegister', 'AccountingRegister', 'CalculationRegister'];

/**
 * Пары «вид × тег», которые в корпусе `example/` НЕ наблюдаются (эталонной
 * выгрузки с таким ребёнком нет). Для них корпусный скан ничего не доказывает,
 * поэтому они перечислены явно; допустимость этих пар опирается на канон
 * `CHILD_OBJECTS_ORDER` (платформа сериализует макет у любого из этих видов) и
 * на то, что расширение умеет их создавать. Тест ниже гарантирует, что список
 * не устарел: пара, ставшая наблюдаемой, обязана быть из него убрана.
 */
const UNOBSERVED_PAIRS: readonly (readonly [MetaKind, ChildTag])[] = [
  ['AccumulationRegister', 'Template'],
  ['CalculationRegister', 'Template'],
  ['AccountingRegister', 'Template'],
  ['ChartOfCalculationTypes', 'Template'],
  ['BusinessProcess', 'Template'],
  ['ChartOfAccounts', 'Template'],
  ['Task', 'Template'],
];

const ALL_CHILD_TAGS = Object.keys(CHILD_TAG_CONFIG) as ChildTag[];

function observedTags(kind: string): Set<string> {
  const seen = new Set<string>();
  for (const file of scanOwnerFiles(kind)) {
    for (const tag of file.tags ?? []) {
      seen.add(tag);
    }
  }
  return seen;
}

suite('childTags ⊇ эталон example/ (T-A2.0: характеризация дефекта, красная до правки)', function () {
  this.timeout(60000);

  suiteSetup(function () {
    if (!hasExampleCorpus()) {
      this.skip();
    }
  });

  for (const kind of ORDERED_OWNER_KINDS) {
    test(`${kind}: каждый ChildTag, реально встречающийся среди прямых детей <ChildObjects> эталона, входит в META_TYPES.childTags`, () => {
      const files = scanOwnerFiles(kind);
      assert.ok(files.length > 0, `${kind}: в корпусе нет ни одного файла — проверка была бы зелёной на пустом корпусе`);
      const seen = observedTags(kind);
      const childTags: readonly string[] = META_TYPES[kind as MetaKind].childTags ?? [];
      const missing = ALL_CHILD_TAGS.filter((tag) => seen.has(tag) && !childTags.includes(tag));
      assert.deepStrictEqual(
        missing,
        [],
        `${kind}: платформа выгружает ${missing.join(', ')}, а реестр их не знает — дерево их не покажет, validate_metadata назовёт ошибкой`
      );
    });
  }

  test('выборка достаточна: по каждому из A2_KINDS просканирован хотя бы один файл, а число наблюдаемых пар считает сам тест', () => {
    let observedPairs = 0;
    for (const kind of A2_KINDS) {
      assert.ok(scanOwnerFiles(kind).length > 0, `${kind}: пустая выборка`);
      const seen = observedTags(kind);
      observedPairs += A2_TAGS.filter((tag) => seen.has(tag)).length;
    }
    assert.ok(observedPairs > 0, 'ни одна пара «вид × Attribute/Template» не наблюдается — нечего проверять');
  });

  test('UNOBSERVED_PAIRS не устарел: перечисленные пары действительно отсутствуют в корпусе', () => {
    const nowObserved = UNOBSERVED_PAIRS.filter(([kind, tag]) => observedTags(kind).has(tag));
    assert.deepStrictEqual(
      nowObserved.map(([k, t]) => `${k}.${t}`),
      [],
      'эти пары стали наблюдаемыми — уберите их из UNOBSERVED_PAIRS, скан выше теперь их проверяет'
    );
  });
});

// ── Валидация на реальных файлах ───────────────────────────────────────────

function validateIssues(xmlPath: string): MetadataValidationIssue[] {
  const result = new MetadataValidationService().validate({ objectPath: xmlPath, maxErrors: 1_000_000 });
  return [...result.objects[0].issues];
}

function errorsOf(issues: readonly MetadataValidationIssue[]): string[] {
  return issues.filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.message}`);
}

/** Первый реальный файл вида `kind`, среди прямых детей `<ChildObjects>` которого встречается `tag`. */
function realFileWith(kind: string, tag: string): string {
  const found = scanOwnerFiles(kind).find((f) => f.tags?.includes(tag));
  assert.ok(found, `в корпусе нет файла ${kind} с ребёнком ${tag}`);
  return found.filePath;
}

/**
 * Копия РЕАЛЬНОГО файла эталона во временный каталог (с тем же именем и папкой
 * вида) с вставленным перед закрывающим тегом владельца фрагментом `insertion`.
 * Так проверяются пары, которых в корпусе нет (например, макет у бизнес-процесса),
 * не выдумывая владельца целиком.
 */
function copyRealWithInsertion(kind: MetaKind, insertion: string): string {
  const source = scanOwnerFiles(kind).find((f) => f.tags && f.tags.length > 0 && f.xml.includes('</ChildObjects>'));
  assert.ok(source, `${kind}: нет реального файла с непустым <ChildObjects>`);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-childtags-')), (META_TYPES[kind].folder ?? ''));
  fs.mkdirSync(dir, { recursive: true });
  // Последнее `</ChildObjects>` в файле закрывает список детей владельца:
  // вложенные (табличные части) закрываются раньше него.
  const at = source.xml.lastIndexOf('</ChildObjects>');
  const lineStart = source.xml.lastIndexOf('\n', at) + 1;
  const xml = `${source.xml.slice(0, lineStart)}\t\t\t${insertion}\n${source.xml.slice(lineStart)}`;
  const target = path.join(dir, path.basename(source.filePath));
  fs.writeFileSync(target, xml, 'utf-8');
  return target;
}

suite('validate_metadata на реальных файлах example/: эталон платформы не объявляется невалидным (T-A2.0.2)', function () {
  this.timeout(60000);

  suiteSetup(function () {
    if (!hasExampleCorpus()) {
      this.skip();
    }
  });

  const realCases: readonly (readonly [string, string, string])[] = [
    ['InformationRegister', 'Attribute', 'регистр сведений с реквизитом'],
    ['AccumulationRegister', 'Attribute', 'регистр накопления с реквизитом'],
    ['AccountingRegister', 'Attribute', 'регистр бухгалтерии с реквизитом'],
    ['CalculationRegister', 'Attribute', 'регистр расчёта с реквизитом'],
    ['InformationRegister', 'Template', 'регистр сведений с макетом'],
    ['DocumentJournal', 'Template', 'журнал документов с макетом'],
    ['ChartOfCharacteristicTypes', 'Template', 'план видов характеристик с макетом'],
    // Column и признаки учёта не входят в ChildTag (расширение их не создаёт),
    // но платформа их сериализует — эталон не должен становиться ошибкой,
    // что бы ни сделала правка с осью допустимости.
    ['DocumentJournal', 'Column', 'журнал документов с колонками'],
    ['ChartOfAccounts', 'AccountingFlag', 'план счетов с признаками учёта'],
    ['ChartOfAccounts', 'ExtDimensionAccountingFlag', 'план счетов с признаками учёта субконто'],
  ];
  for (const [kind, tag, label] of realCases) {
    test(`${label}: ноль issue уровня error`, () => {
      assert.deepStrictEqual(errorsOf(validateIssues(realFileWith(kind, tag))), []);
    });
  }

  // Пары, которых нет в корпусе: реальный файл вида + вставленный элемент.
  const syntheticTemplateKinds = UNOBSERVED_PAIRS.filter(([, tag]) => tag === 'Template').map(([kind]) => kind);
  for (const kind of syntheticTemplateKinds) {
    test(`${kind}: реальный файл + <Template> — ни одного disallowed-child (ось допустимости — канон сериализации)`, () => {
      const copy = copyRealWithInsertion(kind, '<Template>Макет1</Template>');
      const codes = validateIssues(copy).filter((i) => i.severity === 'error').map((i) => i.code);
      assert.ok(!codes.includes('disallowed-child'), `${kind}: макет объявлен недопустимым`);
    });
  }

  // Белый список НЕ снят: допустимость определяется каноном сериализации вида,
  // а не «разрешено всё». Иначе правка превратилась бы в отключение проверки.
  const negatives: readonly (readonly [MetaKind, string, string])[] = [
    ['Catalog', '<Dimension uuid="00000000-0000-4000-8000-000000000001"><Properties><Name>Изм1</Name></Properties></Dimension>', 'измерение у справочника'],
    ['Enum', '<Attribute uuid="00000000-0000-4000-8000-000000000002"><Properties><Name>Рек1</Name></Properties></Attribute>', 'реквизит у перечисления'],
    ['DocumentJournal', '<Attribute uuid="00000000-0000-4000-8000-000000000003"><Properties><Name>Рек1</Name></Properties></Attribute>', 'реквизит у журнала документов (платформа выгружает колонки, а не реквизиты)'],
  ];
  for (const [kind, fragment, label] of negatives) {
    test(`белый список действует: ${label} — disallowed-child уровня error`, () => {
      const copy = copyRealWithInsertion(kind, fragment);
      const disallowed = validateIssues(copy).filter((i) => i.code === 'disallowed-child' && i.severity === 'error');
      assert.strictEqual(disallowed.length, 1, `ожидалась ровно одна ошибка disallowed-child, есть: ${String(disallowed.length)}`);
    });
  }
});

suite('validate_metadata по всему корпусу example/ (T-A2.0.3, T-A2.16)', function () {
  this.timeout(300000);

  suiteSetup(function () {
    if (!hasExampleCorpus()) {
      this.skip();
    }
  });

  /**
   * Потолок прочих error-issue ДО правки, снятый на корпусе на момент
   * написания (5 × `property-not-allowed`). Правка допустимости child-тегов не
   * вправе порождать новые ошибки: число не растёт, новых кодов нет.
   */
  const PROPERTY_NOT_ALLOWED_BASELINE = 5;

  test('ноль disallowed-child уровня error; прочих error не больше, чем до правки; новых кодов нет', () => {
    const service = new MetadataValidationService();
    const folders = [...new Set(Object.values(META_TYPES).map((d) => d.folder).filter((f): f is string => Boolean(f)))];
    const errorsByCode = new Map<string, number>();
    const disallowedByKind = new Map<string, number>();
    let files = 0;
    for (const root of [EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21, EXAMPLE_GENERATIONS.cfe21]) {
      for (const folder of folders) {
        const dir = path.join(root, folder);
        if (!fs.existsSync(dir)) {
          continue;
        }
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.xml')) {
            continue;
          }
          files += 1;
          const result = service.validate({ objectPath: path.join(dir, entry.name), maxErrors: 1_000_000 });
          const object = result.objects[0];
          for (const issue of object.issues) {
            // `disallowed-child` считаем ЛЮБОЙ severity, а не только error.
            // Попытка перевести допустимость на ось сериализации давала 16 945
            // ПРЕДУПРЕЖДЕНИЙ на 3 660 эталонных файлах (StandardAttribute,
            // которого нет в каноне порядка) — и этот тест её не заметил,
            // потому что отбрасывал всё, что не error. Слепота гейта к классу
            // дефекта, который он призван ловить, дороже самого дефекта.
            if (issue.code === 'disallowed-child') {
              disallowedByKind.set(object.kind ?? '?', (disallowedByKind.get(object.kind ?? '?') ?? 0) + 1);
            }
            if (issue.severity !== 'error') {
              continue;
            }
            errorsByCode.set(issue.code, (errorsByCode.get(issue.code) ?? 0) + 1);
          }
        }
      }
    }
    assert.ok(files > 1000, `просканировано только ${String(files)} файлов — корпус неполон`);
    assert.deepStrictEqual([...disallowedByKind.entries()], [], 'disallowed-child по видам: эталон платформы не должен быть ошибкой');
    const otherCodes = [...errorsByCode.keys()].filter((code) => code !== 'property-not-allowed');
    assert.deepStrictEqual(otherCodes, [], 'появились новые коды ошибок');
    assert.ok(
      (errorsByCode.get('property-not-allowed') ?? 0) <= PROPERTY_NOT_ALLOWED_BASELINE,
      `property-not-allowed вырос: ${String(errorsByCode.get('property-not-allowed'))} > ${String(PROPERTY_NOT_ALLOWED_BASELINE)}`
    );
  });
});

suite('Регресс typed-field при расширении childTags (T-A2.17)', () => {
  test('владельцы типизированных полей по-прежнему включают все четыре регистра (набор выводится из childTags)', () => {
    const owners = fieldOwnerKinds();
    for (const register of REGISTERS) {
      assert.ok(owners.includes(register), `${register} выпал из владельцев типизированных полей`);
    }
  });

  test('CalculationRegister × Attribute идёт консервативным путём: нет снятого правила, допустимо всё owner-зависимое, ничего не дописывается', () => {
    // Регистр расчёта не снят с эталона (нет записи в OWNER_ROLE_RULES), поэтому
    // добавление `Attribute` в его childTags не должно менять состав свойств:
    // owner-зависимое только сохраняется, но не дописывается.
    assert.ok(!listRuleOwnerKinds().includes('CalculationRegister'), 'у CalculationRegister не должно быть снятого правила');
    const member = getMemberPropertyKeys('Attribute', 'CalculationRegister');
    const generated = getGeneratedPropertyKeys('Attribute', 'CalculationRegister', '<v8:Type>xs:decimal</v8:Type>');
    for (const key of OWNER_MIRROR_KEYS) {
      assert.ok(member.includes(key), `консервативный режим: ${key} допустим`);
      assert.ok(!generated.includes(key), `консервативный режим: ${key} не дописывается`);
    }
  });
});
