import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { extractSimpleTag, writeTextFilePreservingBomAndEol } from './XmlUtils';

export interface CreateConfigurationOptions {
  readonly name: string;
  readonly synonym?: string;
  readonly outputDir: string;
  readonly version?: string;
  readonly vendor?: string;
  readonly compatibilityMode?: string;
}

export interface CreateExtensionOptions extends CreateConfigurationOptions {
  readonly namePrefix?: string;
  readonly purpose?: 'Patch' | 'Customization' | 'AddOn';
  readonly configPath?: string;
  readonly noRole?: boolean;
}

export interface ScaffoldResult {
  readonly rootPath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

const XMLNS = 'xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:app="http://v8.1c.ru/8.2/managed-application/core" xmlns:cfg="http://v8.1c.ru/8.1/data/enterprise/current-config" xmlns:cmi="http://v8.1c.ru/8.2/managed-application/cmi" xmlns:ent="http://v8.1c.ru/8.1/data/enterprise" xmlns:lf="http://v8.1c.ru/8.2/managed-application/logform" xmlns:style="http://v8.1c.ru/8.1/data/ui/style" xmlns:sys="http://v8.1c.ru/8.1/data/ui/fonts/system" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:web="http://v8.1c.ru/8.1/data/ui/colors/web" xmlns:win="http://v8.1c.ru/8.1/data/ui/colors/windows" xmlns:xen="http://v8.1c.ru/8.3/xcf/enums" xmlns:xpr="http://v8.1c.ru/8.3/xcf/predef" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

const CONFIG_CLASS_IDS = [
  '9cd510cd-abfc-11d4-9434-004095e12fc7',
  '9fcd25a0-4822-11d4-9414-008048da11f9',
  'e3687481-0a87-462c-a166-9f34594f9bba',
  '9de14907-ec23-4a07-96f0-85521cb6b53b',
  '51f2d5d8-ea4d-4064-8892-82951750031e',
  'e68182ea-4237-4383-967f-90c1e3370bc7',
  'fb282519-d103-4dd3-bc12-cb271d631dfc',
];

const MOBILE_FUNCTIONALITIES: readonly [string, boolean][] = [
  ['Biometrics', true], ['Location', false], ['BackgroundLocation', false],
  ['BluetoothPrinters', false], ['WiFiPrinters', false], ['Contacts', false],
  ['Calendars', false], ['PushNotifications', false], ['LocalNotifications', false],
  ['InAppPurchases', false], ['PersonalComputerFileExchange', false], ['Ads', false],
  ['NumberDialing', false], ['CallProcessing', false], ['CallLog', false],
  ['AutoSendSMS', false], ['ReceiveSMS', false], ['SMSLog', false],
  ['Camera', false], ['Microphone', false], ['MusicLibrary', false],
  ['PictureAndVideoLibraries', false], ['AudioPlaybackAndVibration', false],
  ['BackgroundAudioPlaybackAndVibration', false], ['InstallPackages', false],
  ['OSBackup', true], ['ApplicationUsageStatistics', false],
  ['BarcodeScanning', false], ['BackgroundAudioRecording', false],
  ['AllFilesAccess', false], ['Videoconferences', false], ['NFC', false],
  ['DocumentScanning', false], ['SpeechToText', false], ['Geofences', false],
  ['IncomingShareRequests', false], ['AllIncomingShareRequestsTypesProcessing', false],
];

/**
 * Создаёт минимальные исходники CF/CFE, заменяя cf-init.py и cfe-init.py.
 * Сервис не зависит от VS Code и пишет только внутри указанного каталога.
 */
export class ConfigurationScaffoldService {
  createConfiguration(options: CreateConfigurationOptions): ScaffoldResult {
    validateName(options.name);
    const rootPath = path.resolve(options.outputDir);
    ensureNoConfiguration(rootPath);

    const compatibilityMode = options.compatibilityMode ?? 'Version8_3_24';
    const changedFiles = writeScaffoldFiles(rootPath, {
      configurationXml: buildConfigurationXml({
        name: options.name,
        synonym: options.synonym ?? options.name,
        version: options.version ?? '',
        vendor: options.vendor ?? '',
        compatibilityMode,
      }),
      languageXml: buildLanguageXml({ adopted: false }),
    });

    return { rootPath, changedFiles, warnings: [] };
  }

