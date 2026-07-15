import { createRequire } from 'node:module';
import {
  commandAdd,
  commandImport,
  commandInit,
  commandList,
  commandRemove,
  commandSearch,
  commandSync,
  commandUpdate,
  interactiveList,
  printHelp,
} from './commands/index.js';
import { commitCollection, ensureCollection, readState } from './core.js';
import { finalizeResolvedConflicts } from './git.js';
import { closePrompts } from './prompts.js';
import { InterruptError } from './ui/session.js';

const packageVersion = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;

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
  if (command === 'search') return commandSearch(rest);

  await ensureCollection();
  if (command === 'init') return commandInit(rest);
  await finalizeResolvedConflicts();
  await commitCollection('capture external skill edits');
  const pending = (await readState()).conflicts;
  if (pending.length) console.error(`警告：存在 ${pending.length} 个待处理冲突。`);

  if (!command) {
    if (!process.stdin.isTTY) return printHelp();
    return interactiveList('', 'collection');
  }
  if (command === 'add') return commandAdd(rest);
  if (command === 'import') return commandImport(rest);
  if (command === 'list') return commandList(rest);
  if (command === 'remove') return commandRemove(rest);
  if (command === 'sync') return commandSync(rest);
  if (command === 'update') return commandUpdate(rest);
  throw new Error(`未知命令：${command}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    await run(argv);
  } catch (error) {
    if (error instanceof InterruptError) {
      process.exitCode = error.exitCode;
      return;
    }
    throw error;
  } finally {
    closePrompts();
  }
}
