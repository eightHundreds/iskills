import { createRequire } from 'node:module';
import {
  commandAdd,
  commandImport,
  commandInit,
  commandSearch,
  printHelp,
} from './commands/index.js';
import { commitCollection, ensureCollection, readState } from './domain/core.js';
import { finalizeResolvedConflicts } from './domain/git.js';
import { InterruptError } from './ui/terminal.js';

const packageVersion = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;

const PUBLIC_COMMANDS = new Set(['search', 'add', 'import', 'init']);

async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    return printHelp(rest[0]);
  }
  if (rest.includes('--help') || rest.includes('-h')) return printHelp(command);
  if (command === '--version' || command === '-v') {
    console.log(packageVersion);
    return;
  }
  if (command && !PUBLIC_COMMANDS.has(command)) throw new Error(`未知命令：${command}`);
  if (command === 'search') return commandSearch(rest);

  if (!command && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('主 TUI 需要 stdin 和 stdout TTY；当前终端不支持。');
  }

  await ensureCollection();
  if (command === 'init') return commandInit(rest);
  await finalizeResolvedConflicts();
  await commitCollection('capture external skill edits');
  const pending = (await readState()).conflicts;
  if (pending.length) console.error(`警告：存在 ${pending.length} 个待处理冲突。`);

  if (!command) {
    const { runBrowserApp } = await import('./ui/browser/index.js');
    return runBrowserApp('', 'collection');
  }
  if (command === 'add') return commandAdd(rest);
  if (command === 'import') return commandImport(rest);
  throw new Error(`未知命令：${command}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    await run(argv);
  } catch (error) {
    if (
      error instanceof InterruptError ||
      (error instanceof Error && error.name === 'InterruptError')
    ) {
      process.exitCode = 130;
      return;
    }
    throw error;
  } finally {
    // Lazy: avoid static import of Ink UI on every CLI entry; only load to tear down.
    const { closeInk } = await import('./ui/run.js');
    closeInk();
  }
}
