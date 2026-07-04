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
