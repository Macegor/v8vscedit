import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FormCompileService } from '../../infra/xml/form/FormCompileService';
import { FormEditService } from '../../infra/xml/form/FormEditService';
import { FormInfoService } from '../../infra/xml/form/FormInfoService';
import { FormValidateService } from '../../infra/xml/form/FormValidateService';
import { isFormRootXml } from '../../infra/xml/form/FormShared';
import { diffSnapshots, snapshotTree } from './support/fsSnapshot';
import {
  CATALOG_FORM_TITLE,
  COMMON_FORM_TITLE,
  createFormFixtureExport,
  type FormFixtureExport,
} from './support/mcpFormToolsHarness';

/**
 * Guard корневого элемента в сервисах форм (T5/T8): `FormEditService`/`FormInfoService`
 * читают через `readFormXml` (бросок ДО любой мутации), `FormValidateService` остаётся
 * report-стилем (read-only инструмент: одна честная ошибка вместо пачки ложных),
 * `FormCompileService` отказывается перезаписать существующий файл, не являющийся формой.
 *
 * Общий смысл: раньше правка формы по пути, оказавшемуся XML объекта метаданных, тихо
 * перезаписывала этот XML. Теперь ни один из инструментов не должен изменить ни байта.
 */

const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>';
const CATALOG_XML = [
  PROLOG,
  '<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.21">',
  '\t<Catalog uuid="11111111-1111-1111-1111-111111111111">',
  '\t\t<Properties><Name>Товары</Name></Properties>',
  '\t\t<ChildObjects>',
  '\t\t\t<Form>ФормаСписка</Form>',
  '\t\t</ChildObjects>',
  '\t</Catalog>',
  '</MetaDataObject>',
  '',
].join('\n');

/** Содержимое, которое НЕ является формой и которое сервис не вправе затирать/читать как форму. */
const NON_FORM_CONTENTS: readonly { readonly name: string; readonly text: string }[] = [
  { name: 'XML объекта метаданных с <Form> в ChildObjects', text: CATALOG_XML },
  { name: 'XML объекта метаданных с BOM', text: `\uFEFF${CATALOG_XML}` },
  { name: 'корень GraphicalSchema', text: `${PROLOG}\n<GraphicalSchema xmlns="http://v8.1c.ru/8.3/xcf/scheme"/>` },
  { name: 'не XML', text: 'просто текст' },
];

function mkTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Кладёт `text` в `<root>/Форма/Ext/Form.xml` и возвращает путь: файл, названный формой, но формой не являющийся. */
function writeFakeFormBody(root: string, text: string): string {
  const target = path.join(root, 'Форма', 'Ext', 'Form.xml');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, 'utf-8');
  return target;
}

