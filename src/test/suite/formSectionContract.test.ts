import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FORM_PROPERTY_SECTION } from '../../ui/views/properties/propertyKeyOrder';

/**
 * Защита от ПОВТОРЕНИЯ исходного дефекта.
 *
 * Контрол выбора формы включается в панели свойств не по виду объекта и не по
 * имени свойства, а по СОВПАДЕНИЮ ЗАГОЛОВКА СЕКЦИИ: webview рендерит блок
 * `PropertyFormsSection` только когда `card.section.title === 'Формы'`.
 * Заголовок при этом задаётся на стороне расширения (`FORM_PROPERTY_SECTION`),
 * а сравнивается на стороне webview литералом в `.vue` — связка неявная и
 * проходит через границу сборки, поэтому ни компилятор, ни тайпчек её не видят.
 *
 * Именно эта неявная связка дефект и породила: секцию проставляли только
 * справочник и документ, у остальных видов свойства форм попадали в общую
 * секцию, и пикера не было вовсе. Переименование заголовка на ЛЮБОЙ стороне
 * молча выключит выбор формы сразу у ВСЕХ видов — без этого теста молча.
 */

const PROPERTIES_VIEW_VUE = path.resolve(
  __dirname,
  '../../../src-ui/apps/dynamic-panel/views/properties/PropertiesView.vue'
);

const PROPERTY_KEY_ORDER_TS = path.resolve(__dirname, '../../../src/ui/views/properties/propertyKeyOrder.ts');
const PROPERTIES_VIEW_CONTROLLER_TS = path.resolve(
  __dirname,
  '../../../src/ui/views/properties/PropertiesViewController.ts'
);

suite('Контракт секции «Формы» между расширением и webview', () => {
  test('заголовок секции в PropertiesView.vue совпадает с FORM_PROPERTY_SECTION.title', () => {
    assert.ok(
      fs.existsSync(PROPERTIES_VIEW_VUE),
      `панель свойств webview не найдена по пути ${PROPERTIES_VIEW_VUE}: файл переименован или перенесён, ` +
      'контракт секции «Формы» проверить нечем — обновите путь в тесте вместе с переносом'
    );
    const source = fs.readFileSync(PROPERTIES_VIEW_VUE, 'utf-8');

    const matches = [...source.matchAll(/card\.section\.title\s*===\s*'([^']*)'/g)];
    assert.strictEqual(
      matches.length,
      1,
      'в PropertiesView.vue ожидалось ровно одно сравнение заголовка секции с литералом ' +
      `(включение контрола выбора формы), найдено ${String(matches.length)}`
    );
    assert.strictEqual(
      matches[0][1],
      FORM_PROPERTY_SECTION.title,
      'заголовок секции выбора форм разошёлся между расширением и webview: ' +
      `расширение ставит «${FORM_PROPERTY_SECTION.title}», webview ждёт «${matches[0][1]}» — ` +
      'пикер формы выключится сразу у всех видов метаданных'
    );
  });

  test('на стороне расширения заголовок берётся из константы, а не из сырого литерала', () => {
    // Третье место, где заголовок сравнивался строкой, — сокращение ссылки на
    // форму в PropertiesViewController. Оно переведено на константу; тест не
    // даёт литералу вернуться и завести четвёртую независимую копию.
    const controller = fs.readFileSync(PROPERTIES_VIEW_CONTROLLER_TS, 'utf-8');
    assert.ok(
      !controller.includes(`'${FORM_PROPERTY_SECTION.title}'`),
      `в PropertiesViewController.ts снова появился литерал «${FORM_PROPERTY_SECTION.title}» — ` +
      'используйте FORM_PROPERTY_SECTION.title'
    );

    // В propertyKeyOrder.ts литерал допустим ровно один раз — в самом объявлении.
    const keyOrder = fs.readFileSync(PROPERTY_KEY_ORDER_TS, 'utf-8');
    const declarations = [...keyOrder.matchAll(new RegExp(`'${FORM_PROPERTY_SECTION.title}'`, 'g'))];
    assert.strictEqual(
      declarations.length,
      1,
      `заголовок секции «${FORM_PROPERTY_SECTION.title}» объявлен в propertyKeyOrder.ts ` +
      `${String(declarations.length)} раз(а) — источник правды обязан быть один`
    );
  });
});
