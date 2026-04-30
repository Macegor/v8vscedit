import { META_TYPES } from '../../../domain/MetaTypes';

/** Описание представления XML-ссылки на объект метаданных. */
interface MetadataReferencePresentation {
  xmlType: string;
  ruType: string;
}

const MANUAL_REFERENCE_PRESENTATIONS: Readonly<Record<string, string>> = {
  CatalogRef: 'СправочникиСсылка',
  DocumentRef: 'ДокументыСсылка',
  EnumRef: 'ПеречисленияСсылка',
  ChartOfAccountsRef: 'ПланыСчетовСсылка',
  ChartOfCharacteristicTypesRef: 'ПланыВидовХарактеристикСсылка',
  ChartOfCalculationTypesRef: 'ПланыВидовРасчетаСсылка',
  ExchangePlanRef: 'ПланыОбменаСсылка',
  BusinessProcessRef: 'БизнесПроцессыСсылка',
  TaskRef: 'ЗадачиСсылка',
};

const PROPERTY_TITLE_TOKENS: Readonly<Record<string, string>> = {
  Additional: 'дополнительные',
  Address: 'адрес',
  After: 'после',
  Align: 'выравнивание',
  Any: 'любой',
  Allowed: 'разрешённые',
  Arrow: 'стрелка',
  Auto: 'автоматически',
  Application: 'приложение',
  Appearance: 'оформление',
  Authentication: 'аутентификации',
  Autonumeration: 'автонумерация',
  Auxiliary: 'дополнительная',
  Back: 'фон',
  Before: 'перед',
  Begin: 'начало',
  Brief: 'краткая',
  Caption: 'заголовок',
  Category: 'категория',
  Center: 'по центру',
  Change: 'изменений',
  Check: 'проверка',
  Choice: 'выбора',
  Client: 'клиентского',
  Code: 'код',
  Color: 'цвет',
  Collaboration: 'системы взаимодействия',
  Command: 'команда',
  Common: 'общий',
  Compatibility: 'совместимости',
  Configuration: 'конфигурации',
  Connection: 'соединение',
  Constants: 'констант',
  Content: 'содержимое',
  Correspondence: 'корреспонденция',
  Copyright: 'авторские права',
  Create: 'создание',
  Data: 'данных',
  Database: 'базы данных',
  Default: 'основная',
  Delete: 'удалить',
  Dependence: 'зависимость',
  Detailed: 'подробная',
  Dictionaries: 'словари',
  Differences: 'различий',
  Direction: 'направление',
  Dont: 'не',
  Dynamic: 'динамического',
  Enable: 'разрешить',
  End: 'конец',
  Event: 'событие',
  Execute: 'выполнить',
  External: 'внешнего',
  False: 'нет',
  Filter: 'фильтр',
  Form: 'форма',
  Forms: 'формы',
  Folder: 'группа',
  Folders: 'группы',
  For: 'для',
  FullText: 'полнотекстового',
  Global: 'глобальный',
  Group: 'группа',
  Handler: 'обработчик',
  Hierarchical: 'иерархический',
  Hierarchy: 'иерархия',
  Horizontal: 'горизонтальное',
  Hyperlink: 'гиперссылка',
  History: 'истории',
  Include: 'включать',
  Incoming: 'входящих',
  Independent: 'независимый',
  Independently: 'независимо',
  Information: 'информации',
  In: 'в',
  Interface: 'интерфейса',
  Item: 'элемент',
  Items: 'элементы',
  Language: 'язык',
  Left: 'слева',
  Level: 'уровень',
  Limit: 'ограничение',
  Line: 'линия',
  Main: 'основной',
  Lock: 'блокировки',
  Managed: 'управляемом',
  Master: 'ведущий',
  Migration: 'перехода',
  Mobile: 'мобильного',
  Mode: 'режим',
  Multiple: 'множественный',
  Name: 'имя',
  Navigation: 'навигация',
  None: 'нет',
  Nillable: 'допускает null',
  Number: 'номер',
  Object: 'объект',
  Objects: 'объектам',
  On: 'при',
  Open: 'открытия',
  Ordinary: 'обычном',
  Order: 'порядок',
  Parameter: 'параметр',
  Periodicity: 'периодичность',
  Picture: 'картинка',
  Post: 'проведение',
  Posting: 'проведение',
  Prefix: 'префикс',
  Predefined: 'предопределённый',
  Privileged: 'привилегированный',
  Procedure: 'процедура',
  Purposes: 'назначения',
  Quick: 'быстрый',
  Real: 'оперативное',
  Recorder: 'регистратор',
  Records: 'записи',
  Register: 'регистр',
  Reuse: 'повторное использование',
  Report: 'отчёта',
  Reports: 'отчётов',
  Request: 'запроса',
  Required: 'требуемые',
  Return: 'возврат',
  Restriction: 'ограничения',
  Roles: 'роли',
  Run: 'запуска',
  Script: 'встроенного языка',
  Search: 'поиска',
  Separated: 'разделённых',
  Separation: 'разделение',
  Server: 'сервер',
  Sessions: 'сеансы',
  Settings: 'настроек',
  Shape: 'фигура',
  Share: 'обмена',
  Short: 'краткий',
  Simultaneously: 'одновременно',
  Single: 'одиночный',
  Size: 'размер',
  Storage: 'хранилище',
  Storages: 'хранилища',
  Style: 'стиль',
  Synchronous: 'синхронных',
  Tablespaces: 'табличных пространств',
  Task: 'задача',
  Template: 'шаблон',
  Text: 'текст',
  Theme: 'тема',
  Time: 'время',
  Totals: 'итоги',
  Transactioned: 'транзакционный',
  Transfer: 'передача',
  Transparent: 'прозрачный',
  True: 'да',
  Type: 'тип',
  URL: 'URL',
  Update: 'обновлений',
  Use: 'использовать',
  Used: 'используемые',
  User: 'пользовательских',
  Users: 'пользователей',
  Variant: 'вариант',
  Vertical: 'вертикальное',
  Version: 'версии',
  Vendor: 'поставщика',
  Window: 'окна',
  Windows: 'окон',
  Write: 'запись',
};

