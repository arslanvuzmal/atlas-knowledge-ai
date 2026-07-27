import { randomUUID } from 'node:crypto';

/**
 * Structured logging with redaction.
 *
 * Every log line is JSON so it can be shipped to a log aggregator unchanged.
 * Values are passed through a redactor before serialisation: this is the last
 * line of defence against an API key or session token reaching a log sink.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY_PATTERN =
  /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|session|credential|signature|passwordhash)/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI style
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic style
  /\bAIza[0-9A-Za-z_-]{20,}\b/g, // Google style
  /\bhf_[A-Za-z0-9]{16,}\b/g, // Hugging Face style
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /postgres(?:ql)?:\/\/[^\s"']+/gi, // connection strings
];

export const REDACTED = '[redacted]';

export function redactString(input: string): string {
  let output = input;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    output = output.replace(pattern, REDACTED);
  }
  return output;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      // Stacks are kept internal only; they are never returned to a client.
      stack: process.env.NODE_ENV === 'production' ? undefined : redactString(value.stack ?? ''),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return out;
  }
  return '[unserialisable]';
}

function activeLevel(): LogLevel {
  const configured = (process.env.LOG_LEVEL ?? '').toLowerCase();
  if (configured in LEVEL_WEIGHT) return configured as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

export interface LogFields {
  correlationId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[activeLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: redactString(message),
    ...(redact(fields) as Record<string, unknown>),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
  /** Returns a logger that stamps every line with the same correlation id. */
  child: (base: LogFields) => ({
    debug: (message: string, fields?: LogFields) => emit('debug', message, { ...base, ...fields }),
    info: (message: string, fields?: LogFields) => emit('info', message, { ...base, ...fields }),
    warn: (message: string, fields?: LogFields) => emit('warn', message, { ...base, ...fields }),
    error: (message: string, fields?: LogFields) => emit('error', message, { ...base, ...fields }),
  }),
};

export function newCorrelationId(): string {
  return randomUUID();
}
