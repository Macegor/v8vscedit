import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MetaObject } from '../../domain/MetaObject';
import { ParseObjectXmlCache } from '../../infra/xml/ParseObjectXmlCache';
import { parseObjectXml, parseObjectXmlCache } from '../../infra/xml';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses">
  <Catalog uuid="00000000-0000-0000-0000-000000000000">
    <InternalInfo/>
    <Properties>
      <Name>Тестовый</Name>
      <Synonym>
        <v8:item xmlns:v8="http://v8.1c.ru/8.1/data/core">
          <v8:lang>ru</v8:lang>
          <v8:content>Тестовый</v8:content>
        </v8:item>
      </Synonym>
    </Properties>
    <ChildObjects/>
  </Catalog>
</MetaDataObject>
`;

suite('ParseObjectXmlCache — мемоизация parseObjectXml по mtime', () => {
  let tmpDir: string;
  let xmlPath: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-object-cache-'));
    xmlPath = path.join(tmpDir, 'Test.xml');
    fs.writeFileSync(xmlPath, SAMPLE_XML, 'utf-8');
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    parseObjectXmlCache.clear();
  });

  test('Повторный parseObjectXml без правки файла возвращает тот же объект (cache hit)', () => {
    parseObjectXmlCache.clear();
    const first = parseObjectXml(xmlPath);
    const second = parseObjectXml(xmlPath);
    assert.ok(first);
    assert.strictEqual(first.name, 'Тестовый');
    // Cache hit обязан вернуть ровно тот же экземпляр без повторного парсинга.
    assert.strictEqual(second, first, 'второй вызов parseObjectXml должен вернуть кэшированный объект');
  });

  test('Повторный parseObjectXml не повторно парсит XML (memo hit через подмену парсера)', () => {
    const cache = new ParseObjectXmlCache();
    let parses = 0;
    const fakeParser = (input: string): MetaObject | null => {
      parses++;
      return { tag: 'Catalog', name: input, synonym: '', children: [] };
    };

    cache.getOrParse(xmlPath, fakeParser);
    assert.strictEqual(parses, 1);
    cache.getOrParse(xmlPath, fakeParser);
    assert.strictEqual(parses, 1, 'второй getOrParse не должен звать парсер');
    cache.getOrParse(xmlPath, fakeParser);
    assert.strictEqual(parses, 1);
  });

  test('После изменения mtime файла кэш перечитывает результат', () => {
    const cache = new ParseObjectXmlCache();
    let parses = 0;
    const fakeParser = (input: string): MetaObject | null => {
      parses++;
      return { tag: 'Catalog', name: input, synonym: '', children: [] };
    };

    cache.getOrParse(xmlPath, fakeParser);
    assert.strictEqual(parses, 1);

    // Принудительно повышаем mtimeMs на 2 секунды в будущее — этого достаточно
    // для отличия от исходного значения даже на ФС с секундной точностью.
    const now = Date.now();
    fs.utimesSync(xmlPath, new Date(now + 2000), new Date(now + 2000));

    cache.getOrParse(xmlPath, fakeParser);
    assert.strictEqual(parses, 2, 'после изменения mtime парсер должен быть вызван заново');
  });

  test('LRU eviction — при превышении лимита выталкивается самая старая запись', () => {
    const cache = new ParseObjectXmlCache();
    // Парсер-заглушка, чтобы не зависеть от реального fs.
    const parser = (input: string): null => {
      // Возвращаем null — поведение мемоизации не зависит от значения.
      void input;
      return null;
    };

    // Заполняем кэш до лимита.
    for (let i = 0; i < 500; i++) {
      cache.getOrParse(`/virtual/path/${String(i)}`, parser);
    }
    assert.strictEqual(cache.size(), 500);

    // 501-й элемент должен вытеснить самый старый.
    cache.getOrParse('/virtual/path/new', parser);
    assert.strictEqual(cache.size(), 500);
  });
});
