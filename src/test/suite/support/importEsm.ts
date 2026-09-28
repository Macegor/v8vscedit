import { pathToFileURL } from 'node:url';

/**
 * Обходит даунлевелинг `import()` → `require()`, который `tsc` делает при
 * `module: "commonjs"` (как в этом проекте). Обычный `import('...')` внутри
 * `.test.ts` был бы транспилирован в `Promise.resolve().then(() => require('...'))`,
 * а `require()` не умеет грузить чистый ESM (`.mjs`) — упадёт с `ERR_REQUIRE_ESM`.
 * Обёртка в `new Function` прячет вызов `import()` от трансформации tsc (тело
 * функции — просто строка, AST её не видит), поэтому в рантайме выполняется
 * НАТИВНЫЙ динамический `import()`, который ESM грузит штатно.
 *
 * Ошибка отсутствующего на фазе «красный» модуля (`ERR_MODULE_NOT_FOUND`)
 * всплывает здесь же, ВНУТРИ вызова конкретного теста/suiteSetup — не на
 * верхнем уровне файла при загрузке раннером (`src/test/suite/index.ts` грузит
 * все `*.test.js` через `require()` до фильтрации по `MOCHA_GREP`), поэтому
 * отсутствие `scripts/patch-coverage/*.mjs` не обрушивает загрузку остальных
 * файлов сьюта — см. симметричный `support/tryRequireProductionModule.ts` для
 * той же проблемы с обычными `.ts`-модулями (там она решена через `require`).
 */
// Намеренно: только так `import()` переживает даунлевелинг tsc в CommonJS (см. JSDoc
// выше). Строка-литерал фиксирована здесь же, никакого пользовательского ввода в неё
// не попадает — implied-eval здесь не тот риск, от которого защищает правило.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport = new Function('specifier', 'return import(specifier);') as (
  specifier: string
) => Promise<unknown>;

/**
 * Импортирует ES-модуль по АБСОЛЮТНОМУ пути к файлу на диске и приводит
 * результат к ожидаемой форме через дженерик (вызывающий код сам описывает
 * узкий интерфейс модуля — без `any`).
 */
export async function importEsmModule<T>(absolutePath: string): Promise<T> {
  return (await dynamicImport(pathToFileURL(absolutePath).href)) as T;
}

/** `code` ERR_MODULE_NOT_FOUND у ошибок динамического import() отсутствующего модуля. */
export function isModuleNotFoundError(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND';
}
