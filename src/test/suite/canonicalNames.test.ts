import * as assert from 'assert';
import {
  BASE_TYPES,
  CONFIGURATION_MODULE_FILES,
  DIRECT_CHILD_TAGS,
  MODULE_SEGMENT_MAP,
  REF_KIND_MAP,
  SEGMENTED_CHILD_TAGS,
  canonicalChildPath,
  canonicalConfigurationModulePath,
  canonicalModulePath,
  canonicalRootPath,
  canonicalSubsystemPath,
  getBaseTypesForContext,
  getRefKindsFor,
  parseCanonicalPath,
  type BaseTypeInfo,
  type ParsedCanonicalPath,
} from '../../domain/CanonicalNames';
import { CHILD_TAG_CONFIG, type ChildTag } from '../../domain/ChildTag';
import { META_TYPES, type MetaKind, type MetaTypeDef } from '../../domain/MetaTypes';

/**
 * Тесты для модуля `domain/CanonicalNames`.
 * Используют только чистые функции домена — без vscode/fs/path.
 */
suite('CanonicalNames — round-trip корневых путей', () => {
  test('Все типы с pathSegment строят и парсят корневой путь без потерь', () => {
    const skipKinds = new Set<MetaKind>(['configuration', 'extension', 'Subsystem']);
    let checked = 0;
    for (const [kindRaw, def] of Object.entries(META_TYPES) as readonly [MetaKind, MetaTypeDef][]) {
      if (!def.pathSegment) {continue;}
      if (skipKinds.has(kindRaw)) {continue;}

      const path = canonicalRootPath(kindRaw, 'Тестовый');
      assert.strictEqual(path, `${def.pathSegment}.Тестовый`, `Путь для ${kindRaw}`);

      const parsed = parseCanonicalPath(path);
      assert.strictEqual(parsed.kind === 'root' ? parsed.metaKind : undefined, kindRaw, `metaKind для ${kindRaw}`);
      assert.strictEqual(parsed.kind === 'root' ? parsed.name : undefined, 'Тестовый');
      checked += 1;
    }
    // Минимум 40 корневых типов с pathSegment должны существовать.
    assert.ok(checked >= 40, `Проверено ${String(checked)} типов`);
  });

  test('Конфигурация и Расширение парсятся как псевдо-корни', () => {
    const a = parseCanonicalPath('Конфигурация');
    assert.strictEqual(a.kind, 'configuration');
    const b = parseCanonicalPath('Расширение');
    assert.strictEqual(b.kind, 'extension');
  });

  test('canonicalRootPath для Subsystem делегирует в canonicalSubsystemPath', () => {
    const path = canonicalRootPath('Subsystem', 'Продажи');
    assert.strictEqual(path, 'Подсистема.Продажи');
  });

  test('Конкретные канонические значения корней совпадают со спецификацией', () => {
    assert.strictEqual(canonicalRootPath('Catalog', 'Контрагенты'), 'Справочники.Контрагенты');
    assert.strictEqual(canonicalRootPath('Document', 'РасходТовара'), 'Документы.РасходТовара');
    assert.strictEqual(canonicalRootPath('InformationRegister', 'КурсыВалют'), 'РегистрыСведений.КурсыВалют');
    assert.strictEqual(canonicalRootPath('CommonModule', 'ОбщегоНазначения'), 'ОбщиеМодули.ОбщегоНазначения');
    assert.strictEqual(canonicalRootPath('ChartOfCharacteristicTypes', 'ВидыНоменклатуры'), 'ПланыВидовХарактеристик.ВидыНоменклатуры');
    assert.strictEqual(canonicalRootPath('ChartOfAccounts', 'Основной'), 'ПланыСчетов.Основной');
    assert.strictEqual(canonicalRootPath('ChartOfCalculationTypes', 'ОсновныеНачисления'), 'ПланыВидовРасчета.ОсновныеНачисления');
    assert.strictEqual(canonicalRootPath('CalculationRegister', 'Зарплата'), 'РегистрыРасчета.Зарплата');
  });

  test('canonicalRootPath отвергает имя с точкой и пустое имя', () => {
    assert.throws(() => canonicalRootPath('Catalog', 'Имя.С.Точкой'));
    assert.throws(() => canonicalRootPath('Catalog', ''));
  });
});