suite('FormEditService / FormInfoService — guard корня и отсутствующего тела (T5/T8)', () => {
  const edit = (formPath: string): unknown => new FormEditService().edit({
    formPath,
    definition: { attributes: [{ name: 'Новый', type: 'string(10)' }] },
  });
  const info = (formPath: string): unknown => new FormInfoService().info({ formPath });
  const services: readonly { readonly name: string; readonly run: (formPath: string) => unknown }[] = [
    { name: 'FormEditService.edit', run: edit },
    { name: 'FormInfoService.info', run: info },
  ];

  for (const service of services) {
    suite(service.name, () => {
      for (const content of NON_FORM_CONTENTS) {
        test(`файл Form.xml с содержимым «${content.name}» → бросок, файл не тронут`, () => {
          const root = mkTmp('v8vscedit-guard-');
          try {
            const target = writeFakeFormBody(root, content.text);
            const before = snapshotTree(root);
            assert.throws(() => service.run(target), (error: unknown) => {
              assert.ok(error instanceof Error);
              assert.ok(error.message.includes(target), `сообщение должно называть файл: ${error.message}`);
              return true;
            });
            assert.deepStrictEqual(diffSnapshots(before, snapshotTree(root)), [], 'ничего не должно измениться');
          } finally {
            fs.rmSync(root, { recursive: true, force: true });
          }
        });
      }

      test('XML объекта без тела рядом → «Form.xml не найден», объект не тронут (раньше сервис работал с самим XML объекта)', () => {
        const fixture = createFormFixtureExport();
        try {
          // У справочника нет `Товары/Ext/Form.xml`: именно на такой вход старый резолвер возвращал
          // сам файл объекта, а `edit` затем записывал в него содержимое формы.
          const before = snapshotTree(fixture.configRoot);
          assert.throws(() => service.run(fixture.catalogXml), /Form\.xml не найден/);
          assert.deepStrictEqual(diffSnapshots(before, snapshotTree(fixture.configRoot)), []);
        } finally {
          fs.rmSync(fixture.configRoot, { recursive: true, force: true });
        }
      });

      test('«повреждённое» тело (в Form.xml лежит XML объекта) отвергается без записи — состояние после старого дефекта', () => {
        const fixture = createFormFixtureExport();
        try {
          fs.writeFileSync(fixture.catalogFormBody, fs.readFileSync(fixture.catalogXml));
          const before = snapshotTree(fixture.configRoot);
          assert.throws(() => service.run(fixture.catalogFormBody), /XML объекта метаданных/);
          assert.deepStrictEqual(diffSnapshots(before, snapshotTree(fixture.configRoot)), []);
        } finally {
          fs.rmSync(fixture.configRoot, { recursive: true, force: true });
        }
      });
    });
  }

  test('edit по дескриптору формы объекта пишет ровно тело формы; дескриптор и XML объекта не тронуты', () => {
    const fixture = createFormFixtureExport();
    try {
      const before = snapshotTree(fixture.configRoot);
      const result = new FormEditService().edit({
        formPath: fixture.catalogFormDescriptor,
        definition: { attributes: [{ name: 'Новый', type: 'string(10)' }] },
      });
      assert.deepStrictEqual(result.changedFiles, [fixture.catalogFormBody]);
      const changed = diffSnapshots(before, snapshotTree(fixture.configRoot));
      assert.deepStrictEqual(changed, [path.relative(fixture.configRoot, fixture.catalogFormBody)]);
      assert.ok(fs.readFileSync(fixture.catalogFormBody, 'utf-8').includes('Новый'));
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });

  test('edit по дескриптору общей формы пишет ровно тело общей формы', () => {
    const fixture = createFormFixtureExport();
    try {
      const before = snapshotTree(fixture.configRoot);
      const result = new FormEditService().edit({
        formPath: fixture.commonFormXml,
        definition: { attributes: [{ name: 'Поле', type: 'string(10)' }] },
      });
      assert.deepStrictEqual(result.changedFiles, [fixture.commonFormBody]);
      assert.deepStrictEqual(
        diffSnapshots(before, snapshotTree(fixture.configRoot)),
        [path.relative(fixture.configRoot, fixture.commonFormBody)],
      );
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });

  test('info по дескриптору формы читает тело: formPath — тело, title — заголовок формы, а не имя объекта', () => {
    const fixture = createFormFixtureExport();
    try {
      const catalogInfo = new FormInfoService().info({ formPath: fixture.catalogFormDescriptor });
      assert.strictEqual(catalogInfo.formPath, fixture.catalogFormBody);
      assert.strictEqual(catalogInfo.title, CATALOG_FORM_TITLE);
      const commonInfo = new FormInfoService().info({ formPath: fixture.commonFormXml });
      assert.strictEqual(commonInfo.formPath, fixture.commonFormBody);
      assert.strictEqual(commonInfo.title, COMMON_FORM_TITLE);
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });
});

suite('FormValidateService — корень проверяется по первому элементу, report-стиль сохранён (T5)', () => {
  const service = new FormValidateService();

  test('XML объекта под именем Form.xml с <Form>ФормаСписка</Form> в ChildObjects → ровно одна ошибка, без лавины ложных', () => {
    const root = mkTmp('v8vscedit-validate-guard-');
    try {
      // Подстрока `<Form` в этом XML есть (регистрация формы в ChildObjects), но корень — MetaDataObject:
      // старая проверка проходила и выдавала пачку ложных ошибок вроде «AutoCommandBar element missing».
      const target = writeFakeFormBody(root, CATALOG_XML);
      const result = service.validate({ formPath: target, detailed: true });
      assert.strictEqual(result.errors, 1, result.lines.join('\n'));
      const errorLines = result.lines.filter((line) => line.startsWith('[ERROR]'));
      assert.strictEqual(errorLines.length, 1, result.lines.join('\n'));
      assert.match(errorLines[0], /Root element is not Form|объекта метаданных/);
      assert.ok(!result.lines.some((line) => line.includes('AutoCommandBar element missing')), result.lines.join('\n'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const content of NON_FORM_CONTENTS) {
    test(`не выбрасывает, а сообщает об ошибке корня: ${content.name}`, () => {
      const root = mkTmp('v8vscedit-validate-guard-');
      try {
        const target = writeFakeFormBody(root, content.text);
        const before = snapshotTree(root);
        const result = service.validate({ formPath: target, detailed: true });
        assert.strictEqual(result.errors, 1, result.lines.join('\n'));
        assert.ok(!result.lines.some((line) => line.includes('AutoCommandBar element missing')));
        assert.deepStrictEqual(diffSnapshots(before, snapshotTree(root)), [], 'validate — read-only');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('форма с XML-комментарием и BOM перед корнем валидна так же, как без комментария (guard не даёт ложных отказов)', () => {
    const fixture = createFormFixtureExport();
    const rootPlain = mkTmp('v8vscedit-validate-plain-');
    const rootCommented = mkTmp('v8vscedit-validate-commented-');
    try {
      const original = fs.readFileSync(fixture.catalogFormBody, 'utf-8');
      const withComment = original.replace(/^(\uFEFF?<\?xml[^?]*\?>\r?\n?)/, '$1<!-- служебный комментарий с <Form> внутри -->\n');
      assert.notStrictEqual(withComment, original, 'предусловие: комментарий действительно вставлен');
      assert.ok(isFormRootXml(withComment));
      const plain = service.validate({ formPath: writeFakeFormBody(rootPlain, original), detailed: true });
      const commented = service.validate({ formPath: writeFakeFormBody(rootCommented, withComment), detailed: true });
      assert.strictEqual(plain.errors, 0, plain.lines.join('\n'));
      assert.strictEqual(commented.errors, plain.errors, commented.lines.join('\n'));
      assert.strictEqual(commented.warnings, plain.warnings);
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
      fs.rmSync(rootPlain, { recursive: true, force: true });
      fs.rmSync(rootCommented, { recursive: true, force: true });
    }
  });

  test('настоящая форма справочника и настоящая общая форма проходят проверку без ошибок', () => {
    const fixture = createFormFixtureExport();
    try {
      assert.strictEqual(service.validate({ formPath: fixture.catalogFormBody, detailed: true }).errors, 0);
      assert.strictEqual(service.validate({ formPath: fixture.commonFormBody, detailed: true }).errors, 0);
      // Через дескриптор — то же тело.
      const viaDescriptor = service.validate({ formPath: fixture.catalogFormDescriptor, detailed: true });
      assert.strictEqual(viaDescriptor.formPath, fixture.catalogFormBody);
      assert.strictEqual(viaDescriptor.errors, 0);
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });
});

suite('FormCompileService — отказ перезаписывать не-Form файл (T8)', () => {
  const service = new FormCompileService();
  const definition = { title: 'Новый заголовок' };

  for (const content of NON_FORM_CONTENTS) {
    test(`существующий Form.xml с содержимым «${content.name}» → отказ, всё нетронуто`, () => {
      const root = mkTmp('v8vscedit-compile-guard-');
      try {
        const target = writeFakeFormBody(root, content.text);
        const before = snapshotTree(root);
        assert.throws(() => service.compile({ outputPath: target, definition }), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(target), `сообщение должно называть файл: ${error.message}`);
          return true;
        });
        assert.deepStrictEqual(diffSnapshots(before, snapshotTree(root)), []);
        assert.strictEqual(fs.readFileSync(target, 'utf-8'), content.text);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('состояние «после старого дефекта»: в Ext/Form.xml формы объекта лежит XML справочника → compile отказывает ДО побочных записей', () => {
    const fixture = createFormFixtureExport();
    try {
      fs.writeFileSync(fixture.catalogFormBody, fs.readFileSync(fixture.catalogXml));
      const before = snapshotTree(fixture.configRoot);
      // Побочные записи compile (регистрация формы в объекте, дескриптор, Module.bsl) происходят ПОСЛЕ
      // записи тела; отказ обязан произойти раньше любой из них.
      assert.throws(() => service.compile({ outputPath: fixture.catalogFormBody, definition }), /XML объекта метаданных|Form/);
      assert.deepStrictEqual(diffSnapshots(before, snapshotTree(fixture.configRoot)), []);
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });

  test('файла ещё нет → guard не применяется, тело формы создаётся (штатное создание)', () => {
    const root = mkTmp('v8vscedit-compile-new-');
    try {
      const target = path.join(root, 'НоваяФорма', 'Ext', 'Form.xml');
      const result = service.compile({ outputPath: target, definition });
      assert.ok(result.changedFiles.includes(target));
      const text = fs.readFileSync(target, 'utf-8');
      assert.ok(isFormRootXml(text));
      assert.ok(text.includes('Новый заголовок'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('существующая настоящая форма перезаписывается (guard пропускает форму)', () => {
    const fixture = createFormFixtureExport();
    try {
      const result = service.compile({ outputPath: fixture.catalogFormBody, definition });
      assert.deepStrictEqual(result.changedFiles, [fixture.catalogFormBody]);
      const text = fs.readFileSync(fixture.catalogFormBody, 'utf-8');
      assert.ok(isFormRootXml(text));
      assert.ok(text.includes('Новый заголовок'));
      assert.ok(!text.includes(CATALOG_FORM_TITLE));
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });

  const descriptorCases: readonly {
    readonly name: string;
    readonly descriptor: (f: FormFixtureExport) => string;
    readonly body: (f: FormFixtureExport) => string;
  }[] = [
    { name: 'форма объекта', descriptor: (f) => f.catalogFormDescriptor, body: (f) => f.catalogFormBody },
    { name: 'общая форма', descriptor: (f) => f.commonFormXml, body: (f) => f.commonFormBody },
  ];
  for (const c of descriptorCases) {
    test(`compile по дескриптору (${c.name}) пишет ровно тело: нет ENOTDIR и каталогов «X.xml»`, () => {
      const fixture = createFormFixtureExport();
      try {
        const before = snapshotTree(fixture.configRoot);
        const result = service.compile({ outputPath: c.descriptor(fixture), definition });
        assert.deepStrictEqual(result.changedFiles, [c.body(fixture)]);
        const after = snapshotTree(fixture.configRoot);
        assert.deepStrictEqual(diffSnapshots(before, after), [path.relative(fixture.configRoot, c.body(fixture))]);
      } finally {
        fs.rmSync(fixture.configRoot, { recursive: true, force: true });
      }
    });
  }
});
