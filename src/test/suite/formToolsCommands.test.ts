import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SupportMode } from '../../infra/support/SupportInfoService';
import { MetadataNode, type TreeNodeModel } from '../../ui/tree/TreeNode';
import {
  CATALOG_FORM_TITLE,
  COMMON_FORM_TITLE,
  createFormCommandsStand,
  createFormFixtureExport,
  createFormMcpFixture,
  createFormMcpHarnessOverEntry,
  type FormMcpFixture,
  type FormMcpHarnessOptions,
} from './support/mcpFormToolsHarness';

/**
 * Команды навигатора `v8vscedit.form.*` на НАСТОЯЩЕЙ выгрузке и настоящем дереве.
 *
 * Тот же дефект, что чинился в MCP, жил и здесь: `node.xmlPath` у формы объекта — это XML
 * объекта-владельца, а команда принимала его за путь формы. «Форма: валидировать» разбирала
 * XML справочника как Form.xml и выдавала лавину ложных ошибок (в т.ч. «AutoCommandBar element
 * missing»), «Форма: удалить» считала путь владельца двойным `dirname` и промахивалась мимо
 * конфигурации. Деривация теперь общая с MCP (`ui/tree/formNodePaths`), поэтому тесты проверяют
 * именно совпадение результата команды с телом формы.
 *
 * Стенд — `mcpFormToolsHarness`: одна выгрузка, одно дерево и ОДИН набор сервисов на MCP-инструменты
 * и команды навигатора.
 */

const COMMAND = {
  info: 'v8vscedit.form.info',
  validate: 'v8vscedit.form.validate',
  add: 'v8vscedit.form.add',
  remove: 'v8vscedit.form.remove',
} as const;

// ── Подмена диалогов VS Code ──────────────────────────────────────────────

/** Очереди ответов диалогов: каждый вызов снимает следующий ответ (пусто → «отмена»). */
let openDialogAnswers: (vscode.Uri[] | undefined)[] = [];
let inputBoxAnswers: (string | undefined)[] = [];
let quickPickAnswers: (string | undefined)[] = [];
let warningAnswers: (string | undefined)[] = [];

let openDialogCalls: number;
let inputBoxOptions: vscode.InputBoxOptions[];
let errorMessages: string[];
let infoMessages: string[];
let warningMessages: string[];
/** Тексты документов, открытых `openReport` (сам показ документа подменён). */
let reports: string[];

interface WindowRef {
  showOpenDialog: typeof vscode.window.showOpenDialog;
  showInputBox: typeof vscode.window.showInputBox;
  showQuickPick: typeof vscode.window.showQuickPick;
  showWarningMessage: typeof vscode.window.showWarningMessage;
  showInformationMessage: typeof vscode.window.showInformationMessage;
  showErrorMessage: typeof vscode.window.showErrorMessage;
  showTextDocument: typeof vscode.window.showTextDocument;
}

let original: WindowRef;

function installDialogStubs(): void {
  const windowRef = vscode.window as unknown as WindowRef;
  original = {
    showOpenDialog: windowRef.showOpenDialog,
    showInputBox: windowRef.showInputBox,
    showQuickPick: windowRef.showQuickPick,
    showWarningMessage: windowRef.showWarningMessage,
    showInformationMessage: windowRef.showInformationMessage,
    showErrorMessage: windowRef.showErrorMessage,
    showTextDocument: windowRef.showTextDocument,
  };
  windowRef.showOpenDialog = (() => {
    openDialogCalls += 1;
    return Promise.resolve(openDialogAnswers.shift());
  });
  windowRef.showInputBox = ((options?: vscode.InputBoxOptions) => {
    inputBoxOptions.push(options ?? {});
    return Promise.resolve(inputBoxAnswers.shift());
  });
  // Перегрузок showQuickPick несколько (canPickMany и т.п.) — стабу нужна ровно одна форма.
  windowRef.showQuickPick = (() => Promise.resolve(quickPickAnswers.shift())) as typeof vscode.window.showQuickPick;
  windowRef.showWarningMessage = ((message: string) => {
    warningMessages.push(message);
    return Promise.resolve(warningAnswers.shift());
  });
  windowRef.showInformationMessage = ((message: string) => {
    infoMessages.push(message);
    return Promise.resolve(undefined);
  });
  windowRef.showErrorMessage = ((message: string) => {
    errorMessages.push(message);
    return Promise.resolve(undefined);
  });
  windowRef.showTextDocument = ((document: vscode.TextDocument) => {
    reports.push(document.getText());
    return Promise.resolve(undefined);
  }) as unknown as typeof vscode.window.showTextDocument;
}

