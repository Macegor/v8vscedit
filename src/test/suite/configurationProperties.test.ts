import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildConfigurationProperties } from '../../ui/views/properties/PropertyBuilder';
import { EnumPropertyValue, MultiEnumPropertyValue } from '../../ui/views/properties/_types';

const EXAMPLE_CFE = path.resolve(__dirname, '../../../../example/cfe/EVOLC');
const EXAMPLE_CF = path.resolve(__dirname, '../../../../example/cf');

suite('Properties — Configuration.xml', () => {
  test('Показывает свойства основной конфигурации с русскими подписями и enum-значениями', () => {
    const xml = fs.readFileSync(path.join(EXAMPLE_CF, 'Configuration.xml'), 'utf-8');
    const props = buildConfigurationProperties(xml);

    const compatibility = props.find((item) => item.key === 'CompatibilityMode');
    assert.ok(compatibility, 'CompatibilityMode не найден');
    assert.strictEqual(compatibility.title, 'Режим совместимости');
    assert.strictEqual(compatibility.kind, 'enum');

    const enumValue = compatibility.value as EnumPropertyValue;
    assert.strictEqual(enumValue.current, 'Version8_5_1');
    assert.ok(enumValue.allowedValues.some((item) => item.value === 'Version8_5_1' && item.label === 'Версия 8.5.1'));

    const usePurposes = props.find((item) => item.key === 'UsePurposes');
    assert.ok(usePurposes, 'UsePurposes не найден');
    assert.strictEqual(usePurposes.title, 'Назначение использования');
    assert.strictEqual(usePurposes.kind, 'multiEnum');

    const reportForm = props.find((item) => item.key === 'DefaultReportForm');
    assert.ok(reportForm, 'DefaultReportForm не найден');
    assert.strictEqual(reportForm.value, 'ОбщиеФормы.ФормаОтчета');

    const language = props.find((item) => item.key === 'DefaultLanguage');
    assert.ok(language, 'DefaultLanguage не найден');
    assert.strictEqual(language.value, 'Языки.Русский');

    const mobile = props.find((item) => item.key === 'UsedMobileApplicationFunctionalities');
    assert.ok(mobile, 'UsedMobileApplicationFunctionalities не найден');
    assert.ok(String(mobile.value).includes('Биометрия: Да'));
    assert.ok(String(mobile.value).includes('Местоположение: Нет'));
  });

  test('Показывает свойства расширения и список ролей по умолчанию', () => {
    const xml = fs.readFileSync(path.join(EXAMPLE_CFE, 'Configuration.xml'), 'utf-8');
    const props = buildConfigurationProperties(xml);

    const purpose = props.find((item) => item.key === 'ConfigurationExtensionPurpose');
    assert.ok(purpose, 'ConfigurationExtensionPurpose не найден');
    assert.strictEqual(purpose.title, 'Назначение расширения');
    assert.strictEqual(purpose.kind, 'enum');
    assert.strictEqual((purpose.value as EnumPropertyValue).currentLabel, 'Адаптация');

    const roles = props.find((item) => item.key === 'DefaultRoles');
    assert.ok(roles, 'DefaultRoles не найден');
    assert.strictEqual(roles.kind, 'multiEnum');

    const rolesValue = roles.value as MultiEnumPropertyValue;
    assert.deepStrictEqual(rolesValue.selected, ['Role.ев_ОсновнаяРоль']);
    assert.ok(rolesValue.allowedValues.some((item) => item.value === 'Role.ев_ОсновнаяРоль'));
  });
});