const MOBILE_FUNCTIONALITY_LABELS: Readonly<Record<string, string>> = {
  Ads: 'Реклама',
  AllFilesAccess: 'Доступ ко всем файлам',
  AllIncomingShareRequestsTypesProcessing: 'Обработка всех типов входящих запросов обмена',
  ApplicationUsageStatistics: 'Статистика использования приложения',
  AudioPlaybackAndVibration: 'Воспроизведение аудио и вибрация',
  AutoSendSMS: 'Автоматическая отправка SMS',
  BackgroundAudioPlaybackAndVibration: 'Фоновое воспроизведение аудио и вибрация',
  BackgroundAudioRecording: 'Фоновая запись аудио',
  BackgroundLocation: 'Фоновое местоположение',
  BarcodeScanning: 'Сканирование штрихкодов',
  Biometrics: 'Биометрия',
  BluetoothPrinters: 'Bluetooth-принтеры',
  Calendar: 'Календарь',
  Calendars: 'Календари',
  CallLog: 'Журнал вызовов',
  CallProcessing: 'Обработка вызовов',
  Camera: 'Камера',
  Contacts: 'Контакты',
  DocumentScanning: 'Сканирование документов',
  Geofences: 'Геозоны',
  InAppPurchases: 'Встроенные покупки',
  IncomingShareRequests: 'Входящие запросы обмена',
  InstallPackages: 'Установка пакетов',
  LocalNotifications: 'Локальные уведомления',
  Location: 'Местоположение',
  Microphone: 'Микрофон',
  MusicLibrary: 'Музыкальная библиотека',
  NFC: 'NFC',
  NumberDialing: 'Набор номера',
  OSBackup: 'Резервное копирование ОС',
  PersonalComputerFileExchange: 'Обмен файлами с компьютером',
  PictureAndVideoLibraries: 'Библиотеки изображений и видео',
  PushNotifications: 'Push-уведомления',
  ReceiveSMS: 'Получение SMS',
  SMSLog: 'Журнал SMS',
  SpeechToText: 'Распознавание речи',
  TextToSpeech: 'Синтез речи',
  Videoconferences: 'Видеоконференции',
  WiFiPrinters: 'Wi-Fi-принтеры',
};

const referencePresentationByXmlType = buildReferencePresentationMap();
const referenceXmlTypeByPresentation = new Map(
  Array.from(referencePresentationByXmlType.values()).map((item) => [item.ruType, item.xmlType])
);

