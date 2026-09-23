// Timestamped logger. Human-readable lines go to stderr (stdout stays clean for command output such
// as `doctor --json`), and every line is also appended to the run's log file, synchronously, so the
// log survives a harness crash mid-suite.

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_TAG: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

export interface Logger {
  readonly scope: string;
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Same sink, with `scope` appended (`run/api/v2`). */
  child(scope: string): Logger;
  /** Redirect the file sink for this logger and all its children (null = stderr only). */
  setFile(file: string | null): void;
  setLevel(level: LogLevel): void;
  readonly file: string | null;
}

interface Sink {
  file: string | null;
  level: LogLevel;
  quiet: boolean;
  t0: number;
}

/** Local wall-clock ISO time with offset: the machine's clock is what the report's readers know. */
export function localIso(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

function makeLogger(sink: Sink, scope: string): Logger {
  const write = (level: LogLevel, args: unknown[]) => {
    const msg = format(...args);
    const since = ((performance.now() - sink.t0) / 1000).toFixed(3).padStart(9);
    const prefix = `${localIso()} +${since}s ${LEVEL_TAG[level]}${scope ? ` [${scope}]` : ''}`;
    const text = msg
      .split('\n')
      .map((l) => `${prefix} ${l}`)
      .join('\n');
    if (sink.file) {
      try {
        fs.appendFileSync(sink.file, `${text}\n`);
      } catch {
        // A full disk or a deleted run dir must not take the benchmark down; stderr still has it.
      }
    }
    if (!sink.quiet && LEVEL_ORDER[level] >= LEVEL_ORDER[sink.level]) process.stderr.write(`${text}\n`);
  };
  return {
    scope,
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    child: (s) => makeLogger(sink, scope ? `${scope}/${s}` : s),
    setFile(file) {
      if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
      sink.file = file;
    },
    setLevel(level) {
      sink.level = level;
    },
    get file() {
      return sink.file;
    },
  };
}

export function createLogger(opts: { scope?: string; file?: string | null; level?: LogLevel; quiet?: boolean } = {}): Logger {
  const envLevel = process.env.BENCH_LOG_LEVEL as LogLevel | undefined;
  const sink: Sink = {
    file: null,
    level: opts.level ?? (envLevel && envLevel in LEVEL_ORDER ? envLevel : 'info'),
    quiet: opts.quiet ?? false,
    t0: performance.now(),
  };
  const log = makeLogger(sink, opts.scope ?? '');
  if (opts.file) log.setFile(opts.file);
  return log;
}

/** For library code that may be called without a logger. */
export const nullLogger: Logger = createLogger({ quiet: true });

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  return typeof e === 'string' ? e : format('%o', e);
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : format('%o', e);
}