suite('CanonicalNames — построение дочерних путей', () => {
  test('Прямой реквизит у справочника — без сегмента-роли', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'Attribute', childName: 'ИНН',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.ИНН');
  });

  test('Прямая табличная часть у справочника — без сегмента-роли', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'TabularSection', childName: 'КонтактныеЛица',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.КонтактныеЛица');
  });

  test('Стандартный реквизит — с явным сегментом', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'StandardAttribute', childName: 'Код',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.СтандартныйРеквизит.Код');
  });

  test('Форма — с явным сегментом', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'Form', childName: 'ФормаСписка',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.Форма.ФормаСписка');
  });

  test('Колонка внутри ТЧ — с сегментом «Реквизит»', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'Attribute', childName: 'ФИО',
      tabularSectionName: 'КонтактныеЛица',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.ТабличнаяЧасть.КонтактныеЛица.Реквизит.ФИО');
  });

  test('Измерение/Ресурс — прямой сегмент у регистра сведений', () => {
    const dim = canonicalChildPath({
      rootKind: 'InformationRegister', rootName: 'КурсыВалют',
      childTag: 'Dimension', childName: 'Валюта',
    });
    assert.strictEqual(dim, 'РегистрыСведений.КурсыВалют.Валюта');

    const res = canonicalChildPath({
      rootKind: 'InformationRegister', rootName: 'КурсыВалют',
      childTag: 'Resource', childName: 'Курс',
    });
    assert.strictEqual(res, 'РегистрыСведений.КурсыВалют.Курс');
  });

  test('Значение перечисления — прямой сегмент', () => {
    const path = canonicalChildPath({
      rootKind: 'Enum', rootName: 'СтатусыЗаказа',
      childTag: 'EnumValue', childName: 'Активен',
    });
    assert.strictEqual(path, 'Перечисления.СтатусыЗаказа.Активен');
  });

  test('Реквизит адресации задачи — с сегментом', () => {
    const path = canonicalChildPath({
      rootKind: 'Task', rootName: 'ВыполнитьПоручение',
      childTag: 'AddressingAttribute', childName: 'Исполнитель',
    });
    assert.strictEqual(path, 'Задачи.ВыполнитьПоручение.РеквизитАдресации.Исполнитель');
  });

  test('Макет — с сегментом', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'Template', childName: 'СчетФактура',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.Макет.СчетФактура');
  });

  test('Команда — с сегментом', () => {
    const path = canonicalChildPath({
      rootKind: 'Catalog', rootName: 'Контрагенты',
      childTag: 'Command', childName: 'Печать',
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.Команда.Печать');
  });

  test('Прямые vs сегментированные таблицы покрывают все ChildTag', () => {
    const all = new Set<ChildTag>([...DIRECT_CHILD_TAGS, ...SEGMENTED_CHILD_TAGS]);
    for (const tag of Object.keys(CHILD_TAG_CONFIG) as ChildTag[]) {
      assert.ok(all.has(tag), `ChildTag ${tag} не покрыт ни одной из таблиц`);
    }
    // Никакого дублирования.
    for (const t of DIRECT_CHILD_TAGS) {
      assert.ok(!SEGMENTED_CHILD_TAGS.includes(t), `ChildTag ${t} оказался в обеих таблицах`);
    }
  });
});

