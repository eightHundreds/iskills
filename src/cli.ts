import { createRequire } from 'node:module';
import {
  commandAdd,
  commandConfig,
  commandCreate,
  commandImport,
  commandInit,
  commandSearch,
  printHelp,
} from './commands/index.js';
import { commandMcp } from './commands/mcp.js';
import { commitCollection, ensureCollection } from './domain/core.js';
import { finalizeResolvedConflicts } from './domain/git.js';
import { DomainError } from './domain/errors.js';
import {
  applyUserConfigLocale,
  formatAppError,
  getLocale,
  installDomainNotify,
  t,
} from './i18n/index.js';
import { InterruptError } from './ui/shell/terminal.js';
import {
  installRunLogProcessHooks,
  persistFailureLog,
  startRunLog,
} from './util/run-log-session.js';

const packageVersion = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;

const PUBLIC_COMMANDS = new Set([
  'search',
  'add',
  'create',
  'import',
  'init',
  'config',
  'mcp',
]);

function isInterrupt(error: unknown): boolean {
  return (
    error instanceof InterruptError ||
    (error instanceof Error && error.name === 'InterruptError')
  );
}

function processRuntime(): string {
  return process.versions.bun
    ? `bun ${process.versions.bun}`
    : `node ${process.version}`;
}

/** Present a process-level failure on stderr and persist the run log (npm-style path). */
export async function printProcessFailure(error: unknown): Promise<void> {
  if (isInterrupt(error)) {
    process.exitCode = 130;
    return;
  }
  console.error(t('cli.errorPrefix', { message: formatAppError(error) }));
  const path = await persistFailureLog(error);
  if (path) console.error(t('cli.logWritten', { path }));
  process.exitCode = 1;
}

async function run(argv: string[]): Promise<void> {
  await applyUserConfigLocale();
  const [command, ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    return printHelp(rest[0]);
  }
  if (rest.includes('--help') || rest.includes('-h')) return printHelp(command);
  if (command === '--version' || command === '-v') {
    console.log(packageVersion);
    return;
  }
  if (command && !PUBLIC_COMMANDS.has(command)) {
    throw new DomainError('cli.unknownCommand', { command });
  }
  if (command === 'search') return commandSearch(rest);
  if (command === 'config') return commandConfig(rest);
  if (command === 'mcp') return commandMcp(rest);

  if (!command && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new DomainError('cli.mainTtyRequired');
  }

  await ensureCollection();
  if (command === 'init') return commandInit(rest);
  await finalizeResolvedConflicts();
  await commitCollection('capture external skill edits');
  // Collection / source health is shown live in the browser footer (⚠), not via stderr cache.

  if (!command) {
    const { runBrowserApp } = await import('./ui/browser/index.js');
    return runBrowserApp('', 'collection');
  }
  if (command === 'add') return commandAdd(rest);
  if (command === 'create') return commandCreate(rest);
  if (command === 'import') return commandImport(rest);
  throw new DomainError('cli.unknownCommand', { command });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  installDomainNotify();
  await applyUserConfigLocale();
  startRunLog({
    argv,
    version: packageVersion,
    runtime: processRuntime(),
    locale: getLocale(),
    cwd: process.cwd(),
    pid: process.pid,
  });
  installRunLogProcessHooks();
  try {
    await run(argv);
  } catch (error) {
    if (isInterrupt(error)) {
      process.exitCode = 130;
      return;
    }
    // Keep DomainError (stable code); bin formats via printProcessFailure.
    throw error;
  } finally {
    // Lazy: tear down without loading OpenTUI when no UI was mounted.
    const { closeTui } = await import('./ui/shell/lifecycle.js');
    closeTui();
  }
}
