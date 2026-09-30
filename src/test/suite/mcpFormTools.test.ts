import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SupportMode } from '../../infra/support/SupportInfoService';
import { parseObjectXml } from '../../infra/xml';
import { FormValidateService } from '../../infra/xml/form/FormValidateService';
import { isFormRootXml } from '../../infra/xml/form/FormShared';
import { diffSnapshots, directoriesNamedAsXml, snapshotTree } from './support/fsSnapshot';
import { EXAMPLE_ROOT, hasFormCorpus } from './support/formFixtures';
import {
  CATALOG_FORM_TITLE,
  COMMON_FORM_TITLE,
  createFormMcpFixture,
  createFormMcpHarnessOverEntry,
  isToolError,
  toolText,
  type FormMcpFixture,
  type FormMcpHarnessOptions,
} from './support/mcpFormToolsHarness';

/**
 * T4/T7/T8. MCP-инструменты форм (`form_info`, `validate_form`, `compile_form`, `edit_form`,
 * `remove_form`) на настоящей выгрузке и настоящем дереве навигатора.
 *
 * Дефект: узел формы объекта несёт `xmlPath` объекта-владельца (адрес открытия по клику), а
 * MCP брал его за путь формы. Отсюда: `validate_form` читал XML справочника как форму,
 * `compile_form` строил `Catalogs/X.xml/Ext/Form.xml` (ENOTDIR), а `edit_form` ПИСАЛ правку
 * формы поверх XML объекта метаданных. Каждый инструмент проверяется для ОБОИХ видов формы
 * (форма объекта и общая форма): у них разные `xmlPath` и разный путь тела.
 */

const TOOL = {
  info: 'v8vscedit_form_info',
  validate: 'v8vscedit_validate_form',
  compile: 'v8vscedit_compile_form',
  edit: 'v8vscedit_edit_form',
  remove: 'v8vscedit_remove_form',
} as const;

interface FormKindCase {
  readonly label: string;
  readonly canonical: (fx: FormMcpFixture) => string;
  readonly body: (fx: FormMcpFixture) => string;
  readonly title: string;
  /** Файлы, которые инструмент над ТЕЛОМ формы не вправе тронуть ни на байт. */
  readonly untouched: (fx: FormMcpFixture) => readonly string[];
}

const KINDS: readonly FormKindCase[] = [
  {
    label: 'форма объекта (Справочники.X.Форма.Y)',
    canonical: (fx) => `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`,
    body: (fx) => fx.catalogFormBody,
    title: CATALOG_FORM_TITLE,
    untouched: (fx) => [fx.catalogXml, fx.catalogFormDescriptor],
  },
  {
    label: 'общая форма (ОбщиеФормы.X)',
    canonical: (fx) => `ОбщиеФормы.${fx.commonFormName}`,
    body: (fx) => fx.commonFormBody,
    title: COMMON_FORM_TITLE,
    untouched: (fx) => [fx.commonFormXml],
  },
];

/** Тест с собственной свежей выгрузкой: мутирующие инструменты не должны делить состояние друг с другом. */
function fixtureTest(
  title: string,
  options: FormMcpHarnessOptions,
  body: (fx: FormMcpFixture) => Promise<void> | void,
): void {
  test(title, async function () {
    this.timeout(60_000);
    const fx = createFormMcpFixture(options);
    try {
      await body(fx);
    } finally {
      fx.dispose();
    }
  });
}

/** Разбирает JSON успешного ответа; ошибочный ответ инструмента — сразу провал теста с текстом ошибки. */
function parse(result: CallToolResult): unknown {
  assert.ok(!isToolError(result), `инструмент не должен возвращать ошибку: ${toolText(result)}`);
  return JSON.parse(toolText(result));
}

interface MutationJson { changedFiles: string[] }
interface ValidateJson { formPath: string; errors: number; warnings: number; checks: number; lines: string[] }
interface InfoJson {
  formPath: string;
  title: string;
  baseForm?: string;
  attributes: { name: string; main?: boolean }[];
}

function parseMutation(result: CallToolResult): MutationJson {
  return parse(result) as MutationJson;
}

function parseValidate(result: CallToolResult): ValidateJson {
  return parse(result) as ValidateJson;
}

function parseInfo(result: CallToolResult): InfoJson {
  return parse(result) as InfoJson;
}

function rel(fx: FormMcpFixture, absolute: string): string {
  return path.relative(fx.configRoot, absolute);
}