suite('CanonicalNames — модули', () => {
  test('МодульОбъекта и МодульМенеджера справочника', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'Catalog', rootName: 'Контрагенты', slot: 'Object' }),
      'Справочники.Контрагенты.МодульОбъекта',
    );
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'Catalog', rootName: 'Контрагенты', slot: 'Manager' }),
      'Справочники.Контрагенты.МодульМенеджера',
    );
  });

  test('МодульМенеджераЗначения константы', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'Constant', rootName: 'КурсРубля', slot: 'ValueManager' }),
      'Константы.КурсРубля.МодульМенеджераЗначения',
    );
  });

  test('МодульНабораЗаписей регистра сведений', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'InformationRegister', rootName: 'КурсыВалют', slot: 'RecordSet' }),
      'РегистрыСведений.КурсыВалют.МодульНабораЗаписей',
    );
  });

  test('ОбщиеМодули.X — модуль = сам объект (пустой хвост)', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'CommonModule', rootName: 'ОбщегоНазначения', slot: 'CommonModule' }),
      'ОбщиеМодули.ОбщегоНазначения',
    );
  });

  test('МодульФормы общей формы', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'CommonForm', rootName: 'ФормаНастроек', slot: 'CommonForm' }),
      'ОбщиеФормы.ФормаНастроек.МодульФормы',
    );
  });

  test('МодульКоманды общей команды', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'CommonCommand', rootName: 'ГлобальныйПоиск', slot: 'CommonCommand' }),
      'ОбщиеКоманды.ГлобальныйПоиск.МодульКоманды',
    );
  });

  test('Сервисы Web/HTTP — каноничный сегмент МодульМенеджера', () => {
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'WebService', rootName: 'Обмен', slot: 'Service' }),
      'WebСервисы.Обмен.МодульМенеджера',
    );
    assert.strictEqual(
      canonicalModulePath({ rootKind: 'HTTPService', rootName: 'API', slot: 'Service' }),
      'HTTPСервисы.API.МодульМенеджера',
    );
  });

  test('Модуль формы объекта (ChildForm) — требует subPath', () => {
    const path = canonicalModulePath({
      rootKind: 'Catalog', rootName: 'Контрагенты', slot: 'ChildForm',
      subPath: { tag: 'Form', name: 'ФормаЭлемента' },
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.Форма.ФормаЭлемента.МодульФормы');
  });

  test('Модуль команды объекта (ChildCommand) — требует subPath', () => {
    const path = canonicalModulePath({
      rootKind: 'Catalog', rootName: 'Контрагенты', slot: 'ChildCommand',
      subPath: { tag: 'Command', name: 'Печать' },
    });
    assert.strictEqual(path, 'Справочники.Контрагенты.Команда.Печать.МодульКоманды');
  });

  test('ChildForm без subPath — ошибка', () => {
    assert.throws(() => canonicalModulePath({ rootKind: 'Catalog', rootName: 'Контрагенты', slot: 'ChildForm' }));
  });

  test('subPath для обычного слота — ошибка', () => {
    assert.throws(() => canonicalModulePath({
      rootKind: 'Catalog', rootName: 'Контрагенты', slot: 'Object',
      subPath: { tag: 'Form', name: 'X' },
    }));
  });

  test('Модули уровня конфигурации', () => {
    assert.strictEqual(
      canonicalConfigurationModulePath('configuration', 'МодульУправляемогоПриложения'),
      'Конфигурация.МодульУправляемогоПриложения',
    );
    assert.strictEqual(
      canonicalConfigurationModulePath('extension', 'МодульСеанса'),
      'Расширение.МодульСеанса',
    );
  });

  test('MODULE_SEGMENT_MAP содержит все слоты ModuleSlot', () => {
    const slots: readonly (keyof typeof MODULE_SEGMENT_MAP)[] = [
      'Object', 'Manager', 'ValueManager', 'RecordSet', 'Service',
      'CommonModule', 'CommonCommand', 'CommonForm', 'ChildForm', 'ChildCommand',
    ];
    for (const slot of slots) {
      const info = MODULE_SEGMENT_MAP[slot];
      assert.ok(info, `Нет записи для слота ${slot}`);
      assert.ok(info.fileName.endsWith('.bsl'), `Файл слота ${slot} не *.bsl`);
    }
  });

  test('CONFIGURATION_MODULE_FILES соответствует ожиданиям §1.5', () => {
    assert.strictEqual(CONFIGURATION_MODULE_FILES['МодульУправляемогоПриложения'], 'ManagedApplicationModule.bsl');
    assert.strictEqual(CONFIGURATION_MODULE_FILES['МодульСеанса'], 'SessionModule.bsl');
    assert.strictEqual(CONFIGURATION_MODULE_FILES['МодульВнешнегоСоединения'], 'ExternalConnectionModule.bsl');
    assert.strictEqual(CONFIGURATION_MODULE_FILES['МодульОбычногоПриложения'], 'OrdinaryApplicationModule.bsl');
  });
});

suite('CanonicalNames — подсистемы', () => {
  test('canonicalSubsystemPath без удвоения сегмента', () => {
    assert.strictEqual(canonicalSubsystemPath(['Продажи']), 'Подсистема.Продажи');
    assert.strictEqual(canonicalSubsystemPath(['Продажи', 'Розница']), 'Подсистема.Продажи.Розница');
    assert.strictEqual(
      canonicalSubsystemPath(['Продажи', 'Розница', 'Возвраты']),
      'Подсистема.Продажи.Розница.Возвраты',
    );
  });

  test('parseCanonicalPath возвращает массив имён', () => {
    const parsed = parseCanonicalPath('Подсистема.Продажи.Розница.Возвраты');
    assert.deepStrictEqual(
      parsed.kind === 'subsystem' ? parsed.names : undefined,
      ['Продажи', 'Розница', 'Возвраты'],
    );
  });

  test('Пустой список имён подсистем — ошибка', () => {
    assert.throws(() => canonicalSubsystemPath([]));
  });

  test('Голый сегмент Подсистема без имени — ошибка парсинга', () => {
    assert.throws(() => parseCanonicalPath('Подсистема'));
  });
});