/** Сбрасывает очереди ответов и журналы диалогов перед каждым тестом. */
function resetDialogState(): void {
  openDialogAnswers = [];
  inputBoxAnswers = [];
  quickPickAnswers = [];
  warningAnswers = [];
  openDialogCalls = 0;
  inputBoxOptions = [];
  errorMessages = [];
  infoMessages = [];
  warningMessages = [];
  reports = [];
}

function restoreDialogStubs(): void {
  Object.assign(vscode.window as unknown as WindowRef, original);
}

// ── Узлы и фикстуры ───────────────────────────────────────────────────────

function objectFormNode(fx: FormMcpFixture): MetadataNode {
  return fx.harness.paths.resolveNode(`Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`);
}

function commonFormNode(fx: FormMcpFixture): MetadataNode {
  return fx.harness.paths.resolveNode(`ОбщиеФормы.${fx.commonFormName}`);
}

function catalogNode(fx: FormMcpFixture): MetadataNode {
  return fx.harness.paths.resolveNode(`Справочники.${fx.catalogName}`);
}

function syntheticNode(model: TreeNodeModel): MetadataNode {
  return new MetadataNode(model, vscode.TreeItemCollapsibleState.None);
}

/** Свежая выгрузка на каждый тест: команды мутируют состав и не должны делить состояние. */
function fixtureTest(
  title: string,
  options: FormMcpHarnessOptions,
  body: (fx: FormMcpFixture, run: (command: string, node?: MetadataNode) => Promise<void>) => Promise<void> | void,
): void {
  test(title, async function () {
    this.timeout(60_000);
    const fx = createFormMcpFixture(options);
    const stand = createFormCommandsStand(fx.harness);
    try {
      await body(fx, (command, node) => stand.run(command, node));
    } finally {
      fx.dispose();
    }
  });
}

function assertNoErrors(): void {
  assert.deepStrictEqual(errorMessages, [], 'команда не должна была сообщать об ошибке');
}

suite('Команды навигатора: формы — регистрация', () => {
  setup(() => {
    resetDialogState();
    installDialogStubs();
  });
  teardown(restoreDialogStubs);

  fixtureTest('registerFormToolsCommands регистрирует ровно четыре команды и складывает их в subscriptions', {}, (fx) => {
    const stand = createFormCommandsStand(fx.harness);
    assert.deepStrictEqual([...stand.registered].sort(), [COMMAND.add, COMMAND.info, COMMAND.remove, COMMAND.validate].sort());
    assert.strictEqual(stand.subscriptions, 4, 'все disposable-команды отданы контексту расширения');
  });
});

