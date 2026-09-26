import type { ChildTag } from '../../../domain/ChildTag';
import type { MetaKind } from '../../../domain/MetaTypes';

/**
 * Тег, которым элемент СЕРИАЛИЗУЕТСЯ внутри `<ChildObjects>`. Шире {@link ChildTag}:
 * помимо тегов, которые расширение умеет создавать, сюда входят теги, которые оно
 * только ЧИТАЕТ, но обязано знать их место в последовательности —
 * `AccountingFlag`/`ExtDimensionAccountingFlag` плана счетов и `Column` журнала
 * документов. Без них новая табличная часть плана счетов встала бы ПОСЛЕ
 * признаков учёта (их ранг был бы неизвестен и они бы игнорировались), а новая
 * форма журнала — перед колонками.
 */
export type SerializedChildTag =
  | ChildTag
  | 'Column'
  | 'AccountingFlag'
  | 'ExtDimensionAccountingFlag';

/**
 * Канон порядка ПРЯМЫХ детей `<ChildObjects>` по виду объекта-владельца.
 *
 * Правило снято ЭМПИРИЧЕСКИ с эталонного корпуса `example/` (обе генерации
 * формата — 2.20 и 2.21, конфигурация и расширение) полным попарным сравнением
 * всех тегов строки, а не выведено из схемы платформы: у `<ChildObjects>` нет
 * доступной в проекте XSD, а наблюдаемый порядок различается по видам
 * (документ ставит форму ДО табличных частей, регистр бухгалтерии — измерения
 * ДО ресурсов). Числа в комментариях — размер выборки корпуса (файлов вида,
 * в которых распознан `<ChildObjects>`), 0 контрпримеров на каждую пару.
 *
 * Ключ — {@link MetaKind}, а не строка: завести правило для владельца мимо
 * `META_TYPES` невозможно типизацией (запрет на параллельные реестры типов).
 * Порядок ЗДЕСЬ — про сериализацию XML и намеренно не совпадает с
 * `META_TYPES[kind].childTags`, который задаёт порядок ГРУПП в дереве (другая ось).
 */
export const CHILD_OBJECTS_ORDER: Partial<Record<MetaKind, readonly SerializedChildTag[]>> = {
  // 754 файла
  Catalog: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 11 файлов
  ChartOfCharacteristicTypes: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 3 файла
  ChartOfCalculationTypes: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 10 файлов
  BusinessProcess: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 26 файлов
  ExchangePlan: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 362 файла
  Report: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 356 файлов
  DataProcessor: ['Attribute', 'TabularSection', 'Form', 'Template', 'Command'],
  // 356 файлов. ЕДИНСТВЕННЫЙ вид, у которого Form идёт ДО TabularSection —
  // это не опечатка, а устойчивое отличие документа по всему корпусу.
  Document: ['Attribute', 'Form', 'TabularSection', 'Template', 'Command'],
  // Тонкая выборка: РОВНО 2 файла корпуса —
  // example/2.20/src/cf/ChartsOfAccounts/Хозрасчетный.xml и
  // example/2.21/src/cf/ChartsOfAccounts/Управленческий.xml (обе генерации
  // формата), согласие полное. Признаки учёта расширение не создаёт, но их
  // место обязано быть известно (см. SerializedChildTag).
  ChartOfAccounts: ['Attribute', 'TabularSection', 'AccountingFlag', 'ExtDimensionAccountingFlag', 'Form', 'Template', 'Command'],
  // Тонкая выборка: РОВНО 2 файла корпуса —
  // example/2.20/src/cf/Tasks/ЗадачаИсполнителя.xml и
  // example/2.21/src/cf/Tasks/ЗадачаИсполнителя.xml (обе генерации формата),
  // согласие полное. Реквизиты адресации идут ПОСЛЕ форм.
  Task: ['Attribute', 'TabularSection', 'Form', 'AddressingAttribute', 'Template', 'Command'],
  // 1155 файлов
  InformationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  // 140 файлов
  AccumulationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  // Тонкая выборка: 1 файл корпуса —
  // example/2.20/src/cf/CalculationRegisters/Начисления.xml. Тег `Recalculation`
  // (перерасчёт) в корпусе не встречается ни разу, поэтому в канон НЕ включён:
  // его место неизвестно, и гадать нельзя — при добавлении перерасчёта правило
  // снимается с нового эталона.
  CalculationRegister: ['Resource', 'Attribute', 'Dimension', 'Form', 'Template', 'Command'],
  // Тонкая выборка: РОВНО 2 файла корпуса —
  // example/2.20/src/cf/AccountingRegisters/Хозрасчетный.xml и
  // example/2.21/src/cf/AccountingRegisters/Управленческий.xml (обе генерации
  // формата), согласие полное. Единственный регистр, у которого Dimension идёт
  // ДО Resource.
  AccountingRegister: ['Dimension', 'Resource', 'Attribute', 'Form', 'Template', 'Command'],
  // 1146 файлов
  Enum: ['EnumValue', 'Form', 'Template', 'Command'],
  // 51 файл
  DocumentJournal: ['Column', 'Form', 'Template', 'Command'],
  // 19 файлов. У HTTP-сервиса единственный вид прямых детей.
  HTTPService: ['URLTemplate'],
  // Контейнерный дочерний вид: у URL-шаблона внутри собственного
  // `<ChildObjects>` единственный вид детей. Ранжирование здесь вырожденное
  // (один тег), строка существует ради инварианта «у вида с непустым
  // childTags есть строка канона».
  URLTemplate: ['Method'],
};

