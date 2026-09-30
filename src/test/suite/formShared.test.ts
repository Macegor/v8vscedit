import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assertFormRootXml,
  isFormRootXml,
  readFormXml,
  resolveFormXmlPath,
  resolveFormXmlPathForWrite,
} from '../../infra/xml/form/FormShared';
import { EXAMPLE_ROOT, findAllFormXmlFiles, hasFormCorpus } from './support/formFixtures';
import { createFormFixtureExport, type FormFixtureExport } from './support/mcpFormToolsHarness';

/**
 * Guard корневого элемента формы и нормализаторы путей `FormShared`.
 *
 * Дефект: `FormValidateService` проверял форму как `/<Form\b/.test(xml)`, а в XML справочника
 * есть `<Form>ФормаСписка</Form>` внутри `<ChildObjects>` — подстрока находилась, и XML объекта
 * проходил как «форма». Критерий обязан смотреть на ПЕРВЫЙ элемент документа.
 */

const FORM_NS = 'xmlns="http://v8.1c.ru/8.3/xcf/logform"';
const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>';
const FORM_BODY = `<Form ${FORM_NS} version="2.21">\n\t<AutoCommandBar name="ФормаКоманднаяПанель" id="-1"/>\n</Form>\n`;

/** XML справочника с регистрацией формы — именно он проходил старую проверку подстрокой. */
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

const OBJECT_MESSAGE = /XML объекта метаданных, а не Form\.xml/;

interface RootCase {
  readonly name: string;
  readonly xml: string;
  readonly isForm: boolean;
  /** Ожидается ли специальный текст «передан XML объекта метаданных». */
  readonly isObjectXml?: boolean;
}

const ROOT_CASES: readonly RootCase[] = [
  { name: '<Form> с пространством logform', xml: FORM_BODY, isForm: true },
  { name: 'та же форма с BOM', xml: `\uFEFF${FORM_BODY}`, isForm: true },
  { name: 'BOM + пролог <?xml?> + корень', xml: `\uFEFF${PROLOG}\n${FORM_BODY}`, isForm: true },
  {
    name: 'пролог, XML-комментарии и переводы строк CRLF перед корнем',
    xml: `${PROLOG}\r\n<!-- первый -->\r\n\r\n<!-- второй <Form> внутри комментария -->\r\n${FORM_BODY}`,
    isForm: true,
  },
  { name: 'ведущие пробелы и табуляции перед корнем', xml: `  \n\t  ${FORM_BODY}`, isForm: true },
  { name: 'перевод строки после имени тега', xml: '<Form\n\txmlns="http://v8.1c.ru/8.3/xcf/logform"></Form>', isForm: true },
  {
    name: 'форма расширения с <BaseForm> внутри',
    xml: `${PROLOG}\n<Form ${FORM_NS} version="2.21">\n\t<BaseForm version="2.21"><ChildItems/></BaseForm>\n</Form>\n`,
    isForm: true,
  },
  { name: 'самозакрывающийся <Form/>', xml: '<Form/>', isForm: true },
  {
    // Правило — «локальное имя первого тега»: префиксованный корень той же формы тоже форма.
    name: 'корень с префиксом пространства lf:Form',
    xml: '<lf:Form xmlns:lf="http://v8.1c.ru/8.3/xcf/logform"/>',
    isForm: true,
  },
  {
    name: 'ГЛАВНЫЙ НЕГАТИВ: XML справочника с <Form>ФормаСписка</Form> в ChildObjects',
    xml: CATALOG_XML,
    isForm: false,
    isObjectXml: true,
  },
  { name: 'тот же XML справочника с BOM', xml: `\uFEFF${CATALOG_XML}`, isForm: false, isObjectXml: true },
  {
    name: 'XML объекта без пролога',
    xml: '<MetaDataObject><Catalog><ChildObjects><Form>Ф</Form></ChildObjects></Catalog></MetaDataObject>',
    isForm: false,
    isObjectXml: true,
  },
  {
    name: 'корень GraphicalSchema',
    xml: `${PROLOG}\n<GraphicalSchema xmlns="http://v8.1c.ru/8.3/xcf/scheme"><Form/></GraphicalSchema>`,
    isForm: false,
  },
  { name: 'корень FormSettings (имя начинается с Form, но не Form)', xml: '<FormSettings/>', isForm: false },
  { name: 'корень Forms', xml: '<Forms><Form/></Forms>', isForm: false },
  { name: 'Form не корневой, а вложенный', xml: '<Root><Form/></Root>', isForm: false },
  {
    name: '<Form> только внутри комментария перед корнем MetaDataObject',
    xml: `${PROLOG}\n<!-- <Form> --><MetaDataObject><Catalog/></MetaDataObject>`,
    isForm: false,
    isObjectXml: true,
  },
  { name: 'пустой файл', xml: '', isForm: false },
  { name: 'только пробелы и переводы строк', xml: ' \r\n\t\n', isForm: false },
  { name: 'только BOM', xml: '\uFEFF', isForm: false },
  { name: 'только пролог', xml: PROLOG, isForm: false },
  { name: 'только комментарий', xml: '<!-- <Form> -->', isForm: false },
  { name: 'незакрытый комментарий, в котором есть <Form>', xml: '<!-- oops <Form>', isForm: false },
  { name: 'незакрытый пролог', xml: '<?xml version="1.0"\n<Form/>', isForm: false },
  { name: 'не XML: обычный текст', xml: 'просто текст, а не XML', isForm: false },
  { name: 'не XML: текст перед <Form>', xml: 'мусор<Form/>', isForm: false },
  { name: 'одиночный символ <', xml: '<', isForm: false },
];

