import * as path from 'path';

export type ConfigTarget = 'cf' | 'cfe';

/**
 * Возвращает путь к XML-исходникам в рамках жёсткой структуры проекта.
 */
export function resolveConfigDir(projectRoot: string, target: ConfigTarget, extensionName?: string): string {
  if (target === 'cf') {
    return path.join(projectRoot, 'src', 'cf');
  }

  if (!extensionName?.trim()) {
    throw new Error('Error: -Extension is required for cfe target');
  }
  return path.join(projectRoot, 'src', 'cfe', extensionName);
}
