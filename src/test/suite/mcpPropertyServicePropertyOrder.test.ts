import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigurationXmlEditor } from '../../infra/xml';
import { extractTopLevelPropertiesChildren } from '../../infra/xml/MetadataPropertiesXml';
import { McpPropertyService } from '../../ui/mcp/McpPropertyService';
import { MetadataNode } from '../../ui/tree/TreeNode';
import { EXAMPLE_GENERATIONS, skipWithoutCorpus } from './support/corpus';

/**
 * Сквозной канал: MCP `set_property` и панель свойств ходят ОДНИМ путём —
 * `McpPropertyService.setProperty` → `ConfigurationXmlEditor.modifyObjectProperty`
 * → `ObjectXmlReader.updatePropertyInObject`. Отдельного инструмента под порядок
 * не нужно: канон обязан работать на этом пути «из коробки».
 *
 * Сценарий: вспомогательная форма варианта отчёта на выгрузке 2.20, где платформа
 * тега не пишет (у всех девяти отчётов 2.20 его нет). Мутации — над копией во
 * временном каталоге, `example/` не пишется.
 */

const tempDirs: string[] = [];

function copyReport(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-mcp-prop-order-'));
  tempDirs.push(dir);
  const target = path.join(dir, `${name}.xml`);
  fs.copyFileSync(path.join(EXAMPLE_GENERATIONS.cf20, 'Reports', `${name}.xml`), target);
  return target;
}

function reportNode(xmlPath: string, name: string): MetadataNode {
  return new MetadataNode({ label: name, nodeKind: 'Report', xmlPath }, vscode.TreeItemCollapsibleState.None);
}

function keysOf(xmlPath: string): string[] {
  return extractTopLevelPropertiesChildren(fs.readFileSync(xmlPath, 'utf-8')).map((child) => child.tag);
}

suite('McpPropertyService.setProperty — канон порядка свойств корня (сквозной канал)', () => {
  suiteSetup(function () {
    skipWithoutCorpus(this);
  });
  suiteTeardown(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const REPORTS_2_20 = [
    'АнализЗаказов',
    'ВзаимосвязьПродажТоваров',
    'ДашбордПродажи',
    'ДинамикаПродаж',
    'ДокументыОплата',
    'ОстаткиТоваровНаСкладах',
    'ОстаткиТоваровНаСкладахМобильный',
    'ОтчетПоВзаиморасчетам',
    'ПрайсЛист',
  ];

  test('AuxiliaryVariantForm у каждого отчёта 2.20: тег между DefaultVariantForm и VariantsStorage, changedFiles = изменённый XML', () => {
    for (const name of REPORTS_2_20) {
      const xmlPath = copyReport(name);
      const before = keysOf(xmlPath);
      assert.ok(!before.includes('AuxiliaryVariantForm'), `${name}: в 2.20 тега нет`);
      const service = new McpPropertyService(new ConfigurationXmlEditor());

      const result = service.setProperty(reportNode(xmlPath, name), 'AuxiliaryVariantForm', `Report.${name}.Form.ФормаВарианта`);

      assert.strictEqual(result.success, true, `${name}: ${result.message}`);
      assert.strictEqual(result.changed, true, name);
      assert.deepStrictEqual(result.changedFiles, [xmlPath], `${name}: changedFiles`);
      const after = keysOf(xmlPath);
      const index = after.indexOf('AuxiliaryVariantForm');
      assert.strictEqual(after[index - 1], 'DefaultVariantForm', `${name}: слева должен быть DefaultVariantForm`);
      assert.strictEqual(after[index + 1], 'VariantsStorage', `${name}: справа должен быть VariantsStorage`);
      assert.deepStrictEqual(
        after.filter((key) => key !== 'AuxiliaryVariantForm'),
        before,
        `${name}: остальные свойства не сдвинулись`
      );
      assert.ok(
        fs.readFileSync(xmlPath, 'utf-8').includes(`<AuxiliaryVariantForm>Report.${name}.Form.ФормаВарианта</AuxiliaryVariantForm>`),
        `${name}: значение записано`
      );
    }
  });

  test('setProperties: вставка отсутствующего и правка существующего свойства одним вызовом — порядок канонический, один уникальный changedFiles', () => {
    const name = 'ДинамикаПродаж';
    const xmlPath = copyReport(name);
    const before = keysOf(xmlPath);
    assert.ok(!before.includes('AuxiliaryVariantForm'), 'фикстура: тега в 2.20 нет');
    const service = new McpPropertyService(new ConfigurationXmlEditor());

    const result = service.setProperties(reportNode(xmlPath, name), {
      // Порядок ключей запроса намеренно обратный каноническому: результат от него зависеть не должен.
      AuxiliaryVariantForm: `Report.${name}.Form.ФормаВарианта`,
      DefaultVariantForm: `Report.${name}.Form.ФормаВариантаОсновная`,
    });

    assert.deepStrictEqual(result.failed, []);
    assert.deepStrictEqual(result.changedFiles, [xmlPath]);
    const after = keysOf(xmlPath);
    const start = after.indexOf('DefaultVariantForm');
    assert.deepStrictEqual(after.slice(start, start + 3), ['DefaultVariantForm', 'AuxiliaryVariantForm', 'VariantsStorage']);
  });
});