suite('FormShared.isFormRootXml / assertFormRootXml — guard корневого элемента (T5)', () => {
  for (const c of ROOT_CASES) {
    test(`isFormRootXml: ${c.name} → ${String(c.isForm)}`, () => {
      assert.strictEqual(isFormRootXml(c.xml), c.isForm);
    });

    test(`assertFormRootXml: ${c.name} → ${c.isForm ? 'не бросает' : 'бросает'}`, () => {
      const filePath = path.join(path.sep, 'проект', 'Файл.xml');
      if (c.isForm) {
        assert.doesNotThrow(() => { assertFormRootXml(c.xml, filePath); });
        return;
      }
      assert.throws(() => { assertFormRootXml(c.xml, filePath); }, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(filePath), `сообщение должно называть файл: ${error.message}`);
        if (c.isObjectXml === true) {
          assert.match(error.message, OBJECT_MESSAGE, 'для корня MetaDataObject — отдельный текст про XML объекта');
        } else {
          assert.doesNotMatch(error.message, OBJECT_MESSAGE, 'для прочих корней текст про XML объекта неуместен');
        }
        return true;
      });
    });
  }

  test('тексты сообщений для XML объекта и для прочих корней различаются', () => {
    const filePath = path.join(path.sep, 'проект', 'Файл.xml');
    const messageOf = (xml: string): string => {
      try {
        assertFormRootXml(xml, filePath);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    };
    const objectMessage = messageOf(CATALOG_XML);
    const otherMessage = messageOf('<GraphicalSchema/>');
    assert.notStrictEqual(objectMessage, '');
    assert.notStrictEqual(otherMessage, '');
    assert.notStrictEqual(objectMessage, otherMessage);
  });
});

