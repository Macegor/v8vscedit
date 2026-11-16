import * as assert from 'assert';
import * as path from 'path';
import { MetaPathResolver, resolveOwnerXmlForExtContent } from '../../infra/fs/MetaPathResolver';
import { makeTempDir, objectXml, removeTempDir, testUuid, writeFileIn } from './support/parentConfigurationsBin';

type Layout = 'deep' | 'flat';
const LAYOUTS: readonly Layout[] = ['deep', 'flat'];

suite('MetaPathResolver.resolveOwnerXmlForExtContent', () => {
  let root: string;
  const resolver = new MetaPathResolver();

  setup(() => {
    root = makeTempDir('v8vscedit-owner-xml-');
  });

  teardown(() => {
    removeTempDir(root);
  });

  function createDoc(layout: Layout): string {
    const rel = layout === 'deep' ? 'Documents/Док/Док.xml' : 'Documents/Док.xml';
    return writeFileIn(root, rel, objectXml('Document', testUuid(1), 'Док'));
  }

  function p(rel: string): string {
    return path.join(root, ...rel.split('/'));
  }

  for (const layout of LAYOUTS) {
    suite(`раскладка ${layout}`, () => {
      test('модуль объекта → XML объекта', () => {
        const xml = createDoc(layout);
        assert.strictEqual(resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Ext/ObjectModule.bsl')), xml);
      });

      test('модуль формы → дескриптор формы, если он есть', () => {
        createDoc(layout);
        const descriptor = writeFileIn(root, 'Documents/Док/Forms/Ф.xml', objectXml('Form', testUuid(2), 'Ф'));
        assert.strictEqual(
          resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Forms/Ф/Ext/Form/Module.bsl')),
          descriptor
        );
        assert.strictEqual(
          resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Forms/Ф/Ext/Form.xml')),
          descriptor
        );
      });

      test('модуль команды → дескриптор команды', () => {
        createDoc(layout);
        const descriptor = writeFileIn(root, 'Documents/Док/Commands/К.xml', objectXml('Command', testUuid(3), 'К'));
        assert.strictEqual(
          resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Commands/К/Ext/CommandModule.bsl')),
          descriptor
        );
      });

      test('содержимое макета → дескриптор макета', () => {
        createDoc(layout);
        const descriptor = writeFileIn(root, 'Documents/Док/Templates/М.xml', objectXml('Template', testUuid(4), 'М'));
        assert.strictEqual(
          resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Templates/М/Ext/Template.xml')),
          descriptor
        );
      });

      test('нет дескриптора формы → XML объекта-владельца', () => {
        const xml = createDoc(layout);
        assert.strictEqual(
          resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Forms/Ф/Ext/Form/Module.bsl')),
          xml
        );
      });

      test('Ext в другом регистре распознаётся', () => {
        const xml = createDoc(layout);
        assert.strictEqual(resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/ext/ObjectModule.bsl')), xml);
      });
    });
  }

  test('глубокий дескриптор формы <Forms>/<Имя>/<Имя>.xml тоже находится', () => {
    createDoc('flat');
    const descriptor = writeFileIn(root, 'Documents/Док/Forms/Ф/Ф.xml', objectXml('Form', testUuid(2), 'Ф'));
    assert.strictEqual(
      resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Forms/Ф/Ext/Form/Module.bsl')),
      descriptor
    );
  });

  test('вложенная подсистема: Ext/CommandInterface.xml принадлежит B.xml', () => {
    writeFileIn(root, 'Subsystems/A.xml', objectXml('Subsystem', testUuid(5), 'A'));
    const b = writeFileIn(root, 'Subsystems/A/Subsystems/B.xml', objectXml('Subsystem', testUuid(6), 'B'));
    assert.strictEqual(
      resolver.resolveOwnerXmlForExtContent(root, p('Subsystems/A/Subsystems/B/Ext/CommandInterface.xml')),
      b
    );
  });

  test('Ext в корне → Configuration.xml, если он существует', () => {
    const cfg = writeFileIn(root, 'Configuration.xml', objectXml('Configuration', testUuid(7), 'К'));
    assert.strictEqual(resolver.resolveOwnerXmlForExtContent(root, p('Ext/SessionModule.bsl')), cfg);
  });

  test('Ext в корне без Configuration.xml → null', () => {
    assert.strictEqual(resolver.resolveOwnerXmlForExtContent(root, p('Ext/SessionModule.bsl')), null);
  });

  test('путь без сегмента Ext → null', () => {
    createDoc('flat');
    assert.strictEqual(resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док.xml')), null);
  });

  test('<Folder>/Ext/x.bsl (каталог ближе двух сегментов от корня) → null', () => {
    writeFileIn(root, 'Documents.xml', objectXml('Document', testUuid(8), 'Documents'));
    assert.strictEqual(resolver.resolveOwnerXmlForExtContent(root, p('Documents/Ext/x.bsl')), null);
  });

  test('файл вне корня конфигурации → null', () => {
    const outside = makeTempDir('v8vscedit-owner-xml-outside-');
    try {
      assert.strictEqual(
        resolver.resolveOwnerXmlForExtContent(root, path.join(outside, 'Documents', 'Док', 'Ext', 'ObjectModule.bsl')),
        null
      );
    } finally {
      removeTempDir(outside);
    }
  });

  test('ни дескриптора, ни XML объекта → null', () => {
    assert.strictEqual(
      resolver.resolveOwnerXmlForExtContent(root, p('Documents/Док/Forms/Ф/Ext/Form/Module.bsl')),
      null
    );
  });

  test('фасад-функция делегирует резолверу', () => {
    const xml = createDoc('flat');
    const file = p('Documents/Док/Ext/ObjectModule.bsl');
    assert.strictEqual(resolveOwnerXmlForExtContent(root, file), xml);
    assert.strictEqual(resolveOwnerXmlForExtContent(root, p('Documents/Док.xml')), null);
  });

  suite('регресс resolveXml', () => {
    test('глубокая раскладка', () => {
      const xml = createDoc('deep');
      assert.strictEqual(resolver.resolveXml(root, 'Document', 'Док'), xml);
    });
    test('плоская раскладка', () => {
      const xml = createDoc('flat');
      assert.strictEqual(resolver.resolveXml(root, 'Document', 'Док'), xml);
    });
    test('глубокая раскладка приоритетнее плоской', () => {
      const deep = createDoc('deep');
      createDoc('flat');
      assert.strictEqual(resolver.resolveXml(root, 'Document', 'Док'), deep);
    });
    test('нет файла → null', () => {
      assert.strictEqual(resolver.resolveXml(root, 'Document', 'Нет'), null);
    });
  });
});
