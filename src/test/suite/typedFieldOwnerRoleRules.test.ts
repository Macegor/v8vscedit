import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MetadataValidationService,
  MetadataXmlCreator,
  ObjectXmlReader,
} from '../../infra/xml';
import {
  isTypedFieldControlledPropertyKey,
  normalizeTypedFieldPropertiesAfterTypeChange,
  type TypeAwarePropertyOwnerKind,
} from '../../infra/xml/TypedFieldPropertyRules';
// Контракт нового модуля явно задан архитектором (раздел «Целевой контракт
// реализации»): getMemberPropertyKeys/getGeneratedPropertyKeys — единственные
// точки чтения состава свойств владелец×роль. До реализации импорт красный —
// это ожидаемо (модуль ещё не существует).
import {
  getGeneratedPropertyKeys,
  getMemberPropertyKeys,
  isTypedFieldRole,
  listRolesForOwner,
  listRuleOwnerKinds,
} from '../../infra/xml/typedField/TypedFieldOwnerRules';
import { getTypedFieldPropertyKeyOrder, TYPED_FIELD_PROPERTY_KEYS } from '../../ui/views/properties/propertyKeyOrder';
import { getMetaFolder, META_TYPES, type MetaKind } from '../../domain/MetaTypes';
import {
  assertStructuralRoundTrip,
  assertWellFormedXml,
  EXAMPLE_GENERATIONS,
  fieldOwnerKinds,
  isUncorruptedObjectXml,
  KNOWN_CORRUPTED_FIXTURE,
  scanCorpusFields,
  type CorpusField,
} from './support/typedFieldCorpus';
import { skipWithoutCorpus } from './support/corpus';

const STRING_TYPE = '<v8:Type>xs:string</v8:Type>';
const NUMBER_TYPE = '<v8:Type>xs:decimal</v8:Type>';
const BOOLEAN_TYPE = '<v8:Type>xs:boolean</v8:Type>';
const DATE_TYPE = '<v8:Type>xs:dateTime</v8:Type>';
const REFERENCE_TYPE = '<v8:Type>cfg:CatalogRef.Тест</v8:Type>';
const TYPE_SAMPLES = [STRING_TYPE, NUMBER_TYPE, BOOLEAN_TYPE, DATE_TYPE, REFERENCE_TYPE, ''] as const;

/**
 * Роли, для которых поле снимается напрямую из <ChildObjects> владельца (не self-owning).
 *
 * Раньше массив был аннотирован широким `readonly TypeAwarePropertyOwnerKind[]`,
 * из-за чего перебор `for (const role of CHILD_ROLES)` типизировал `role` как
 * ПОЛНЫЙ union (включая 'Constant'/'CommonAttribute'), а не как реальные 5
 * литералов инициализатора — `as const` сохраняет узкий кортежный тип, и
 * `role` в теле цикла корректно сужается до фактически перечисленных ролей.
 */
const CHILD_ROLES = ['Attribute', 'AddressingAttribute', 'Dimension', 'Resource', 'Column'] as const satisfies readonly TypeAwarePropertyOwnerKind[];

/**
 * Гейт эталонного корпуса: `example/` в `.gitignore`, на чистом клоне его нет —
 * такие тесты пропускаются, а не красят прогон. Проверка наличия — общая
 * (`support/corpus.ts`), здесь только требование «обе генерации формата»:
 * правило владелец×роль снимается с обеих, половина корпуса его не подтверждает.
 * Проверки полноты корпуса ВНУТРИ тестов сохранены: корпус есть, но
 * подозрительно мал — падение.
 */
function requireExampleCorpus(context: Mocha.Context): void {
  skipWithoutCorpus(context, EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21);
}

suite('typedFieldOwnerRoleRules — страховка реестра: роли типизированного поля не расходятся с META_TYPES', () => {
  // `isTypedFieldRole` — type-predicate на union TypeAwarePropertyOwnerKind, но
  // само множество ролей считается в рантайме из META_TYPES. Новая запись с
  // propertySchema: 'typedField' сделала бы предикат ложью: роль прошла бы
  // guard, таблица владелец×роль вернула бы undefined, и состав свойств ТИХО
  // деградировал бы до owner-независимого — платформа получила бы поле с
  // чужими свойствами, а прогон остался бы зелёным. Страховка двусторонняя.
  const EXPECTED_ROLES = [
    'Attribute',
    'AddressingAttribute',
    'Dimension',
    'Resource',
    'Column',
    'Constant',
    'CommonAttribute',
  ] as const satisfies readonly TypeAwarePropertyOwnerKind[];

  /** Самовладеющие виды: поле и владелец — один объект, своей `propertySchema: 'typedField'` в реестре у них нет. */
  const SELF_OWNING_ROLES = ['Constant', 'CommonAttribute'] as const satisfies readonly TypeAwarePropertyOwnerKind[];

  function rolesFromRegistry(): string[] {
    return [
      ...Object.values(META_TYPES).filter((def) => def.propertySchema === 'typedField').map((def) => def.kind),
      ...SELF_OWNING_ROLES,
    ];
  }

  test('union TypeAwarePropertyOwnerKind перечислен целиком (расхождение ломает компиляцию)', () => {
    // Направление «union расширили, а список/таблицу — нет» ловится РАНЬШЕ
    // прогона, на `npm run test:compile`: при новом члене union тип выражения
    // становится `false` и присваивание `= true` перестаёт компилироваться.
    type UncoveredRole = Exclude<TypeAwarePropertyOwnerKind, (typeof EXPECTED_ROLES)[number]>;
    const unionFullyCovered: [UncoveredRole] extends [never] ? true : false = true;
    assert.strictEqual(unionFullyCovered, true);
  });

  test('множество ролей, выведенное из META_TYPES, совпадает с union TypeAwarePropertyOwnerKind', () => {
    // Обратное направление («запись в реестре появилась, union не расширили»)
    // типами не ловится: META_TYPES объявлен как Readonly<Record<MetaKind,
    // MetaTypeDef>>, литералы propertySchema в типе не сохраняются — только
    // рантайм-сравнение.
    assert.deepStrictEqual(
      rolesFromRegistry().sort(),
      [...EXPECTED_ROLES].sort(),
      'новая запись META_TYPES с propertySchema: «typedField» обязана попасть в union TypeAwarePropertyOwnerKind ' +
      'и в таблицу владелец×роль — иначе состав свойств поля тихо деградирует до owner-независимого'
    );
  });

  test('каждая роль из META_TYPES проходит isTypedFieldRole и описана хотя бы у одного владельца таблицы', () => {
    // Мало «пройти guard»: роль, которой нет ни в одной паре таблицы, даёт
    // rules[role] === undefined — тот самый тихий owner-независимый состав.
    const tableRoles = new Set(listRuleOwnerKinds().flatMap((owner) => listRolesForOwner(owner)));
    for (const role of rolesFromRegistry()) {
      assert.ok(isTypedFieldRole(role), `роль ${role} из META_TYPES не распознаётся isTypedFieldRole`);
      assert.ok(tableRoles.has(role), `роль ${role} не описана ни у одного владельца таблицы владелец×роль`);
    }
  });
});

