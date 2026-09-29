import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  MetaPathResolver,
  resolveChildFormDescriptor,
  resolveChildFormXml,
  resolveFormXmlByDescriptor,
} from '../../infra/fs/MetaPathResolver';
import { createFormFixtureExport } from './support/mcpFormToolsHarness';

/**
 * Единая арифметика путей форм в `MetaPathResolver`.
 *
 * Дефект, ради которого она заведена: узел формы объекта несёт `xmlPath` ОБЪЕКТА-владельца,
 * и MCP-резолвер принимал его за путь формы, а сервисы достраивали к нему `Ext/Form.xml`
 * (`Catalogs/X.xml/Ext/Form.xml` — файл как компонент каталога). Поэтому деривация «дескриптор
 * → тело формы» и «владелец + имя → дескриптор» считается ЯВНО в одном месте и без ФС.
 *
 * Все ожидания собраны через `path.join`: тест не должен зависеть от разделителя платформы.
 */

const ROOT = path.join(path.sep, 'выгрузка', 'cf');

/** Обе поверхности API (метод класса и module-level фасад) обязаны давать одно и то же. */
const resolver = new MetaPathResolver();
const SURFACES = [
  {
    label: 'метод MetaPathResolver',
    byDescriptor: (d: string) => resolver.resolveFormXmlByDescriptor(d),
    childDescriptor: (owner: string, name: string) => resolver.resolveChildFormDescriptor(owner, name),
    childXml: (owner: string, name: string) => resolver.resolveChildFormXml(owner, name),
  },
  {
    label: 'module-level фасад',
    byDescriptor: resolveFormXmlByDescriptor,
    childDescriptor: resolveChildFormDescriptor,
    childXml: resolveChildFormXml,
  },
] as const;

