import { SupportMode } from '../../infra/support/SupportInfoService';

/** Значение режима поддержки в протоколе webview (`src-ui/shared/types/tree.ts`). */
export type SupportModeDto = 'none' | 'locked' | 'editable' | 'removed';

export interface SupportPresentation {
  /** Токен в `contextValue` узла — по нему режим читают меню и панель. */
  readonly suffix: string;
  readonly dto: SupportModeDto;
  /** Имя SVG в `src/icons/{light,dark}` без расширения. */
  readonly icon: string;
  readonly title: string;
}

/**
 * Единая таблица представления режимов: суффикс contextValue, DTO, иконка и подпись.
 * Раньше эти соответствия разбирались строками в нескольких местах UI и расходились.
 */
export const SUPPORT_PRESENTATION: Readonly<Record<SupportMode, SupportPresentation>> = {
  [SupportMode.None]: { suffix: '-supportNone', dto: 'none', icon: 'support-none', title: 'Не на поддержке' },
  [SupportMode.Locked]: {
    suffix: '-supportLocked', dto: 'locked', icon: 'support-locked', title: 'На поддержке, редактирование запрещено',
  },
  [SupportMode.Editable]: {
    suffix: '-supportEditable', dto: 'editable', icon: 'support-editable', title: 'На поддержке, редактирование разрешено',
  },
  [SupportMode.Removed]: { suffix: '-supportRemoved', dto: 'removed', icon: 'support-removed', title: 'Снят с поддержки' },
};

const SUFFIX_RE = /-support(None|Locked|Editable|Removed)(?![A-Za-z])/g;

const MODE_BY_TOKEN: Readonly<Record<string, SupportMode>> = {
  None: SupportMode.None,
  Locked: SupportMode.Locked,
  Editable: SupportMode.Editable,
  Removed: SupportMode.Removed,
};

/**
 * Ставит суффикс режима, предварительно удаляя ЛЮБОЙ прежний в любом месте строки:
 * после суффикса поддержки к contextValue дописываются `-repo…`, и замена только
 * в конце строки копила бы суффиксы при каждом getTreeItem.
 */
export function withSupportSuffix(contextValue: string | undefined, mode: SupportMode): string {
  return withoutSupportSuffix(contextValue) + SUPPORT_PRESENTATION[mode].suffix;
}

/** Убирает суффикс режима: у конфигурации без данных поддержки режима нет вовсе. */
export function withoutSupportSuffix(contextValue: string | undefined): string {
  return (contextValue ?? '').replace(SUFFIX_RE, '');
}

export function supportModeFromContextValue(contextValue: string): SupportMode | undefined {
  const m = /-support(None|Locked|Editable|Removed)(?![A-Za-z])/.exec(contextValue);
  return m ? MODE_BY_TOKEN[m[1]] : undefined;
}
