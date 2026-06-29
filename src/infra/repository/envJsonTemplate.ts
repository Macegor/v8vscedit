import * as fs from 'fs';
import * as path from 'path';

/**
 * Шаблон env.json — единый источник для инициализации проекта и доинициализации
 * пустого/отсутствующего файла. Совместим с vanessa-runner.
 */
export const DEFAULT_ENV_JSON = {
  $schema: 'https://raw.githubusercontent.com/vanessa-opensource/vanessa-runner/develop/vanessa-runner-schema.json',
  default: {
    '--ibconnection': '',
    '--db-user': '',
    '--db-pwd': '',
    '--path': '',
    '--root': '.',
    '--workspace': '.',
    '--v8version': '',
    '--locale': 'ru',
    '--language': 'ru',
    '--additional': '/DisplayAllFunctions /Lru  /iTaxi /TESTMANAGER',
    '--ordinaryapp': '-1',
  },
} as const;

/**
 * Гарантирует валидный env.json в каталоге проекта: создаёт из шаблона, если файл
 * отсутствует или пуст (пустой файл ломает JSON.parse и навигатор). Существующий
 * непустой файл не трогает. Возвращает true, если файл был записан.
 */
export function ensureEnvJson(rootPath: string): boolean {
  const envPath = path.join(rootPath, 'env.json');
  if (fs.existsSync(envPath) && fs.readFileSync(envPath, 'utf-8').trim().length > 0) {
    return false;
  }
  fs.writeFileSync(envPath, `${JSON.stringify(DEFAULT_ENV_JSON, null, 2)}\n`, 'utf-8');
  return true;
}
