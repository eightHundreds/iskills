import {
  commandAdd,
  commandImport,
  commandList,
  commandRemove,
  commandSync,
  commandUpdate,
  mainMenu,
  printHelp,
} from './commands/index.js';
import { commitCollection, ensureCollection, readState } from './core.js';
import { finalizeResolvedConflicts } from './git.js';
import { closePrompts } from './prompts.js';

async function run(argv: string[]): Promise<void> {
  await ensureCollection();
  await finalizeResolvedConflicts();
  await commitCollection('capture external skill edits');
  const pending = (await readState()).conflicts;
  if (pending.length) console.error(`警告：存在 ${pending.length} 个待处理冲突。`);

  const [command, ...rest] = argv;
  if (!command) return mainMenu();
  if (command === 'add') return commandAdd(rest);
  if (command === 'import') return commandImport(rest);
  if (command === 'list') return commandList(rest);
  if (command === 'remove') return commandRemove(rest);
  if (command === 'sync') return commandSync(rest);
  if (command === 'update') return commandUpdate(rest);
  if (command === 'help' || command === '--help' || command === '-h') return printHelp();
  if (command === '--version' || command === '-v') {
    console.log('0.0.0');
    return;
  }
  throw new Error(`未知命令：${command}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    await run(argv);
  } finally {
    closePrompts();
  }
}
