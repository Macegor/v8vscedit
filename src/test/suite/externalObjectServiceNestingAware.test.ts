import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalObjectService } from '../../infra/xml';

suite('ExternalObjectService — parseChildObjects учитывает вложенность верхнего ChildObjects (M1)', () => {
  test('validate видит Form/TabularSection верхнего уровня, даже если TabularSection содержит собственный вложенный ChildObjects с колонками', () => {
    // extractBlock(xml, 'ChildObjects') в ExternalObjectService — non-greedy regex без учёта
    // вложенности. Если внутри верхнего <ChildObjects> лежит <TabularSection> со своим
    // вложенным <ChildObjects>...</ChildObjects> (колонки), non-greedy поиск остановится на
    // ПЕРВОМ встреченном </ChildObjects> — то есть на закрытии ВНУТРЕННЕГО блока колонок,
    // а не внешнего. В результате извлечённый "верхний" срез фактически обрезан ДО Form,
    // но содержит фрагмент TabularSection вместе с вложенным Attribute — plain-regex
    // parseChildObjects распознаёт этот Attribute как узел ВЕРХНЕГО уровня (вместо
    // TabularSection(1)+Form(1) отчёт покажет ложный Attribute(1)).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-epf-nesting-'));
    const service = new ExternalObjectService();
    service.createExternalDataProcessor({ name: 'ОбработкаСТЧ', outputDir: root });

    const objectXml = path.join(root, 'ОбработкаСТЧ.xml');
    let xml = fs.readFileSync(objectXml, 'utf-8');

    assert.ok(xml.includes('<ChildObjects/>') || xml.includes('<ChildObjects></ChildObjects>'), 'ожидался пустой ChildObjects у свежесозданной обработки');

    xml = xml.replace('<ChildObjects/>', [
      '<ChildObjects>',
      '\t\t<TabularSection uuid="44444444-4444-4444-4444-444444444444">',
      '\t\t\t<Properties><Name>Строки</Name></Properties>',
      '\t\t\t<ChildObjects>',
      '\t\t\t\t<Attribute uuid="55555555-5555-5555-5555-555555555555">',
      '\t\t\t\t\t<Properties><Name>Колонка1</Name></Properties>',
      '\t\t\t\t</Attribute>',
      '\t\t\t</ChildObjects>',
      '\t\t</TabularSection>',
      '\t\t<Form uuid="66666666-6666-6666-6666-666666666666"><Properties><Name>ОсновнаяФорма</Name></Properties></Form>',
      '\t</ChildObjects>',
    ].join('\n'));
    fs.writeFileSync(objectXml, xml, 'utf-8');

    const validation = service.validate({ objectPath: objectXml, detailed: true });
    const childObjectsLine = validation.lines.find((line) => line.startsWith('4. ChildObjects') || line.includes('[OK]') && line.includes('ChildObjects'));
    assert.ok(childObjectsLine, 'ожидалась строка про ChildObjects в отчёте валидации');
    assert.ok(
      !childObjectsLine.includes('empty'),
      `ChildObjects не должен считаться пустым: у обработки есть TabularSection и Form верхнего уровня (получено: "${childObjectsLine}")`
    );
    assert.ok(
      childObjectsLine.includes('TabularSection(1)') && childObjectsLine.includes('Form(1)'),
      `ожидались найденные верхнеуровневые TabularSection и Form (получено: "${childObjectsLine}")`
    );
  });
});