  createExtension(options: CreateExtensionOptions): ScaffoldResult {
    validateName(options.name);
    const rootPath = path.resolve(options.outputDir);
    ensureNoConfiguration(rootPath);

    const base = options.configPath ? readBaseConfiguration(options.configPath) : {
      languageUuid: '00000000-0000-0000-0000-000000000000',
      compatibilityMode: options.compatibilityMode ?? 'Version8_3_24',
      interfaceCompatibilityMode: 'TaxiEnableVersion8_2',
      warnings: ['Language ExtendedConfigurationObject установлен в нули. Передайте configPath, чтобы взять UUID языка из основной конфигурации.'],
    };
    const namePrefix = options.namePrefix ?? `${options.name}_`;
    const roleName = `${namePrefix}ОсновнаяРоль`;
    const changedFiles = writeScaffoldFiles(rootPath, {
      configurationXml: buildExtensionXml({
        name: options.name,
        synonym: options.synonym ?? options.name,
        namePrefix,
        purpose: options.purpose ?? 'Customization',
        version: options.version ?? '',
        vendor: options.vendor ?? '',
        compatibilityMode: options.compatibilityMode ?? base.compatibilityMode,
        interfaceCompatibilityMode: base.interfaceCompatibilityMode,
        roleName: options.noRole === true ? undefined : roleName,
      }),
      languageXml: buildLanguageXml({ adopted: true, extendedConfigurationObject: base.languageUuid }),
    });

    if (options.noRole !== true) {
      const roleXmlPath = path.join(rootPath, 'Roles', `${roleName}.xml`);
      fs.mkdirSync(path.dirname(roleXmlPath), { recursive: true });
      writeNewFile(roleXmlPath, buildRoleXml(roleName));
      changedFiles.push(roleXmlPath);
    }

    return { rootPath, changedFiles, warnings: base.warnings };
  }
}

function writeScaffoldFiles(rootPath: string, files: { configurationXml: string; languageXml: string }): string[] {
  fs.mkdirSync(path.join(rootPath, 'Languages'), { recursive: true });
  const configXmlPath = path.join(rootPath, 'Configuration.xml');
  const languageXmlPath = path.join(rootPath, 'Languages', 'Русский.xml');
  writeNewFile(configXmlPath, files.configurationXml);
  writeNewFile(languageXmlPath, files.languageXml);
  return [configXmlPath, languageXmlPath];
}

function ensureNoConfiguration(rootPath: string): void {
  const configXmlPath = path.join(rootPath, 'Configuration.xml');
  if (fs.existsSync(configXmlPath)) {
    throw new Error(`Configuration.xml уже существует: ${configXmlPath}`);
  }
}

function writeNewFile(filePath: string, content: string): void {
  writeTextFilePreservingBomAndEol(filePath, '', content);
}

function buildConfigurationXml(options: {
  readonly name: string;
  readonly synonym: string;
  readonly version: string;
  readonly vendor: string;
  readonly compatibilityMode: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject ${XMLNS} version="2.17">
\t<Configuration uuid="${newUuid()}">
\t\t<InternalInfo>
${buildContainedObjects()}\t\t</InternalInfo>
\t\t<Properties>
\t\t\t<Name>${escapeXml(options.name)}</Name>
\t\t\t<Synonym>${buildLocalizedItems(options.synonym)}</Synonym>
\t\t\t<Comment/>
\t\t\t<NamePrefix/>
\t\t\t<ConfigurationExtensionCompatibilityMode>${options.compatibilityMode}</ConfigurationExtensionCompatibilityMode>
\t\t\t<DefaultRunMode>ManagedApplication</DefaultRunMode>
\t\t\t<UsePurposes>
\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>
\t\t\t</UsePurposes>
\t\t\t<ScriptVariant>Russian</ScriptVariant>
\t\t\t<DefaultRoles/>
\t\t\t<Vendor>${escapeXml(options.vendor)}</Vendor>
\t\t\t<Version>${escapeXml(options.version)}</Version>
\t\t\t<UpdateCatalogAddress/>
\t\t\t<IncludeHelpInContents>false</IncludeHelpInContents>
\t\t\t<UseManagedFormInOrdinaryApplication>false</UseManagedFormInOrdinaryApplication>
\t\t\t<UseOrdinaryFormInManagedApplication>false</UseOrdinaryFormInManagedApplication>
\t\t\t<RequiredMobileApplicationPermissions/>
\t\t\t<UsedMobileApplicationFunctionalities>${buildMobileFunctionalities()}
\t\t\t</UsedMobileApplicationFunctionalities>
\t\t\t<MainClientApplicationWindowMode>Normal</MainClientApplicationWindowMode>
\t\t\t<DefaultLanguage>Language.Русский</DefaultLanguage>
\t\t\t<DataLockControlMode>Managed</DataLockControlMode>
\t\t\t<ObjectAutonumerationMode>NotAutoFree</ObjectAutonumerationMode>
\t\t\t<ModalityUseMode>DontUse</ModalityUseMode>
\t\t\t<SynchronousPlatformExtensionAndAddInCallUseMode>DontUse</SynchronousPlatformExtensionAndAddInCallUseMode>
\t\t\t<InterfaceCompatibilityMode>TaxiEnableVersion8_2</InterfaceCompatibilityMode>
\t\t\t<DatabaseTablespacesUseMode>DontUse</DatabaseTablespacesUseMode>
\t\t\t<CompatibilityMode>${options.compatibilityMode}</CompatibilityMode>
\t\t\t<DefaultConstantsForm/>
\t\t</Properties>
\t\t<ChildObjects>
\t\t\t<Language>Русский</Language>
\t\t</ChildObjects>
\t</Configuration>
</MetaDataObject>`;
}

function buildExtensionXml(options: {
  readonly name: string;
  readonly synonym: string;
  readonly namePrefix: string;
  readonly purpose: 'Patch' | 'Customization' | 'AddOn';
  readonly version: string;
  readonly vendor: string;
  readonly compatibilityMode: string;
  readonly interfaceCompatibilityMode: string;
  readonly roleName?: string;
}): string {
  const defaultRoleXml = options.roleName
    ? `\r\n\t\t\t\t<xr:Item xsi:type="xr:MDObjectRef">Role.${escapeXml(options.roleName)}</xr:Item>\r\n\t\t\t`
    : '';
  const roleChildXml = options.roleName ? `\r\n\t\t\t<Role>${escapeXml(options.roleName)}</Role>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject ${XMLNS} version="2.17">
\t<Configuration uuid="${newUuid()}">
\t\t<InternalInfo>
${buildContainedObjects()}\t\t</InternalInfo>
\t\t<Properties>
\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>
\t\t\t<Name>${escapeXml(options.name)}</Name>
\t\t\t<Synonym>${buildLocalizedItems(options.synonym)}</Synonym>
\t\t\t<Comment/>
\t\t\t<ConfigurationExtensionPurpose>${options.purpose}</ConfigurationExtensionPurpose>
\t\t\t<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>
\t\t\t<NamePrefix>${escapeXml(options.namePrefix)}</NamePrefix>
\t\t\t<ConfigurationExtensionCompatibilityMode>${options.compatibilityMode}</ConfigurationExtensionCompatibilityMode>
\t\t\t<DefaultRunMode>ManagedApplication</DefaultRunMode>
\t\t\t<UsePurposes>
\t\t\t\t<v8:Value xsi:type="app:ApplicationUsePurpose">PlatformApplication</v8:Value>
\t\t\t</UsePurposes>
\t\t\t<ScriptVariant>Russian</ScriptVariant>
\t\t\t<DefaultRoles>${defaultRoleXml}</DefaultRoles>
\t\t\t<Vendor>${escapeXml(options.vendor)}</Vendor>
\t\t\t<Version>${escapeXml(options.version)}</Version>
\t\t\t<DefaultLanguage>Language.Русский</DefaultLanguage>
\t\t\t<InterfaceCompatibilityMode>${options.interfaceCompatibilityMode}</InterfaceCompatibilityMode>
\t\t</Properties>
\t\t<ChildObjects>
\t\t\t<Language>Русский</Language>${roleChildXml}
\t\t</ChildObjects>
\t</Configuration>
</MetaDataObject>`;
}

function buildLanguageXml(options: { readonly adopted: boolean; readonly extendedConfigurationObject?: string }): string {
  const adoptedProperties = options.adopted
    ? `\t\t\t<ObjectBelonging>Adopted</ObjectBelonging>
\t\t\t<Comment/>
\t\t\t<ExtendedConfigurationObject>${options.extendedConfigurationObject ?? '00000000-0000-0000-0000-000000000000'}</ExtendedConfigurationObject>`
    : `\t\t\t<Synonym>${buildLocalizedItems('Русский')}</Synonym>
\t\t\t<Comment/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject ${XMLNS} version="2.17">
\t<Language uuid="${newUuid()}">
\t\t${options.adopted ? '<InternalInfo/>\n\t\t' : ''}<Properties>
\t\t\t<Name>Русский</Name>
${adoptedProperties}
\t\t\t<LanguageCode>ru</LanguageCode>
\t\t</Properties>
\t</Language>
</MetaDataObject>`;
}

function buildRoleXml(roleName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject ${XMLNS} version="2.17">
\t<Role uuid="${newUuid()}">
\t\t<Properties>
\t\t\t<Name>${escapeXml(roleName)}</Name>
\t\t\t<Synonym/>
\t\t\t<Comment/>
\t\t</Properties>
\t</Role>
</MetaDataObject>`;
}

function buildContainedObjects(): string {
  return CONFIG_CLASS_IDS.map((classId) => `\t\t\t<xr:ContainedObject>
\t\t\t\t<xr:ClassId>${classId}</xr:ClassId>
\t\t\t\t<xr:ObjectId>${newUuid()}</xr:ObjectId>
\t\t\t</xr:ContainedObject>
`).join('');
}

function buildLocalizedItems(value: string): string {
  return value
    ? `\r\n\t\t\t\t<v8:item>\r\n\t\t\t\t\t<v8:lang>ru</v8:lang>\r\n\t\t\t\t\t<v8:content>${escapeXml(value)}</v8:content>\r\n\t\t\t\t</v8:item>\r\n\t\t\t`
    : '';
}

function buildMobileFunctionalities(): string {
  return MOBILE_FUNCTIONALITIES
    .map(([name, use]) => `\r\n\t\t\t\t<app:functionality>\r\n\t\t\t\t\t<app:functionality>${name}</app:functionality>\r\n\t\t\t\t\t<app:use>${use ? 'true' : 'false'}</app:use>\r\n\t\t\t\t</app:functionality>`)
    .join('');
}

function readBaseConfiguration(configPath: string): {
  readonly languageUuid: string;
  readonly compatibilityMode: string;
  readonly interfaceCompatibilityMode: string;
  readonly warnings: string[];
} {
  const resolved = resolveConfigXmlPath(configPath);
  const configRoot = path.dirname(resolved);
  const configXml = fs.readFileSync(resolved, 'utf-8');
  const languageXmlPath = path.join(configRoot, 'Languages', 'Русский.xml');
  const warnings: string[] = [];
  let languageUuid = '00000000-0000-0000-0000-000000000000';
  if (fs.existsSync(languageXmlPath)) {
    const languageXml = fs.readFileSync(languageXmlPath, 'utf-8');
    languageUuid = /<Language\b[^>]*uuid="([^"]+)"/.exec(languageXml)?.[1] ?? languageUuid;
  } else {
    warnings.push(`Не найден язык основной конфигурации: ${languageXmlPath}`);
  }

  return {
    languageUuid,
    compatibilityMode: extractSimpleTag(configXml, 'CompatibilityMode') ?? 'Version8_3_24',
    interfaceCompatibilityMode: extractSimpleTag(configXml, 'InterfaceCompatibilityMode') ?? 'TaxiEnableVersion8_2',
    warnings,
  };
}

function resolveConfigXmlPath(configPath: string): string {
  const resolved = path.resolve(configPath);
  const candidate = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'Configuration.xml')
    : resolved;
  if (!fs.existsSync(candidate)) {
    throw new Error(`Configuration.xml не найден: ${configPath}`);
  }
  return candidate;
}

function validateName(value: string): void {
  if (!/^[\p{L}_][\p{L}\p{Nd}_]*$/u.test(value)) {
    throw new Error('Имя должно начинаться с буквы или подчёркивания и содержать только буквы, цифры и подчёркивание.');
  }
}

function newUuid(): string {
  return crypto.randomUUID();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
