/**
 * Failure run log: buffer a process timeline in memory, write a debug file
 * only when an error is presented to the user (npm-style path notice).
 *
 * No redaction — dump argv, URLs, and error text as recorded.
 */
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionPaths } from '../domain/core.js';
import { DomainError } from '../domain/errors.js';
import {
  recordRunLog,
  setRunLogRecorder,
  type RunLogExtra,
  type RunLogLevel,
} from '../domain/run-log.js';

export const RUN_LOG_MAX_EVENTS = 2000;
export const RUN_LOG_MAX_FILES = 10;
const MAX_EXTRA_CHARS = 8000;
const DEBUG_LOG_NAME = /^\d{4}-\d{2}-\d{2}T.+-debug\.log$/;

export interface RunLogMeta {
  argv: string[];
  version: string;
  runtime: string;
  locale?: string;
  cwd?: string;
  pid?: number;
}

export interface RunLogOptions {
  directory?: string;
  maxFiles?: number;
  now?: () => Date;
}

interface RunLogEvent {
  at: Date;
  level: RunLogLevel;
  scope: string;
  message: string;
  extra?: RunLogExtra;
}

function isInterruptError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name: string }).name === 'InterruptError'
  );
}

function clip(value: string): string {
  if (value.length <= MAX_EXTRA_CHARS) return value;
  return `${value.slice(0, MAX_EXTRA_CHARS)}…`;
}

function formatExtra(extra: RunLogExtra | undefined): string {
  if (!extra) return '';
  const parts = Object.entries(extra).map(([key, value]) => `${key}=${clip(String(value))}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '_');
}

function clock(date: Date): string {
  return date.toISOString().slice(11, 23);
}

function defaultRuntime(): string {
  return process.versions.bun
    ? `bun ${process.versions.bun}`
    : `node ${process.version}`;
}

function defaultMeta(): RunLogMeta {
  return {
    argv: process.argv.slice(2),
    version: 'unknown',
    runtime: defaultRuntime(),
    cwd: process.cwd(),
    pid: process.pid,
  };
}

/** Collection-local log directory: `$XDG_CONFIG_HOME/iskills/.local/logs`. */
export function runLogDirectory(): string {
  return join(collectionPaths().local, 'logs');
}

/** One CLI process session. Tests may construct this with an explicit directory. */
export class RunLog {
  readonly meta: RunLogMeta;
  private readonly directory: string;
  private readonly maxFiles: number;
  private readonly now: () => Date;
  private readonly started: Date;
  private readonly events: RunLogEvent[] = [];
  private fileName: string | undefined;

  constructor(meta: RunLogMeta, options: RunLogOptions = {}) {
    this.meta = { ...meta };
    this.directory = options.directory ?? runLogDirectory();
    this.maxFiles = options.maxFiles ?? RUN_LOG_MAX_FILES;
    this.now = options.now ?? (() => new Date());
    this.started = this.now();
  }

  record(level: RunLogLevel, scope: string, message: string, extra?: RunLogExtra): void {
    this.events.push({
      at: this.now(),
      level,
      scope,
      message,
      ...(extra ? { extra } : {}),
    });
    if (this.events.length > RUN_LOG_MAX_EVENTS) this.events.shift();
  }

  /** Write (or overwrite) this process's debug file. Returns the path, or undefined on I/O failure. */
  async persist(error: unknown): Promise<string | undefined> {
    if (isInterruptError(error)) return undefined;
    this.fileName ??= `${stamp(this.now())}-debug.log`;
    const path = join(this.directory, this.fileName);
    const temporary = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, this.render(error), 'utf8');
      await rename(temporary, path);
      await this.prune(path);
      return path;
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      return undefined;
    }
  }

  private render(error: unknown): string {
    const lines = [
      'iskills debug log',
      `version: ${this.meta.version}`,
      `runtime: ${this.meta.runtime}`,
      `argv: ${this.meta.argv.join(' ')}`,
      `cwd: ${this.meta.cwd ?? process.cwd()}`,
      `pid: ${this.meta.pid ?? process.pid}`,
      `started: ${this.started.toISOString()}`,
      `locale: ${this.meta.locale ?? ''}`,
      '',
      '--- timeline ---',
    ];
    for (const event of this.events) {
      lines.push(
        `${clock(event.at)} ${event.level}  ${event.scope} ${event.message}${formatExtra(event.extra)}`
      );
    }
    lines.push('', '--- error ---');
    if (error instanceof DomainError) {
      lines.push(`code: ${error.code}`);
      const params = Object.entries(error.params)
        .map(([key, value]) => `${key}=${clip(String(value))}`)
        .join(' ');
      if (params) lines.push(`params: ${params}`);
    }
    if (error instanceof Error) {
      lines.push(`name: ${error.name}`);
      lines.push(`message: ${clip(error.message)}`);
      if (error.stack) lines.push(`stack: ${clip(error.stack)}`);
    } else {
      lines.push(`message: ${clip(String(error))}`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  private async prune(keep: string): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.directory);
    } catch {
      return;
    }
    const logs = names
      .filter((name) => DEBUG_LOG_NAME.test(name))
      .map((name) => join(this.directory, name))
      .sort();
    const extra = logs.filter((path) => path !== keep);
    const overflow = extra.length + 1 - this.maxFiles;
    if (overflow <= 0) return;
    await Promise.all(extra.slice(0, overflow).map((path) => rm(path, { force: true })));
  }
}

let session: RunLog | undefined;
let processHooksInstalled = false;

function ensureSession(): RunLog {
  if (!session) {
    session = new RunLog(defaultMeta());
    bindRecorder(session);
  }
  return session;
}

function bindRecorder(log: RunLog): void {
  setRunLogRecorder((level, scope, message, extra) => {
    log.record(level, scope, message, extra);
  });
}

/** Start (or replace) the process session. Call once from CLI `main`. */
export function startRunLog(meta: RunLogMeta, options?: RunLogOptions): RunLog {
  session = new RunLog(meta, options);
  bindRecorder(session);
  return session;
}

/** Persist the current session's failure dump. No-op for interrupt / missing I/O. */
export async function persistFailureLog(error: unknown): Promise<string | undefined> {
  if (isInterruptError(error)) return undefined;
  recordRunLog('error', 'failure', error instanceof DomainError ? error.code : 'error');
  return ensureSession().persist(error);
}

/** Uncaught dump so a rejected TUI action still leaves a file if the UI catch is missed. */
export function installRunLogProcessHooks(): void {
  if (processHooksInstalled) return;
  processHooksInstalled = true;
  const dump = (error: unknown): void => {
    void persistFailureLog(error);
  };
  process.on('uncaughtException', dump);
  process.on('unhandledRejection', dump);
}

/** Test isolation: drop the process session and restore the no-op recorder. */
export function resetRunLogForTests(): void {
  session = undefined;
  setRunLogRecorder(() => undefined);
}