function assertGateFired(fx: FormMcpFixture, changedFiles: readonly string[], label: string): void {
  const log = fx.harness.postMutation;
  assert.ok(changedFiles.length > 0, `${label}: changedFiles не должен быть пустым`);
  assert.deepStrictEqual(log.suppress, [[...changedFiles]], `${label}: suppressConfigurationReloadForFiles — ровно один раз с изменёнными файлами`);
  assert.deepStrictEqual(log.markChanged, [[...changedFiles]], `${label}: markChangedConfigurationByFiles — ровно один раз`);
  assert.strictEqual(log.refreshActionsView, 1, `${label}: refreshActionsView — ровно один раз`);
}

function assertGateNotFired(fx: FormMcpFixture, label: string): void {
  const log = fx.harness.postMutation;
  assert.deepStrictEqual(log.suppress, [], `${label}: post-mutation путь не должен запускаться`);
  assert.deepStrictEqual(log.markChanged, [], label);
  assert.strictEqual(log.refreshActionsView, 0, label);
}

suite('MCP-инструменты форм: edit_form (T4)', () => {
  fixtureTest('ГЛАВНЫЙ НЕГАТИВ: edit_form по Справочники.X.Форма.Y не изменяет XML справочника ни на байт, меняется ровно тело формы', {}, async (fx) => {
    const catalogBefore = fs.readFileSync(fx.catalogXml);
    const tree = snapshotTree(fx.configRoot);
    const result = await fx.harness.call(TOOL.edit, {
      path: `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`,
      definition: { attributes: [{ name: 'НовыйРеквизит', type: 'string(20)' }] },
    });
    const parsed = parseMutation(result);

    assert.ok(fs.readFileSync(fx.catalogXml).equals(catalogBefore),
      'XML справочника изменён: правка формы записана поверх XML объекта метаданных');
    const catalogText = fs.readFileSync(fx.catalogXml, 'utf-8');
    assert.ok(catalogText.includes('<Catalog'), 'XML справочника всё ещё описывает справочник');
    assert.ok(catalogText.includes(`<Form>${fx.catalogFormName}</Form>`), 'регистрация формы в ChildObjects сохранилась');
    assert.strictEqual(parseObjectXml(fx.catalogXml)?.name, fx.catalogName, 'объект по-прежнему читается ридером метаданных');

    assert.deepStrictEqual(parsed.changedFiles, [fx.catalogFormBody], 'changedFiles — ровно тело формы');
    assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), [rel(fx, fx.catalogFormBody)]);
    const bodyText = fs.readFileSync(fx.catalogFormBody, 'utf-8');
    assert.ok(isFormRootXml(bodyText));
    assert.ok(bodyText.includes('НовыйРеквизит'), 'правка легла в тело формы');
  });

  for (const kind of KINDS) {
    fixtureTest(`${kind.label}: правка ложится в тело; XML владельца/дескриптор не тронуты; гейт запущен один раз`, {}, async (fx) => {
      const untouchedBefore = kind.untouched(fx).map((file) => fs.readFileSync(file));
      const tree = snapshotTree(fx.configRoot);
      const parsed = parseMutation(await fx.harness.call(TOOL.edit, {
        path: kind.canonical(fx),
        definition: { attributes: [{ name: 'НовыйРеквизит', type: 'string(20)' }] },
      }));

      assert.deepStrictEqual(parsed.changedFiles, [kind.body(fx)]);
      assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), [rel(fx, kind.body(fx))]);
      kind.untouched(fx).forEach((file, index) => {
        assert.ok(fs.readFileSync(file).equals(untouchedBefore[index]), `не должен меняться: ${file}`);
      });
      assert.ok(fs.readFileSync(kind.body(fx), 'utf-8').includes('НовыйРеквизит'));
      assertGateFired(fx, parsed.changedFiles, `edit_form ${kind.label}`);
    });

    fixtureTest(`${kind.label}: повторная правка той же формы работает (дерево после пост-мутационного пути согласовано)`, {}, async (fx) => {
      await fx.harness.call(TOOL.edit, {
        path: kind.canonical(fx),
        definition: { attributes: [{ name: 'Первый', type: 'string(20)' }] },
      });
      const second = parseMutation(await fx.harness.call(TOOL.edit, {
        path: kind.canonical(fx),
        definition: { attributes: [{ name: 'Второй', type: 'string(20)' }] },
      }));
      assert.deepStrictEqual(second.changedFiles, [kind.body(fx)]);
      const text = fs.readFileSync(kind.body(fx), 'utf-8');
      assert.ok(text.includes('Первый') && text.includes('Второй'));
    });
  }
});