suite('Команды навигатора: формы — чтение (info/validate)', () => {
  setup(() => {
    resetDialogState();
    installDialogStubs();
  });
  teardown(restoreDialogStubs);

  const FORM_KINDS = [
    {
      label: 'форма объекта',
      node: objectFormNode,
      body: (fx: FormMcpFixture) => fx.catalogFormBody,
      title: CATALOG_FORM_TITLE,
      formName: (fx: FormMcpFixture) => fx.catalogFormName,
    },
    {
      label: 'общая форма',
      node: commonFormNode,
      body: (fx: FormMcpFixture) => fx.commonFormBody,
      title: COMMON_FORM_TITLE,
      formName: (fx: FormMcpFixture) => fx.commonFormName,
    },
  ] as const;

  for (const kind of FORM_KINDS) {
    fixtureTest(`${kind.label}: «Форма: структура» отчитывается по ТЕЛУ формы (заголовок формы, а не имя объекта)`, {}, async (fx, run) => {
      await run(COMMAND.info, kind.node(fx));
      assertNoErrors();
      assert.strictEqual(reports.length, 1);
      assert.ok(reports[0].startsWith(`Форма: ${kind.title}`), reports[0]);
      assert.strictEqual(openDialogCalls, 0, 'узел есть — диалог выбора файла не нужен');
    });

    fixtureTest(`${kind.label}: «Форма: валидировать» читает тело формы — 0 ошибок и никакого «AutoCommandBar element missing»`, {}, async (fx, run) => {
      await run(COMMAND.validate, kind.node(fx));
      assertNoErrors();
      assert.strictEqual(reports.length, 1);
      assert.ok(reports[0].startsWith('Валидация формы: 0 ошибок'), reports[0]);
      assert.ok(reports[0].includes(`=== Validation: Form.${kind.formName(fx)} ===`), reports[0]);
      assert.ok(
        !reports[0].includes('AutoCommandBar element missing'),
        `регресс: разбор XML объекта вместо формы\n${reports[0]}`,
      );
    });

    fixtureTest(`${kind.label}: настоящий дефект тела формы виден («AutoCommandBar element missing» — диагностика, а не шум)`, {}, async (fx, run) => {
      const body = kind.body(fx);
      const broken = fs.readFileSync(body, 'utf-8').replace(/<AutoCommandBar\b[^>]*\/>\s*/, '');
      fs.writeFileSync(body, broken, 'utf-8');
      await run(COMMAND.validate, kind.node(fx));
      assertNoErrors();
      assert.ok(reports[0].includes('AutoCommandBar element missing'), reports[0]);
      assert.ok(!reports[0].startsWith('Валидация формы: 0 ошибок'), reports[0]);
    });
  }

  fixtureTest('узел формы объекта: отчёт совпадает с прямым прогоном по Form.xml, XML справочника не читается как форма', {}, async (fx, run) => {
    await run(COMMAND.info, objectFormNode(fx));
    assert.ok(reports[0].includes(CATALOG_FORM_TITLE), reports[0]);
    // Заголовок объекта («Товары») в отчёте формы появлялся ровно тогда, когда читался XML справочника.
    assert.ok(!reports[0].includes(`Форма: ${fx.catalogName}`), reports[0]);
  });

  for (const command of [COMMAND.info, COMMAND.validate]) {
    fixtureTest(`${command}: без узла путь спрашивается диалогом (ручной ввод сохранён)`, {}, async (fx, run) => {
      openDialogAnswers = [[vscode.Uri.file(fx.catalogFormBody)]];
      await run(command);
      assertNoErrors();
      assert.strictEqual(openDialogCalls, 1);
      assert.strictEqual(reports.length, 1);
    });

    fixtureTest(`${command}: диалог отменён → ни отчёта, ни ошибки`, {}, async (_fx, run) => {
      openDialogAnswers = [undefined];
      await run(command);
      assertNoErrors();
      assert.deepStrictEqual(reports, []);
    });

    fixtureTest(`${command}: диалог вернул пустой выбор → ни отчёта, ни ошибки`, {}, async (_fx, run) => {
      openDialogAnswers = [[]];
      await run(command);
      assertNoErrors();
      assert.deepStrictEqual(reports, []);
    });

    fixtureTest(`${command}: узел не форма (справочник) → внятный отказ, а не разбор XML объекта как формы`, {}, async (fx, run) => {
      await run(command, catalogNode(fx));
      assert.deepStrictEqual(reports, [], 'отчёта по не-форме быть не должно');
      assert.strictEqual(errorMessages.length, 1, errorMessages.join('\n'));
      assert.match(errorMessages[0], /Не удалось определить файл формы/);
      assert.match(errorMessages[0], /форм/i);
    });
  }

  fixtureTest('узел формы объекта без metaContext → отказ про объект-владелец', {}, async (fx, run) => {
    const orphan = syntheticNode({ label: fx.catalogFormName, nodeKind: 'Form', xmlPath: fx.catalogXml });
    await run(COMMAND.info, orphan);
    assert.deepStrictEqual(reports, []);
    assert.strictEqual(errorMessages.length, 1);
    assert.match(errorMessages[0], /владел/i);
  });

  fixtureTest('тело формы удалено → отказ сервиса уходит в уведомление, а не в необработанное исключение', {}, async (fx, run) => {
    fs.rmSync(path.dirname(path.dirname(fx.catalogFormBody)), { recursive: true, force: true });
    await run(COMMAND.info, objectFormNode(fx));
    assert.deepStrictEqual(reports, []);
    assert.strictEqual(errorMessages.length, 1, errorMessages.join('\n'));
    assert.match(errorMessages[0], /Не удалось прочитать форму/);
    assert.match(errorMessages[0], /Form\.xml/);
  });
});

