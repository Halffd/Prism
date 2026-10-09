/**
 * Configurable logging for Prism.
 *
 * - Levels: debug | info | warn | error
 * - Channels: chat | search | agent | sync | system
 * - Sinks: console (default), ring buffer (in-memory, exportable as JSONL),
 *   optional async sink (e.g. chrome.storage or a remote endpoint).
 *
 * Zero dependencies; usable from the extension, TUI, desktop, and API server.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogChannel = 'chat' | 'search' | 'agent' | 'sync' | 'system';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  channel: LogChannel;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogConfig {
  /** Minimum level per channel; channels without an entry use defaultLevel. */
  levels?: Partial<Record<LogChannel, LogLevel>>;
  defaultLevel?: LogLevel;
  /** Ring buffer capacity (entries). Default 500. */
  bufferSize?: number;
  /** Enable console output. Default true. */
  console?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(
  wanted: LogLevel,
  config: LogConfig,
  channel: LogChannel,
): boolean {
  const min = config.levels?.[channel] ?? config.defaultLevel ?? 'info';
  return LEVEL_ORDER[wanted] >= LEVEL_ORDER[min];
}

export class Logger {
  private config: LogConfig;
  private buffer: LogEntry[] = [];
  private asyncSinks: Array<(entries: LogEntry) => Promise<void>> = [];

  constructor(config: LogConfig = {}) {
    this.config = {
      bufferSize: 500,
      console: true,
      defaultLevel: 'info',
      ...config,
    };
  }

  configure(config: Partial<LogConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Register an async sink (storage, remote collector…). Called per entry. */
  addAsyncSink(sink: (entry: LogEntry) => Promise<void>): void {
    this.asyncSinks.push(sink);
  }

  debug(
    message: string,
    channel: LogChannel = 'system',
    data?: Record<string, unknown>,
  ): void {
    this.log('debug', channel, message, data);
  }

  info(
    message: string,
    channel: LogChannel = 'system',
    data?: Record<string, unknown>,
  ): void {
    this.log('info', channel, message, data);
  }

  warn(
    message: string,
    channel: LogChannel = 'system',
    data?: Record<string, unknown>,
  ): void {
    this.log('warn', channel, message, data);
  }

  error(
    message: string,
    channel: LogChannel = 'system',
    data?: Record<string, unknown>,
  ): void {
    this.log('error', channel, message, data);
  }

  private log(
    level: LogLevel,
    channel: LogChannel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (!shouldLog(level, this.config, channel)) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      channel,
      message,
      data,
    };

    // Ring buffer with capacity cap
    this.buffer.push(entry);
    if (this.buffer.length > (this.config.bufferSize ?? 500)) {
      this.buffer.shift();
    }

    if (this.config.console !== false) {
      const prefix = `[prism:${channel}]`;
      const fn =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : level === 'debug'
              ? console.debug
              : console.log;
      if (data !== undefined) fn(prefix, message, data);
      else fn(prefix, message);
    }

    // Fire-and-forget async sinks
    for (const sink of this.asyncSinks) {
      sink(entry).catch(() => {
        /* a failing sink must never break logging */
      });
    }
  }

  /** All buffered entries (oldest first). */
  entries(): LogEntry[] {
    return [...this.buffer];
  }

  /** Buffered entries as newline-delimited JSON. */
  exportJsonl(): string {
    return this.buffer.map((e) => JSON.stringify(e)).join('\n');
  }

  clear(): void {
    this.buffer = [];
  }
}

/** Shared default instance. */
export const logger = new Logger();
