import { createRequire } from 'node:module';
import {
  commandAdd,
  commandImport,
  commandInit,
  commandSearch,
  interactiveList,
  printHelp,
} from './commands/index.js';
import { commitCollection, ensureCollection, readState } from './domain/core.js';
import { finalizeResolvedConflicts } from './domain/git.js';
import { closeActivePrompts } from './ui/prompt-lifecycle.js';
import { InterruptError } from './contracts/terminal.js';

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
    return interactiveList('', 'collection');
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
    closeActivePrompts();
  }
}
