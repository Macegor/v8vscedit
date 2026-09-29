import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BasedOnXmlService } from '../../infra/xml/BasedOnXmlService';
import { ConfigurationXmlEditor } from '../../infra/xml/ConfigurationXmlEditor';
import { ExchangePlanContentService } from '../../infra/xml/ExchangePlanContentService';
import { MetadataXmlCreator } from '../../infra/xml/MetadataXmlCreator';
import { SubsystemXmlService } from '../../infra/xml/SubsystemXmlService';
import { MetadataNode } from '../../ui/tree/TreeNode';
import type { NodeKind } from '../../ui/tree/TreeNode';
import { PropertiesViewController } from '../../ui/views/properties/PropertiesViewController';
import { TypeRegistryService } from '../../ui/views/properties/TypeRegistryService';
import { getEmptyFormPickerMessage } from '../../ui/views/properties/formPickerOptions';
import type { ObjectPropertiesCollection } from '../../ui/views/properties/_types';

/**
 * Путь пикера форм ЦЕЛИКОМ, от сообщения webview до записи в XML.
 *
 * Чистый `formPickerOptions` покрыт отдельно, но вся польза правки проходит
 * через маппинг аргументов в контроллере: перепутанные `ownerKind`/`ownerName`
 * или `'Form'` вместо `'CommonForm'` не ловятся ни одним тестом чистого модуля.
 * Поэтому здесь поднимается настоящий контроллер на настоящей временной
 * выгрузке, а сообщение идёт через публичный `handleWebviewMessage`.
 */

interface FormPickerPrivateApi {
  handleOpenFormPicker(key?: string): Promise<void>;
  activeProperties: ObjectPropertiesCollection;
}

type QuickPickItemWithOption = vscode.QuickPickItem & { option?: { reference: string } };

let quickPickSelector: (items: readonly QuickPickItemWithOption[]) => QuickPickItemWithOption | undefined;
let quickPickCalls: QuickPickItemWithOption[][] = [];
let infoMessages: string[] = [];
let warningMessages: string[] = [];
let errorMessages: string[] = [];
let originals: {
  showQuickPick: typeof vscode.window.showQuickPick;
  showInformationMessage: typeof vscode.window.showInformationMessage;
  showWarningMessage: typeof vscode.window.showWarningMessage;
  showErrorMessage: typeof vscode.window.showErrorMessage;
} | undefined;

function installDialogStubs(): void {
  const windowRef = vscode.window as unknown as {
    showQuickPick: typeof vscode.window.showQuickPick;
    showInformationMessage: typeof vscode.window.showInformationMessage;
    showWarningMessage: typeof vscode.window.showWarningMessage;
    showErrorMessage: typeof vscode.window.showErrorMessage;
  };
  originals = {
    showQuickPick: windowRef.showQuickPick,
    showInformationMessage: windowRef.showInformationMessage,
    showWarningMessage: windowRef.showWarningMessage,
    showErrorMessage: windowRef.showErrorMessage,
  };
  // Перегрузок showQuickPick несколько — стабу нужна ровно одна форма.
  windowRef.showQuickPick = ((items: readonly QuickPickItemWithOption[]) => {
    quickPickCalls.push([...items]);
    return Promise.resolve(quickPickSelector(items));
  }) as unknown as typeof vscode.window.showQuickPick;
  windowRef.showInformationMessage = ((message: string) => {
    infoMessages.push(message);
    return Promise.resolve(undefined);
  });
  windowRef.showWarningMessage = ((message: string) => {
    warningMessages.push(message);
    return Promise.resolve(undefined);
  });
  windowRef.showErrorMessage = ((message: string) => {
    errorMessages.push(message);
    return Promise.resolve(undefined);
  });
}

function restoreDialogStubs(): void {
  if (!originals) {
    return;
  }
  const windowRef = vscode.window as unknown as Record<string, unknown>;
  windowRef.showQuickPick = originals.showQuickPick;
  windowRef.showInformationMessage = originals.showInformationMessage;
  windowRef.showWarningMessage = originals.showWarningMessage;
  windowRef.showErrorMessage = originals.showErrorMessage;
  originals = undefined;
}

