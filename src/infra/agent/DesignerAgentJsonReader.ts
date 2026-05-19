import type { AgentMessage } from '../../domain/agent';

export class DesignerAgentJsonReader {
  private buffer = '';

  push(chunk: string | Buffer): AgentMessage[][] {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk;
    const batches: AgentMessage[][] = [];

    for (;;) {
      const range = findFirstJsonArray(this.buffer);
      if (!range) {
        this.trimNoiseBeforeJson();
        return batches;
      }

      const rawJson = this.buffer.slice(range.start, range.end + 1);
      try {
        const parsed = JSON.parse(rawJson) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error('ответ не является массивом');
        }
        batches.push(parsed.map(normalizeAgentMessage));
        this.buffer = this.buffer.slice(range.end + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const parseError = new Error(
          `Не удалось разобрать JSON-ответ агента: ${message}. Фрагмент: ${rawJson.slice(0, 200)}`
        ) as Error & { cause?: unknown };
        parseError.cause = error;
        throw parseError;
      }
    }
  }

  reset(): void {
    this.buffer = '';
  }

  private trimNoiseBeforeJson(): void {
    const nextJsonStart = this.buffer.indexOf('[');
    if (nextJsonStart > 0) {
      this.buffer = this.buffer.slice(nextJsonStart);
    } else if (nextJsonStart < 0 && this.buffer.length > 4096) {
      this.buffer = this.buffer.slice(-1024);
    }
  }
}

interface JsonRange {
  readonly start: number;
  readonly end: number;
}

function findFirstJsonArray(text: string): JsonRange | null {
  const start = text.indexOf('[');
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index };
      }
    }
  }

  return null;
}

function normalizeAgentMessage(value: unknown): AgentMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    throw new Error('элемент массива не является сообщением агента');
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') {
    throw new Error('тип сообщения агента должен быть строкой');
  }
  return value as AgentMessage;
}