suite('MCP-инструменты форм: compile_form (T4)', () => {
  const definition = {
    title: 'Скомпилированная форма',
    attributes: [{ name: 'Поле', type: 'string(50)' }],
  };

  for (const kind of KINDS) {
    fixtureTest(`${kind.label}: нет ENOTDIR, пишется ровно тело; каталогов «X.xml» не появляется; гейт запущен`, {}, async (fx) => {
      const untouchedBefore = kind.untouched(fx).map((file) => fs.readFileSync(file));
      const tree = snapshotTree(fx.configRoot);
      const parsed = parseMutation(await fx.harness.call(TOOL.compile, {
        path: kind.canonical(fx),
        definition,
      }));

      const after = snapshotTree(fx.configRoot);
      assert.deepStrictEqual(parsed.changedFiles, [kind.body(fx)]);
      assert.deepStrictEqual(diffSnapshots(tree, after), [rel(fx, kind.body(fx))]);
      assert.deepStrictEqual(directoriesNamedAsXml(after), [], 'файл .xml использован как каталог пути (Catalogs/X.xml/…, CommonForms/X.xml/…)');
      kind.untouched(fx).forEach((file, index) => {
        assert.ok(fs.readFileSync(file).equals(untouchedBefore[index]), `не должен меняться: ${file}`);
      });
      const text = fs.readFileSync(kind.body(fx), 'utf-8');
      assert.ok(isFormRootXml(text));
      assert.ok(text.includes('Скомпилированная форма'));
      assertGateFired(fx, parsed.changedFiles, `compile_form ${kind.label}`);
    });
  }

  fixtureTest('общая форма: не появляется CommonForms/X/Forms/**, дескриптор CommonForms/X.xml остаётся файлом и не переписан', {}, async (fx) => {
    const descriptorBefore = fs.readFileSync(fx.commonFormXml);
    parse(await fx.harness.call(TOOL.compile, { path: `ОбщиеФормы.${fx.commonFormName}`, definition }));
    assert.ok(!fs.existsSync(path.join(fx.configRoot, 'CommonForms', fx.commonFormName, 'Forms')), 'общая форма не владеет каталогом Forms');
    assert.ok(fs.statSync(fx.commonFormXml).isFile(), 'CommonForms/X.xml по-прежнему файл');
    assert.ok(fs.readFileSync(fx.commonFormXml).equals(descriptorBefore));
  });

  fixtureTest('форма объекта: ничего не построено «под» Catalogs/X.xml, XML справочника не переписан', {}, async (fx) => {
    const catalogBefore = fs.readFileSync(fx.catalogXml);
    parse(await fx.harness.call(TOOL.compile, {
      path: `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`,
      definition,
    }));
    assert.ok(fs.statSync(fx.catalogXml).isFile());
    assert.ok(fs.readFileSync(fx.catalogXml).equals(catalogBefore));
  });
});