function createController(): PropertiesViewController {
  return new PropertiesViewController(
    new SubsystemXmlService(),
    new ExchangePlanContentService(),
    new TypeRegistryService(),
    new ConfigurationXmlEditor(),
    new BasedOnXmlService(),
    {
      refreshActiveView: () => undefined,
      replaceActiveNode: () => undefined,
    }
  );
}

function makeNode(nodeKind: NodeKind, label: string, xmlPath?: string): MetadataNode {
  return new MetadataNode({ label, nodeKind, xmlPath }, vscode.TreeItemCollapsibleState.None);
}

/** Временная выгрузка: Configuration.xml с общими формами (по списку) и отчёт. */
function createDump(commonForms: readonly string[], options: { withOwnForm?: boolean } = {}): {
  configRoot: string;
  configXmlPath: string;
  reportXmlPath: string;
} {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-form-picker-'));
  const configXmlPath = path.join(configRoot, 'Configuration.xml');
  fs.writeFileSync(
    configXmlPath,
    '<?xml version="1.0" encoding="utf-8"?>\n'
    + '<MetaDataObject version="2.21">\n'
    + '  <Configuration>\n'
    + '    <Properties>\n'
    + '      <Name>ТестоваяКонфигурация</Name>\n'
    + '      <Synonym/>\n'
    + '      <DefaultReportVariantForm/>\n'
    + '    </Properties>\n'
    + `    <ChildObjects>${commonForms.map((name) => `<CommonForm>${name}</CommonForm>`).join('')}</ChildObjects>\n`
    + '  </Configuration>\n'
    + '</MetaDataObject>',
    'utf-8'
  );

  const creator = new MetadataXmlCreator();
  assert.strictEqual(creator.addRootObject({ configRoot, kind: 'Report', name: 'ОтчётПикер' }).success, true);
  const reportXmlPath = path.join(configRoot, 'Reports', 'ОтчётПикер.xml');
  if (options.withOwnForm === true) {
    assert.strictEqual(
      creator.addChildElement({ ownerObjectXmlPath: reportXmlPath, childTag: 'Form', name: 'ФормаОтчёта' }).success,
      true
    );
  }
  return { configRoot, configXmlPath, reportXmlPath };
}