suite('CanonicalNames — parseCanonicalPath: отбивка неканонических форм', () => {
  test('Английский корень Catalog.X — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Catalog.Контрагенты'));
  });

  test('Английский множественный Catalogs.X — ошибка (только русский канон)', () => {
    assert.throws(() => parseCanonicalPath('Catalogs.Контрагенты'));
  });

  test('Единственное число Справочник.X — ошибка (нужно мн.ч.)', () => {
    assert.throws(() => parseCanonicalPath('Справочник.Контрагенты'));
  });

  test('Пустой путь — ошибка', () => {
    assert.throws(() => parseCanonicalPath(''));
  });

  test('Путь с пустыми сегментами — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Справочники..Контрагенты'));
  });

  test('Корень без имени объекта — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Справочники'));
  });

  test('Лишний модуль уровня конфигурации — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Конфигурация.НеизвестныйМодуль'));
  });

  test('Лишние сегменты после Конфигурация.<модуль> — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Конфигурация.МодульСеанса.Что-то'));
  });

  test('Неизвестный сегмент-роль после имени объекта — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Справочники.Контрагенты.НеизвестнаяРоль.Что-то'));
  });

  test('Внутри ТЧ ожидается только сегмент «Реквизит»', () => {
    assert.throws(() => parseCanonicalPath('Справочники.Контрагенты.ТабличнаяЧасть.КонтактныеЛица.Форма.ФИО'));
  });

  test('Чужой модуль после Форма.X — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Справочники.Контрагенты.Форма.ФормаСписка.МодульКоманды'));
  });

  test('Неподдерживаемая структура пути — ошибка', () => {
    assert.throws(() => parseCanonicalPath('Справочники.Контрагенты.ТабличнаяЧасть.КонтактныеЛица.Реквизит.ФИО.Лишнее'));
  });
});

suite('CanonicalNames — parseCanonicalPath: успешные ветви', () => {
  test('Прямой модуль объекта', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.МодульОбъекта');
    assert.strictEqual(parsed.kind === 'module' ? parsed.rootKind : undefined, 'Catalog');
    assert.strictEqual(parsed.kind === 'module' ? parsed.rootName : undefined, 'Контрагенты');
    assert.strictEqual(parsed.kind === 'module' ? parsed.slot : undefined, 'Object');
    assert.strictEqual(parsed.kind === 'module' ? parsed.subPath : 'absent', undefined);
  });

  test('Прямой реквизит распознаётся как child (childTag по умолчанию)', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.ИНН');
    assert.strictEqual(parsed.kind === 'child' ? parsed.rootKind : undefined, 'Catalog');
    assert.strictEqual(parsed.kind === 'child' ? parsed.rootName : undefined, 'Контрагенты');
    assert.strictEqual(parsed.kind === 'child' ? parsed.childName : undefined, 'ИНН');
  });

  test('Сегментированный дочерний элемент — Форма', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.Форма.ФормаСписка');
    assert.strictEqual(parsed.kind === 'child' ? parsed.childTag : undefined, 'Form');
    assert.strictEqual(parsed.kind === 'child' ? parsed.childName : undefined, 'ФормаСписка');
  });

  test('Колонка ТЧ', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.ТабличнаяЧасть.КонтактныеЛица.Реквизит.ФИО');
    assert.strictEqual(parsed.kind === 'child' ? parsed.childTag : undefined, 'Attribute');
    assert.strictEqual(parsed.kind === 'child' ? parsed.tabularSectionName : undefined, 'КонтактныеЛица');
    assert.strictEqual(parsed.kind === 'child' ? parsed.childName : undefined, 'ФИО');
  });

  test('Модуль формы объекта', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.Форма.ФормаЭлемента.МодульФормы');
    assert.strictEqual(parsed.kind === 'module' ? parsed.slot : undefined, 'ChildForm');
    assert.deepStrictEqual(
      parsed.kind === 'module' ? parsed.subPath : undefined,
      { tag: 'Form', name: 'ФормаЭлемента' },
    );
  });

  test('Модуль команды объекта', () => {
    const parsed = parseCanonicalPath('Справочники.Контрагенты.Команда.Печать.МодульКоманды');
    assert.strictEqual(parsed.kind === 'module' ? parsed.slot : undefined, 'ChildCommand');
    assert.deepStrictEqual(
      parsed.kind === 'module' ? parsed.subPath : undefined,
      { tag: 'Command', name: 'Печать' },
    );
  });

  test('Модуль уровня конфигурации', () => {
    const parsed: ParsedCanonicalPath = parseCanonicalPath('Конфигурация.МодульУправляемогоПриложения');
    assert.strictEqual(parsed.kind === 'configurationModule' ? parsed.root : undefined, 'configuration');
    assert.strictEqual(
      parsed.kind === 'configurationModule' ? parsed.segment : undefined,
      'МодульУправляемогоПриложения',
    );
  });
});

