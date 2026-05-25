import * as assert from 'assert';
import * as path from 'path';
import {
  parseCommonCfgPaths,
  parseCommonInfoBasePaths,
  parseV8iContent,
} from '../../infra/environment/InfoBaseRegistryService';

suite('InfoBaseRegistryService', () => {
  test('Читает файловую и серверную базу из v8i', () => {
    const bases = parseV8iContent(`
; комментарий перед первой секцией
[БезСоединения]
Connect=

[Разработка]
Connect=File="/Users/test/InfoBases/dev;archive";
ID=dev
OrderInList=20

[Тестовая]
Connect=Srvr="srv01";Ref="Demo_Test";
ID=test
OrderInList=10
`, '/tmp/ibases.v8i');

    assert.strictEqual(bases.length, 2);
    assert.strictEqual(bases[0].name, 'Разработка');
    assert.strictEqual(bases[0].kind, 'file');
    assert.strictEqual(bases[0].connection, '/F/Users/test/InfoBases/dev;archive');
    assert.strictEqual(bases[0].order, 20);
    assert.strictEqual(bases[1].kind, 'server');
    assert.strictEqual(bases[1].connection, '/Ssrv01/Demo_Test');
  });

  test('Разбирает CommonInfoBases из 1cestart.cfg', () => {
    const cfgDir = path.join('/Users/test/.1C/1cestart');
    const cfgPath = path.join(cfgDir, '1cestart.cfg');
    const paths = parseCommonInfoBasePaths(
      'CommonInfoBases=shared.v8i,"/opt/1c/common bases.v8i"',
      cfgPath
    );

    // На Windows path.resolve добавит букву текущего диска к относительному пути;
    // сравниваем через тот же path.resolve, чтобы тест не зависел от ОС-хоста.
    assert.deepStrictEqual(paths, [
      path.resolve(cfgDir, 'shared.v8i'),
      '/opt/1c/common bases.v8i',
    ]);
  });

  test('Разбирает Windows-пути к общему cfg и общему списку баз', () => {
    const previousProgramData = process.env.ProgramData;
    process.env.ProgramData = String.raw`C:\ProgramData`;

    try {
      const cfgPath = String.raw`C:\ProgramData\1C\1CEStart\1cestart.cfg`;
      assert.deepStrictEqual(
        parseCommonCfgPaths(String.raw`CommonCfgLocation=common\1cescmn.cfg`, cfgPath),
        [String.raw`C:\ProgramData\1C\1CEStart\common\1cescmn.cfg`]
      );
      assert.deepStrictEqual(
        parseCommonInfoBasePaths(String.raw`CommonInfoBases=%programdata%\1C\bases\ibases.v8i,\\server\share\common.v8i`, cfgPath),
        [
          String.raw`C:\ProgramData\1C\bases\ibases.v8i`,
          String.raw`\\server\share\common.v8i`,
        ]
      );
    } finally {
      if (previousProgramData === undefined) {
        delete process.env.ProgramData;
      } else {
        process.env.ProgramData = previousProgramData;
      }
    }
  });
});
