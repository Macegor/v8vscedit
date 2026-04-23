import { ConfigInfo } from './Configuration';

/**
 * Метка владения объектом внутри расширения (CFE):
 *  - `OWN` — имя начинается с `namePrefix` расширения (свой объект);
 *  - `BORROWED` — заимствованный из основной конфигурации.
 */
export type OwnershipTag = 'OWN' | 'BORROWED';

/** Определяет владение объектом расширения по его имени */
export function detectOwnership(info: ConfigInfo, objectName: string): OwnershipTag | undefined {
  if (info.kind !== 'cfe' || !info.namePrefix) {
    return undefined;
  }
  return objectName.startsWith(info.namePrefix) ? 'OWN' : 'BORROWED';
}