suite('CanonicalNames — базовые типы и производные', () => {
  test('Все 20 базовых типов присутствуют', () => {
    assert.strictEqual(BASE_TYPES.length, 20);
    const russian = new Set(BASE_TYPES.map((t) => t.russian));
    for (const expected of [
      'Строка', 'Число', 'Булево', 'Дата', 'ДатаВремя', 'ХранилищеЗначения',
      'УникальныйИдентификатор', 'ДвоичныеДанные', 'Тип', 'ОписаниеТипов',
      'СписокЗначений', 'ТаблицаЗначений', 'ДеревоЗначений', 'Массив',
      'ФиксированныйМассив', 'Структура', 'ФиксированнаяСтруктура',
      'ТабличныйДокумент', 'Картинка', 'ФорматированнаяСтрока',
    ]) {
      assert.ok(russian.has(expected), `Нет базового типа ${expected}`);
    }
  });

  test('getBaseTypesForContext исключает form-only типы для metadataAttribute', () => {
    const meta = getBaseTypesForContext('metadataAttribute');
    const names = new Set(meta.map((t) => t.russian));
    // Допустимы в обоих контекстах
    assert.ok(names.has('Строка'));
    assert.ok(names.has('УникальныйИдентификатор'));
    assert.ok(names.has('Картинка'));
    // Form-only типы исключены
    assert.ok(!names.has('Тип'));
    assert.ok(!names.has('ОписаниеТипов'));
    assert.ok(!names.has('СписокЗначений'));
    assert.ok(!names.has('ТаблицаЗначений'));
    assert.ok(!names.has('ДеревоЗначений'));
    assert.ok(!names.has('Массив'));
    assert.ok(!names.has('ФиксированныйМассив'));
    assert.ok(!names.has('Структура'));
    assert.ok(!names.has('ФиксированнаяСтруктура'));
    assert.ok(!names.has('ТабличныйДокумент'));
    assert.ok(!names.has('ФорматированнаяСтрока'));
  });

  test('getBaseTypesForContext для formAttribute содержит все 20', () => {
    const forms = getBaseTypesForContext('formAttribute');
    assert.strictEqual(forms.length, 20);
  });

  test('REF_KIND_MAP содержит ожидаемые группы', () => {
    const cat = getRefKindsFor('Catalog');
    assert.strictEqual(cat.length, 5);
    const suffixes = new Set(cat.map((r) => r.suffix));
    for (const s of ['Ссылка', 'Объект', 'Менеджер', 'Выборка', 'Список']) {
      assert.ok(suffixes.has(s), `Нет суффикса ${s} у Catalog`);
    }
    // Регистр сведений — 6 видов
    assert.strictEqual(getRefKindsFor('InformationRegister').length, 6);
    // Регистр расчёта — 6 + Перерасчет = 7
    assert.strictEqual(getRefKindsFor('CalculationRegister').length, 7);
    // Бизнес-процесс — 3 + ТочкаМаршрутаСсылка = 4
    assert.strictEqual(getRefKindsFor('BusinessProcess').length, 4);
    // Константа — 2
    assert.strictEqual(getRefKindsFor('Constant').length, 2);
    // ОпределяемыйТип — 1
    assert.strictEqual(getRefKindsFor('DefinedType').length, 1);
  });

  test('Английские канонические идентификаторы соответствуют §2.2', () => {
    const find = (kind: MetaKind, suffix: string) => REF_KIND_MAP.find((r) => r.metaKind === kind && r.suffix === suffix);
    assert.strictEqual(find('Catalog', 'Ссылка')?.englishCanonical, 'CatalogRef');
    assert.strictEqual(find('InformationRegister', 'НаборЗаписей')?.englishCanonical, 'InformationRegisterRecordSet');
    assert.strictEqual(find('CalculationRegister', 'Перерасчет')?.englishCanonical, 'CalculationRegisterRecalculation');
    assert.strictEqual(find('BusinessProcess', 'ТочкаМаршрутаСсылка')?.englishCanonical, 'BusinessProcessRoutePointRef');
  });

  test('BASE_TYPES — XML-токены примитивов соответствуют §2.1', () => {
    const map = new Map<string, BaseTypeInfo>(BASE_TYPES.map((t) => [t.russian, t]));
    assert.strictEqual(map.get('Строка')?.xmlPrimitive, 'xs:string');
    assert.strictEqual(map.get('Число')?.xmlPrimitive, 'xs:decimal');
    assert.strictEqual(map.get('Булево')?.xmlPrimitive, 'xs:boolean');
    assert.strictEqual(map.get('Дата')?.xmlPrimitive, 'xs:dateTime');
    assert.strictEqual(map.get('ХранилищеЗначения')?.xmlPrimitive, undefined);
    assert.strictEqual(map.get('ДвоичныеДанные')?.xmlPrimitive, 'xs:base64Binary');
    // УникальныйИдентификатор пока без xmlPrimitive (см. TODO в исходнике).
    assert.strictEqual(map.get('УникальныйИдентификатор')?.xmlPrimitive, undefined);
  });
});

