import { BASELINE_RULESET } from './baselineRuleset';
import type { FormatRuleset } from './FormatRuleset';

/**
 * Ruleset формата 2.20 — дельта от baseline (2.21). Отличия, снятые с эталонной
 * выгрузки `example/2.20`:
 *   - у корневого `<MetaDataObject>` НЕТ пространства имён `xmlns:pal`
 *     (палитра появилась в наборе префиксов только в 2.21);
 *   - у отчёта НЕТ свойства `<AuxiliaryVariantForm/>` (добавлено в 2.21).
 *
 * Блоки `<StandardAttributes>`/`<StandardTabularSections>` и таблица
 * generatedTypes у 2.20 и 2.21 совпадают по составу/порядку, поэтому наследуются
 * из baseline без изменений.
 */
export const FORMAT_2_20_RULESET: FormatRuleset = {
  ...BASELINE_RULESET,
  id: 'format-2.20',
  metaDataObjectXmlns: BASELINE_RULESET.metaDataObjectXmlns.replace(
    ' xmlns:pal="http://v8.1c.ru/8.1/data/ui/colors/palette"',
    ''
  ),
  includeReportAuxiliaryVariantForm: false,
};