suite('typedFieldOwnerRoleRules — GOLDEN A: идемпотентность нормализации на эталонном поле', () => {
  suiteSetup(function () {
    requireExampleCorpus(this);
  });

  test('normalizeTypedFieldPropertiesAfterTypeChange(el, role, ownTypeInner, ownerKind) === el для дочерних полей корпуса', function () {
    // Сам scanCorpusFields() занимает ~3.6с (полный обход example/2.20+2.21+cfe) —
    // дольше дефолтного мокка-таймаута 2с. Как и соседний тест на валидацию
    // корпуса — увеличиваем таймаут, а не ослабляем выборку (инвариант проверен
    // на всех 14 630 полях корпуса за ~195мс, см. бриф).
    this.timeout(60000);
    // Обход ВСЕГО корпуса без подвыборки: сама нормализация на всех полях стоит
    // ~195мс, дорог только разбор XML (~3.6с), который всё равно уже оплачен.
    // Идемпотентность — главный инвариант задачи (битый XML метаданных делает
    // нечитаемой всю конфигурацию), проверять его на трети корпуса нет причин.
    const fields = scanCorpusFields();
    assert.ok(fields.length > 1000, `корпус пуст или почти пуст: ${String(fields.length)} полей`);

    let checked = 0;
    for (const field of fields) {
      const normalizedFieldXml = field.fieldXml.replace(/\r\n/g, '\n');
      const typeInner = extractOwnTypeInner(normalizedFieldXml);
      if (typeInner === null) {
        continue; // поле без <Type> (самозакрытый/отсутствует) — не предмет этого инварианта
      }
      const result = normalizeTypedFieldPropertiesAfterTypeChange(
        normalizedFieldXml,
        field.role,
        typeInner,
        field.ownerKind
      );
      if (result !== normalizedFieldXml) {
        const diffAt = firstDiffIndex(result, normalizedFieldXml);
        assert.fail(
          `${field.filePath}: поле "${field.name}" (${field.ownerKind}.${field.role}) не идемпотентно.\n` +
          `Первый расходящийся символ на позиции ${String(diffAt)}:\n` +
          `  ожидалось: …${JSON.stringify(normalizedFieldXml.slice(Math.max(0, diffAt - 40), diffAt + 40))}\n` +
          `  получено:  …${JSON.stringify(result.slice(Math.max(0, diffAt - 40), diffAt + 40))}`
        );
      }
      checked += 1;
    }
    assert.ok(checked > 500, `слишком мало полей с <Type> прошло проверку: ${String(checked)}`);
  });

  test('normalizeTypedFieldPropertiesAfterTypeChange идемпотентна для Constant/CommonAttribute (self-owning роль)', () => {
    let checked = 0;
    for (const generation of [EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21]) {
      for (const [folder, kind] of [['Constants', 'Constant'], ['CommonAttributes', 'CommonAttribute']] as const) {
        const dir = path.join(generation, folder);
        if (!fs.existsSync(dir)) {
          continue;
        }
        for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.xml'))) {
          const xmlPath = path.join(dir, name);
          const raw = fs.readFileSync(xmlPath, 'utf-8');
          if (!isUncorruptedObjectXml(raw)) {
            continue;
          }
          const xml = raw.replace(/\r\n/g, '\n');
          const rootBlock = extractRootElementBlock(xml, kind);
          if (!rootBlock) {
            continue;
          }
          const typeInner = extractOwnTypeInner(rootBlock);
          if (typeInner === null) {
            continue;
          }
          const result = normalizeTypedFieldPropertiesAfterTypeChange(rootBlock, kind, typeInner, kind);
          assert.strictEqual(result, rootBlock, `${xmlPath}: ${kind} не идемпотентен`);
          checked += 1;
        }
      }
    }
    assert.ok(checked > 0, 'не найдено ни одной Constant/CommonAttribute фикстуры с <Type>');
  });

  test('заведомо испорченный файл распознаётся предфильтром и не попадает в GOLDEN A', () => {
    // ПосчитатьТест.xml испорчен тем же дефектом (смешанная разметка, лишние
    // свойства заполнения у реквизита обработки) — используется как вход теста
    // «повреждённый файл», а не эталон. Прогон через нормализацию НЕ обязан быть
    // идемпотентным — это ожидаемо и не проверяется здесь.
    assert.ok(fs.existsSync(KNOWN_CORRUPTED_FIXTURE), 'фикстура известного дефекта отсутствует');
    const xml = fs.readFileSync(KNOWN_CORRUPTED_FIXTURE, 'utf-8');
    assert.strictEqual(isUncorruptedObjectXml(xml), false, 'предфильтр обязан отбраковать испорченный файл');
    assert.ok(
      scanCorpusFields().every((field) => field.filePath !== KNOWN_CORRUPTED_FIXTURE),
      'испорченный файл не должен попадать в результаты скана корпуса'
    );
  });
});

suite('typedFieldOwnerRoleRules — матрица владелец×роль: состав из эталона', () => {
  test('getMemberPropertyKeys(role, ownerKind) совпадает с фактическим составом эталонного поля (100%/0%, без промежуточных долей)', function () {
    requireExampleCorpus(this);
    const groups = groupCorpusByOwnerRole(scanCorpusFields());
    const intermediate: string[] = [];
    let comparedGroups = 0;

    for (const [key, fields] of groups) {
      const [ownerKind, role] = key.split('|') as [string, TypeAwarePropertyOwnerKind];
      if (fields.length < 3) {
        // Слишком маленькая выборка (например, единичный ChartOfAccounts.Resource)
        // не даёт статистически надёжной доли — не участвует в строгом сравнении,
        // но группа всё равно фигурирует в остальных тестах через синтетические XML.
        continue;
      }
      const counts = new Map<string, number>();
      for (const field of fields) {
        for (const propKey of field.propertyKeys) {
          if (!isTypedFieldControlledPropertyKey(propKey)) {
            continue;
          }
          counts.set(propKey, (counts.get(propKey) ?? 0) + 1);
        }
      }
      const total = fields.length;
      const hundred = new Set<string>();
      for (const [propKey, count] of counts) {
        const pct = (100 * count) / total;
        if (pct === 100) {
          hundred.add(propKey);
        } else if (pct > 0 && pct < 100) {
          intermediate.push(`${ownerKind}.${role}.${propKey} = ${String(count)}/${String(total)} (${pct.toFixed(1)}%)`);
        }
      }

      const expected = getMemberPropertyKeys(role, ownerKind);
      assert.deepStrictEqual(
        [...expected].sort(),
        [...hundred].sort(),
        `${ownerKind}.${role}: getMemberPropertyKeys разошёлся с эталоном ` +
        `(эталон: ${[...hundred].sort().join(',')}; функция: ${[...expected].sort().join(',')})`
      );
      comparedGroups += 1;
    }

    assert.deepStrictEqual(intermediate, [], `найдены промежуточные доли — правило снято неверно:\n${intermediate.join('\n')}`);
    assert.ok(comparedGroups >= 15, `сверено слишком мало пар владелец×роль: ${String(comparedGroups)}`);
  });

  test('getGeneratedPropertyKeys(role, ownerKind, typeInner) ⊆ getMemberPropertyKeys(role, ownerKind) для всех владельцев, ролей и типов', () => {
    // Инвариант из контракта задачи: генерируемый набор не может выходить за
    // рамки допустимого состава — иначе add_attribute/set_type дописали бы
    // в файл свойство чужого владельца.
    let checkedPairs = 0;
    for (const ownerKind of [...fieldOwnerKinds(), 'CalculationRegister', undefined, 'НеизвестныйВладелец']) {
      for (const role of CHILD_ROLES) {
        const members = new Set(getMemberPropertyKeys(role, ownerKind));
        for (const typeInner of TYPE_SAMPLES) {
          const generated = getGeneratedPropertyKeys(role, ownerKind, typeInner);
          for (const key of generated) {
            assert.ok(
              members.has(key),
              `${String(ownerKind)}.${role} (type="${typeInner}"): generated содержит "${key}", которого нет в members`
            );
          }
        }
        checkedPairs += 1;
      }
    }
    assert.ok(checkedPairs > 40, `сверено слишком мало пар: ${String(checkedPairs)}`);
  });

  test('обе функции детерминированы и не зависят от повторного вызова (нет скрытого состояния)', () => {
    for (const ownerKind of ['Catalog', 'DataProcessor', 'InformationRegister', undefined]) {
      for (const role of CHILD_ROLES) {
        const first = getMemberPropertyKeys(role, ownerKind);
        const second = getMemberPropertyKeys(role, ownerKind);
        assert.deepStrictEqual(first, second);
      }
    }
  });
});

