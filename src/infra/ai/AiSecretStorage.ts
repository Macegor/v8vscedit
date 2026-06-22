/**
 * Минимальный контракт хранилища секретов, совместимый с `vscode.SecretStorage`.
 * Объявлен локально, чтобы инфраструктурный слой не импортировал VS Code API
 * (реальный `context.secrets` подходит структурно).
 */
export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/**
 * Логические идентификаторы секретов панели ИИ. Реальные значения хранятся в
 * `vscode.SecretStorage` (ОС-keychain), а не в settings.json, чтобы не утекать
 * в git вместе с workspace-настройками.
 */
export type AiSecretId = 'embeddingApiKey' | 'naparnikToken' | 'onecPassword';

/** Ключи SecretStorage с неймспейсом расширения. */
const SECRET_STORAGE_KEYS: Record<AiSecretId, string> = {
  embeddingApiKey: 'v8vscedit.bslAnalyzer.embeddingApiKey',
  naparnikToken: 'v8vscedit.bslAnalyzer.naparnikToken',
  onecPassword: 'v8vscedit.bslAnalyzer.onecPassword',
};

/**
 * Обёртка над `vscode.SecretStorage` для секретов панели ИИ. Хранит реальные
 * значения вне настроек VS Code; чтение/запись/удаление — асинхронные.
 */
export class AiSecretStorage {
  constructor(private readonly secrets: SecretStore) {}

  async get(id: AiSecretId): Promise<string | undefined> {
    return this.secrets.get(SECRET_STORAGE_KEYS[id]);
  }

  async set(id: AiSecretId, value: string): Promise<void> {
    // Пустое значение трактуем как удаление, чтобы не плодить пустые записи.
    const trimmed = value.trim();
    if (trimmed) {
      await this.secrets.store(SECRET_STORAGE_KEYS[id], trimmed);
    } else {
      await this.secrets.delete(SECRET_STORAGE_KEYS[id]);
    }
  }

  async delete(id: AiSecretId): Promise<void> {
    await this.secrets.delete(SECRET_STORAGE_KEYS[id]);
  }
}
