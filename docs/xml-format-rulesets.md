# Правила генерации XML по версиям формата (format rulesets)

## Зачем

При каждом релизе 1С версия формата сериализации (`version="2.18"`, `"2.21"`, …)
может меняться: добавляются свойства, namespace'ы, меняется состав
`xr:GeneratedType`. Чтобы расширение всегда генерировало корректный XML, правила
генерации **параметризуются версией формата**, а не зашиты в один безымянный
вариант.

Зависимость — **только от атрибута `version`** в файлах выгрузки, не от версии
платформы (8.3.x). Внутри одной выгрузки версия формата едина (задаётся в
`Configuration.xml`).

## Из чего состоит каркас

`src/infra/xml/format/`:

- **`FormatRuleset.ts`** — интерфейс (стратегия) одного поколения правил
  генерации. Владеет формат-чувствительными частями и корня, и вложенных
  элементов:
  - `metaDataObjectXmlns` — пространства имён корневого `<MetaDataObject>`;
  - `generatedTypes` — `xr:GeneratedType` по виду метаданных;
  - `buildDefaultTypeBlock()` — блок `<Type>` нового типизированного поля;
  - `buildTypedFieldProperties()` — свойства типизированного поля по его типу;
  - `tabularSectionGeneratedTypes()` — `xr:GeneratedType` табличной части/строки.
- **`baselineRuleset.ts`** — `BASELINE_RULESET`: формат 2.21 (namespace с
  `xmlns:pal`, у отчёта есть `<AuxiliaryVariantForm/>`). К нему привязаны
  версии 2.18–2.19 и 2.21.
- **`format2_20Ruleset.ts`** — `FORMAT_2_20_RULESET`: дельта от baseline для
  формата 2.20. Отличия, снятые с эталона `example/2.20`: у корневого
  `<MetaDataObject>` нет `xmlns:pal`; у отчёта нет `<AuxiliaryVariantForm/>`.
  Всё остальное (SA-блоки, generatedTypes) наследуется из baseline.
- **`standardAttributes.ts`** — константные блоки `<StandardAttributes>` и
  `<StandardTabularSections>` по виду метаданных (сгенерированы из эталонных
  выгрузок). Блоки не зависят от имени объекта; по составу/порядку реквизитов
  едины для 2.20 и 2.21. Ruleset публикует их через `standardAttributes(kind)`
  и `standardTabularSections(kind)`; `MetadataXmlCreator` вставляет в
  `<Properties>` на фиксированную позицию вида. Виды без стандартных реквизитов
  у свежего объекта (перечисление, журнал документов, независимый
  непериодический регистр сведений) блок не получают.
- **`formatRegistry.ts`** — карта «версия → ruleset», резолвер и version-guard:
  - `resolveFormatRuleset(version)` — ruleset по версии;
  - для **незнакомой** версии берётся самый свежий известный ruleset и
    эмитится предупреждение (работу не блокируем, но честно сигналим);
  - `registerFormatRuleset(ruleset, versions)` — регистрация нового поколения;
  - `setFormatRulesetWarning(handler)` — подключение приёмника предупреждений
    (Container может направить в output-канал расширения).

Генерация (`MetadataXmlCreator`) резолвит ruleset по версии выгрузки и берёт
из него namespace и таблицу типов. Версию по-прежнему определяет
`resolveConfigFormatVersion` / `resolveObjectFormatVersion`.

## Регламент: вышла новая версия формата

1. Получить **донорскую выгрузку** на новой версии (по одному объекту каждого
   типа, объекты минимальные).
2. Сравнить с ближайшим известным форматом (diff):
   - **отличий в генерации нет** → добавить версию в `SUPPORTED_FORMATS`
     (`formatRegistry.ts`) на существующий ruleset. Кода не меняем.
   - **есть отличия** → завести новый ruleset как дельту от baseline
     (`{ ...BASELINE_RULESET, ...изменившиеся поля }`), зарегистрировать через
     `registerFormatRuleset(newRuleset, ['2.xx', …])`.
3. Закрепить golden-тестом: генерация объекта на новой версии == соответствующий
   файл из донора (байт-в-байт, с учётом BOM/EOL).

## Что ещё предстоит перенести в ruleset (точки расширения)

Эти части генерации пока остаются с собственными литералами в
`MetadataXmlCreator` и переносятся в ruleset по мере появления доноров, которым
они реально нужны:

