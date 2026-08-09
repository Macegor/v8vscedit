import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Корень эталонных выгрузок 1С (генерации формата 2.20 и 2.21), общий для
 * всех тестов дефекта «слепота validate_form к дублям id». Вынесен в support,
 * т.к. используется несколькими тестовыми файлами (formIdSpaces, formValidateIds).
 */
export const EXAMPLE_ROOT = path.resolve(__dirname, '../../../../example');

/**
 * Рекурсивно находит все `Form.xml` под заданным корнем. Используется для
 * широкого sweep-теста (регресс «ноль ложных срабатываний» по всему корпусу
 * эталонов) и для курируемого списка форм-носителей.
 */
export function findAllFormXmlFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'Form.xml') {
        result.push(full);
      }
    }
  };
  walk(root);
  return result;
}

/**
 * Пишет XML формы во временный каталог со структурой `<root>/Форма/Ext/Form.xml`,
 * как ожидает `resolveFormXmlPath`. Возвращает путь к записанному файлу.
 */
export function writeFormCopy(xml: string, root?: string): string {
  const base = root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'v8vscedit-formids-'));
  const dir = path.join(base, 'Форма', 'Ext');
  fs.mkdirSync(dir, { recursive: true });
  const formPath = path.join(dir, 'Form.xml');
  fs.writeFileSync(formPath, xml, 'utf-8');
  return formPath;
}
