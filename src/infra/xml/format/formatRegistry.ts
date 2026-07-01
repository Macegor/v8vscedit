import { BASELINE_RULESET } from './baselineRuleset';
import type { FormatRuleset } from './FormatRuleset';

/**
 * Версия формата сериализации, используемая когда определить её из выгрузки не
 * удалось. Совпадает с прежним поведением `MetadataXmlCreator`.
 */
export const DEFAULT_FORMAT_VERSION = '2.18';

/** Все зарегистрированные ruleset'ы по их id. */
const RULESETS = new Map<string, FormatRuleset>([[BASELINE_RULESET.id, BASELINE_RULESET]]);

/**
 * Карта «версия формата → id ruleset». Несколько версий могут ссылаться на
 * один ruleset, пока генерация между ними не отличается. Когда по донору
 * выясняется, что формат поменялся, — добавляется новый ruleset и его версии.
 */
const SUPPORTED_FORMATS = new Map<string, string>([
  ['2.18', BASELINE_RULESET.id],
  ['2.19', BASELINE_RULESET.id],
  ['2.20', BASELINE_RULESET.id],
  ['2.21', BASELINE_RULESET.id],
]);

export type FormatRulesetWarning = (message: string) => void;

let emitWarning: FormatRulesetWarning = () => {
  // по умолчанию предупреждения подавляются, пока приёмник не подключён
};

/** Подключает приёмник предупреждений (например, output-канал расширения). */
export function setFormatRulesetWarning(handler: FormatRulesetWarning): void {
  emitWarning = handler;
}

/**
 * Регистрирует ruleset и привязывает к нему перечисленные версии формата.
 * Вызывается при добавлении поддержки нового поколения формата по донору.
 */
export function registerFormatRuleset(ruleset: FormatRuleset, versions: readonly string[]): void {
  RULESETS.set(ruleset.id, ruleset);
  for (const version of versions) {
    SUPPORTED_FORMATS.set(version, ruleset.id);
  }
}

/**
 * Возвращает ruleset для версии формата. Для незнакомой версии берёт самый
 * свежий известный ruleset и сигналит предупреждением: работу не блокируем,
 * но честно помечаем, что вывод может не совпасть с этой версией платформы.
 */
export function resolveFormatRuleset(version: string): FormatRuleset {
  const id = SUPPORTED_FORMATS.get(version);
  if (id) {
    return RULESETS.get(id) ?? BASELINE_RULESET;
  }

  const newest = newestKnownRuleset();
  emitWarning(
    `Формат выгрузки "${version}" не описан в правилах генерации. ` +
      `Используются правила "${newest.id}" (самые свежие из известных). ` +
      `Сгенерированный XML может не совпасть с этой версией платформы 1С.`
  );
  return newest;
}

/** Ruleset, привязанный к максимальной известной версии формата. */
function newestKnownRuleset(): FormatRuleset {
  let bestVersion: string | undefined;
  let bestId = BASELINE_RULESET.id;
  for (const [version, id] of SUPPORTED_FORMATS) {
    if (bestVersion === undefined || compareFormatVersions(version, bestVersion) > 0) {
      bestVersion = version;
      bestId = id;
    }
  }
  return RULESETS.get(bestId) ?? BASELINE_RULESET;
}

/** Сравнивает версии формата вида «2.21» покомпонентно. */
function compareFormatVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10));
  const pb = b.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
