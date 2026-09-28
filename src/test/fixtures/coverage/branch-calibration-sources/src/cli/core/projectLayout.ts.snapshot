/**
 * Тонкий re-export раскладки проекта для CLI.
 *
 * Само правило («src/cf» для основной конфигурации, «src/cfe/<имя>» для
 * расширения) нужно и расширению, и CLI, поэтому живёт в `infra/fs/` — так
 * предписывает CLAUDE.md для общего кода. Здесь остаётся только реэкспорт,
 * чтобы существующие импорты CLI не менялись и не появилось второго
 * источника знания о раскладке (запрет №2).
 */
export { resolveConfigDir } from '../../infra/fs/ProjectLayout';
export type { ConfigTarget } from '../../infra/fs/ProjectLayout';
