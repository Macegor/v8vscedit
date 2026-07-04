import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildConfigurationProperties,
  buildPropertyItemsForKeys,
} from '../../ui/views/properties/PropertyBuilder';

// Реальный CFE-Configuration.xml (BOM+CRLF, реальная выгрузка) — используем как
// каркас, подменяя только значение исследуемого known-boolean тега, чтобы не
// городить синтетический XML с нуля и не терять реалистичность остальных тегов.
const CFE_CONFIG_XML_PATH = path.resolve(
  __dirname,
  '../../../example/2.21/src/cfe/EVOLC/Configuration.xml'
);

/**
 * Баг B1 (PropertyBuilder.ts:~2060, buildConfigurationProperties):
 * условие `(BOOLEAN_PROPERTY_TAGS.has(key) || isBooleanScalar(x)) && isBooleanScalar(x)`
 * алгебраически схлопывается в `isBooleanScalar(x)` — вторая половина конъюнкции
 * убивает эффект первой. В результате known-boolean тег (входит в
 * BOOLEAN_PROPERTY_TAGS) со значением НЕ 'true'/'false' (или пустым/self-closing)
 * не распознаётся как boolean и проваливается в scalar-string ветку.
 *
 * Эталонная реализация — buildPropertyItemsForKeys (~1794): `isKnownBoolean ||
 * isBooleanScalar` — правильное ИЛИ, known-boolean тег ВСЕГДА кладётся как
 * kind:'boolean', а само значение приводится через `(x ?? 'false').trim()
 * .toLowerCase() === 'true'`. Тест проверяет эквивалентность поведения между
 * двумя функциями на одном и том же "битом" входе.
 */
suite('PropertyBuilder — B1: мёртвый терм булева в buildConfigurationProperties', () => {
  test('known-boolean тег KeepMappingToExtendedConfigurationObjectsByIDs с пустым (self-closing) значением должен остаться kind:boolean', () => {
    const originalXml = fs.readFileSync(CFE_CONFIG_XML_PATH, 'utf-8');
    assert.ok(
      originalXml.includes('<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>'),
      'фикстура должна содержать known-boolean тег со значением true — иначе подмена ничего не проверяет'
    );

    // Подменяем нормальное значение 'true' на self-closing тег без значения —
    // такое реально встречается в выгрузках 1С для необязательных булевых свойств
    // конфигурации (Конфигуратор не всегда пишет явное 'false').
    const buggedXml = originalXml.replace(
      '<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>',
      '<KeepMappingToExtendedConfigurationObjectsByIDs/>'
    );

    const props = buildConfigurationProperties(buggedXml);
    const item = props.find((p) => p.key === 'KeepMappingToExtendedConfigurationObjectsByIDs');

    assert.ok(item, 'known-boolean свойство должно попасть в результат (оно есть в byTag через extractTopLevelPropertiesChildren)');
    // КРАСНЫЙ: сейчас (BOOLEAN_PROPERTY_TAGS.has(key) || isBooleanScalar(x)) && isBooleanScalar(x)
    // эквивалентно isBooleanScalar(x); extractSimpleTag на self-closing теге возвращает
    // undefined => isBooleanScalar(undefined) === false => свойство уезжает в enum/string.
    assert.strictEqual(item.kind, 'boolean', 'known-boolean тег с пустым значением должен остаться boolean, а не уехать в enum/string');
    assert.strictEqual(item.value, false, 'отсутствующее значение известного boolean-тега трактуется как false');
  });

  test('эталонная ветка buildPropertyItemsForKeys на тот же вход (доказательство корректной логики isKnownBoolean || isBooleanScalar)', () => {
    // Тот же дефектный тег, но пропущенный через buildPropertyItemsForKeys —
    // функцию с ПРАВИЛЬНОЙ логикой (эталон для сверки поведения).
    const propsInner = '<KeepMappingToExtendedConfigurationObjectsByIDs/>';
    const items = buildPropertyItemsForKeys(propsInner, ['KeepMappingToExtendedConfigurationObjectsByIDs'], {
      showMissingKeys: true,
    });
    const item = items.find((p) => p.key === 'KeepMappingToExtendedConfigurationObjectsByIDs');
    assert.ok(item, 'эталонная функция должна вернуть свойство даже при пустом значении (showMissingKeys)');
    assert.strictEqual(item.kind, 'boolean', 'эталонная реализация корректно распознаёт known-boolean тег независимо от значения');
    assert.strictEqual(item.value, false);
  });

  test('known-boolean тег IncludeHelpInContents со значением, отличным от true/false, тоже должен остаться boolean', () => {
    // Второй independent-ключ на пересечении BOOLEAN_PROPERTY_TAGS и
    // CONFIGURATION_PROPERTY_KEYS — защищает от случая, когда фикс завязан на
    // конкретное имя тега, а не на множество BOOLEAN_PROPERTY_TAGS в целом.
    const originalXml = fs.readFileSync(CFE_CONFIG_XML_PATH, 'utf-8');
    const withIncludeHelp = originalXml.includes('<IncludeHelpInContents>')
      ? originalXml
      : originalXml.replace(
          '<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>',
          '<KeepMappingToExtendedConfigurationObjectsByIDs>true</KeepMappingToExtendedConfigurationObjectsByIDs>\n\t\t\t<IncludeHelpInContents>Неизвестно</IncludeHelpInContents>'
        );
    const buggedXml = withIncludeHelp.replace(
      /<IncludeHelpInContents>[^<]*<\/IncludeHelpInContents>/,
      '<IncludeHelpInContents>Неизвестно</IncludeHelpInContents>'
    );

    const props = buildConfigurationProperties(buggedXml);
    const item = props.find((p) => p.key === 'IncludeHelpInContents');
    assert.ok(item, 'IncludeHelpInContents должен попасть в результат');
    assert.strictEqual(item.kind, 'boolean', 'известный boolean-тег с "мусорным" значением должен остаться boolean согласно эталонной логике');
  });
});