suite('typedFieldOwnerRoleRules — зеркало fill/DataHistory/FullTextSearch/Indexing', () => {
  // Зеркало, снятое с эталона (см. бриф): Catalog/Document/ExchangePlan/BusinessProcess/
  // Task/ChartOf* — реквизит верхнего уровня ИМЕЕТ fill/DataHistory, колонка ТЧ — НЕТ.
  // DataProcessor/Report — ровно наоборот.
  const FILL_OWNERS = ['Catalog', 'Document', 'ExchangePlan', 'BusinessProcess', 'Task', 'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes'] as const;
  const NO_FILL_OWNERS = ['DataProcessor', 'Report'] as const;
  const MIRROR_KEYS = ['FillFromFillingValue', 'FillValue'] as const;

  for (const owner of FILL_OWNERS) {
    test(`${owner}: реквизит верхнего уровня — с fill/DataHistory, колонка ТЧ — без`, () => {
      const attributeMembers = new Set(getMemberPropertyKeys('Attribute', owner));
      const columnMembers = new Set(getMemberPropertyKeys('Column', owner));
      for (const key of MIRROR_KEYS) {
        assert.ok(attributeMembers.has(key), `${owner}.Attribute должен допускать ${key}`);
        assert.ok(!columnMembers.has(key), `${owner}.Column не должен допускать ${key}`);
      }
      assert.ok(attributeMembers.has('DataHistory'), `${owner}.Attribute должен допускать DataHistory`);
      assert.ok(columnMembers.has('DataHistory'), `${owner}.Column должен допускать DataHistory (снято с эталона)`);
    });
  }

  for (const owner of NO_FILL_OWNERS) {
    test(`${owner}: реквизит верхнего уровня — без fill, колонка ТЧ — с fill`, () => {
      const attributeMembers = new Set(getMemberPropertyKeys('Attribute', owner));
      const columnMembers = new Set(getMemberPropertyKeys('Column', owner));
      for (const key of MIRROR_KEYS) {
        assert.ok(!attributeMembers.has(key), `${owner}.Attribute не должен допускать ${key}`);
        assert.ok(columnMembers.has(key), `${owner}.Column должен допускать ${key}`);
      }
      assert.ok(!attributeMembers.has('DataHistory'), `${owner}.Attribute не должен допускать DataHistory`);
      assert.ok(!columnMembers.has('DataHistory'), `${owner}.Column не должен допускать DataHistory`);
    });
  }

  test('зеркало проверено и через нормализацию (write-путь): set_type реквизита/колонки Catalog vs DataProcessor', () => {
    for (const [owner, expectFillOnAttribute] of [['Catalog', true], ['DataProcessor', false]] as const) {
      const attributeXml = buildFieldXmlFixture('Attribute', 'Рекв');
      const normalizedAttribute = normalizeTypedFieldPropertiesAfterTypeChange(attributeXml, 'Attribute', NUMBER_TYPE, owner);
      assert.strictEqual(normalizedAttribute.includes('<FillFromFillingValue'), expectFillOnAttribute, `${owner}.Attribute`);

      const columnXml = buildFieldXmlFixture('Attribute', 'Кол');
      const normalizedColumn = normalizeTypedFieldPropertiesAfterTypeChange(columnXml, 'Column', NUMBER_TYPE, owner);
      assert.strictEqual(normalizedColumn.includes('<FillFromFillingValue'), !expectFillOnAttribute, `${owner}.Column`);
    }
  });
});

suite('typedFieldOwnerRoleRules — пустой/отсутствующий тип: панель считается по владельцу, а не по общему фолбэку', () => {
  // Дефект 4: getTypedFieldPropertyKeyOrder с пустым <Type> уходил на
  // TYPED_FIELD_PROPERTY_KEYS вне зависимости от владельца.
  test('getMemberPropertyKeys не зависит от типа (member — не про <Type>) — пустой typeInner не имеет отношения к составу', () => {
    for (const ownerKind of fieldOwnerKinds()) {
      for (const role of CHILD_ROLES) {
        const members = getMemberPropertyKeys(role, ownerKind);
        assert.ok(members.length > 0, `${ownerKind}.${role}: пустой состав member-свойств выглядит подозрительно`);
      }
    }
  });

  test('getTypedFieldPropertyKeyOrder: пустой <Type/> у реквизита РС не уходит на TYPED_FIELD_PROPERTY_KEYS', () => {
    // Регрессия на верифицированный дефект (см. бриф): при пустом <Type> панель
    // строго возвращала TYPED_FIELD_PROPERTY_KEYS вне зависимости от владельца.
    const emptyTypeAttributeXml = [
      '<Attribute uuid="11111111-1111-1111-1111-111111111111">',
      '\t<Properties>',
      '\t\t<Name>Рекв</Name>',
      '\t\t<Synonym/>',
      '\t\t<Comment/>',
      '\t\t<Type/>',
      '\t</Properties>',
      '</Attribute>',
    ].join('\n');

    const withOwner = getTypedFieldPropertyKeyOrder(emptyTypeAttributeXml, 'InformationRegister');
    assert.notDeepStrictEqual(
      withOwner,
      TYPED_FIELD_PROPERTY_KEYS,
      'пустой <Type/> не должен уводить панель на общий фолбэк без учёта владельца'
    );
    assert.ok(withOwner.includes('Master'), 'реквизит РС должен получить ролевые свойства измерения РС');

    const withoutType = getTypedFieldPropertyKeyOrder(
      ['<Attribute uuid="22222222-2222-2222-2222-222222222222">', '\t<Properties>', '\t\t<Name>Рекв</Name>', '\t</Properties>', '</Attribute>'].join('\n'),
      'InformationRegister'
    );
    assert.notDeepStrictEqual(withoutType, TYPED_FIELD_PROPERTY_KEYS, 'отсутствие <Type> тоже не должно уводить на общий фолбэк для известного владельца');
  });

  test('для каждого владельца×роли пустой тип не переключает состав на общий (не зависящий от владельца) список', () => {
    const generic = new Set(getGeneratedPropertyKeys('Attribute', undefined, ''));
    let sawDifference = false;
    for (const ownerKind of fieldOwnerKinds()) {
      const owned = new Set(getGeneratedPropertyKeys('Attribute', ownerKind, ''));
      if (!setsEqual(owned, generic)) {
        sawDifference = true;
      }
    }
    assert.ok(sawDifference, 'должен найтись хотя бы один владелец, для которого пустой тип даёт иной состав, чем без владельца');
  });
});

suite('typedFieldOwnerRoleRules — согласованность потребителей (панель/set_type/validate/add)', () => {
  test('всё, что set_type сохраняет/дописывает, входит в getMemberPropertyKeys того же владельца×роли', () => {
    for (const ownerKind of ['Catalog', 'DataProcessor', 'InformationRegister', 'Document', 'Report']) {
      for (const role of CHILD_ROLES) {
        const members = new Set(getMemberPropertyKeys(role, ownerKind));
        const fixture = buildFieldXmlFixture(role === 'Column' ? 'Attribute' : role, 'Тест');
        const normalized = normalizeTypedFieldPropertiesAfterTypeChange(fixture, role, NUMBER_TYPE, ownerKind);
        for (const key of extractControlledKeysFromXml(normalized)) {
          assert.ok(members.has(key), `${ownerKind}.${role}: set_type записал "${key}", не входящий в getMemberPropertyKeys`);
        }
      }
    }
  });

  test('add-фрагмент (getGeneratedPropertyKeys) — то же множество, что set_type допишет для нового поля без предыдущих свойств', () => {
    for (const ownerKind of ['Catalog', 'DataProcessor', 'AccumulationRegister', 'InformationRegister']) {
      for (const role of CHILD_ROLES) {
        const generated = new Set(getGeneratedPropertyKeys(role, ownerKind, NUMBER_TYPE));
        const bareFieldXml = buildBareFieldXmlFixture(role === 'Column' ? 'Attribute' : role, 'Тест');
        const normalized = normalizeTypedFieldPropertiesAfterTypeChange(bareFieldXml, role, NUMBER_TYPE, ownerKind);
        const written = new Set(extractControlledKeysFromXml(normalized));
        assert.deepStrictEqual(
          [...written].sort(),
          [...generated].sort(),
          `${ownerKind}.${role}: set_type на пустом поле должен дописать ровно getGeneratedPropertyKeys`
        );
      }
    }
  });
});