- namespace вспомогательных файлов (формы, роли, макеты, схемы СКД, графсхемы);
- наборы и порядок свойств корневых объектов по видам метаданных
  (`buildRootProperties` / `buildCatalogProperties` в
  `infra/xml/creator/rootObjectBuilders.ts`, см. также
  [architecture.md](./architecture.md#декомпозиция-god-классов-на-тонкий-фасад--подмодули)
  про раскладку `MetadataXmlCreator` на фасад + `infra/xml/creator/*`; свойства —
  `PropertySchema`). Позиция вставки
  `<StandardAttributes>`/`<StandardTabularSections>` пока задаётся прямо
  в `build*`-функциях (сами блоки уже принадлежат ruleset);
- `<StandardAttributes>` табличных частей (реквизит `LineNumber`) при добавлении
  ТЧ через `addChildElement` — на данный момент не генерируется.

Примечание: таблицы свойств типизированных полей (`TypedFieldPropertyRules`)
физически остаются общим модулем — они используются и путём правки
(`normalizeTypedFieldPropertiesAfterTypeChange`), и UI. Ruleset владеет
*привязкой* к ним (`buildTypedFieldProperties`), поэтому будущий формат может их
переопределить, не дублируя таблицы.

## Состав свойств типизированного поля по виду владельца

Свойства внутри `<Properties>` типизированного поля (`Attribute`/`AddressingAttribute`/
`Dimension`/`Resource`/`Column`/`Constant`/`CommonAttribute`) задаются ДВУМЯ независимыми осями:
типом поля (`<Type>`) и видом объекта-владельца (корень XML-файла). Ось версии формата (rulesets
выше) здесь ни при чём — состав от версии 2.20/2.21 не зависит, снят с обоих эталонов одинаковым.

Модуль: `infra/xml/TypedFieldPropertyRules.ts`.

### Ось типа: `getAllowedPropertyKeys` по `FieldTypeCategory`

Категория типа (`string`/`number`/`boolean`/`date`/`reference`/`defined`/`binary`/`other`/`none`,
определяется `detectFieldTypeCategories` по `<Type>`/`<TypeSet>`) добавляет свой блок ключей
(`STRING_ORDER`, `NUMBER_ORDER`, `DATE_ORDER`, `BOOLEAN_ORDER`, `CHOICE_ORDER`). Общий блок
(`COMMON_ORDER`) есть у поля любого типа.

### Ось владельца: `REGISTER_FIELD_RULES` по `RegisterOwnerKind`

Для измерения/ресурса регистра состав дополнительно зависит от вида регистра-владельца
(`InformationRegister`/`AccumulationRegister`/`AccountingRegister`) — платформа отклоняет загрузку
при свойстве, не входящем в состав объекта метаданных (`UseInTotals` у измерения ИР, `Balance` у
ресурса ИР), и при недопустимом значении перечисления. Таблица `REGISTER_FIELD_RULES` снята с
эталонов `example/2.20` + `example/2.21`:

- `dimensionRole`/`resourceRole` — ролевые свойства, добавляемые ТОЛЬКО измерению/ресурсу этого
  вида регистра (`Master`/`MainFilter` у ИР, `UseInTotals` у РН, `Balance`/`AccountingFlag`/
  `ExtDimensionAccountingFlag` у РБ);
- `dropKeys`/`resourceDropKeys` — общие свойства, которых у полей ЭТОГО регистра нет вовсе
  (`FillFromFillingValue`/`FillValue`/`DataHistory` — нет у РН и РБ, есть только у ИР).

Правило распространяется и на РЕКВИЗИТ регистра, не только на измерение/ресурс (в эталонах у
реквизита РН и РБ, в отличие от реквизита РС, нет `FillFromFillingValue`/`FillValue`/`DataHistory`).
Набор видов-владельцев, для которых применяются правила регистра (`REGISTER_OWNER_KINDS`),
выводится из `META_TYPES` по `childTags.includes('Dimension')`, а не перечисляется параллельным
списком — новый вид-владелец с измерением подхватывается автоматически той же одной записью в
`META_TYPES`, без правки этого модуля.

Регистр, правила которого с эталона ещё не сняты (на момент написания — регистр расчёта),
обрабатывается КОНСЕРВАТИВНО (`isUnmodelledRegisterField` + `restrictOwnerDependentKeysToExisting`):
свойства из `OWNER_DEPENDENT_KEYS` (зависящие от владельца — `FillFromFillingValue`, `UseInTotals`,
`Balance`, `AccountingFlag` и т.п.) только СОХРАНЯЮТСЯ из исходного XML, никогда не дописываются
«по умолчанию». Смена типа поля такого объекта не может ни добавить, ни выбросить ролевое свойство
непроверенного вида.

Вид владельца определяется по корню файла (`ObjectXmlReader.detectRootObjectKind` →
`updateTypeInObject` → `normalizeTypedFieldPropertiesAfterTypeChange`), не по тегу самого поля — у
измерения/ресурса/реквизита свой собственный тег, здесь нужен именно владелец.

### `CONTROLLED_PROPERTY_KEYS` — единая надпоследовательность

Порядок свойств в `<Properties>` — не произвольный, а единая последовательность,
подпоследовательностями которой являются ВСЕ наблюдаемые в эталонах порядки (реквизит справочника,
адресный реквизит задачи, измерение/ресурс ИР/РН/РБ): схема 1С — `xs:sequence`, платформа
чувствительна к порядку. Ролевые свойства владельца (`Master`/`MainFilter`/`Balance`/
`AccountingFlag`) идут ДО `Indexing`/`FullTextSearch`/`DataHistory`, `UseInTotals`/
`TypeReductionMode` — после них. Новый управляемый ключ добавляется в эту таблицу на позицию,
соответствующую его месту в схеме; `sortByControlledOrder` расставляет уже собранные блоки
автоматически по этому порядку.

`RoundingMode` в таблице есть, но никогда не генерируется (в эталонах отсутствует у всех
типизированных полей всех видов) — оставлен, чтобы смена типа вычищала его из уже испорченных
файлов. `AccountingFlag`/`ExtDimensionAccountingFlag` — не булевы, а ссылка на признак учёта плана
счетов (`ChartOfAccounts.X.AccountingFlag.Y`); по умолчанию генерируются пустым самозакрытым тегом,
а не значением `false`.

### Панель свойств — тот же конвейер, что и запись

`ui/tree/nodeBuilders/structuredMetaChildHandler.ts` прокидывает `node.metaContext.rootMetaKind`
(вид объекта-владельца) в `PropertyBuilder.buildTypedFieldProperties` →
`getTypedFieldPropertyKeyOrder` → `TypedFieldPropertyRules.getDisplayTypedFieldPropertyKeys`. Это
принципиально: панель рисует недостающие ключи РЕДАКТИРУЕМЫМИ и дописывает их в XML при первом же
вводе значения — набор обязан совпадать с составом, который пишет
`normalizeTypedFieldPropertiesAfterTypeChange`, иначе один клик в панели вернул бы в файл
`UseInTotals` измерению регистра сведений. Когда владелец неизвестен (панель открыта вне контекста
объекта — применимо только к константе/общему реквизиту), ролевые свойства объединяются по всем
описанным видам регистров, чтобы не спрятать уже записанное платформой свойство.

### Валидация: код `property-not-allowed`

`MetadataValidationService` (через `findDisallowedTypedFieldProperties` из
`TypedFieldPropertyRules.ts`) проверяет обратную задачу — что в уже существующем XML нет свойства,
не входящего в состав вида объекта-владельца. Код ошибки — `property-not-allowed`, severity
`error` (платформа отказывается грузить конфигурацию с таким XML). Важно: проверяется
принадлежность ВИДУ, а не соответствие текущему `<Type>` — платформа выгружает типозависимые
свойства (`PasswordMode`, `MinValue`, …) у поля ЛЮБОГО типа, и сужение состава по типу — политика
генератора (`getAllowedPropertyKeys`/`getTypedFieldPropertyKeys`), а не ограничение формата;
проверка по `<Type>` давала бы ложные срабатывания. Проверено на 22 328 реальных XML — 0 ложных
срабатываний.

Колонка ТЧ (`Column`) в этой проверке не наследует запрет генератора на свойства заполнения:
`getMemberPropertyKeys` явно допускает `FillFromFillingValue`/`FillValue` у колонки, потому что в
реальной выгрузке они встречаются у колонки ТЧ обработки/отчёта (наследуются от владельца ТЧ), хотя
сам генератор их по-прежнему не пишет.

MCP-инструменты, использующие этот конвейер, отдельной поддержки владельца не содержат — она уже в
`infra/xml/`: `v8vscedit_set_type` (запись, через `ObjectXmlReader.updateTypeInObject`) и
`v8vscedit_validate_metadata` (чтение, через `MetadataValidationService`) учитывают вид владельца
автоматически. Канон путей этих инструментов — [mcp-paths.md](./mcp-paths.md).
