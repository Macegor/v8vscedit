/**
 * Описание конфигурации / расширения 1С.
 *
 * Поле `childObjects` — «тип → имена объектов»; ключ совпадает с именем тега
 * внутри `<ChildObjects>` в `Configuration.xml` и с `folder` в `META_TYPES`.
 */
export interface ConfigInfo {
  kind: 'cf' | 'cfe';
  name: string;
  synonym: string;
  version: string;
  /** Префикс имён в расширении (используется для детекции «свой/заимствованный») */
  namePrefix: string;
  childObjects: Map<string, string[]>;
}

/**
 * Запись реестра найденных конфигураций.
 *
 * Содержит только «ссылочные» поля (`rootPath`, `kind`). Полное описание
 * конфигурации (`ConfigInfo`) парсится лениво потребителем и в реестр не
 * складывается — это историческое поведение `ConfigFinder`, на которое
 * опирается `MetadataTreeProvider`, `BslContextService`, тесты.
 */
export interface ConfigEntry {
  /** Абсолютный путь к каталогу, содержащему `Configuration.xml` */
  rootPath: string;
  /** Тип конфигурации */
  kind: 'cf' | 'cfe';
}