suite('MCP-инструменты форм: validate_form (T4)', () => {
  for (const kind of KINDS) {
    fixtureTest(`${kind.label}: в отчёте нет «AutoCommandBar element missing», вердикт = прямому прогону FormValidateService по Form.xml`, {}, async (fx) => {
      const tree = snapshotTree(fx.configRoot);
      const viaMcp = parseValidate(
        await fx.harness.call(TOOL.validate, { path: kind.canonical(fx), detailed: true }),
      );
      const direct = new FormValidateService().validate({ formPath: kind.body(fx), detailed: true });

      assert.ok(!viaMcp.lines.some((line) => line.includes('AutoCommandBar element missing')), viaMcp.lines.join('\n'));
      assert.strictEqual(viaMcp.formPath, kind.body(fx));
      assert.strictEqual(viaMcp.errors, 0, viaMcp.lines.join('\n'));
      assert.deepStrictEqual(viaMcp, JSON.parse(JSON.stringify(direct)));
      assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), [], 'validate_form — read-only');
      assertGateNotFired(fx, `validate_form ${kind.label}`);
    });

    fixtureTest(`${kind.label}: настоящий дефект тела ловится (сообщение «AutoCommandBar element missing» — про форму, а не про XML объекта)`, {}, async (fx) => {
      // Убираем AutoCommandBar из тела: инструмент обязан прочитать ИМЕННО тело и честно
      // сообщить об этом. Раньше та же строка возникала на любой форме объекта из-за чтения
      // XML справочника, то есть была шумом, а не диагностикой.
      const body = kind.body(fx);
      const original = fs.readFileSync(body, 'utf-8');
      const broken = original.replace(/<AutoCommandBar\b[^>]*\/>\s*/, '');
      assert.notStrictEqual(broken, original, 'предусловие: AutoCommandBar действительно удалён');
      fs.writeFileSync(body, broken, 'utf-8');
      const viaMcp = parseValidate(
        await fx.harness.call(TOOL.validate, { path: kind.canonical(fx), detailed: true }),
      );
      const direct = new FormValidateService().validate({ formPath: body, detailed: true });
      assert.ok(viaMcp.errors >= 1);
      assert.ok(viaMcp.lines.some((line) => line.includes('AutoCommandBar element missing')), viaMcp.lines.join('\n'));
      assert.deepStrictEqual(viaMcp, JSON.parse(JSON.stringify(direct)));
    });
  }
});

suite('MCP-инструменты форм: form_info (T4)', () => {
  for (const kind of KINDS) {
    fixtureTest(`${kind.label}: formPath — тело формы, title — заголовок формы, а не имя объекта`, {}, async (fx) => {
      const tree = snapshotTree(fx.configRoot);
      const info = parseInfo(
        await fx.harness.call(TOOL.info, { path: kind.canonical(fx) }),
      );
      assert.strictEqual(info.formPath, kind.body(fx));
      assert.strictEqual(info.title, kind.title);
      assert.notStrictEqual(info.title, fx.catalogName, 'заголовок формы не должен подменяться именем объекта');
      assert.notStrictEqual(info.title, fx.commonFormName);
      assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), [], 'form_info — read-only');
      assertGateNotFired(fx, `form_info ${kind.label}`);
    });
  }

  fixtureTest('форма объекта: реквизиты берутся из тела формы (главный реквизит «Объект»)', {}, async (fx) => {
    const info = parseInfo(
      await fx.harness.call(TOOL.info, { path: `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}` }),
    );
    assert.ok(info.attributes.some((attribute) => attribute.name === 'Объект' && attribute.main === true), JSON.stringify(info.attributes));
  });
});

suite('MCP-инструменты форм: remove_form (T7, анти-регресс)', () => {
  fixtureTest('форма объекта: дескриптор и каталог исчезают, регистрация и DefaultObjectForm сняты, общая форма цела', {}, async (fx) => {
    const commonBefore = fs.readFileSync(fx.commonFormBody);
    assert.ok(fs.readFileSync(fx.catalogXml, 'utf-8').includes(`<Form>${fx.catalogFormName}</Form>`), 'предусловие: форма зарегистрирована');
    const tree = snapshotTree(fx.configRoot);

    const parsed = parseMutation(await fx.harness.call(TOOL.remove, {
      path: `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`,
    }));

    assert.ok(!fs.existsSync(fx.catalogFormDescriptor), 'дескриптор Forms/Y.xml удалён');
    assert.ok(!fs.existsSync(path.dirname(path.dirname(fx.catalogFormBody))), 'каталог формы Forms/Y удалён');
    const catalogText = fs.readFileSync(fx.catalogXml, 'utf-8');
    assert.ok(!catalogText.includes(`<Form>${fx.catalogFormName}</Form>`), 'регистрация формы снята из ChildObjects');
    assert.ok(!catalogText.includes(`.Form.${fx.catalogFormName}`), 'ссылки DefaultForm/DefaultObjectForm очищены');
    assert.ok(catalogText.includes('<Catalog'), 'XML справочника цел');
    assert.ok(parsed.changedFiles.includes(fx.catalogXml));
    assert.ok(parsed.changedFiles.includes(fx.catalogFormDescriptor));
    assert.ok(fs.readFileSync(fx.commonFormBody).equals(commonBefore), 'общая форма не затронута');
    const changed = diffSnapshots(tree, snapshotTree(fx.configRoot));
    assert.ok(
      changed.every((entry) => entry.startsWith(path.join('Catalogs', fx.catalogName))),
      `изменения только внутри справочника: ${changed.join(', ')}`,
    );
    assertGateFired(fx, parsed.changedFiles, 'remove_form');
  });

  fixtureTest('НЕГАТИВ: ОбщиеФормы.X в remove_form отбивается, ничего не удалено, гейт не запущен', {}, async (fx) => {
    const tree = snapshotTree(fx.configRoot);
    const result = await fx.harness.call(TOOL.remove, { path: `ОбщиеФормы.${fx.commonFormName}` });
    assert.ok(isToolError(result));
    assert.match(toolText(result), /форм/i);
    assert.ok(fs.existsSync(fx.commonFormXml) && fs.existsSync(fx.commonFormBody));
    assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), []);
    assertGateNotFired(fx, 'remove_form общая форма');
  });

  fixtureTest('НЕГАТИВ: путь не к форме (справочник) отбивается', {}, async (fx) => {
    const tree = snapshotTree(fx.configRoot);
    const result = await fx.harness.call(TOOL.remove, { path: `Справочники.${fx.catalogName}` });
    assert.ok(isToolError(result));
    assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), []);
    assertGateNotFired(fx, 'remove_form справочник');
  });
});

