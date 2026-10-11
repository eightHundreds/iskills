import { spawn } from 'node:child_process';
import { OperationFailure } from './operation.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const processSignals = new AsyncLocalStorage<AbortSignal>();

export function withProcessSignal<T>(
  signal: AbortSignal,
  execute: () => Promise<T>,
): Promise<T> {
  return processSignals.run(signal, execute);
}

/** Captured, non-interactive Git process including credential-helper time. */
export async function runGit(
  args: string[],
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<string> {
  signal ??= processSignals.getStore();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new OperationFailure(
          'execution.interrupted',
          'The operation was interrupted.',
          {},
          130,
          'inspect-state',
        ),
      );
      return;
    }
    const child = spawn('git', args, {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_PAGER: 'cat',
      },
    });
    const stdout: Buffer[] = [];
    let size = 0;
    let failure: string | number | undefined;
    const kill = (): void => {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const abort = (): void => {
      failure = 'interrupted';
      kill();
    };
    const timer = setTimeout(() => {
      failure = 'timeout';
      kill();
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        failure = 'output-limit';
        kill();
      } else stdout.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.on('error', (error: NodeJS.ErrnoException) => {
      failure = error.code ?? 'spawn';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure !== undefined || code !== 0)
        reject(
          new OperationFailure(
            failure === 'interrupted'
              ? 'execution.interrupted'
              : 'execution.gitFailed',
            failure === 'interrupted'
              ? 'The operation was interrupted.'
              : 'A Git operation failed.',
            {
              stage: args[0] === '-C' ? args[2] : args[0],
              timeoutMs,
              cause: failure ?? code,
            },
            failure === 'interrupted' ? 130 : 1,
            failure === 'interrupted' ? 'inspect-state' : 'after-fix',
          ),
        );
      else resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
  });
}