suite('FormShared.readFormXml (T5/T8)', () => {
  let tmp: string;

  suiteSetup(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-readformxml-')));
  });
  suiteTeardown(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('читает форму как есть (включая BOM), не искажая содержимое', () => {
    const file = path.join(tmp, 'Form.xml');
    fs.writeFileSync(file, `\uFEFF${PROLOG}\n${FORM_BODY}`, 'utf-8');
    assert.strictEqual(readFormXml(file), fs.readFileSync(file, 'utf-8'));
  });

  test('XML объекта метаданных отвергается с текстом про объект и именем файла', () => {
    const file = path.join(tmp, 'Товары.xml');
    fs.writeFileSync(file, `\uFEFF${CATALOG_XML}`, 'utf-8');
    assert.throws(() => readFormXml(file), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, OBJECT_MESSAGE);
      assert.ok(error.message.includes(file));
      return true;
    });
  });

  test('файл с прочим корнем отвергается', () => {
    const file = path.join(tmp, 'Схема.xml');
    fs.writeFileSync(file, '<GraphicalSchema/>', 'utf-8');
    assert.throws(() => readFormXml(file), /Схема\.xml/);
  });

  test('несуществующий файл — ошибка чтения, а не тихий пустой результат', () => {
    assert.throws(() => readFormXml(path.join(tmp, 'НетТакого', 'Form.xml')));
  });

  test('на настоящей форме, созданной addForm, guard проходит', () => {
    const fixture = createFormFixtureExport();
    try {
      assert.strictEqual(readFormXml(fixture.catalogFormBody), fs.readFileSync(fixture.catalogFormBody, 'utf-8'));
      assert.strictEqual(readFormXml(fixture.commonFormBody), fs.readFileSync(fixture.commonFormBody, 'utf-8'));
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });

  test('на настоящих XML объекта, дескриптора формы и общей формы guard отбивает (не тело формы)', () => {
    const fixture = createFormFixtureExport();
    try {
      for (const objectLike of [fixture.catalogXml, fixture.catalogFormDescriptor, fixture.commonFormXml]) {
        assert.throws(() => readFormXml(objectLike), OBJECT_MESSAGE, objectLike);
        assert.strictEqual(isFormRootXml(fs.readFileSync(objectLike, 'utf-8')), false, objectLike);
      }
    } finally {
      fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    }
  });
});

/** Сегменты каталогов результата: ни один не должен быть «файлом .xml как каталогом». */
function assertNoXmlDirectorySegment(result: string): void {
  const dirSegments = path.dirname(result).split(path.sep);
  assert.deepStrictEqual(
    dirSegments.filter((segment) => segment.endsWith('.xml')),
    [],
    `путь содержит сегмент «X.xml» как каталог (ENOTDIR-ловушка): ${result}`,
  );
}