suite('typedFieldOwnerRoleRules — ветки ошибок и guard\'ы', () => {
  test('неизвестный ownerKind: getMemberPropertyKeys/getGeneratedPropertyKeys не бросают и возвращают детерминированный (owner-независимый) состав', () => {
    for (const role of CHILD_ROLES) {
      const members = getMemberPropertyKeys(role, 'НеизвестныйВладелец');
      assert.ok(Array.isArray(members));
      const generated = getGeneratedPropertyKeys(role, 'НеизвестныйВладелец', NUMBER_TYPE);
      assert.ok(Array.isArray(generated));
      for (const key of generated) {
        assert.ok(members.includes(key));
      }
    }
  });

  test('ownerKind === undefined: функции не бросают, а возвращают состав без владельца', () => {
    for (const role of CHILD_ROLES) {
      assert.ok(Array.isArray(getMemberPropertyKeys(role, undefined)));
      assert.ok(Array.isArray(getGeneratedPropertyKeys(role, undefined, '')));
    }
  });

  test('Constant/CommonAttribute (self-owning роль): ownerKind равный собственной роли не бросает', () => {
    assert.ok(Array.isArray(getMemberPropertyKeys('Constant', 'Constant')));
    assert.ok(Array.isArray(getMemberPropertyKeys('CommonAttribute', 'CommonAttribute')));
  });

  test('нет <Properties> у элемента — normalizeTypedFieldPropertiesAfterTypeChange возвращает вход без изменений', () => {
    const xml = '<Attribute uuid="11111111-1111-1111-1111-111111111111"></Attribute>';
    assert.strictEqual(normalizeTypedFieldPropertiesAfterTypeChange(xml, 'Attribute', NUMBER_TYPE, 'Catalog'), xml);
  });

  test('самозакрытый <Properties/> — normalizeTypedFieldPropertiesAfterTypeChange возвращает вход без изменений', () => {
    const xml = '<Attribute uuid="11111111-1111-1111-1111-111111111111"><Properties/></Attribute>';
    assert.strictEqual(normalizeTypedFieldPropertiesAfterTypeChange(xml, 'Attribute', NUMBER_TYPE, 'Catalog'), xml);
  });

  test('незакрытый тег внутри <Properties> не приводит к исключению', () => {
    const xml = [
      '<Attribute uuid="11111111-1111-1111-1111-111111111111">',
      '\t\t\t<Properties>',
      '\t\t\t\t<Name>Тест</Name>',
      '\t\t\t\t<Type>',
      '\t\t\t\t\t<v8:Type>xs:string</v8:Type>',
      '\t\t\t\t</Type>',
      '\t\t\t\t<НезакрытыйТег>',
      '\t\t\t</Properties>',
      '\t\t</Attribute>',
    ].join('\n');
    let result = '';
    assert.doesNotThrow(() => {
      result = normalizeTypedFieldPropertiesAfterTypeChange(xml, 'Attribute', NUMBER_TYPE, 'Catalog');
    });
    assert.strictEqual(typeof result, 'string');
  });

  test('роль, структурно невозможная для владельца (Dimension у обработки, Resource у справочника), не бросает и не даёт ролевых свойств регистра', () => {
    for (const [role, ownerKind] of [['Dimension', 'DataProcessor'], ['Resource', 'Catalog']] as const) {
      const members = getMemberPropertyKeys(role, ownerKind);
      assert.ok(Array.isArray(members));
      for (const alien of ['Master', 'MainFilter', 'Balance', 'AccountingFlag', 'ExtDimensionAccountingFlag', 'UseInTotals']) {
        assert.ok(!members.includes(alien), `${ownerKind}.${role}: не может иметь ролевое свойство регистра ${alien}`);
      }
    }
  });
});

suite('typedFieldOwnerRoleRules — GOLDEN B: реальная смена типа (диффовый тест через updateTypeInObject)', () => {
  suiteSetup(function () {
    requireExampleCorpus(this);
  });

  // GOLDEN A (выше) проверяет только «тип не изменился» — реализация могла бы
  // пройти его тривиальным «если тип тот же — верни вход», при этом калеча
  // файл на РЕАЛЬНОЙ смене типа (основной сценарий set_type). Здесь — диффовый
  // тест на копии реального эталонного объекта: строковый дифф ловит косметику
  // (что именно изменилось построчно), assertStructuralRoundTrip — семантику
  // (какие ключи <Properties> изменились и что XML остаётся well-formed).

  test('Catalogs/Контрагенты.Индекс (реквизит верхнего уровня): string→reference меняет только <Type>, PasswordMode/Mask/Use сохраняются', () => {
    const xmlPath = copyExampleObjectToTmp(path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs/Контрагенты.xml'), 'Catalogs');
    const before = fs.readFileSync(xmlPath, 'utf-8');
    assert.ok(isUncorruptedObjectXml(before), 'исходный эталон должен быть неповреждён');

    const uuid = '662a9391-2f06-49b1-89de-8adcff059a69';
    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Индекс',
      typeInnerXml: REFERENCE_TYPE,
    });
    assert.strictEqual(changed, true, 'смена типа должна была реально применить изменение');

    const after = fs.readFileSync(xmlPath, 'utf-8');
    assertWellFormedXml(after, 'Индекс: файл после set_type');
    const { beforeBlock, afterBlock } = assertOnlyTypeBlockChangedInFile(before, after, 'Attribute', uuid, 'Индекс');

    assert.ok(beforeBlock.includes('<v8:Type>xs:string</v8:Type>'));
    // Точная проверка ИМЕННО тега <v8:Type>, а не подстроки "xs:string": у поля
    // есть <FillValue xsi:type="xs:string"/> — этот блок обязан сохраниться
    // (иначе изменился бы ключ FillValue, а не только Type) и он тоже содержит
    // подстроку "xs:string", хотя и не является типом реквизита.
    assert.ok(!afterBlock.includes('<v8:Type>xs:string</v8:Type>'));
    assert.ok(afterBlock.includes('CatalogRef.Тест'));
    for (const preserved of [
      '<Use>ForItem</Use>',
      '<PasswordMode>false</PasswordMode>',
      '<Mask/>',
      '<MultiLine>false</MultiLine>',
      '<ExtendedEdit>false</ExtendedEdit>',
    ]) {
      assert.ok(afterBlock.includes(preserved), `реквизит должен сохранить ${preserved} при смене string→reference`);
    }
    assertStructuralRoundTrip(beforeBlock, afterBlock, ['Type'], 'Контрагенты.Индекс string→reference');
  });

  test('Catalogs/Контрагенты.Регион (реквизит верхнего уровня): reference→number меняет только <Type>, свойства выбора и Use сохраняются', () => {
    const xmlPath = copyExampleObjectToTmp(path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs/Контрагенты.xml'), 'Catalogs');
    const before = fs.readFileSync(xmlPath, 'utf-8');

    const uuid = '0d5000f4-d82f-4b24-a5b6-68fe67aefe1b';
    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Регион',
      typeInnerXml: NUMBER_TYPE,
    });
    assert.strictEqual(changed, true, 'смена типа должна была реально применить изменение');

    const after = fs.readFileSync(xmlPath, 'utf-8');
    assertWellFormedXml(after, 'Регион: файл после set_type');
    const { beforeBlock, afterBlock } = assertOnlyTypeBlockChangedInFile(before, after, 'Attribute', uuid, 'Регион');

    assert.ok(beforeBlock.includes('CatalogRef.Регионы'));
    assert.ok(afterBlock.includes('xs:decimal'));
    for (const preserved of ['<Use>ForItem</Use>', '<ChoiceParameterLinks/>', '<ChoiceForm/>', '<LinkByType/>', '<DataHistory>Use</DataHistory>']) {
      assert.ok(afterBlock.includes(preserved), `реквизит должен сохранить ${preserved} при смене reference→number`);
    }
    assertStructuralRoundTrip(beforeBlock, afterBlock, ['Type'], 'Контрагенты.Регион reference→number');
  });

  test('Catalogs/ИсходящиеПисьма.Получатели.ЭлектроннаяПочта (колонка ТЧ): string→reference не добавляет свойства заполнения и сохраняет незнакомый тег', () => {
    const xmlPath = copyExampleObjectToTmp(path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs/ИсходящиеПисьма.xml'), 'Catalogs');
    // Синтетический незнакомый тег — проверка сохранения ПОЛНОСТЬЮ неизвестного
    // производству свойства (даже не входящего в CONTROLLED_PROPERTY_KEYS).
    // Строка встречается в файле ровно один раз (7 табов — глубина колонки ТЧ).
    const original = fs.readFileSync(xmlPath, 'utf-8');
    const marker = '\t\t\t\t\t\t\t<DataHistory>Use</DataHistory>';
    assert.strictEqual(original.split(marker).length, 2, 'маркер должен встречаться в файле ровно один раз');
    // Вставляем через \r\n (не голый \n): исходный файл — CRLF, и
    // writeTextFilePreservingBomAndEol на пути записи обязан нормализовать
    // ВСЕ переводы строк к стилю файла (запрет №12 CLAUDE.md, менять нельзя) —
    // если бы "before"-снимок содержал смешанный EOL, "after" (уже нормализованный
    // production-кодом) отличался бы лишним `\r` не по вине мутации состава, а
    // из-за смешанной разметки, заведённой самим тестом.
    const withSyntheticTag = original.replace(marker, `${marker}\r\n\t\t\t\t\t\t\t<БудущееСвойство>X</БудущееСвойство>`);
    fs.writeFileSync(xmlPath, withSyntheticTag, 'utf-8');
    const before = fs.readFileSync(xmlPath, 'utf-8');

    const uuid = '16bc9885-9419-432c-a9a3-cf88fd4e1d28';
    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'ЭлектроннаяПочта',
      tabularSectionName: 'Получатели',
      typeInnerXml: REFERENCE_TYPE,
    });
    assert.strictEqual(changed, true, 'смена типа должна была реально применить изменение');

    const after = fs.readFileSync(xmlPath, 'utf-8');
    assertWellFormedXml(after, 'ЭлектроннаяПочта: файл после set_type');
    const { beforeBlock, afterBlock } = assertOnlyTypeBlockChangedInFile(before, after, 'Attribute', uuid, 'ЭлектроннаяПочта (колонка)');

    assert.ok(!afterBlock.includes('FillFromFillingValue'), 'колонка ТЧ справочника не должна получать свойства заполнения');
    assert.ok(!afterBlock.includes('FillValue'), 'колонка ТЧ справочника не должна получать свойства заполнения');
    assert.ok(afterBlock.includes('<БудущееСвойство>X</БудущееСвойство>'), 'полностью незнакомый тег должен сохраниться байт-в-байт');
    assert.ok(afterBlock.includes('<DataHistory>Use</DataHistory>'), 'DataHistory колонки справочника — owner-member, сохраняется');
    assertStructuralRoundTrip(beforeBlock, afterBlock, ['Type'], 'ИсходящиеПисьма.ЭлектроннаяПочта string→reference');
  });
});

