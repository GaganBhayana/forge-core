import { redact, redactString } from './redact.ts';

/** Log levels from most to least verbose. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** One of {@link LOG_LEVELS}. */
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Structured fields attached to a log line. */
export type LogFields = Readonly<Record<string, unknown>>;

/** Receives one complete JSON line per record, without the trailing newline. */
export type LogSink = (line: string) => void;

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  /** Lowest level that is written. Defaults to `info`. */
  readonly level?: LogLevel;
  /** Where lines go. Defaults to standard output. */
  readonly sink?: LogSink;
  /** Fields bound to every line. */
  readonly fields?: LogFields;
  /** Current time in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/** A JSON-lines logger. Every line is passed through the secret redactor. */
export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a logger that adds `fields` to every line; the parent is unchanged. */
  child(fields: LogFields): Logger;
}

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Creates a logger that writes `{"time","level","msg",...fields}` as one JSON line per call.
 * Call fields override bound fields; `time`, `level` and `msg` cannot be overridden.
 * Logging never throws because of its fields: if they cannot be serialized, a short line
 * with the message and a `logError` field is written instead.
 * Throws a `TypeError` for an unknown `level`.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  if (!LOG_LEVELS.includes(level)) {
    throw new TypeError(`unknown log level ${JSON.stringify(level)}; expected one of ${LOG_LEVELS.join(', ')}`);
  }
  const sink = options.sink ?? stdoutSink;
  const now = options.now ?? Date.now;
  const bound = options.fields ?? {};
  const threshold = LOG_LEVELS.indexOf(level);

  const write = (lineLevel: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(lineLevel) < threshold) return;
    sink(formatLine(lineLevel, msg, [bound, fields], now));
  };

  return {
    level,
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (fields) => createLogger({ level, sink, now, fields: { ...bound, ...fields } }),
  };
}

/** Builds the JSON line for one record, falling back to a minimal line if the fields can't be serialized. */
function formatLine(level: LogLevel, msg: string, layers: readonly LogFields[], now: () => number): string {
  const time = safeTime(now);
  try {
    const merged: Record<string, unknown> = Object.assign({}, ...layers);
    const record: Record<string, unknown> = { time, level, msg };
    for (const [key, value] of Object.entries(merged)) {
      if (!Object.hasOwn(record, key)) record[key] = value;
    }
    return JSON.stringify(redact(record));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return JSON.stringify({ time, level, msg: redactString(msg), logError: `fields not serializable: ${redactString(reason)}` });
  }
}

/** ISO time from `now`, or the system time if `now` throws or returns an invalid value. */
function safeTime(now: () => number): string {
  try {
    return new Date(now()).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** Parses a level name, for example from an environment variable. Unknown names give `undefined`. */
export function parseLogLevel(name: string | undefined): LogLevel | undefined {
  const normal = name?.trim().toLowerCase();
  return LOG_LEVELS.find((level) => level === normal);
}
