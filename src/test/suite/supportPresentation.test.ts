import * as assert from 'assert';
import { SupportMode } from '../../infra/support/SupportInfoService';
import {
  SUPPORT_PRESENTATION,
  supportModeFromContextValue,
  withSupportSuffix,
} from '../../ui/support/supportPresentation';

const MODES: readonly { mode: SupportMode; suffix: string; dto: string; icon: string; title: string }[] = [
  { mode: SupportMode.None, suffix: '-supportNone', dto: 'none', icon: 'support-none', title: 'Не на поддержке' },
  { mode: SupportMode.Locked, suffix: '-supportLocked', dto: 'locked', icon: 'support-locked', title: 'На поддержке, редактирование запрещено' },
  { mode: SupportMode.Editable, suffix: '-supportEditable', dto: 'editable', icon: 'support-editable', title: 'На поддержке, редактирование разрешено' },
  { mode: SupportMode.Removed, suffix: '-supportRemoved', dto: 'removed', icon: 'support-removed', title: 'Снят с поддержки' },
];

suite('supportPresentation', () => {
  test('таблица полна: запись на каждый из 4 режимов', () => {
    assert.strictEqual(Object.keys(SUPPORT_PRESENTATION).length, 4);
    for (const m of MODES) {
      const entry = SUPPORT_PRESENTATION[m.mode];
      assert.strictEqual(entry.suffix, m.suffix);
      assert.strictEqual(entry.dto, m.dto);
      assert.strictEqual(entry.icon, m.icon);
      assert.strictEqual(entry.title, m.title);
    }
  });

  for (const m of MODES) {
    suite(m.mode, () => {
      test('withSupportSuffix: undefined → только суффикс', () => {
        assert.strictEqual(withSupportSuffix(undefined, m.mode), m.suffix);
      });

      test('withSupportSuffix: добавляется к базовому значению', () => {
        assert.strictEqual(withSupportSuffix('object', m.mode), `object${m.suffix}`);
      });

      test('withSupportSuffix: заменяет любой прежний суффикс поддержки', () => {
        for (const other of MODES) {
          assert.strictEqual(withSupportSuffix(`object${other.suffix}`, m.mode), `object${m.suffix}`);
        }
      });

      test('withSupportSuffix: суффикс в середине (перед -repo…) заменяется, а не копится', () => {
        const result = withSupportSuffix('base-supportLocked-repoConnected', m.mode);
        const tokens = result.match(/-support(None|Locked|Editable|Removed)/g) ?? [];
        assert.strictEqual(tokens.length, 1);
        assert.ok(result.includes(m.suffix));
        assert.ok(result.includes('-repoConnected'));
        assert.ok(result.startsWith('base'));
      });

      test('supportModeFromContextValue: распознаёт режим, в том числе рядом с -repo…', () => {
        assert.strictEqual(supportModeFromContextValue(`object${m.suffix}`), m.mode);
        assert.strictEqual(supportModeFromContextValue(`object${m.suffix}-repoLocked`), m.mode);
      });

      test('повторное применение идемпотентно', () => {
        const once = withSupportSuffix('object-repoConnected', m.mode);
        assert.strictEqual(withSupportSuffix(once, m.mode), once);
      });
    });
  }

  test('supportModeFromContextValue: без суффикса → undefined', () => {
    assert.strictEqual(supportModeFromContextValue('object'), undefined);
    assert.strictEqual(supportModeFromContextValue('object-repoLocked'), undefined);
    assert.strictEqual(supportModeFromContextValue(''), undefined);
  });
});