suite('Команды навигатора: формы — удаление', () => {
  setup(() => {
    resetDialogState();
    // Подтверждение удаления по умолчанию дано; тесты отмены переопределяют ответ.
    warningAnswers = ['Удалить'];
    installDialogStubs();
  });
  teardown(restoreDialogStubs);

  function assertFormGone(fx: FormMcpFixture): void {
    assert.ok(!fs.existsSync(fx.catalogFormDescriptor), 'дескриптор формы удалён');
    assert.ok(!fs.existsSync(path.dirname(path.dirname(fx.catalogFormBody))), 'каталог формы удалён');
    assert.ok(fs.existsSync(fx.catalogXml), 'XML справочника остался на месте');
    assert.ok(
      !fs.readFileSync(fx.catalogXml, 'utf-8').includes(`<Form>${fx.catalogFormName}</Form>`),
      'регистрация формы снята из ChildObjects',
    );
  }

  fixtureTest('узел формы объекта: удаляется форма владельца (путь берётся из metaContext, а не арифметикой над xmlPath)', {}, async (fx, run) => {
    // Прежняя арифметика (два dirname от xmlPath) давала «<configRoot>.xml» — файл вне выгрузки.
    const bogus = `${fx.configRoot}.xml`;
    await run(COMMAND.remove, objectFormNode(fx));
    assertNoErrors();
    assertFormGone(fx);
    assert.ok(!fs.existsSync(bogus), 'команда не создаёт и не трогает файл рядом с корнем конфигурации');
    assert.strictEqual(infoMessages.length, 1);
    assert.match(infoMessages[0], new RegExp(`Форма ${fx.catalogFormName} удалена`));
    assert.strictEqual(openDialogCalls, 0, 'узел формы известен — имя и владелец не спрашиваются');
    assert.deepStrictEqual(inputBoxOptions, []);
    const log = fx.harness.postMutation;
    assert.strictEqual(log.suppress.length, 1);
    assert.strictEqual(log.markChanged.length, 1);
    assert.strictEqual(log.refreshActionsView, 1);
    assert.ok(log.markChanged[0].includes(fx.catalogXml));
  });

  fixtureTest('подтверждение не дано → форма на месте, пост-мутационный путь не запускался', {}, async (fx, run) => {
    warningAnswers = [undefined];
    await run(COMMAND.remove, objectFormNode(fx));
    assertNoErrors();
    assert.ok(fs.existsSync(fx.catalogFormDescriptor));
    assert.strictEqual(warningMessages.length, 1);
    assert.strictEqual(fx.harness.postMutation.refreshActionsView, 0);
  });

  fixtureTest('объект на поддержке с запретом редактирования → отказ по поддержке', { supportMode: SupportMode.Locked }, async (fx, run) => {
    await run(COMMAND.remove, objectFormNode(fx));
    assert.ok(fs.existsSync(fx.catalogFormDescriptor));
    assert.strictEqual(errorMessages.length, 1);
    assert.match(errorMessages[0], /поддержке/);
    // Проверка идёт по XML объекта-владельца — тому же пути, что и в RemoveMetadataCommand.
    assert.deepStrictEqual(fx.harness.supportQueries, [fx.catalogXml]);
    assert.deepStrictEqual(warningMessages, [], 'до подтверждения дело не дошло');
  });

  fixtureTest('поддержка есть, но редактирование разрешено → удаление проходит', { supportMode: SupportMode.Editable }, async (fx, run) => {
    await run(COMMAND.remove, objectFormNode(fx));
    assertNoErrors();
    assertFormGone(fx);
    assert.deepStrictEqual(fx.harness.supportQueries, [fx.catalogXml]);
  });

  fixtureTest('объект не захвачен в хранилище → отказ по хранилищу', { repositoryRestricted: true }, async (fx, run) => {
    await run(COMMAND.remove, objectFormNode(fx));
    assert.ok(fs.existsSync(fx.catalogFormDescriptor));
    assert.strictEqual(errorMessages.length, 1);
    assert.match(errorMessages[0], /хранилище/);
    assert.deepStrictEqual(fx.harness.repositoryQueries, [fx.catalogXml]);
  });

  fixtureTest('хранилище подключено, ограничений нет → удаление проходит', { repositoryRestricted: false }, async (fx, run) => {
    await run(COMMAND.remove, objectFormNode(fx));
    assertNoErrors();
    assertFormGone(fx);
    assert.deepStrictEqual(fx.harness.repositoryQueries, [fx.catalogXml]);
  });

  fixtureTest('узел формы без metaContext → отказ про объект-владелец, выгрузка не тронута', {}, async (fx, run) => {
    const orphan = syntheticNode({ label: fx.catalogFormName, nodeKind: 'Form', xmlPath: fx.catalogXml });
    await run(COMMAND.remove, orphan);
    assert.ok(fs.existsSync(fx.catalogFormDescriptor));
    assert.strictEqual(errorMessages.length, 1);
    assert.match(errorMessages[0], /объект-владелец/i);
    assert.strictEqual(openDialogCalls, 0, 'форма опознана — на ручной ввод не переключаемся');
  });

  fixtureTest('узел общей формы: владельца нет — команда переходит на ручной ввод (общую форму эта команда не удаляет)', {}, async (fx, run) => {
    openDialogAnswers = [undefined];
    await run(COMMAND.remove, commonFormNode(fx));
    assertNoErrors();
    assert.strictEqual(openDialogCalls, 1);
    assert.ok(fs.existsSync(fx.commonFormXml), 'общая форма на месте');
  });

  fixtureTest('без узла: путь объекта и имя формы спрашиваются, удаление проходит', {}, async (fx, run) => {
    openDialogAnswers = [[vscode.Uri.file(fx.catalogXml)]];
    inputBoxAnswers = [fx.catalogFormName];
    await run(COMMAND.remove);
    assertNoErrors();
    assertFormGone(fx);
    assert.strictEqual(openDialogCalls, 1);
    assert.strictEqual(inputBoxOptions.length, 1);
  });

  fixtureTest('без узла: диалог выбора объекта отменён → ничего не происходит', {}, async (fx, run) => {
    openDialogAnswers = [undefined];
    await run(COMMAND.remove);
    assertNoErrors();
    assert.ok(fs.existsSync(fx.catalogFormDescriptor));
    assert.deepStrictEqual(inputBoxOptions, [], 'имя формы не спрашивается без объекта');
  });

  fixtureTest('без узла: имя формы не введено → ничего не происходит', {}, async (fx, run) => {
    openDialogAnswers = [[vscode.Uri.file(fx.catalogXml)]];
    inputBoxAnswers = [undefined];
    await run(COMMAND.remove);
    assertNoErrors();
    assert.ok(fs.existsSync(fx.catalogFormDescriptor));
    assert.deepStrictEqual(warningMessages, []);
  });

  fixtureTest('несуществующая форма → отказ сервиса уходит в уведомление', {}, async (fx, run) => {
    openDialogAnswers = [[vscode.Uri.file(fx.catalogXml)]];
    inputBoxAnswers = ['НетТакойФормы'];
    await run(COMMAND.remove);
    assert.strictEqual(errorMessages.length, 1, errorMessages.join('\n'));
    assert.match(errorMessages[0], /Не удалось удалить форму/);
    assert.ok(fs.existsSync(fx.catalogFormDescriptor), 'существующая форма не пострадала');
    assert.strictEqual(fx.harness.postMutation.refreshActionsView, 0);
  });
});

