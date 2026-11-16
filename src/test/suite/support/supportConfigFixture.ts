/**
 * Синтетическая конфигурация с четырьмя справочниками во всех режимах поддержки
 * (None/Locked/Editable/Removed) — для интеграционных тестов дерева и панели.
 * Выгрузка строится реальным `MetadataXmlCreator` (плоская раскладка), bin — хелпером.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MetadataXmlCreator } from '../../../infra/xml/MetadataXmlCreator';
import { SupportMode } from '../../../infra/support/SupportInfoService';
import { writeBin } from './parentConfigurationsBin';

export const SUPPORT_CATALOGS: readonly { name: string; mode: SupportMode; code?: number; suffix: string; dto: string }[] = [
  { name: 'Собственный', mode: SupportMode.None, suffix: '-supportNone', dto: 'none' },
  { name: 'Запрещённый', mode: SupportMode.Locked, code: 0, suffix: '-supportLocked', dto: 'locked' },
  { name: 'Разрешённый', mode: SupportMode.Editable, code: 1, suffix: '-supportEditable', dto: 'editable' },
  { name: 'СнятыйСПоддержки', mode: SupportMode.Removed, code: 2, suffix: '-supportRemoved', dto: 'removed' },
];

const CONFIG_XML = `<?xml version="1.0" encoding="utf-8"?>
<MetaDataObject>
  <Configuration>
    <Properties>
      <Name>ТестоваяКонфигурация</Name>
      <Synonym/>
    </Properties>
    <ChildObjects/>
  </Configuration>
</MetaDataObject>`;

function readUuid(xmlPath: string): string {
  const m = /uuid="([0-9a-f-]{36})"/i.exec(fs.readFileSync(xmlPath, 'utf8'));
  if (!m) {
    throw new Error(`в ${xmlPath} нет uuid`);
  }
  return m[1].toLowerCase();
}

/** Создаёт конфигурацию в `configRoot`; bin пишется только при `withBin`. */
export function buildSupportConfig(configRoot: string, withBin: boolean): void {
  fs.mkdirSync(configRoot, { recursive: true });
  fs.writeFileSync(path.join(configRoot, 'Configuration.xml'), CONFIG_XML, 'utf8');
  const creator = new MetadataXmlCreator();
  const records: { code: number; uuid: string }[] = [];
  for (const c of SUPPORT_CATALOGS) {
    const result = creator.addRootObject({ configRoot, kind: 'Catalog', name: c.name });
    if (!result.success) {
      throw new Error(`не удалось создать справочник ${c.name}: ${result.errors.join('; ')}`);
    }
    if (c.code !== undefined) {
      records.push({ code: c.code, uuid: readUuid(path.join(configRoot, 'Catalogs', `${c.name}.xml`)) });
    }
  }
  if (withBin) {
    writeBin(configRoot, [{ name: 'Поставщик', records }]);
  }
}