suite('MetaPathResolver — арифметика путей форм (T2)', () => {
  for (const surface of SURFACES) {
    suite(surface.label, () => {
      // Дескриптор → тело: формула `dirname/basename/Ext/Form.xml`, одинаковая для форм объекта и общих форм.
      const descriptorCases: readonly { readonly name: string; readonly descriptor: string; readonly body: string }[] = [
        {
          name: 'форма объекта Forms/Y.xml',
          descriptor: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Y.xml'),
          body: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Y', 'Ext', 'Form.xml'),
        },
        {
          name: 'общая форма CommonForms/Y.xml',
          descriptor: path.join(ROOT, 'CommonForms', 'Y.xml'),
          body: path.join(ROOT, 'CommonForms', 'Y', 'Ext', 'Form.xml'),
        },
        {
          // Имя формы совпадает с именем каталога `Forms`: раскладка «глубокая» по эвристике
          // getObjectLocationFromXml (имя файла == имя родителя), и через неё это ломается.
          // Деривация тела обязана быть чистой арифметикой, а не выводом из раскладки объекта.
          name: 'краевой случай Forms/Forms.xml (имя формы равно Forms)',
          descriptor: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Forms.xml'),
          body: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Forms', 'Ext', 'Form.xml'),
        },
        {
          name: 'краевой случай CommonForms/CommonForms.xml',
          descriptor: path.join(ROOT, 'CommonForms', 'CommonForms.xml'),
          body: path.join(ROOT, 'CommonForms', 'CommonForms', 'Ext', 'Form.xml'),
        },
        {
          name: 'кириллические имена объекта и формы',
          descriptor: path.join(ROOT, 'Documents', 'Заказ', 'Forms', 'ФормаДокумента.xml'),
          body: path.join(ROOT, 'Documents', 'Заказ', 'Forms', 'ФормаДокумента', 'Ext', 'Form.xml'),
        },
      ];
      for (const c of descriptorCases) {
        test(`resolveFormXmlByDescriptor: ${c.name}`, () => {
          assert.strictEqual(surface.byDescriptor(c.descriptor), c.body);
        });
      }

      // Владелец + имя формы → дескриптор: плоская и глубокая раскладки объекта.
      const childCases: readonly { readonly name: string; readonly owner: string; readonly form: string; readonly descriptor: string }[] = [
        {
          name: 'плоская раскладка Catalogs/X.xml',
          owner: path.join(ROOT, 'Catalogs', 'X.xml'),
          form: 'Y',
          descriptor: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Y.xml'),
        },
        {
          name: 'глубокая раскладка Catalogs/X/X.xml',
          owner: path.join(ROOT, 'Catalogs', 'X', 'X.xml'),
          form: 'Y',
          descriptor: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Y.xml'),
        },
        {
          name: 'плоская раскладка, документ',
          owner: path.join(ROOT, 'Documents', 'Заказ.xml'),
          form: 'ФормаДокумента',
          descriptor: path.join(ROOT, 'Documents', 'Заказ', 'Forms', 'ФормаДокумента.xml'),
        },
        {
          name: 'имя формы совпадает с именем владельца',
          owner: path.join(ROOT, 'Catalogs', 'X.xml'),
          form: 'X',
          descriptor: path.join(ROOT, 'Catalogs', 'X', 'Forms', 'X.xml'),
        },
      ];
      for (const c of childCases) {
        test(`resolveChildFormDescriptor: ${c.name}`, () => {
          assert.strictEqual(surface.childDescriptor(c.owner, c.form), c.descriptor);
        });

        test(`resolveChildFormXml (композиция): ${c.name}`, () => {
          const expectedBody = path.join(path.dirname(c.descriptor), c.form, 'Ext', 'Form.xml');
          assert.strictEqual(surface.childXml(c.owner, c.form), expectedBody);
          // Композиция обязана совпадать с двумя шагами по отдельности.
          assert.strictEqual(
            surface.childXml(c.owner, c.form),
            surface.byDescriptor(surface.childDescriptor(c.owner, c.form)),
          );
        });
      }

      test('краевой случай: форма Forms у объекта — тело Forms/Forms/Ext/Form.xml', () => {
        const owner = path.join(ROOT, 'Catalogs', 'X.xml');
        assert.strictEqual(
          surface.childXml(owner, 'Forms'),
          path.join(ROOT, 'Catalogs', 'X', 'Forms', 'Forms', 'Ext', 'Form.xml'),
        );
      });

      test('арифметика не обращается к ФС: для несуществующих путей результат тот же', () => {
        const ghostOwner = path.join(ROOT, 'НетТакого', 'Catalogs', 'X.xml');
        assert.strictEqual(fs.existsSync(ROOT), false, 'предусловие: путь фикстуры не существует');
        assert.strictEqual(
          surface.childXml(ghostOwner, 'Y'),
          path.join(ROOT, 'НетТакого', 'Catalogs', 'X', 'Forms', 'Y', 'Ext', 'Form.xml'),
        );
      });

      test('в результате нет сегмента, оканчивающегося на .xml, кроме самого дескриптора (анти-регресс ENOTDIR)', () => {
        for (const c of childCases) {
          const body = surface.childXml(c.owner, c.form);
          const dirSegments = path.dirname(body).split(path.sep);
          assert.deepStrictEqual(
            dirSegments.filter((segment) => segment.endsWith('.xml')),
            [],
            `путь тела формы содержит «файл как каталог»: ${body}`,
          );
        }
      });
    });
  }

  suite('на настоящей раскладке выгрузки', () => {
    // Арифметика должна совпадать с тем, что реально раскладывает генератор форм, иначе
    // формула «верна сама по себе», но не относится к реальной выгрузке.
    test('тело и дескриптор формы объекта совпадают с файлами, созданными addForm', () => {
      const fixture = createFormFixtureExport();
      try {
        assert.strictEqual(
          resolveChildFormDescriptor(fixture.catalogXml, fixture.catalogFormName),
          fixture.catalogFormDescriptor,
        );
        assert.strictEqual(
          resolveChildFormXml(fixture.catalogXml, fixture.catalogFormName),
          fixture.catalogFormBody,
        );
        assert.ok(fs.existsSync(resolveChildFormDescriptor(fixture.catalogXml, fixture.catalogFormName)));
        assert.ok(fs.existsSync(resolveChildFormXml(fixture.catalogXml, fixture.catalogFormName)));
      } finally {
        fs.rmSync(fixture.configRoot, { recursive: true, force: true });
      }
    });

    test('общая форма: дескриптор CommonForms/X.xml → существующее тело CommonForms/X/Ext/Form.xml', () => {
      const fixture = createFormFixtureExport();
      try {
        assert.strictEqual(resolveFormXmlByDescriptor(fixture.commonFormXml), fixture.commonFormBody);
        assert.ok(fs.existsSync(resolveFormXmlByDescriptor(fixture.commonFormXml)));
      } finally {
        fs.rmSync(fixture.configRoot, { recursive: true, force: true });
      }
    });

    test('глубокая раскладка владельца: дескриптор формы там же, где у плоской', () => {
      // Регресс на «глубокий» справочник, созданный платформой как Catalogs/X/X.xml: файл формы
      // лежит в Catalogs/X/Forms/, как и при плоской раскладке.
      const fixture = createFormFixtureExport();
      try {
        const deepOwner = path.join(fixture.configRoot, 'Catalogs', fixture.catalogName, `${fixture.catalogName}.xml`);
        assert.strictEqual(
          resolveChildFormDescriptor(deepOwner, fixture.catalogFormName),
          fixture.catalogFormDescriptor,
        );
      } finally {
        fs.rmSync(fixture.configRoot, { recursive: true, force: true });
      }
    });
  });
});