suite('typedFieldOwnerRoleRules — известный испорченный файл: set_type чинит, а не усугубляет', () => {
  suiteSetup(function () {
    requireExampleCorpus(this);
  });

  test('ПосчитатьТест.тестк: set_type убирает лишние свойства заполнения реквизита обработки, остальной файл не трогает', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-corrupted-'));
    const dir = path.join(tmpDir, 'DataProcessors');
    fs.mkdirSync(dir, { recursive: true });
    const xmlPath = path.join(dir, 'ПосчитатьТест.xml');
    fs.copyFileSync(KNOWN_CORRUPTED_FIXTURE, xmlPath);
    const before = fs.readFileSync(xmlPath, 'utf-8');
    assert.strictEqual(isUncorruptedObjectXml(before), false, 'фикстура должна оставаться распознанной как испорченная');

    const uuid = '96b0a184-96eb-441a-877d-9d0f4ae97090';
    new ObjectXmlReader().updateTypeInObject(xmlPath, { targetKind: 'Attribute', targetName: 'тестк', typeInnerXml: STRING_TYPE });

    const after = fs.readFileSync(xmlPath, 'utf-8');
    assertWellFormedXml(after, 'ПосчитатьТест: файл после set_type');
    const attrAfter = new RegExp(`<Attribute uuid="${uuid}">[\\s\\S]*?</Attribute>`).exec(after);
    assert.ok(attrAfter, 'реквизит должен остаться в файле');
    assert.ok(!attrAfter[0].includes('FillFromFillingValue'), 'set_type должен убрать лишнее свойство заполнения, а не оставить/умножить его');
    assert.ok(!attrAfter[0].includes('FillValue'), 'set_type должен убрать лишнее свойство заполнения');
    assert.ok(!attrAfter[0].includes('DataHistory'), 'реквизит обработки не должен иметь DataHistory (owner-зависимое свойство)');

    // Остальной файл (шапка объекта, InternalInfo, Properties владельца) не тронут.
    const headBefore = before.slice(0, before.indexOf('<Attribute'));
    assert.ok(after.startsWith(headBefore), 'содержимое до реквизита не должно меняться');
  });
});

suite('typedFieldOwnerRoleRules — CRLF + BOM: идемпотентный вызов не переписывает файл', () => {
  suiteSetup(function () {
    requireExampleCorpus(this);
  });

  test('set_type с тем же типом на CRLF-файле с BOM не производит запись и не меняет байты (BOM/EOL включительно)', () => {
    const sourcePath = path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs/Контрагенты.xml');
    const lfContent = fs.readFileSync(sourcePath, 'utf-8').replace(/\r\n/g, '\n');
    const crlfWithBom = `\ufeff${lfContent.replace(/\n/g, '\r\n')}`;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-crlf-bom-'));
    const dir = path.join(tmpDir, 'Catalogs');
    fs.mkdirSync(dir, { recursive: true });
    const xmlPath = path.join(dir, 'Контрагенты.xml');
    fs.writeFileSync(xmlPath, crlfWithBom, 'utf-8');

    const beforeRaw = fs.readFileSync(xmlPath);
    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Attribute',
      targetName: 'Регион',
      // Тот же тип, что уже указан в эталоне («Регион» — cfg:CatalogRef.Регионы): идемпотентный вызов.
      typeInnerXml: '<v8:Type>cfg:CatalogRef.Регионы</v8:Type>',
    });
    assert.strictEqual(changed, false, 'смена на тот же тип не должна считаться реальным изменением');

    const afterRaw = fs.readFileSync(xmlPath);
    assert.ok(beforeRaw.equals(afterRaw), 'идемпотентный вызов не должен менять файл побайтово (BOM/CRLF включительно)');
  });
});