suite('FormShared.resolveFormXmlPath / resolveFormXmlPathForWrite (T6)', () => {
  let fixture: FormFixtureExport;
  let tmp: string;

  suiteSetup(() => {
    fixture = createFormFixtureExport();
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-resolveformxml-')));
  });
  suiteTeardown(() => {
    fs.rmSync(fixture.configRoot, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  interface PathCase {
    readonly name: string;
    /** Вход считается лениво: фикстура выгрузки создаётся только в suiteSetup. */
    readonly input: () => string;
    readonly expected: () => string;
  }

  suite('resolveFormXmlPath (чтение существующей формы)', () => {
    const cases: readonly PathCase[] = [
      { name: 'тело формы → оно же', input: () => fixture.catalogFormBody, expected: () => fixture.catalogFormBody },
      {
        name: 'каталог формы → Ext/Form.xml',
        input: () => path.dirname(path.dirname(fixture.catalogFormBody)),
        expected: () => fixture.catalogFormBody,
      },
      { name: 'дескриптор формы объекта → тело', input: () => fixture.catalogFormDescriptor, expected: () => fixture.catalogFormBody },
      { name: 'дескриптор общей формы → тело', input: () => fixture.commonFormXml, expected: () => fixture.commonFormBody },
      { name: 'тело общей формы → оно же', input: () => fixture.commonFormBody, expected: () => fixture.commonFormBody },
      {
        name: 'каталог общей формы → Ext/Form.xml',
        input: () => path.dirname(path.dirname(fixture.commonFormBody)),
        expected: () => fixture.commonFormBody,
      },
      {
        name: 'несуществующий Form.xml рядом с существующим Ext/Form.xml → Ext/Form.xml',
        input: () => path.join(path.dirname(path.dirname(fixture.catalogFormBody)), 'Form.xml'),
        expected: () => fixture.catalogFormBody,
      },
      {
        name: 'относительный путь к телу приводится к абсолютному',
        input: () => path.relative(process.cwd(), fixture.catalogFormBody),
        expected: () => fixture.catalogFormBody,
      },
    ];
    for (const c of cases) {
      test(c.name, () => {
        const result = resolveFormXmlPath(c.input());
        assert.strictEqual(result, c.expected());
        assert.ok(fs.existsSync(result), 'результат чтения обязан быть существующим файлом');
        assertNoXmlDirectorySegment(result);
        assert.strictEqual(isFormRootXml(fs.readFileSync(result, 'utf-8')), true, 'и это тело формы, а не XML объекта');
      });
    }

    test('каталог без Ext/Form.xml НЕ бросает: путь достраивается (поведение formValidateIds T-17, дальше упадёт чтение)', () => {
      const emptyDir = path.join(tmp, 'ПустойКаталог');
      fs.mkdirSync(emptyDir);
      assert.strictEqual(resolveFormXmlPath(emptyDir), path.join(emptyDir, 'Ext', 'Form.xml'));
      // Каталог справочника из реальной выгрузки: тоже без Ext/Form.xml.
      const catalogDir = path.join(fixture.configRoot, 'Catalogs', fixture.catalogName);
      assert.strictEqual(resolveFormXmlPath(catalogDir), path.join(catalogDir, 'Ext', 'Form.xml'));
    });

    const missingCases: readonly { readonly name: string; readonly input: () => string }[] = [
      { name: 'несуществующий путь', input: () => path.join(tmp, 'НетТакого', 'Что-то.xml') },
      { name: 'несуществующий Form.xml без соседнего Ext/Form.xml', input: () => path.join(tmp, 'НетТакого', 'Form.xml') },
      {
        // КАНАЛ РАЗРУШЕНИЯ: раньше функция молча возвращала входной файл, и правка формы
        // ложилась поверх XML объекта метаданных.
        name: 'XML справочника без тела рядом',
        input: () => fixture.catalogXml,
      },
      {
        name: 'XML подсистемы без тела рядом',
        input: () => path.join(fixture.configRoot, 'Subsystems', `${fixture.subsystemName}.xml`),
      },
      { name: 'Configuration.xml', input: () => path.join(fixture.configRoot, 'Configuration.xml') },
    ];
    for (const c of missingCases) {
      test(`бросает «Form.xml не найден: <вход>»: ${c.name}`, () => {
        const input = c.input();
        assert.throws(() => resolveFormXmlPath(input), (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.strictEqual(error.message, `Form.xml не найден: ${input}`);
          return true;
        });
      });
    }

    test('XML объекта не возвращается как «форма» и НЕ изменяется самим резолвом', () => {
      const before = fs.readFileSync(fixture.catalogXml);
      assert.throws(() => resolveFormXmlPath(fixture.catalogXml), /Form\.xml не найден/);
      assert.ok(fs.readFileSync(fixture.catalogXml).equals(before));
    });
  });

  suite('resolveFormXmlPathForWrite (путь для записи/создания)', () => {
    const cases: readonly PathCase[] = [
      { name: 'существующее тело → как есть', input: () => fixture.catalogFormBody, expected: () => fixture.catalogFormBody },
      {
        // Ветка `Form.xml` идёт РАНЬШЕ ветки `*.xml`: иначе тело (тоже оканчивается на .xml) было бы
        // принято за дескриптор и превратилось в `Form/Ext/Form.xml`.
        name: 'несуществующее тело в новом каталоге → как есть',
        input: () => path.join(tmp, 'Новая', 'Ext', 'Form.xml'),
        expected: () => path.join(tmp, 'Новая', 'Ext', 'Form.xml'),
      },
      { name: 'дескриптор формы объекта → тело', input: () => fixture.catalogFormDescriptor, expected: () => fixture.catalogFormBody },
      { name: 'дескриптор общей формы → тело', input: () => fixture.commonFormXml, expected: () => fixture.commonFormBody },
      {
        name: 'несуществующий дескриптор → тело по арифметике (файл ещё не создан)',
        input: () => path.join(tmp, 'Forms', 'Новая.xml'),
        expected: () => path.join(tmp, 'Forms', 'Новая', 'Ext', 'Form.xml'),
      },
      {
        name: 'каталог формы → Ext/Form.xml',
        input: () => path.dirname(path.dirname(fixture.catalogFormBody)),
        expected: () => fixture.catalogFormBody,
      },
      {
        name: 'несуществующий каталог → Ext/Form.xml',
        input: () => path.join(tmp, 'Forms', 'Свежая'),
        expected: () => path.join(tmp, 'Forms', 'Свежая', 'Ext', 'Form.xml'),
      },
      {
        name: 'относительный дескриптор приводится к абсолютному',
        input: () => path.relative(process.cwd(), fixture.commonFormXml),
        expected: () => fixture.commonFormBody,
      },
    ];
    for (const c of cases) {
      test(c.name, () => {
        const result = resolveFormXmlPathForWrite(c.input());
        assert.strictEqual(result, c.expected());
        // Анти-регресс ENOTDIR: раньше дескриптор давал `Forms/Y.xml/Ext/Form.xml`.
        assertNoXmlDirectorySegment(result);
        assert.strictEqual(path.basename(result), 'Form.xml');
      });
    }

    test('чтение и запись согласованы: для существующей формы оба нормализатора дают один и тот же файл', () => {
      for (const input of [
        fixture.catalogFormBody,
        fixture.catalogFormDescriptor,
        fixture.commonFormXml,
        path.dirname(path.dirname(fixture.catalogFormBody)),
      ]) {
        assert.strictEqual(resolveFormXmlPathForWrite(input), resolveFormXmlPath(input), input);
      }
    });
  });
});

/**
 * Сканы корпуса `example/`: критерий guard'а снимается с эталона, а не выдумывается.
 *
 * Результат измерения на момент написания (обе генерации 2.20/2.21, cf и cfe): всего 6329
 * файлов `Form.xml` — у всех корень `Form`, у всех `xmlns="http://v8.1c.ru/8.3/xcf/logform"`,
 * у всех BOM; контрпримеров нет. Поэтому пространство имён можно было бы требовать жёстко, но
 * контракт guard'а — локальное имя первого тега `Form`: пространство имён не участвует в
 * решении, а факт про него записывается ниже отдельной проверкой корпуса как основание критерия.
 */
const CORPUS_SCOPES: readonly { readonly generation: string; readonly kind: 'cf' | 'cfe' }[] = [
  { generation: '2.20', kind: 'cf' },
  { generation: '2.20', kind: 'cfe' },
  { generation: '2.21', kind: 'cf' },
  { generation: '2.21', kind: 'cfe' },
];

/**
 * Читает начало файла: guard смотрит только на корневой элемент, а полный корпус — сотни мегабайт.
 * 4 КБ заведомо покрывают BOM + пролог; результат для корня от усечения хвоста не зависит.
 */
function readHead(file: string, bytes = 4096): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Файлы `*.xml` объектов метаданных и дескрипторов форм: `<Cat>/X.xml`, `<Cat>/X/X.xml`, `<Cat>/X/Forms/Y.xml`. */
function collectObjectAndDescriptorXml(root: string): { readonly objects: string[]; readonly descriptors: string[] } {
  const objects: string[] = [];
  const descriptors: string[] = [];
  const configXml = path.join(root, 'Configuration.xml');
  if (fs.existsSync(configXml)) {
    objects.push(configXml);
  }
  for (const category of fs.readdirSync(root, { withFileTypes: true })) {
    if (!category.isDirectory()) {
      continue;
    }
    const categoryDir = path.join(root, category.name);
    for (const entry of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      const entryPath = path.join(categoryDir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.xml')) {
        objects.push(entryPath);
        continue;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      const deep = path.join(entryPath, `${entry.name}.xml`);
      if (fs.existsSync(deep)) {
        objects.push(deep);
      }
      const formsDir = path.join(entryPath, 'Forms');
      if (fs.existsSync(formsDir) && fs.statSync(formsDir).isDirectory()) {
        for (const form of fs.readdirSync(formsDir, { withFileTypes: true })) {
          if (form.isFile() && form.name.endsWith('.xml')) {
            descriptors.push(path.join(formsDir, form.name));
          }
        }
      }
    }
  }
  return { objects, descriptors };
}

/** Независимая от тестируемой функции проверка «корень — MetaDataObject»: узнаём объект без isFormRootXml. */
const META_DATA_OBJECT_ROOT = /^\uFEFF?\s*(?:<\?xml[^?]*\?>\s*)?<MetaDataObject[\s>]/;

suite('FormShared.isFormRootXml — сканы корпуса example/ (T5)', () => {
  suiteSetup(function () {
    if (!hasFormCorpus()) {
      this.skip();
    }
  });

  for (const scope of CORPUS_SCOPES) {
    const root = path.join(EXAMPLE_ROOT, scope.generation, 'src', scope.kind);
    const label = `${scope.generation}/${scope.kind}`;

    test(`${label}: все Form.xml проходят guard, корень — Form в пространстве logform`, function () {
      this.timeout(180_000);
      const forms = findAllFormXmlFiles(root);
      if (forms.length === 0) {
        this.skip();
      }
      const notForm: string[] = [];
      const notLogformNs: string[] = [];
      for (const file of forms) {
        const head = readHead(file);
        if (!isFormRootXml(head)) {
          notForm.push(file);
        }
        if (!head.includes(FORM_NS)) {
          notLogformNs.push(file);
        }
      }
      assert.deepStrictEqual(notForm, [], `формы, не прошедшие guard (${String(notForm.length)} из ${String(forms.length)})`);
      assert.deepStrictEqual(notLogformNs, [], 'основание критерия: у всех эталонных Form.xml пространство имён logform');
    });

    test(`${label}: корневые XML объектов и дескрипторы форм (MetaDataObject) guard НЕ проходят`, function () {
      this.timeout(180_000);
      if (!fs.existsSync(root)) {
        this.skip();
      }
      const { objects, descriptors } = collectObjectAndDescriptorXml(root);
      if (objects.length === 0) {
        this.skip();
      }
      const descriptorSet = new Set(descriptors);
      const wronglyAccepted: string[] = [];
      let checked = 0;
      let descriptorsChecked = 0;
      for (const file of [...objects, ...descriptors]) {
        const head = readHead(file);
        if (!META_DATA_OBJECT_ROOT.test(head)) {
          continue;
        }
        checked += 1;
        if (descriptorSet.has(file)) {
          descriptorsChecked += 1;
        }
        if (isFormRootXml(head)) {
          wronglyAccepted.push(file);
        }
      }
      assert.deepStrictEqual(wronglyAccepted, [], 'XML объекта принят за форму');
      assert.ok(checked > 0, 'скан обязан реально проверить хотя бы один MetaDataObject');
      if (descriptors.length > 0) {
        assert.ok(descriptorsChecked > 0, 'среди проверенных должны быть дескрипторы форм (Forms/Y.xml с <Form uuid>)');
      }
    });
  }
});
