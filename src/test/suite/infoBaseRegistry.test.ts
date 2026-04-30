import * as assert from 'assert';
import * as path from 'path';
import {
  parseCommonInfoBasePaths,
  parseV8iContent,
} from '../../infra/environment';

suite('InfoBaseRegistryService', () => {
  test('Читает файловую и серверную базу из v8i', () => {
    const bases = parseV8iContent(`
[Разработка]
Connect=File=/Users/test/InfoBases/dev;
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
    assert.strictEqual(bases[0].connection, '/F/Users/test/InfoBases/dev');
    assert.strictEqual(bases[1].kind, 'server');
    assert.strictEqual(bases[1].connection, '/Ssrv01/Demo_Test');
  });

  test('Разбирает CommonInfoBases из 1cestart.cfg', () => {
    const cfgPath = path.join('/Users/test/.1C/1cestart', '1cestart.cfg');
    const paths = parseCommonInfoBasePaths(
      'CommonInfoBases=shared.v8i,"/opt/1c/common bases.v8i"',
      cfgPath
    );

    assert.deepStrictEqual(paths, [
      path.join('/Users/test/.1C/1cestart', 'shared.v8i'),
      '/opt/1c/common bases.v8i',
    ]);
  });
});