suite('MCP-инструменты форм: ветки ошибок (T8)', () => {
  const nonFormPaths = (fx: FormMcpFixture): readonly { readonly name: string; readonly canonical: string }[] => [
    { name: 'справочник', canonical: `Справочники.${fx.catalogName}` },
    { name: 'реквизит', canonical: `Справочники.${fx.catalogName}.${fx.attributeName}` },
    { name: 'макет', canonical: `Справочники.${fx.catalogName}.Макет.${fx.templateName}` },
    { name: 'подсистема', canonical: `Подсистема.${fx.subsystemName}` },
  ];

  for (const tool of [TOOL.info, TOOL.validate, TOOL.compile, TOOL.edit]) {
    fixtureTest(`${tool}: путь не к форме → ошибка про форму, выгрузка не тронута, гейт не запущен`, {}, async (fx) => {
      const tree = snapshotTree(fx.configRoot);
      for (const target of nonFormPaths(fx)) {
        const result = await fx.harness.call(tool, { path: target.canonical, definition: {} });
        assert.ok(isToolError(result), `${target.name}: ${toolText(result)}`);
        assert.match(toolText(result), /форм/i, target.name);
      }
      assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), []);
      assertGateNotFired(fx, tool);
    });
  }

  for (const tool of [TOOL.compile, TOOL.edit]) {
    fixtureTest(`${tool}: в теле формы лежит XML объекта (состояние после старого дефекта) → отказ, ничего не записано`, {}, async (fx) => {
      fs.writeFileSync(fx.catalogFormBody, fs.readFileSync(fx.catalogXml));
      const tree = snapshotTree(fx.configRoot);
      const result = await fx.harness.call(tool, {
        path: `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`,
        definition: { title: 'Не должно записаться', attributes: [{ name: 'Х', type: 'string(10)' }] },
      });
      assert.ok(isToolError(result), toolText(result));
      assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), [], 'ни одного изменённого/созданного файла');
      assertGateNotFired(fx, tool);
    });
  }

  fixtureTest('validate_form: в теле формы лежит XML объекта → отчёт с ровно одной ошибкой корня, без лавины ложных', {}, async (fx) => {
    fs.writeFileSync(fx.catalogFormBody, fs.readFileSync(fx.catalogXml));
    const report = parseValidate(await fx.harness.call(TOOL.validate, {
      path: `Справочники.${fx.catalogName}.Форма.${fx.catalogFormName}`,
      detailed: true,
    }));
    assert.strictEqual(report.errors, 1, report.lines.join('\n'));
    assert.ok(!report.lines.some((line) => line.includes('AutoCommandBar element missing')));
  });

  const lockCases: readonly { readonly name: string; readonly options: FormMcpHarnessOptions; readonly message: RegExp }[] = [
    { name: 'поддержка с запретом редактирования (Locked)', options: { supportMode: SupportMode.Locked }, message: /поддержке/ },
    { name: 'объект не захвачен в хранилище', options: { repositoryRestricted: true }, message: /хранилищ/ },
  ];
  for (const lock of lockCases) {
    for (const kind of KINDS) {
      for (const tool of [TOOL.edit, TOOL.compile, TOOL.remove]) {
        if (tool === TOOL.remove && kind === KINDS[1]) {
          continue; // remove_form общей формы отбивается ещё раньше (см. remove_form, T7): блокировка не достигается.
        }
        fixtureTest(`${tool} × ${kind.label}: ${lock.name} — отказ ДО резолвинга тела, файлы не тронуты`, lock.options, async (fx) => {
          const tree = snapshotTree(fx.configRoot);
          const result = await fx.harness.call(tool, {
            path: kind.canonical(fx),
            definition: { title: 'Не должно записаться', attributes: [{ name: 'Х', type: 'string(10)' }] },
          });
          assert.ok(isToolError(result), toolText(result));
          assert.match(toolText(result), lock.message);
          assert.deepStrictEqual(diffSnapshots(tree, snapshotTree(fx.configRoot)), []);
          assertGateNotFired(fx, `${tool} ${lock.name}`);
          if (lock.options.supportMode !== undefined) {
            // Проверка блокировки идёт по XML ВЛАДЕЛЬЦА формы (для общей формы — по её собственному XML).
            const expectedOwner = kind === KINDS[0] ? fx.catalogXml : fx.commonFormXml;
            assert.deepStrictEqual(fx.harness.supportQueries, [expectedOwner]);
          }
        });
      }
    }

    fixtureTest(`${lock.name}: проверка блокировки идёт раньше проверки вида узла (путь не к форме тоже отбивается блокировкой)`, lock.options, async (fx) => {
      const result = await fx.harness.call(TOOL.edit, { path: `Справочники.${fx.catalogName}`, definition: {} });
      assert.ok(isToolError(result));
      assert.match(toolText(result), lock.message);
    });
  }

  for (const kind of KINDS) {
    for (const tool of [TOOL.info, TOOL.validate]) {
      fixtureTest(`${tool} × ${kind.label}: read-only инструмент работает и при блокировке объекта`, { supportMode: SupportMode.Locked, repositoryRestricted: true }, async (fx) => {
        const result = await fx.harness.call(tool, { path: kind.canonical(fx) });
        assert.ok(!isToolError(result), toolText(result));
        assert.strictEqual(fx.harness.supportQueries.length, 0, 'read-only инструмент не спрашивает про блокировку');
        assert.strictEqual(fx.harness.repositoryQueries.length, 0);
      });
    }
  }
});