/**
 * Порядок типов в `<ChildObjects>` файла `Configuration.xml` — переехал БЕЗ
 * изменения содержимого из приватного массива `ConfigurationXmlEditor.sortChildObjects`,
 * чтобы оба правила порядка (состав конфигурации и состав объекта) жили в одном
 * модуле. Ключи здесь — имена ТЕГОВ ссылок в Configuration.xml (`<Catalog>Имя</Catalog>`),
 * а не набор детей объекта, поэтому это отдельная константа, а не строка
 * {@link CHILD_OBJECTS_ORDER}.
 */
export const CONFIGURATION_CHILD_ORDER: readonly string[] = [
  'Language', 'Subsystem', 'StyleItem', 'Style', 'CommonPicture', 'SessionParameter', 'Role', 'CommonTemplate',
  'FilterCriterion', 'CommonModule', 'CommonAttribute', 'ExchangePlan', 'XDTOPackage', 'WebService', 'HTTPService',
  'WSReference', 'EventSubscription', 'ScheduledJob', 'SettingsStorage', 'FunctionalOption', 'FunctionalOptionsParameter',
  'DefinedType', 'CommonCommand', 'CommandGroup', 'Constant', 'CommonForm', 'Catalog', 'Document', 'DocumentNumerator',
  'Sequence', 'DocumentJournal', 'Enum', 'Report', 'DataProcessor', 'InformationRegister', 'AccumulationRegister',
  'ChartOfCharacteristicTypes', 'ChartOfAccounts', 'AccountingRegister', 'ChartOfCalculationTypes', 'CalculationRegister',
  'BusinessProcess', 'Task', 'IntegrationService',
];

/** Строка канона владельца или `undefined`, если правило для вида не снято с эталона. */
function orderRow(ownerKind: string | undefined): readonly SerializedChildTag[] | undefined {
  if (ownerKind === undefined) {
    return undefined;
  }
  // Индексация произвольной строкой (вид приходит из XML, а не из типа) — явный
  // Partial-каст вместо `as MetaKind`: последний "лжёт" компилятору, что ключ
  // заведомо валиден, и глушит проверку неизвестного вида.
  return (CHILD_OBJECTS_ORDER as Partial<Record<string, readonly SerializedChildTag[]>>)[ownerKind];
}

/**
 * Ранг тега в каноне владельца: чем меньше, тем раньше элемент стоит в файле.
 * `null` — правило для вида не снято с эталона ЛИБО тег у этого вида не
 * встречается; в обоих случаях вызывающий обязан работать консервативно
 * (дописывать в конец), а не угадывать позицию.
 */
export function childTagRank(ownerKind: string | undefined, tag: string): number | null {
  const index = orderRow(ownerKind)?.indexOf(tag as SerializedChildTag) ?? -1;
  return index === -1 ? null : index;
}

/** Снято ли с эталона правило порядка для этого вида владельца. */
export function hasOrderRule(ownerKind: string | undefined): boolean {
  return orderRow(ownerKind) !== undefined;
}