suite('typedFieldOwnerRoleRules — порядок вставки новых свойств относительно неуправляемого тега', () => {
  test('новый ключ ложится в каноническую позицию по обе стороны от неуправляемого <Use>', () => {
    // ChoiceHistoryOnInput/Use/FullTextSearch — реальный относительный порядок,
    // наблюдаемый в example/ (Use — неуправляемый тег между ними). LinkByType по
    // CONTROLLED_PROPERTY_KEYS идёт РАНЬШЕ ChoiceHistoryOnInput (а значит и
    // раньше Use), Indexing — ПОЗЖЕ ChoiceHistoryOnInput (а значит и позже Use).
    const fixture = [
      '<Attribute uuid="33333333-3333-3333-3333-333333333333">',
      '\t\t\t<Properties>',
      '\t\t\t\t<Name>Тест</Name>',
      '\t\t\t\t<Synonym/>',
      '\t\t\t\t<Comment/>',
      '\t\t\t\t<Type>',
      '\t\t\t\t\t<v8:Type>cfg:CatalogRef.Тест</v8:Type>',
      '\t\t\t\t</Type>',
      '\t\t\t\t<ChoiceHistoryOnInput>Auto</ChoiceHistoryOnInput>',
      '\t\t\t\t<Use>ForItem</Use>',
      '\t\t\t\t<FullTextSearch>Use</FullTextSearch>',
      '\t\t\t</Properties>',
      '\t\t</Attribute>',
    ].join('\n');

    const result = normalizeTypedFieldPropertiesAfterTypeChange(fixture, 'Attribute', REFERENCE_TYPE, 'Catalog');
    assertWellFormedXml(result, 'фикстура вставки вокруг Use');
    const lines = result.split('\n');
    const indexOf = (needle: string): number => lines.findIndex((line) => line.includes(needle));

    const useIdx = indexOf('<Use>ForItem</Use>');
    assert.ok(useIdx >= 0, 'неуправляемый тег Use должен сохраниться');
    const linkByTypeIdx = indexOf('<LinkByType');
    const indexingIdx = indexOf('<Indexing');
    assert.ok(linkByTypeIdx >= 0, 'LinkByType должен быть дописан (реквизит ссылочного типа)');
    assert.ok(indexingIdx >= 0, 'Indexing должен быть дописан');
    assert.ok(linkByTypeIdx < useIdx, 'LinkByType (раньше Use по канону) должен встать до Use, а не после');
    assert.ok(indexingIdx > useIdx, 'Indexing (позже Use по канону) должен встать после Use, а не до');
  });
});

suite('typedFieldOwnerRoleRules — ветки updateTypeInObject: guard\'ы и targetKind без нормализации состава', () => {
  test('Column без tabularSectionName возвращает false и не трогает файл', () => {
    const xmlPath = writeMinimalCatalogWithColumn();
    const before = fs.readFileSync(xmlPath, 'utf-8');
    const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
      targetKind: 'Column',
      targetName: 'Кол',
      typeInnerXml: NUMBER_TYPE,
    });
    assert.strictEqual(changed, false);
    assert.strictEqual(fs.readFileSync(xmlPath, 'utf-8'), before);
  });

  test('несуществующий файл — false, а не исключение', () => {
    assert.strictEqual(
      new ObjectXmlReader().updateTypeInObject(path.join(os.tmpdir(), 'v8vscedit-нет-такого-файла', 'Файл.xml'), {
        targetKind: 'Attribute',
        targetName: 'Х',
        typeInnerXml: NUMBER_TYPE,
      }),
      false
    );
  });

  test('несуществующий элемент в существующем файле — false', () => {
    const xmlPath = writeMinimalCatalogWithColumn();
    assert.strictEqual(
      new ObjectXmlReader().updateTypeInObject(xmlPath, {
        targetKind: 'Attribute',
        targetName: 'НетТакогоРеквизита',
        typeInnerXml: NUMBER_TYPE,
      }),
      false
    );
  });

  test('SessionParameter/DefinedType: <Type> меняется, состав свойств типизированного поля не затрагивается', () => {
    for (const targetKind of ['SessionParameter', 'DefinedType'] as const) {
      const xmlPath = writeRootTypeTargetXml(targetKind);
      const changed = new ObjectXmlReader().updateTypeInObject(xmlPath, {
        targetKind,
        targetName: 'Параметр',
        typeInnerXml: STRING_TYPE,
      });
      assert.strictEqual(changed, true, `${targetKind}: смена типа должна была примениться`);
      const xml = fs.readFileSync(xmlPath, 'utf-8');
      assertWellFormedXml(xml, `${targetKind}: файл после смены типа`);
      assert.ok(xml.includes('xs:string'));
      for (const alien of ['PasswordMode', 'Indexing', 'FullTextSearch', 'DataHistory']) {
        assert.ok(!xml.includes(`<${alien}`), `${targetKind}: свойство ${alien} посторонне для этого вида`);
      }
    }
  });
});

suite('typedFieldOwnerRoleRules — путь add (MCP/UI): состав по владельцу для новых полей', () => {
  test('add_column в ТЧ справочника: без свойств заполнения; в ТЧ обработки: со свойствами заполнения', () => {
    for (const [kind, expectFill] of [['Catalog', false], ['DataProcessor', true]] as const) {
      const { ownerXml } = makeRootObjectForOwnerRulesTest(kind);
      const creator = new MetadataXmlCreator();
      assert.strictEqual(creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'TabularSection', name: 'ТЧ' }).success, true);
      assert.strictEqual(
        creator.addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Column', name: 'Кол', tabularSectionName: 'ТЧ' }).success,
        true
      );
      const xml = fs.readFileSync(ownerXml, 'utf-8');
      assertWellFormedXml(xml, `${kind}: файл владельца после add_column`);
      const ts = /<TabularSection uuid=[\s\S]*?<\/TabularSection>/.exec(xml);
      assert.ok(ts, `${kind}: блок табличной части не найден`);
      assert.strictEqual(ts[0].includes('FillFromFillingValue'), expectFill, `${kind}: колонка ТЧ — состав fill должен зависеть от владельца`);
      assert.strictEqual(ts[0].includes('FillValue'), expectFill, `${kind}: колонка ТЧ — состав fill должен зависеть от владельца`);
    }
  });

  test('add_attribute для обработки: реквизит верхнего уровня без свойств заполнения (зеркально справочнику)', () => {
    const { ownerXml } = makeRootObjectForOwnerRulesTest('DataProcessor');
    assert.strictEqual(new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Attribute', name: 'Рекв' }).success, true);
    const xml = fs.readFileSync(ownerXml, 'utf-8');
    assertWellFormedXml(xml, 'DataProcessor: файл владельца после add_attribute');
    const attr = /<Attribute uuid=[\s\S]*?<\/Attribute>/.exec(xml);
    assert.ok(attr);
    assert.ok(!attr[0].includes('FillFromFillingValue'), 'реквизит обработки не должен получать свойства заполнения');
    assert.ok(!attr[0].includes('FillValue'), 'реквизит обработки не должен получать свойства заполнения');
  });

  test('add_attribute для справочника: реквизит верхнего уровня со свойствами заполнения', () => {
    const { ownerXml } = makeRootObjectForOwnerRulesTest('Catalog');
    assert.strictEqual(new MetadataXmlCreator().addChildElement({ ownerObjectXmlPath: ownerXml, childTag: 'Attribute', name: 'Рекв' }).success, true);
    const xml = fs.readFileSync(ownerXml, 'utf-8');
    assertWellFormedXml(xml, 'Catalog: файл владельца после add_attribute');
    const attr = /<Attribute uuid=[\s\S]*?<\/Attribute>/.exec(xml);
    assert.ok(attr);
    assert.ok(attr[0].includes('FillFromFillingValue'), 'реквизит справочника должен получать свойства заполнения');
  });
});

