import type { ProjectSecretStorage } from './ProjectSecretStorage';

/**
 * Резолвит пароль подключения к базе: сначала смотрит в `ProjectSecretStorage`
 * (новое, безопасное хранилище), и только при отсутствии секрета — на legacy
 * значение из `env.json` (для конфигураций, ещё не пересохранённых через новый
 * `ProjectEnvironmentService.save`).
 */
export async function resolveDbPassword(
  secrets: ProjectSecretStorage,
  legacyEnvJsonPassword: string
): Promise<string> {
  const stored = await secrets.getDbPassword();
  if (stored !== undefined) {
    return stored;
  }
  return legacyEnvJsonPassword;
}