suite('Пикер формы — путь от сообщения webview до записи в XML', () => {
  setup(() => {
    quickPickCalls = [];
    infoMessages = [];
    warningMessages = [];
    errorMessages = [];
    quickPickSelector = () => undefined;
    installDialogStubs();
  });

  teardown(() => {
    restoreDialogStubs();
  });

  test('отчёт с общими формами: в XML записана ровно CommonForm.<Имя>', async () => {
    const dump = createDump(['ФормаОтчета', 'ФормаВариантаОтчета'], { withOwnForm: false });
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));
    quickPickSelector = (items) => items.find((item) => item.label === 'ФормаВариантаОтчета');

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultVariantForm' });

    const xml = fs.readFileSync(dump.reportXmlPath, 'utf-8');
    assert.ok(
      xml.includes('<DefaultVariantForm>CommonForm.ФормаВариантаОтчета</DefaultVariantForm>'),
      `ожидалась ссылка на общую форму, получено:\n${/<DefaultVariantForm>.*/.exec(xml)?.[0] ?? '(тега нет)'}`
    );
    // Своих форм у отчёта нет — весь список состоит из общих форм конфигурации.
    assert.deepStrictEqual(
      quickPickCalls[0].map((item) => item.description),
      ['CommonForm.ФормаВариантаОтчета', 'CommonForm.ФормаОтчета']
    );
  });

  test('объект со своей формой: ссылка «<Вид>.<Имя>.Form.<Форма>», своя форма идёт первой', async () => {
    const dump = createDump(['ФормаОтчета'], { withOwnForm: true });
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));
    quickPickSelector = (items) => items[0];

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });

    // Порядок важен: первой предлагается собственная форма объекта.
    assert.deepStrictEqual(
      quickPickCalls[0].map((item) => item.description),
      ['Report.ОтчётПикер.Form.ФормаОтчёта', 'CommonForm.ФормаОтчета']
    );
    const xml = fs.readFileSync(dump.reportXmlPath, 'utf-8');
    assert.ok(
      xml.includes('<DefaultForm>Report.ОтчётПикер.Form.ФормаОтчёта</DefaultForm>'),
      `ожидалась ссылка на собственную форму, получено:\n${/<DefaultForm>.*/.exec(xml)?.[0] ?? '(тега нет)'}`
    );
  });

  test('ни своих, ни общих форм: сообщение называет обе причины, XML не тронут', async () => {
    const dump = createDump([], { withOwnForm: false });
    const before = fs.readFileSync(dump.reportXmlPath, 'utf-8');
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });

    assert.deepStrictEqual(infoMessages, [getEmptyFormPickerMessage()]);
    assert.strictEqual(quickPickCalls.length, 0, 'пустой список показывать нельзя');
    assert.strictEqual(fs.readFileSync(dump.reportXmlPath, 'utf-8'), before, 'XML не должен меняться');
  });

  test('отмена пикера: записи не происходит', async () => {
    const dump = createDump(['ФормаОтчета'], { withOwnForm: false });
    const before = fs.readFileSync(dump.reportXmlPath, 'utf-8');
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));
    quickPickSelector = () => undefined;

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });

    assert.strictEqual(quickPickCalls.length, 1, 'список показать были обязаны');
    assert.strictEqual(fs.readFileSync(dump.reportXmlPath, 'utf-8'), before, 'после отмены XML не меняется');
  });

  test('clearFormProperty очищает значение свойства формы', async () => {
    const dump = createDump(['ФормаОтчета'], { withOwnForm: false });
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));
    quickPickSelector = (items) => items[0];
    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });
    assert.ok(fs.readFileSync(dump.reportXmlPath, 'utf-8').includes('<DefaultForm>CommonForm.ФормаОтчета</DefaultForm>'));

    await controller.handleWebviewMessage({ type: 'clearFormProperty', key: 'DefaultForm' });

    const xml = fs.readFileSync(dump.reportXmlPath, 'utf-8');
    assert.ok(
      !xml.includes('CommonForm.ФормаОтчета'),
      `значение свойства формы должно быть очищено, получено:\n${/<DefaultForm>.*/.exec(xml)?.[0] ?? '(тега нет)'}`
    );
  });

  test('корень конфигурации: формы уровня приложения тоже выбираются и пишутся в Configuration.xml', async () => {
    const dump = createDump(['ФормаВариантаОтчета'], { withOwnForm: false });
    const controller = createController();
    controller.setActiveNode(makeNode('configuration', 'ТестоваяКонфигурация', dump.configXmlPath));
    quickPickSelector = (items) => items[0];

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultReportVariantForm' });

    // У конфигурации собственных форм не бывает — список целиком из общих.
    assert.deepStrictEqual(quickPickCalls[0].map((item) => item.description), ['CommonForm.ФормаВариантаОтчета']);
    const xml = fs.readFileSync(dump.configXmlPath, 'utf-8');
    assert.ok(
      xml.includes('<DefaultReportVariantForm>CommonForm.ФормаВариантаОтчета</DefaultReportVariantForm>'),
      `ожидалась запись формы уровня приложения, получено:\n${/<DefaultReportVariantForm>.*/.exec(xml)?.[0] ?? '(тега нет)'}`
    );
  });

  test('повторный выбор той же формы конфигурации: файл не переписывается, ошибки нет', async () => {
    const dump = createDump(['ФормаВариантаОтчета'], { withOwnForm: false });
    const controller = createController();
    controller.setActiveNode(makeNode('configuration', 'ТестоваяКонфигурация', dump.configXmlPath));
    quickPickSelector = (items) => items[0];
    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultReportVariantForm' });
    const afterFirst = fs.readFileSync(dump.configXmlPath, 'utf-8');

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultReportVariantForm' });

    assert.strictEqual(fs.readFileSync(dump.configXmlPath, 'utf-8'), afterFirst, 'повтор не должен менять файл');
    assert.deepStrictEqual(errorMessages, [], 'повтор того же значения — не ошибка');
  });

  test('свойства формы нет в Configuration.xml: показана ошибка, файл не тронут', async () => {
    const dump = createDump(['ФормаОтчета'], { withOwnForm: false });
    const before = fs.readFileSync(dump.configXmlPath, 'utf-8');
    const controller = createController();
    controller.setActiveNode(makeNode('configuration', 'ТестоваяКонфигурация', dump.configXmlPath));
    quickPickSelector = (items) => items[0];

    // Тега <DefaultConstantsForm/> в фикстуре нет — редактор дописывать свойство
    // в обход порядка xs:sequence не должен, а обязан отказать с сообщением.
    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultConstantsForm' });

    assert.strictEqual(errorMessages.length, 1, `ожидалась ошибка записи, получено: ${errorMessages.join('; ')}`);
    assert.strictEqual(fs.readFileSync(dump.configXmlPath, 'utf-8'), before);
  });

  test('свойство только для чтения: показывается предупреждение, список не открывается', async () => {
    const dump = createDump(['ФормаОтчета'], { withOwnForm: false });
    const before = fs.readFileSync(dump.reportXmlPath, 'utf-8');
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));
    const api = controller as unknown as FormPickerPrivateApi;
    api.activeProperties = [
      { key: 'DefaultForm', title: 'Основная форма', kind: 'string', value: '', readonly: true },
    ];

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });

    assert.strictEqual(quickPickCalls.length, 0, 'для readonly-свойства список открывать нельзя');
    assert.strictEqual(warningMessages.length, 1, 'ожидалось предупреждение о readonly-свойстве');
    assert.strictEqual(fs.readFileSync(dump.reportXmlPath, 'utf-8'), before);
  });

  test('сообщение без ключа свойства: пикер не открывается', async () => {
    const dump = createDump(['ФормаОтчета'], { withOwnForm: false });
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));

    await controller.handleWebviewMessage({ type: 'openFormPicker' });

    assert.strictEqual(quickPickCalls.length, 0);
    assert.deepStrictEqual(infoMessages, []);
  });

  test('без активного узла приватный вход в пикер не падает и ничего не показывает', async () => {
    const controller = createController();
    controller.clearActiveNode();

    // Через handleWebviewMessage эта ветка недостижима (там свой ранний выход по
    // activeNode), но метод вызывается и напрямую — защитный guard обязан жить.
    await (controller as unknown as FormPickerPrivateApi).handleOpenFormPicker('DefaultForm');

    assert.strictEqual(quickPickCalls.length, 0);
  });

  test('узел без xmlPath: общие формы не читаются, список пуст', async () => {
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётБезФайла'));

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });

    assert.deepStrictEqual(infoMessages, [getEmptyFormPickerMessage()]);
    assert.strictEqual(quickPickCalls.length, 0);
  });

  test('нечитаемый Configuration.xml: общие формы не читаются, список пуст', async () => {
    const dump = createDump([], { withOwnForm: false });
    // Configuration.xml удалён — parseConfigXml бросает, контроллер обязан
    // отдать пустой список, а не уронить обработку сообщения.
    fs.rmSync(dump.configXmlPath);
    const controller = createController();
    controller.setActiveNode(makeNode('Report', 'ОтчётПикер', dump.reportXmlPath));

    await controller.handleWebviewMessage({ type: 'openFormPicker', key: 'DefaultForm' });

    assert.deepStrictEqual(infoMessages, [getEmptyFormPickerMessage()]);
    assert.strictEqual(quickPickCalls.length, 0);
  });
});