suite('typedFieldOwnerRoleRules — консервативный режим для владельцев без снятых правил', () => {
  test('CalculationRegister (реальный эталон): owner-зависимые свойства регистра не дописываются «по умолчанию»', function () {
    requireExampleCorpus(this);
    const xml = fs.readFileSync(path.join(EXAMPLE_GENERATIONS.cf20, 'CalculationRegisters/Начисления.xml'), 'utf-8');
    const dimensionMatch = /<Dimension uuid="[^"]+">[\s\S]*?<\/Dimension>/.exec(xml);
    assert.ok(dimensionMatch, 'эталон должен содержать измерение');
    const typeInner = /<Type>\r?\n?([\s\S]*?)\r?\n?[ \t]*<\/Type>/.exec(dimensionMatch[0])?.[1] ?? '';

    const generated = getGeneratedPropertyKeys('Dimension', 'CalculationRegister', typeInner);
    for (const alien of ['UseInTotals', 'Balance', 'AccountingFlag', 'Master', 'MainFilter']) {
      assert.ok(!generated.includes(alien), `консервативный режим не должен дописывать ${alien} по умолчанию неизвестному регистру`);
    }
  });

  test('синтетический владелец вне таблицы: owner-зависимые свойства не дописываются', () => {
    for (const role of ['Attribute', 'Dimension', 'Resource'] as const) {
      const generated = getGeneratedPropertyKeys(role, 'НесуществующийВидМетаданных', NUMBER_TYPE);
      for (const alien of ['UseInTotals', 'Balance', 'AccountingFlag', 'Master', 'MainFilter', 'FillFromFillingValue', 'FillValue', 'DataHistory']) {
        assert.ok(!generated.includes(alien), `${role}: неизвестному владельцу нельзя дописывать owner-зависимое свойство ${alien}`);
      }
    }
  });
});

suite('typedFieldOwnerRoleRules — validate_metadata: критерий property-not-allowed = getMemberPropertyKeys владельца', () => {
  suiteSetup(function () {
    requireExampleCorpus(this);
  });

  test('владелец×роль ловит owner-несовместимое свойство заполнения у колонки ТЧ справочника (сегодня — нет)', () => {
    // Дефекты 3/5 из очереди, если сформулировать через ЧТЕНИЕ (не запись):
    // сегодня findDisallowedTypedFieldProperties('Column', ownerKind) — единая
    // функция getMemberPropertyKeys('Column', registerKind) БЕЗУСЛОВНО считает
    // FillFromFillingValue/FillValue допустимыми у ЛЮБОЙ колонки (комментарий в
    // TypedFieldPropertyRules.ts: «для проверки принадлежности виду они
    // допустимы всегда»), а не только у колонки ТЧ обработки/отчёта. Из-за
    // этого validate_metadata сегодня НЕ поймает испорченную колонку
    // справочника/документа со свойствами заполнения — а именно такую порчу
    // (реальную, не гипотетическую) чинит эта задача на пути записи. Новый
    // контракт делает критерий ЕДИНЫМ: getMemberPropertyKeys(role, ownerKind)
    // владельца ТЧ, а не безусловным «для Column — всегда можно».
    const xmlPath = copyExampleObjectToTmp(path.join(EXAMPLE_GENERATIONS.cf20, 'Catalogs/ИсходящиеПисьма.xml'), 'Catalogs');
    const original = fs.readFileSync(xmlPath, 'utf-8');
    const marker = '\t\t\t\t\t\t\t<FillChecking>DontCheck</FillChecking>';
    assert.strictEqual(original.split(marker).length, 2, 'маркер должен встречаться в файле ровно один раз (колонка ЭлектроннаяПочта)');
    const corrupted = original.replace(
      marker,
      '\t\t\t\t\t\t\t<FillFromFillingValue>false</FillFromFillingValue>\n\t\t\t\t\t\t\t<FillValue xsi:nil="true"/>\n' + marker
    );
    fs.writeFileSync(xmlPath, corrupted, 'utf-8');

    const result = new MetadataValidationService().validate({ objectPath: xmlPath });
    const wrong = result.objects[0].issues.filter((issue) => issue.code === 'property-not-allowed');
    assert.ok(
      wrong.some((issue) => issue.message.includes('FillFromFillingValue')),
      'колонка ТЧ справочника с FillFromFillingValue должна быть поймана как property-not-allowed'
    );
  });

  test('на неповреждённой части корпуса (Catalogs/Documents/регистры — БЕЗ обработок/отчётов) ни один объект не даёт property-not-allowed', function () {
    // Полный корпус — тысячи файлов, даже с подвыборкой «каждый 4-й» это
    // заметно дольше дефолтного мокка-таймаута в 2с.
    this.timeout(60000);
    // Регрессионная страховка на позитивном корпусе. DataProcessors/Reports
    // сюда намеренно НЕ включены: сегодняшняя безусловная терпимость
    // getMemberPropertyKeys('Column', …) к fill означала бы, что этот тест
    // «зелёный» не благодаря корректности, а благодаря всеядности критерия —
    // содержательная проверка для обработок/отчётов сделана выше отдельным
    // тестом на инъекции дефекта.
    const service = new MetadataValidationService();
    let checked = 0;
    const folders = ['Catalogs', 'Documents', 'InformationRegisters', 'AccumulationRegisters', 'AccountingRegisters'];
    for (const generation of [EXAMPLE_GENERATIONS.cf20, EXAMPLE_GENERATIONS.cf21]) {
      for (const folder of folders) {
        const dir = path.join(generation, folder);
        if (!fs.existsSync(dir)) {
          continue;
        }
        // Полный обход занял бы существенно больше времени на тысячах файлов —
        // берём детерминированную подвыборку (сортировка + каждый 4-й файл).
        const files = fs.readdirSync(dir).filter((name) => name.endsWith('.xml')).sort();
        for (let i = 0; i < files.length; i += 4) {
          const xmlPath = path.join(dir, files[i]);
          if (xmlPath === KNOWN_CORRUPTED_FIXTURE) {
            continue;
          }
          const raw = fs.readFileSync(xmlPath, 'utf-8');
          if (!isUncorruptedObjectXml(raw)) {
            continue;
          }
          const result = service.validate({ objectPath: xmlPath });
          const wrong = (result.objects[0]?.issues ?? []).filter((issue) => issue.code === 'property-not-allowed');
          assert.deepStrictEqual(wrong.map((issue) => issue.message), [], `ложное срабатывание property-not-allowed на ${xmlPath}`);
          checked += 1;
        }
      }
    }
    assert.ok(checked >= 60, `проверено объектов: ${String(checked)}`);
  });
});

// ── Хелперы файла ──────────────────────────────────────────────────────────

function extractOwnTypeInner(fieldXmlLf: string): string | null {
  const match = /<Type>\n([\s\S]*?)\n[ \t]*<\/Type>/.exec(fieldXmlLf);
  return match ? match[1] : null;
}

function extractRootElementBlock(xmlLf: string, tag: string): string | null {
  const openMatch = new RegExp(`<${tag} uuid="[^"]+"[^>]*>`).exec(xmlLf);
  if (!openMatch) {
    return null;
  }
  const closeTag = `</${tag}>`;
  const closeIdx = xmlLf.indexOf(closeTag, openMatch.index + openMatch[0].length);
  if (closeIdx < 0) {
    return null;
  }
  return xmlLf.slice(openMatch.index, closeIdx + closeTag.length);
}

function firstDiffIndex(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return len;
}

function groupCorpusByOwnerRole(fields: readonly CorpusField[]): Map<string, CorpusField[]> {
  const map = new Map<string, CorpusField[]>();
  for (const field of fields) {
    const key = `${field.ownerKind}|${field.role}`;
    const list = map.get(key);
    if (list) {
      list.push(field);
    } else {
      map.set(key, [field]);
    }
  }
  return map;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function buildFieldXmlFixture(tag: 'Attribute' | 'Dimension' | 'Resource' | 'AddressingAttribute', name: string): string {
  return [
    `<${tag} uuid="11111111-1111-1111-1111-111111111111">`,
    '\t\t\t<Properties>',
    `\t\t\t\t<Name>${name}</Name>`,
    '\t\t\t\t<Synonym/>',
    '\t\t\t\t<Comment/>',
    '\t\t\t\t<Type>',
    '\t\t\t\t\t<v8:Type>xs:string</v8:Type>',
    '\t\t\t\t</Type>',
    '\t\t\t\t<ToolTip/>',
    '\t\t\t</Properties>',
    `\t\t</${tag}>`,
  ].join('\n');
}

function buildBareFieldXmlFixture(tag: 'Attribute' | 'Dimension' | 'Resource' | 'AddressingAttribute', name: string): string {
  return [
    `<${tag} uuid="22222222-2222-2222-2222-222222222222">`,
    '\t\t\t<Properties>',
    `\t\t\t\t<Name>${name}</Name>`,
    '\t\t\t\t<Synonym/>',
    '\t\t\t\t<Comment/>',
    '\t\t\t</Properties>',
    `\t\t</${tag}>`,
  ].join('\n');
}

/** Прямые дети <Properties>, входящие в CONTROLLED_PROPERTY_KEYS (без Name/Synonym/Comment/Type). */
function extractControlledKeysFromXml(xml: string): string[] {
  const propsMatch = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml);
  if (!propsMatch) {
    return [];
  }
  return [...propsMatch[1].matchAll(/^\t+<([A-Za-z][\w]*)/gm)]
    .map((m) => m[1])
    .filter((key) => isTypedFieldControlledPropertyKey(key));
}

