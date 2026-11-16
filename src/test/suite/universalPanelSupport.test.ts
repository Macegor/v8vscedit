import * as assert from 'assert';
import * as path from 'path';
import { SupportInfoService } from '../../infra/support/SupportInfoService';
import { LineLogger, makeTempDir, removeTempDir } from './support/parentConfigurationsBin';
import { SUPPORT_CATALOGS, buildSupportConfig } from './support/supportConfigFixture';
import {
  createUniversalPanelFixture,
  type TreeNodeDtoLike,
  type UniversalPanelFixture,
} from './support/universalPanelHarness';

async function findByLabel(
  fixture: UniversalPanelFixture,
  nodes: readonly TreeNodeDtoLike[],
  label: string,
  depth = 0
): Promise<TreeNodeDtoLike | undefined> {
  for (const node of nodes) {
    if (node.label === label) {
      return node;
    }
    if (depth < 4 && node.hasChildren) {
      const found = await findByLabel(fixture, await fixture.loadChildren(node.id), label, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

suite('UniversalPanelViewProvider — режим поддержки в DTO узла', () => {
  let tmp: string;
  let fixture: UniversalPanelFixture | undefined;

  setup(() => {
    tmp = makeTempDir('v8vscedit-panel-support-');
  });

  teardown(() => {
    fixture?.dispose();
    fixture = undefined;
    removeTempDir(tmp);
  });

  function open(withBin: boolean): UniversalPanelFixture {
    const cf = path.join(tmp, 'cf');
    buildSupportConfig(cf, withBin);
    fixture = createUniversalPanelFixture({
      entries: [{ kind: 'cf', rootPath: cf }],
      supportService: new SupportInfoService(new LineLogger()),
    });
    return fixture;
  }

  const TITLES: Record<string, string | undefined> = {
    none: 'Не на поддержке',
    locked: 'На поддержке, редактирование запрещено',
    editable: 'На поддержке, редактирование разрешено',
    removed: 'Снят с поддержки',
  };

  for (const catalog of SUPPORT_CATALOGS) {
    test(`${catalog.mode}: supportMode='${catalog.dto}' и подпись «${TITLES[catalog.dto] ?? ''}» в stateIcons`, async function () {
      this.timeout(60_000);
      const panel = open(true);
      const node = await findByLabel(panel, panel.rootNodes, catalog.name);
      assert.ok(node, `узел ${catalog.name} не найден`);
      assert.strictEqual(node.supportMode, catalog.dto);
      const titles = (node.stateIcons ?? []).map((i) => i.title);
      assert.ok(titles.includes(TITLES[catalog.dto] ?? ''), `stateIcons: ${JSON.stringify(titles)}`);
    });
  }

  test('без bin: supportMode=none и нет иконки поддержки', async function () {
    this.timeout(60_000);
    const panel = open(false);
    for (const catalog of SUPPORT_CATALOGS) {
      const node = await findByLabel(panel, panel.rootNodes, catalog.name);
      assert.ok(node, `узел ${catalog.name} не найден`);
      assert.strictEqual(node.supportMode, 'none', catalog.name);
      const titles = (node.stateIcons ?? []).map((i) => i.title);
      assert.strictEqual(titles.some((t) => /поддержк/i.test(t)), false, `${catalog.name}: ${JSON.stringify(titles)}`);
    }
  });
});
