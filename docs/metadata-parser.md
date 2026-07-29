# Парсинг XML конфигурации 1С

## Назначение

Разбор XML-выгрузок конфигурации и расширений 1С для построения дерева метаданных. Реализован через регулярные выражения и depth-aware алгоритм без DOM-парсера.

Файл: `src/ConfigParser.ts`

Связанный функционал — [metadata-navigator.md](./metadata-navigator.md).

## Почему регулярные выражения, а не DOM

XML-выгрузка 1С имеет строго предсказуемую структуру — каждый тип объекта генерируется платформой по фиксированной схеме. DOM-парсер добавил бы зависимость и накладные расходы без практической пользы.

Единственное исключение — depth-aware алгоритм для `<ChildObjects>`, где возможна вложенность одноимённых тегов (например, `<TabularSection>` содержит `<ChildObjects>` с `<Attribute>`).

## parseConfigXml(xmlPath) → ConfigInfo

Читает `Configuration.xml` и извлекает:

```typescript
interface ConfigInfo {
  name: string;                          // имя конфигурации
  synonym: string;                       // синоним (отображаемое название)
  version: string;                       // версия
  namePrefix: string;                    // префикс расширения (например "ев_")
  childObjects: Map<string, string[]>;   // тип → список имён объектов
}
```

### Структура Configuration.xml

```xml
<MetaDataObject>
  <Configuration name="EVOLC">
    <Properties>
      <Synonym><v8:item><v8:content>ЕВОЛ С</v8:content></v8:item></Synonym>
      <Version>1.0.0.1</Version>
      <NamePrefix>ев_</NamePrefix>
    </Properties>
    <ChildObjects>
      <Catalog>Контрагенты</Catalog>
      <Catalog>ев_Покупатели</Catalog>
      <Document>ев_Заказ</Document>
      ...
    </ChildObjects>
  </Configuration>
</MetaDataObject>
```

`childObjects` заполняется простой регуляркой по тегам в блоке `<ChildObjects>`:
```
/<(\w+)>([^<]+)<\/\1>/g
```

## parseObjectXml(xmlPath) → ObjectInfo | null

Читает XML отдельного объекта и извлекает его дочерние элементы:

```typescript
interface ObjectInfo {
  tag: string;       // тип объекта (Catalog, Document, ...)
  name: string;      // имя объекта
  synonym: string;   // синоним
  children: Array<{
    tag: string;
    name: string;
    synonym: string;
    columns?: Array<{ tag: string; name: string; synonym: string }>;
  }>;
}
```

### Depth-aware разбор ChildObjects

Проблема: `<ChildObjects>` встречается как на уровне объекта (содержит реквизиты, ТЧ, формы), так и внутри `<TabularSection>` (содержит колонки):

```xml
<Catalog>
  <ChildObjects>
    <Attribute>Наименование</Attribute>
    <TabularSection>МояТЧ
      <ChildObjects>              <!-- вложенный ChildObjects -->
        <Attribute>Колонка1</Attribute>
      </ChildObjects>
    </TabularSection>
  </ChildObjects>
</Catalog>
```

`extractNestingAwareBlock(xml, tag)` реализует счётчик вложенности:
- Инкремент при открытии `<tag>`
- Декремент при закрытии `</tag>`
- Возвращает содержимое при depth = 1 (первое вхождение)

Это позволяет корректно разграничить `<ChildObjects>` объекта и `<ChildObjects>` табличных частей.

### Парсинг колонок табличной части

После извлечения блока верхнего `<ChildObjects>` для каждой `<TabularSection>` вызывается `extractNestingAwareBlock` для извлечения её вложенного `<ChildObjects>` — это и есть колонки ТЧ.

## extractSynonym(xml) → string

Извлекает текст синонима из тега:
```xml
<Synonym><v8:item><v8:content>Текст синонима</v8:content></v8:item></Synonym>
```

Паттерн: `/<v8:content>(.*?)<\/v8:content>/`.

## extractSimpleTag(xml, tag) → string

Извлекает значение простого тега: `/<tag>(.*?)<\/tag>/s`.

## resolveObjectXmlPath(configRoot, objectType, objectName) → string | null

Определяет путь к XML-файлу объекта. Поддерживает две структуры выгрузки:

```
Глубокая:  <configRoot>/Catalogs/МойСправочник/МойСправочник.xml
Плоская:   <configRoot>/Catalogs/МойСправочник.xml
```

Маппинг типов на папки — 30 типов объектов: `Catalog → Catalogs`, `Document → Documents`, `CommonModule → CommonModules`, `HTTPService → HTTPServices`, `WebService → WebServices`, `FilterCriterion → FilterCriteria`, и т.д.

Если файл не найден по обоим вариантам — возвращает `null`.

## Второй прецедент контейнерного парсинга: URLTemplate → Method

Актуальный ридер объекта — `src/infra/xml/ObjectXmlReader.ts` (на `fast-xml-parser`
с `preserveOrder`, не regex — в отличие от описания выше, которое относится к
устаревшему `ConfigParser.ts`). У HTTP-сервиса (`HTTPService`) третий уровень
вложенности: `HTTPService → URLTemplate → Method`. `URLTemplate` — контейнер
(свойство `Template`), `Method` — его лист (`HTTPMethod`, `Handler`).

`ObjectXmlReader.parseChildren` обходит `<URLTemplate>` внутри `<ChildObjects>`
объекта через `toUrlTemplateChild` (по образцу `toTabularSectionChild` для ТЧ),
а вложенные `<Method>` — тем же `toMetaChild('Method', …)`, что и колонки ТЧ,
складывая их в `MetaChild.columns` контейнера. Слот `columns` в
`domain/MetaObject.ts` документирован как переиспользуемый под оба прецедента.

Точечное чтение/правка одного метода по имени (без разбора всего объекта)
идёт через nesting-aware функции `infra/xml/XmlUtils.ts`:
`findMethodRangeInUrlTemplate(xml, urlTemplateName, methodName)` и
`extractMethodXmlFromUrlTemplate(objectXml, urlTemplateName, methodName)` —
симметрично `findColumnRangeInTabularSection` для колонок ТЧ. Это необходимо,
потому что в разных `URLTemplate` одного HTTP-сервиса могут быть одноимённые
`Method` (например, `GET`-обработчик с одинаковым именем метода в двух разных
шаблонах) — плоский поиск по имени метода без учёта родителя дал бы неверный
диапазон.

Канон путей (`HTTPСервисы.X.URLШаблон.T.Метод.M`) и состав MCP-инструментов —
в [mcp-paths.md](./mcp-paths.md); построение дерева — в
[metadata-navigator.md](./metadata-navigator.md#контейнерные-дочерние-узлы-тчколонка-и-httpсервисurlшаблонметод).

## Состав свойств типизированного поля

Состав тегов `<Properties>` реквизита/измерения/ресурса/колонки — отдельный вопрос от разбора
структуры: он зависит от вида объекта-владельца (корня XML) и категории типа `<Type>`, а не от
глубины вложенности. Правила, таблицы и точка добавления нового ключа — в
[xml-format-rulesets.md](./xml-format-rulesets.md#состав-свойств-типизированного-поля-по-виду-владельца).
