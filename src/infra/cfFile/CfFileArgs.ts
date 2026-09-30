/**
 * Построение вектора аргументов пакетного Конфигуратора для выгрузки/загрузки
 * бинарных файлов конфигурации (`.cf`) и расширений (`.cfe`).
 *
 * Вектор аргументов — единственный реальный контракт с платформой: проверенный
 * прогон 8.3.27.1989 показал, что Конфигуратор МОЛЧА игнорирует неизвестные
 * ключи (`/DumpCfg <файл> -ЗаведомоНетТакого` → exit 0), а `-AllExtensions`
 * принимает с exit 0, отдавая при этом выгрузку ОСНОВНОЙ конфигурации. То есть
 * ошибка в векторе НЕ диагностируется ни кодом возврата, ни логом — поэтому
 * функция умышленно не имеет параметра, из которого мог бы получиться
 * `-AllExtensions`, а состав/порядок ключей зафиксирован точными тестами.
 */
import * as path from 'path';

export type CfFileOperation = 'dump' | 'load';

export interface CfFileDesignerArgsOptions {
  readonly operation: CfFileOperation;
  /** Путь к .cf/.cfe; нормализуется в абсолютный (процесс запускается с shell:false — кавычки не нужны). */
  readonly filePath: string;
  /** Имя расширения; пустое/пробельное значение означает основную конфигурацию. */
  readonly extensionName?: string;
  /** Файл служебного вывода Конфигуратора (`/Out`). */
  readonly outLogFile: string;
}

/** Собирает вектор аргументов `DESIGNER` для `/DumpCfg` или `/LoadCfg`. */
export function buildCfFileDesignerArgs(options: CfFileDesignerArgsOptions): string[] {
  const command = options.operation === 'dump' ? '/DumpCfg' : '/LoadCfg';
  const args: string[] = [command, path.resolve(options.filePath)];

  const extensionName = (options.extensionName ?? '').trim();
  if (extensionName) {
    args.push('-Extension', extensionName);
  }

  args.push('/Out', options.outLogFile, '/DisableStartupDialogs');
  return args;
}