suite('CanonicalNames — MetaTypes/ChildTag расширены полями канона', () => {
  test('Все нужные MetaKind с коллекцией имеют pathSegment и englishKind', () => {
    const requiredRoots: MetaKind[] = [
      'Catalog', 'Document', 'InformationRegister', 'AccumulationRegister',
      'AccountingRegister', 'CalculationRegister', 'Enum', 'Report', 'DataProcessor',
      'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'ChartOfCalculationTypes',
      'CommonModule', 'CommonForm', 'CommonCommand', 'CommonTemplate', 'CommonPicture',
      'Constant', 'Role', 'Subsystem', 'BusinessProcess', 'Task',
      'ExchangePlan', 'DocumentJournal', 'WebService', 'HTTPService', 'WSReference',
      'XDTOPackage', 'EventSubscription', 'ScheduledJob', 'SessionParameter',
      'CommonAttribute', 'FilterCriterion', 'FunctionalOption',
      'FunctionalOptionsParameter', 'DefinedType', 'SettingsStorage',
      'StyleItem', 'Style', 'Language', 'ExternalDataSource',
      'IntegrationService', 'CommandGroup', 'Sequence', 'DocumentNumerator',
    ];
    for (const k of requiredRoots) {
      const def = META_TYPES[k];
      assert.ok(def.pathSegment, `${k}: нет pathSegment`);
      assert.ok(def.englishKind, `${k}: нет englishKind`);
    }
  });

  test('Дочерние MetaKind не получают pathSegment', () => {
    const childKinds: MetaKind[] = [
      'Attribute', 'StandardAttribute', 'AddressingAttribute', 'TabularSection',
      'Column', 'Form', 'Command', 'Template', 'Dimension', 'Resource', 'EnumValue',
    ];
    for (const k of childKinds) {
      assert.strictEqual(META_TYPES[k].pathSegment, undefined, `${k}: pathSegment должен отсутствовать`);
    }
  });

  test('CHILD_TAG_CONFIG.pathSegment проставлен для всех тегов и совпадает со спецификацией', () => {
    const expected: Record<ChildTag, string> = {
      StandardAttribute: 'СтандартныйРеквизит',
      Attribute: 'Реквизит',
      AddressingAttribute: 'РеквизитАдресации',
      TabularSection: 'ТабличнаяЧасть',
      Form: 'Форма',
      Command: 'Команда',
      Template: 'Макет',
      Dimension: 'Измерение',
      Resource: 'Ресурс',
      EnumValue: 'ЗначениеПеречисления',
      URLTemplate: 'URLШаблон',
      Method: 'Метод',
    };
    for (const tag of Object.keys(expected) as ChildTag[]) {
      assert.strictEqual(CHILD_TAG_CONFIG[tag].pathSegment, expected[tag], `pathSegment для ${tag}`);
    }
  });
});