/** Возвращает русское имя свойства. Для неизвестного ключа строит имя из PascalCase-токенов. */
export function getPropertyTitle(key: string, titles: Readonly<Record<string, string>>): string {
  return titles[key] ?? titleFromPascalCase(key);
}

/** Показывает строковое значение свойства в русской форме без изменения канонического XML. */
export function formatPropertyDisplayValue(value: string): string {
  return formatKnownScalarValue(formatMetadataReferences(value));
}

/** Русское представление неизвестного enum-значения, если точного словаря ещё нет. */
export function formatEnumDisplayValue(value: string): string {
  const version = /^Version(\d+)$/.exec(value);
  if (version) {
    return `Версия ${version[1].split('').join('.')}`;
  }
  return formatKnownScalarValue(formatMetadataReferences(titleFromPascalCase(value)));
}

/** Преобразует русское представление ссылок обратно в XML-форму перед записью. */
export function toCanonicalPropertyInput(value: string): string {
  const refMatch = /^([^.\s]+)\.(.+)$/.exec(value.trim());
  if (!refMatch) {
    return value;
  }
  const xmlType = referenceXmlTypeByPresentation.get(refMatch[1]);
  return xmlType ? `${xmlType}.${refMatch[2]}` : value;
}

/** Сжимает XML-содержимое свойства в русское человекочитаемое представление. */
export function formatXmlPropertyDisplay(key: string, innerXml: string): string {
  if (key === 'UsedMobileApplicationFunctionalities') {
    return formatMobileFunctionalities(innerXml);
  }

  return formatKnownScalarValue(formatMetadataReferences(innerXml.replace(/\s+/g, ' ').trim()));
}

function buildReferencePresentationMap(): Map<string, MetadataReferencePresentation> {
  const map = new Map<string, MetadataReferencePresentation>();

  for (const def of Object.values(META_TYPES)) {
    if (!def.folder || def.group === 'child') {
      continue;
    }
    map.set(def.kind, {
      xmlType: def.kind,
      ruType: compactTypeLabel(def.pluralLabel),
    });
  }

  for (const [xmlType, ruType] of Object.entries(MANUAL_REFERENCE_PRESENTATIONS)) {
    map.set(xmlType, { xmlType, ruType });
  }

  return map;
}

function compactTypeLabel(label: string): string {
  return label
    .split(/[\s-]+/)
    .filter((part) => part.length > 0)
    .map(capitalizeFirst)
    .join('');
}

function formatMetadataReferences(value: string): string {
  return value.replace(/\b([A-Za-z][A-Za-z0-9]*Ref?|[A-Za-z][A-Za-z0-9]*)\.([A-Za-zА-Яа-яЁё_][\wА-Яа-яЁё]*)/g, (full, type, name) => {
    const presentation = referencePresentationByXmlType.get(type);
    return presentation ? `${presentation.ruType}.${name}` : full;
  });
}

function formatKnownScalarValue(value: string): string {
  if (value === 'true') {
    return 'Да';
  }
  if (value === 'false') {
    return 'Нет';
  }
  return value;
}

function formatMobileFunctionalities(innerXml: string): string {
  const items = Array.from(innerXml.matchAll(
    /<app:functionality>\s*<app:functionality>([^<]+)<\/app:functionality>\s*<app:use>(true|false)<\/app:use>\s*<\/app:functionality>/g
  )).map((match) => {
    const functionality = match[1].trim();
    const use = match[2].trim() === 'true' ? 'Да' : 'Нет';
    return `${MOBILE_FUNCTIONALITY_LABELS[functionality] ?? titleFromPascalCase(functionality)}: ${use}`;
  });

  return items.join('\n');
}

function titleFromPascalCase(key: string): string {
  const words = splitPascalCase(key).map((word) => PROPERTY_TITLE_TOKENS[word] ?? word);
  if (words.length === 0) {
    return key;
  }
  return capitalizeFirst(words.join(' '));
}

function splitPascalCase(value: string): string[] {
  return value
    .replace(/([A-ZА-ЯЁ]+)([A-ZА-ЯЁ][a-zа-яё])/g, '$1 $2')
    .replace(/([a-zа-яё\d])([A-ZА-ЯЁ])/g, '$1 $2')
    .split(/\s+/)
    .filter((item) => item.length > 0);
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toLocaleUpperCase('ru-RU')}${value.slice(1)}`;
}
