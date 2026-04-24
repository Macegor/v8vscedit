import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sessionParameterHandler } from '../../ui/tree/nodeBuilders/sessionParameter';
import { MetadataNode } from '../../ui/tree/TreeNode';

const EXAMPLE_CF = path.resolve(__dirname, '../../../../example/cf');

suite('sessionParameterHandler', () => {
  test('Свойства параметра сеанса: порядок как в XML и тип', function () {
    const xmlPath = path.join(EXAMPLE_CF, 'SessionParameters', 'АвторизованныйПользователь.xml');
    if (!fs.existsSync(xmlPath)) {
      this.skip();
      return;
    }

    const node = new MetadataNode({
      label: 'АвторизованныйПользователь',
      nodeKind: 'SessionParameter',
      xmlPath,
    }, vscode.TreeItemCollapsibleState.None);

    const props = sessionParameterHandler.getProperties!(node);
    const keys = props.map((p) => p.key);

    assert.deepStrictEqual(keys, ['Name', 'Synonym', 'Comment', 'Type']);

    const typeProp = props.find((p) => p.key === 'Type');
    assert.ok(typeProp && typeProp.kind === 'metadataType');
    const typeValue = typeProp!.value as {
      presentation: string;
      items: Array<{ canonical: string }>;
    };

    assert.ok(
      typeValue.items.some((item) => item.canonical === 'CatalogRef.Пользователи'),
      'Ожидался составной тип со ссылкой на справочник Пользователи'
    );
    assert.ok(typeValue.presentation.includes('СправочникСсылка.Пользователи'));
  });
});
