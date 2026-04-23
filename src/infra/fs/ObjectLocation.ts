import * as path from 'path';

/** Разобранный путь к объекту метаданных внутри каталога выгрузки */
export interface ObjectLocation {
  /** Абсолютный путь к каталогу конфигурации */
  configRoot: string;
  /** Имя папки категории (например `Catalogs`, `Documents`) */
  folderName: string;
  /** Имя объекта */
  objectName: string;
  /** Абсолютный путь к каталогу объекта (всегда существует концептуально, даже при плоской структуре) */
  objectDir: string;
}

/**
 * Возвращает корень конфигурации, имя папки, имя объекта и каталог объекта по пути XML.
 * Понимает две формы выгрузки:
 *   - глубокая: `<Root>/<Folder>/<Name>/<Name>.xml`;
 *   - плоская:  `<Root>/<Folder>/<Name>.xml`.
 */
export function getObjectLocationFromXml(xmlPath: string): ObjectLocation {
  const normalized = path.normalize(xmlPath);
  const fileName = path.basename(normalized, '.xml');
  const xmlDir = path.dirname(normalized);
  const parentName = path.basename(xmlDir);

  const isDeep = parentName === fileName;

  if (isDeep) {
    const folderDir = path.dirname(xmlDir);
    return {
      configRoot: path.dirname(folderDir),
      folderName: path.basename(folderDir),
      objectName: fileName,
      objectDir: xmlDir,
    };
  }

  return {
    configRoot: path.dirname(xmlDir),
    folderName: path.basename(xmlDir),
    objectName: fileName,
    objectDir: path.join(xmlDir, fileName),
  };
}