suite('Команды навигатора: формы — добавление', () => {
  setup(() => {
    resetDialogState();
    installDialogStubs();
  });
  teardown(restoreDialogStubs);

  fixtureTest('узел объекта: форма создаётся, пост-мутационный путь запускается, имя проверяется как идентификатор 1С', {}, async (fx, run) => {
    inputBoxAnswers = ['ФормаСписка', 'Список товаров'];
    quickPickAnswers = ['List'];
    await run(COMMAND.add, catalogNode(fx));
    assertNoErrors();
    assert.strictEqual(openDialogCalls, 0);
    const descriptor = path.join(fx.configRoot, 'Catalogs', fx.catalogName, 'Forms', 'ФормаСписка.xml');
    assert.ok(fs.existsSync(descriptor));
    assert.ok(fs.existsSync(path.join(fx.configRoot, 'Catalogs', fx.catalogName, 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')));
    assert.strictEqual(infoMessages.length, 1);
    assert.match(infoMessages[0], /Форма ФормаСписка добавлена/);
    const log = fx.harness.postMutation;
    assert.strictEqual(log.suppress.length, 1);
    assert.strictEqual(log.markChanged.length, 1);
    assert.strictEqual(log.refreshActionsView, 1);

    // validateInput диалога имени — часть контракта команды: без неё в выгрузку попадёт
    // недопустимое имя объекта метаданных.
    const validate = inputBoxOptions[0].validateInput?.bind(inputBoxOptions[0]);
    assert.ok(validate);
    assert.strictEqual(validate('ФормаЭлемента2'), undefined);
    assert.strictEqual(validate('2ФормаЭлемента'), 'Введите идентификатор 1С');
  });

  fixtureTest('без узла: путь объекта спрашивается диалогом', {}, async (fx, run) => {
    openDialogAnswers = [[vscode.Uri.file(fx.catalogXml)]];
    inputBoxAnswers = ['ФормаВыбора', 'Выбор'];
    quickPickAnswers = ['Choice'];
    await run(COMMAND.add);
    assertNoErrors();
    assert.strictEqual(openDialogCalls, 1);
    assert.ok(fs.existsSync(path.join(fx.configRoot, 'Catalogs', fx.catalogName, 'Forms', 'ФормаВыбора.xml')));
  });

  fixtureTest('без узла: диалог отменён → форма не создаётся, имя не спрашивается', {}, async (_fx, run) => {
    openDialogAnswers = [undefined];
    await run(COMMAND.add);
    assertNoErrors();
    assert.deepStrictEqual(inputBoxOptions, []);
  });

  fixtureTest('имя формы не введено → форма не создаётся', {}, async (fx, run) => {
    inputBoxAnswers = [undefined];
    await run(COMMAND.add, catalogNode(fx));
    assertNoErrors();
    assert.strictEqual(fx.harness.postMutation.refreshActionsView, 0);
  });

  fixtureTest('назначение формы не выбрано → форма не создаётся', {}, async (fx, run) => {
    inputBoxAnswers = ['ФормаСписка'];
    quickPickAnswers = [undefined];
    await run(COMMAND.add, catalogNode(fx));
    assertNoErrors();
    assert.ok(!fs.existsSync(path.join(fx.configRoot, 'Catalogs', fx.catalogName, 'Forms', 'ФормаСписка.xml')));
  });

  fixtureTest('синоним не введён (диалог закрыт) → форма не создаётся', {}, async (fx, run) => {
    inputBoxAnswers = ['ФормаСписка', undefined];
    quickPickAnswers = ['List'];
    await run(COMMAND.add, catalogNode(fx));
    assertNoErrors();
    assert.ok(!fs.existsSync(path.join(fx.configRoot, 'Catalogs', fx.catalogName, 'Forms', 'ФормаСписка.xml')));
  });

  fixtureTest('форма с таким именем уже есть → отказ сервиса уходит в уведомление', {}, async (fx, run) => {
    inputBoxAnswers = [fx.catalogFormName, 'Повтор'];
    quickPickAnswers = ['Object'];
    await run(COMMAND.add, catalogNode(fx));
    assert.strictEqual(errorMessages.length, 1, errorMessages.join('\n'));
    assert.match(errorMessages[0], /Не удалось добавить форму/);
    assert.strictEqual(fx.harness.postMutation.refreshActionsView, 0);
  });

  test('изменённые файлы вне дерева → полный refresh дерева (кэш точечно обновить нечего)', async function () {
    this.timeout(60_000);
    // Дерево построено над ОДНОЙ выгрузкой, а команда правит другую: refreshCacheForFiles
    // не находит совпавшей конфигурации и возвращает false — тогда нужен полный refresh.
    const inTree = createFormFixtureExport();
    const outside = createFormFixtureExport();
    const harness = createFormMcpHarnessOverEntry({ rootPath: inTree.configRoot, kind: 'cf' });
    const stand = createFormCommandsStand(harness);
    const treeEvents: unknown[] = [];
    const subscription = harness.treeProvider.onDidChangeTreeData((node) => { treeEvents.push(node); });
    try {
      openDialogAnswers = [[vscode.Uri.file(outside.catalogXml)]];
      inputBoxAnswers = ['ФормаСписка', 'Список'];
      quickPickAnswers = ['List'];
      await stand.run(COMMAND.add);
      assertNoErrors();
      assert.ok(fs.existsSync(path.join(outside.configRoot, 'Catalogs', outside.catalogName, 'Forms', 'ФормаСписка.xml')));
      assert.deepStrictEqual(treeEvents, [undefined], 'полный refresh: одно событие без конкретного узла');
      assert.strictEqual(harness.postMutation.refreshActionsView, 1);
    } finally {
      subscription.dispose();
      harness.dispose();
      fs.rmSync(inTree.configRoot, { recursive: true, force: true });
      fs.rmSync(outside.configRoot, { recursive: true, force: true });
    }
  });
});
