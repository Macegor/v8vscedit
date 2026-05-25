import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildConfigurationProperties,
  buildEffectivePropertyItemsForKeys,
} from '../../ui/views/properties/PropertyBuilder';
import { formatXmlPropertyDisplay } from '../../ui/views/properties/PropertyPresentationRegistry';
import type { EnumPropertyValue, MultiEnumPropertyValue } from '../../ui/views/properties/_types';

const EXAMPLE_CFE_ROOT = path.resolve(__dirname, '../../../example/src/cfe');
const EXAMPLE_CF = path.resolve(__dirname, '../../../example/src/cf');

function findFirstCfeRoot(): string | null {
  if (!fs.existsSync(EXAMPLE_CFE_ROOT)) {
    return null;
  }
  for (const entry of fs.readdirSync(EXAMPLE_CFE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(EXAMPLE_CFE_ROOT, entry.name);
    if (fs.existsSync(path.join(candidate, 'Configuration.xml'))) {
      return candidate;
    }
  }
  return null;
}

suite('Properties — Configuration.xml', () => {
  test('Показывает свойства основной конфигурации с русскими подписями и enum-значениями', () => {
    const xml = fs.readFileSync(path.join(EXAMPLE_CF, 'Configuration.xml'), 'utf-8');
    const props = buildConfigurationProperties(xml);

    const compatibility = props.find((item) => item.key === 'CompatibilityMode')
      ?? props.find((item) => item.key === 'ConfigurationExtensionCompatibilityMode');
    assert.ok(compatibility, 'CompatibilityMode/ConfigurationExtensionCompatibilityMode не найден');
    assert.strictEqual(compatibility.kind, 'enum');

    // Не привязываем тест к конкретной версии платформы: сравниваем фактическое
    // значение со списком допустимых, чтобы тест работал на любой валидной выгрузке.
    const enumValue = compatibility.value as EnumPropertyValue;
    assert.ok(enumValue.current.length > 0, 'current версия совместимости пуста');
    assert.ok(enumValue.current.startsWith('Version8_'), `Неожиданное значение версии: ${enumValue.current}`);
    assert.ok(
      enumValue.allowedValues.some((item) => item.value === enumValue.current),
      `Текущее значение ${enumValue.current} не входит в список допустимых`
    );

    const usePurposes = props.find((item) => item.key === 'UsePurposes');
    assert.ok(usePurposes, 'UsePurposes не найден');
    assert.strictEqual(usePurposes.title, 'Назначение использования');
    assert.strictEqual(usePurposes.kind, 'multiEnum');
  });

  test('Показывает свойства расширения и список ролей по умолчанию', function () {
    const cfeRoot = findFirstCfeRoot();
    if (!cfeRoot) {
      // Тест применим только при наличии CFE-расширения в example/src/cfe.
      this.skip();
    }
    const xml = fs.readFileSync(path.join(cfeRoot, 'Configuration.xml'), 'utf-8');
    const props = buildConfigurationProperties(xml);

    const purpose = props.find((item) => item.key === 'ConfigurationExtensionPurpose');
    assert.ok(purpose, 'ConfigurationExtensionPurpose не найден');
    assert.strictEqual(purpose.title, 'Назначение расширения');
    assert.strictEqual(purpose.kind, 'enum');

    // DefaultRoles может отсутствовать у расширения — проверяем только структуру, если есть.
    const roles = props.find((item) => item.key === 'DefaultRoles');
    if (roles) {
      assert.strictEqual(roles.kind, 'multiEnum');
      const rolesValue = roles.value as MultiEnumPropertyValue;
      assert.ok(Array.isArray(rolesValue.selected));
      assert.ok(Array.isArray(rolesValue.allowedValues));
    }
  });

  test('Сравнивает унаследованные локализованные строки и форматирует мобильные возможности', () => {
    const inherited = `
<Name>Тест</Name>
<Synonym>
  <v8:item>
    <v8:lang>ru</v8:lang>
    <v8:content>Тест</v8:content>
  </v8:item>
</Synonym>`;
    const local = `
<Name>Тест</Name>
<Synonym>
  <v8:item>
    <v8:lang>ru</v8:lang>
    <v8:content>Тест</v8:content>
  </v8:item>
</Synonym>`;

    const props = buildEffectivePropertyItemsForKeys(local, inherited, ['Name', 'Synonym']);
    const synonym = props.find((item) => item.key === 'Synonym');
    assert.strictEqual(synonym?.source, 'inherited');

    assert.strictEqual(
      formatXmlPropertyDisplay('UsedMobileApplicationFunctionalities', `
        <app:functionality>
          <app:functionality>UnknownMobileFeature</app:functionality>
          <app:use>true</app:use>
        </app:functionality>
      `),
      'Unknown мобильного Feature: Да'
    );
  });
});