suite('MCP-инструменты форм на реальном расширении EVOLC (T4, CFE, read-only)', () => {
  const evolc = path.join(EXAMPLE_ROOT, '2.21', 'src', 'cfe', 'EVOLC');

  suiteSetup(function () {
    if (!hasFormCorpus() || !fs.existsSync(evolc)) {
      this.skip();
    }
  });

  const cases = [
    {
      label: 'заимствованная форма справочника (в теле есть <BaseForm>)',
      canonical: 'Справочники.Пользователи.Форма.ФормаЭлемента',
      body: path.join(evolc, 'Catalogs', 'Пользователи', 'Forms', 'ФормаЭлемента', 'Ext', 'Form.xml'),
      hasBaseForm: true,
    },
    {
      label: 'общая форма расширения',
      canonical: 'ОбщиеФормы.ев_ВыборУчастника',
      body: path.join(evolc, 'CommonForms', 'ев_ВыборУчастника', 'Ext', 'Form.xml'),
      hasBaseForm: false,
    },
  ] as const;

  for (const c of cases) {
    test(`${c.label}: form_info и validate_form читают тело формы`, async function () {
      this.timeout(120_000);
      const harness = createFormMcpHarnessOverEntry({ rootPath: evolc, kind: 'cfe' });
      try {
        const info = parseInfo(await harness.call(TOOL.info, { path: c.canonical }));
        assert.strictEqual(info.formPath, c.body);
        assert.strictEqual(info.baseForm !== undefined, c.hasBaseForm, `baseForm: ${String(info.baseForm)}`);

        const viaMcp = parseValidate(
          await harness.call(TOOL.validate, { path: c.canonical, detailed: true }),
        );
        const direct = new FormValidateService().validate({ formPath: c.body, detailed: true });
        assert.strictEqual(viaMcp.formPath, c.body);
        assert.deepStrictEqual(viaMcp, JSON.parse(JSON.stringify(direct)));
        assert.ok(!viaMcp.lines.some((line) => line.includes('Root element is not Form')), 'форма расширения — не «XML объекта»');
      } finally {
        harness.dispose();
      }
    });
  }
});
