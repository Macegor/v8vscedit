import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationScaffoldService } from '../../infra/xml/ConfigurationScaffoldService';
import { ExternalObjectService } from '../../infra/xml/ExternalObjectService';
import {
  SCAFFOLD_FORMAT_VERSION,
  isKnownFormatVersion,
} from '../../infra/xml/format/formatRegistry';

/**
 * Суб-волна 3c, задача X1: захардкоженные литералы `version="2.17"` в
 * генераторах (ConfigurationScaffoldService, ExternalObjectService) должны
 * браться из единого реестра формата (`formatRegistry`), а не дублироваться
 * по файлам. Белый список версий у валидатора внешнего объекта должен строиться
 * через предикат реестра, чтобы регистрация новой версии форматa автоматически
 * расширяла валидатор. Байтовый вывод генераторов при этом не должен измениться
 * ни на символ — только источник константы.
 */
suite('formatRegistry — SCAFFOLD_FORMAT_VERSION и isKnownFormatVersion', () => {
  test('SCAFFOLD_FORMAT_VERSION равен "2.17" — версия формата scaffold/внешних объектов', () => {
    // Значение фиксируем явно: это не "любая строка", а конкретно версия 2.17,
    // которую сегодня пишут cf-init/cfe-init/epf-init/erf-init. Меняться она
    // не должна вместе с рефакторингом — только источник переезжает в реестр.
    assert.strictEqual(SCAFFOLD_FORMAT_VERSION, '2.17');
  });

  test('isKnownFormatVersion — true для версий реестра (2.17/2.18/2.20/2.21)', () => {
    // Это ровно то множество, которое сегодня захардкожено белым списком в
    // ExternalObjectService.validate(). После рефакторинга оно должно приходить
    // из реестра, а не жить отдельной копией в валидаторе.
    for (const version of ['2.17', '2.18', '2.20', '2.21']) {
      assert.strictEqual(isKnownFormatVersion(version), true, `версия ${version} должна быть известна реестру`);
    }
  });

  test('isKnownFormatVersion — false для незнакомой версии', () => {
    assert.strictEqual(isKnownFormatVersion('9.99'), false);
  });
});

suite('ConfigurationScaffoldService — версия формата берётся из реестра, вывод байт-в-байт', () => {
  test('createConfiguration: Configuration.xml содержит version из SCAFFOLD_FORMAT_VERSION', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-fmt-cf-'));
    new ConfigurationScaffoldService().createConfiguration({
      name: 'ТестФормата',
      outputDir: root,
    });

    const xml = fs.readFileSync(path.join(root, 'Configuration.xml'), 'utf-8');
    // Ровно одно вхождение в корневом MetaDataObject — версия не должна плодиться
    // литералом в нескольких местах генератора.
    assert.ok(
      xml.includes(`<MetaDataObject `) && xml.includes(` version="${SCAFFOLD_FORMAT_VERSION}">`),
      'Configuration.xml должен содержать версию формата из реестра, а не захардкоженный литерал'
    );
    // Побайтовый инвариант: значение должно остаться "2.17", как было в генераторе
    // до переноса константы в реестр.
    assert.ok(xml.includes('version="2.17">'));
  });

  test('createExtension: Configuration.xml и Role.xml расширения содержат версию из реестра', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-fmt-cfe-'));
    new ConfigurationScaffoldService().createExtension({
      name: 'РасширениеФормата',
      outputDir: root,
      namePrefix: 'РФ_',
    });

    const configXml = fs.readFileSync(path.join(root, 'Configuration.xml'), 'utf-8');
    const roleXml = fs.readFileSync(path.join(root, 'Roles', 'РФ_ОсновнаяРоль.xml'), 'utf-8');
    for (const xml of [configXml, roleXml]) {
      assert.ok(xml.includes(` version="${SCAFFOLD_FORMAT_VERSION}">`));
      assert.ok(xml.includes('version="2.17">'));
    }
  });

  test('Languages/Русский.xml тоже содержит версию из реестра (buildLanguageXml)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-fmt-lang-'));
    new ConfigurationScaffoldService().createConfiguration({
      name: 'ТестЯзыка',
      outputDir: root,
    });

    const languageXml = fs.readFileSync(path.join(root, 'Languages', 'Русский.xml'), 'utf-8');
    assert.ok(languageXml.includes(` version="${SCAFFOLD_FORMAT_VERSION}">`));
    assert.ok(languageXml.includes('version="2.17">'));
  });
});

