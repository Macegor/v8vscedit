/**
 * Кэш промисов с защитой от TOCTOU: параллельные запросы с одним ключом
 * переиспользуют один и тот же in-flight промис, а не запускают фабрику дважды.
 *
 * Промис кладётся в map СРАЗУ (до await), чтобы конкурентный вызов, пришедший
 * между созданием и разрешением, увидел уже начатую операцию. При reject ключ
 * удаляется — неудачная инициализация не должна «отравлять» кэш навсегда.
 */
export function getOrCreate<K, V>(
  map: Map<K, Promise<V>>,
  key: K,
  factory: () => Promise<V>
): Promise<V> {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created = factory().catch((err: unknown) => {
    // Снимаем «отравленный» промис, чтобы следующий вызов сделал новую попытку.
    if (map.get(key) === created) {
      map.delete(key);
    }
    throw err;
  });
  map.set(key, created);
  return created;
}