// ── Хелперы для GOLDEN B / guard-тестов ─────────────────────────────────────

/** Копирует реальный эталонный объект во временный каталог (исходники в example/ не портим). */
function copyExampleObjectToTmp(sourceXmlPath: string, folder: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-goldenb-'));
  const dir = path.join(tmpDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(sourceXmlPath));
  fs.copyFileSync(sourceXmlPath, dest);
  return dest;
}

/**
 * Изолирует блок конкретного элемента (по тегу+uuid) в ПОЛНОМ файле до/после
 * мутации и проверяет, что ВСЁ вне этого блока byte-in-byte идентично, а
 * внутри блока изменились ТОЛЬКО строки между `<Type>`/`</Type>` (включая их
 * собственный отступ — колонка ТЧ на 2 уровня глубже top-level реквизита не
 * должна получить захардкоженный отступ, отличный от отступа `<Type>`).
 * Возвращает оба извлечённых блока для последующей проверки состава свойств.
 */
function assertOnlyTypeBlockChangedInFile(
  before: string,
  after: string,
  tag: string,
  uuid: string,
  label: string
): { beforeBlock: string; afterBlock: string } {
  const blockRe = new RegExp(`<${tag} uuid="${uuid}">[\\s\\S]*?</${tag}>`);
  const match = blockRe.exec(before);
  assert.ok(match, `${label}: блок <${tag} uuid="${uuid}"> не найден в исходном файле`);
  const beforeBlock = match[0];
  const prefix = before.slice(0, match.index);
  const suffix = before.slice(match.index + beforeBlock.length);

  assert.ok(after.startsWith(prefix), `${label}: содержимое ДО целевого поля изменилось`);
  assert.ok(after.endsWith(suffix), `${label}: содержимое ПОСЛЕ целевого поля изменилось`);
  const afterBlock = after.slice(prefix.length, after.length - suffix.length);

  const beforeLines = beforeBlock.split('\n');
  const afterLines = afterBlock.split('\n');
  const bOpen = beforeLines.findIndex((line) => line.trim() === '<Type>');
  const bClose = beforeLines.findIndex((line, i) => i > bOpen && line.trim() === '</Type>');
  const aOpen = afterLines.findIndex((line) => line.trim() === '<Type>');
  const aClose = afterLines.findIndex((line, i) => i > aOpen && line.trim() === '</Type>');
  assert.ok(bOpen >= 0 && bClose > bOpen, `${label}: не найден <Type> в исходном блоке`);
  assert.ok(aOpen >= 0 && aClose > aOpen, `${label}: не найден <Type> в изменённом блоке`);

  assert.deepStrictEqual(
    afterLines.slice(0, aOpen + 1),
    beforeLines.slice(0, bOpen + 1),
    `${label}: строки ДО и включая <Type> изменились`
  );
  assert.deepStrictEqual(
    afterLines.slice(aClose),
    beforeLines.slice(bClose),
    `${label}: строки С </Type> и далее изменились`
  );

  // Отступ содержимого <Type> — по фактическому отступу самой открывающей
  // строки, а не захардкоженное значение: у колонки ТЧ (глубже на 2 уровня)
  // это единственный способ не получить неверный отступ.
  const openIndent = /^[ \t]*/.exec(afterLines[aOpen])?.[0] ?? '';
  for (let i = aOpen + 1; i < aClose; i += 1) {
    assert.ok(
      afterLines[i].startsWith(`${openIndent}\t`),
      `${label}: строка внутри <Type> имеет неверный отступ: ${JSON.stringify(afterLines[i])}`
    );
  }
  const closeIndent = /^[ \t]*/.exec(afterLines[aClose])?.[0] ?? '';
  assert.strictEqual(closeIndent, openIndent, `${label}: </Type> должен быть на одном уровне отступа с <Type>`);

  return { beforeBlock, afterBlock };
}

function writeMinimalCatalogWithColumn(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-guard-'));
  const dir = path.join(root, 'Catalogs');
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, 'Тест.xml');
  fs.writeFileSync(xmlPath, [
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
    '\t<Catalog uuid="70000000-0000-0000-0000-000000000000">',
    '\t\t<Properties>',
    '\t\t\t<Name>Тест</Name>',
    '\t\t</Properties>',
    '\t\t<ChildObjects>',
    '\t\t\t<TabularSection uuid="70000000-0000-0000-0000-000000000001">',
    '\t\t\t\t<Properties>',
    '\t\t\t\t\t<Name>ТЧ</Name>',
    '\t\t\t\t</Properties>',
    '\t\t\t\t<ChildObjects>',
    '\t\t\t\t\t<Attribute uuid="70000000-0000-0000-0000-000000000002">',
    '\t\t\t\t\t\t<Properties>',
    '\t\t\t\t\t\t\t<Name>Кол</Name>',
    '\t\t\t\t\t\t\t<Type>',
    '\t\t\t\t\t\t\t\t<v8:Type>xs:string</v8:Type>',
    '\t\t\t\t\t\t\t</Type>',
    '\t\t\t\t\t\t</Properties>',
    '\t\t\t\t\t</Attribute>',
    '\t\t\t\t</ChildObjects>',
    '\t\t\t</TabularSection>',
    '\t\t</ChildObjects>',
    '\t</Catalog>',
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

function writeRootTypeTargetXml(targetKind: 'SessionParameter' | 'DefinedType'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-roottype-'));
  const folder = targetKind === 'SessionParameter' ? 'SessionParameters' : 'DefinedTypes';
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  const xmlPath = path.join(dir, 'Параметр.xml');
  fs.writeFileSync(xmlPath, [
    '<MetaDataObject xmlns:v8="http://v8.1c.ru/8.1/data/core" version="2.21">',
    `\t<${targetKind} uuid="80000000-0000-0000-0000-000000000000">`,
    '\t\t<Properties>',
    '\t\t\t<Name>Параметр</Name>',
    '\t\t\t<Comment/>',
    '\t\t\t<Type>',
    '\t\t\t\t<v8:Type>xs:boolean</v8:Type>',
    '\t\t\t</Type>',
    '\t\t</Properties>',
    `\t</${targetKind}>`,
    '</MetaDataObject>',
  ].join('\n'), 'utf-8');
  return xmlPath;
}

/** Свежий корневой объект вида `kind` для проверки состава по владельцу в add-пути. */
function makeRootObjectForOwnerRulesTest(kind: MetaKind): { configRoot: string; ownerXml: string } {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-ownerrules-'));
  fs.writeFileSync(
    path.join(configRoot, 'Configuration.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<MetaDataObject version="2.21">\n\t<Configuration>\n\t\t<Properties>\n\t\t\t<Name>Тест</Name>\n\t\t\t<Synonym/>\n\t\t</Properties>\n\t\t<ChildObjects/>\n\t</Configuration>\n</MetaDataObject>',
    'utf-8'
  );
  const result = new MetadataXmlCreator().addRootObject({ configRoot, kind, name: 'Р' });
  assert.strictEqual(result.success, true, result.errors.join('; '));
  return { configRoot, ownerXml: path.join(configRoot, getMetaFolder(kind) ?? '', 'Р.xml') };
}