suite('ExternalObjectService — версия формата берётся из реестра, вывод байт-в-байт', () => {
  test('createExternalDataProcessor: EPF.xml содержит version из SCAFFOLD_FORMAT_VERSION', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-fmt-epf-'));
    new ExternalObjectService().createExternalDataProcessor({
      name: 'ПроверкаФормата',
      outputDir: root,
    });

    const xml = fs.readFileSync(path.join(root, 'ПроверкаФормата.xml'), 'utf-8');
    assert.ok(xml.includes(` version="${SCAFFOLD_FORMAT_VERSION}">`));
    assert.ok(xml.includes('version="2.17">'));
  });

  test('createExternalReport с withSkd: ERF.xml и Template.xml дескриптор содержат version из реестра', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-fmt-erf-'));
    new ExternalObjectService().createExternalReport({
      name: 'ОтчётФормата',
      outputDir: root,
      withSkd: true,
    });

    const reportXml = fs.readFileSync(path.join(root, 'ОтчётФормата.xml'), 'utf-8');
    const templateDescriptorXml = fs.readFileSync(
      path.join(root, 'ОтчётФормата', 'Templates', 'ОсновнаяСхемаКомпоновкиДанных.xml'),
      'utf-8'
    );
    for (const xml of [reportXml, templateDescriptorXml]) {
      assert.ok(xml.includes(` version="${SCAFFOLD_FORMAT_VERSION}">`));
      assert.ok(xml.includes('version="2.17">'));
    }
  });

  test('validate: белый список версий строится через isKnownFormatVersion — известные версии проходят без warn', () => {
    const service = new ExternalObjectService();
    for (const version of ['2.17', '2.18', '2.20', '2.21']) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `v8vscedit-fmt-val-${version}-`));
      const objectXml = path.join(root, 'ПроверкаВерсии.xml');
      fs.writeFileSync(objectXml, buildMinimalExternalDataProcessorXml(version), 'utf-8');

      const result = service.validate({ objectPath: objectXml, detailed: true });
      assert.strictEqual(result.errors, 0, `версия ${version} не должна давать ошибок: ${result.lines.join('\n')}`);
      assert.ok(
        !result.lines.some((line) => line.includes('Необычная версия')),
        `версия ${version} известна реестру — не должно быть предупреждения "Необычная версия": ${result.lines.join('\n')}`
      );
    }
  });

  test('validate: неизвестная версия формата даёт предупреждение "Необычная версия" через isKnownFormatVersion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-fmt-val-unknown-'));
    const objectXml = path.join(root, 'ПроверкаНеизвестной.xml');
    fs.writeFileSync(objectXml, buildMinimalExternalDataProcessorXml('9.99'), 'utf-8');

    const result = new ExternalObjectService().validate({ objectPath: objectXml, detailed: true });
    assert.ok(
      result.lines.some((line) => line.includes('Необычная версия') && line.includes('9.99')),
      `ожидалось предупреждение о версии 9.99: ${result.lines.join('\n')}`
    );
  });
});

/** Минимальный, но валидный по остальным правилам EPF.xml с заданной версией формата — для точечной проверки правила версии. */
function buildMinimalExternalDataProcessorXml(version: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" version="${version}">`,
    '\t<ExternalDataProcessor uuid="11111111-1111-1111-1111-111111111111">',
    '\t\t<InternalInfo>',
    '\t\t\t<xr:ClassId>c3831ec8-d8d5-4f93-8a22-f9bfae07327f</xr:ClassId>',
    '\t\t\t<xr:ObjectId>22222222-2222-2222-2222-222222222222</xr:ObjectId>',
    '\t\t\t<xr:GeneratedType name="ExternalDataProcessorObject.ПроверкаВерсии" category="Object">',
    '\t\t\t\t<xr:TypeId>33333333-3333-3333-3333-333333333333</xr:TypeId>',
    '\t\t\t\t<xr:ValueId>44444444-4444-4444-4444-444444444444</xr:ValueId>',
    '\t\t\t</xr:GeneratedType>',
    '\t\t</InternalInfo>',
    '\t\t<Properties>',
    '\t\t\t<Name>ПроверкаВерсии</Name>',
    '\t\t\t<Comment/>',
    '\t\t\t<DefaultForm/>',
    '\t\t\t<AuxiliaryForm/>',
    '\t\t</Properties>',
    '\t\t<ChildObjects/>',
    '\t</ExternalDataProcessor>',
    '</MetaDataObject>',
    '',
  ].join('\n');
}
