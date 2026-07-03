import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildRootMetaObjectProperties } from '../../ui/views/properties/PropertyBuilder';

const EXAMPLE_CF = path.resolve(__dirname, '../../../example/2.20/src/cf');

function findFirstDocument(): string {
  const documentsDir = path.join(EXAMPLE_CF, 'Documents');
  assert.ok(fs.existsSync(documentsDir), 'В example/2.20/src/cf/Documents нет каталога документов');
  const entry = fs.readdirSync(documentsDir, { withFileTypes: true })
    .find((item) => item.isFile() && item.name.endsWith('.xml'));
  assert.ok(entry, 'В example/2.20/src/cf/Documents нет ни одного документа');
  return path.join(documentsDir, entry.name);
}

suite('Properties — документ', () => {
  test('Показывает свойства документа по разделам конфигуратора', () => {
    const xml = fs.readFileSync(findFirstDocument(), 'utf-8');
    const props = buildRootMetaObjectProperties(xml, 'Document');

    const keys = props.map((item) => item.key);
    assert.ok(keys.includes('Numerator'), 'Numerator не найден');
    assert.ok(keys.includes('NumberType'), 'NumberType не найден');
    assert.ok(keys.includes('Posting'), 'Posting не найден');
    assert.ok(keys.includes('RegisterRecordsDeletion'), 'RegisterRecordsDeletion не найден');
    assert.ok(keys.includes('DefaultObjectForm'), 'DefaultObjectForm не найден');
    assert.ok(keys.includes('InputByString'), 'InputByString не найден');
    assert.ok(keys.includes('UseStandardCommands'), 'UseStandardCommands не найден');
    assert.ok(keys.includes('BasedOn'), 'BasedOn не найден');
    assert.ok(keys.includes('DataHistory'), 'DataHistory не найден');
    assert.ok(keys.includes('DataLockFields'), 'DataLockFields не найден');
    assert.ok(!keys.includes('Characteristics'), 'Characteristics не должен выводиться в свойствах документа');

    const numerator = props.find((item) => item.key === 'Numerator');
    assert.ok(numerator, 'Numerator не найден');
    assert.strictEqual(numerator.title, 'Нумератор');
    assert.strictEqual(numerator.section, 'Нумерация');

    const numberType = props.find((item) => item.key === 'NumberType');
    assert.ok(numberType, 'NumberType не найден');
    assert.strictEqual(numberType.kind, 'enum');
    assert.strictEqual(numberType.section, 'Нумерация');

    const posting = props.find((item) => item.key === 'Posting');
    assert.ok(posting, 'Posting не найден');
    assert.strictEqual(posting.kind, 'enum');
    assert.strictEqual(posting.section, 'Проведение');

    const form = props.find((item) => item.key === 'DefaultObjectForm');
    assert.ok(form, 'DefaultObjectForm не найден');
    assert.strictEqual(form.section, 'Формы');

    const inputByString = props.find((item) => item.key === 'InputByString');
    assert.ok(inputByString, 'InputByString не найден');
    assert.strictEqual(inputByString.kind, 'metadataReferenceList');
    assert.strictEqual(inputByString.section, 'Поле ввода');

    const commands = props.find((item) => item.key === 'UseStandardCommands');
    assert.ok(commands, 'UseStandardCommands не найден');
    assert.strictEqual(commands.section, 'Команды');

    const basedOn = props.find((item) => item.key === 'BasedOn');
    assert.ok(basedOn, 'BasedOn не найден');
    assert.strictEqual(basedOn.kind, 'metadataReferenceList');
    assert.strictEqual(basedOn.section, 'Ввод на основании');

    const dataLockControlMode = props.find((item) => item.key === 'DataLockControlMode');
    assert.ok(dataLockControlMode, 'DataLockControlMode не найден');
    assert.strictEqual(dataLockControlMode.section, 'Служебное');
  });
});
