import { parseArgs } from 'node:util';
import { errorMessage, listCollection, readState } from '../core.js';
import { syncCollection, updateGitSkill } from '../git.js';
import { chooseMany, chooseOne } from '../prompts.js';
import type { CollectedSkill, UpdateStatus } from '../types.js';
import { commandList, interactiveList } from './browser.js';
import { commandAdd, commandImport, commandRemove } from './library.js';

export { commandAdd, commandImport, commandList, commandRemove, interactiveList };

export async function commandUpdate(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  const updateable = (await listCollection()).filter((skill) => skill.source.type === 'git');
  let selected: CollectedSkill[];
  if (positionals.length) {
    selected = positionals.flatMap((name) => {
      const skill = updateable.find((item) => item.name === name);
      return skill ? [skill] : [];
    });
    const found = new Set(selected.map((skill) => skill.name));
    const missing = positionals.filter((name) => !found.has(name));
    if (missing.length) throw new Error(`没有可更新的来源：${missing.join(', ')}`);
  } else if (values.all) {
    selected = updateable;
  } else if (process.stdin.isTTY) {
    selected = await chooseMany(updateable, '选择要更新的技能：');
  } else {
    throw new Error('请指定技能名称或使用 --all');
  }

  const results: Array<{ name: string; status: UpdateStatus | 'error'; error?: string }> = [];
  for (const skill of selected) {
    try {
      results.push({ name: skill.name, status: await updateGitSkill(skill, values.yes ?? false) });
    } catch (error) {
      results.push({ name: skill.name, status: 'error', error: errorMessage(error) });
    }
  }
  for (const result of results) {
    console.log(`${result.name}: ${result.status}${result.error ? ` — ${result.error}` : ''}`);
    if (result.status === 'conflict') {
      const conflict = (await readState()).conflicts.find(
        (item) => item.type === 'source' && item.skill === result.name
      );
      if (conflict?.type === 'source') {
        console.log(`  请在 ${conflict.path} 中手动解决并提交 Git 合并。`);
      }
    }
  }
  if (results.some((result) => result.status === 'error')) process.exitCode = 1;
}

export async function commandSync(argv: string[] = []): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { background: { type: 'boolean' } },
  });
  await syncCollection(values.background ?? false);
}

export async function mainMenu(): Promise<void> {
  if (!process.stdin.isTTY) {
    printHelp();
    return;
  }
  const action = await chooseOne(
    [
      { label: '从收藏夹添加到当前目录', value: 'add' },
      { label: '导入当前目录中的技能', value: 'import' },
      { label: '扫描全局 Skill 目录', value: 'import-global' },
      { label: '浏览收藏夹', value: 'list' },
      { label: '更新远程来源技能', value: 'update' },
    ],
    '你想做什么？',
    true
  );
  if (action === 'add') return commandAdd([]);
  if (action === 'import') return commandImport([]);
  if (action === 'import-global') return commandImport(['-g']);
  if (action === 'list') return interactiveList();
  if (action === 'update') return commandUpdate([]);
}

export function printHelp(): void {
  console.log(`Skill 收藏夹

用法：
  iskills                 打开主界面
  iskills add [技能...]    从收藏夹添加到当前项目（--copy 复制，-g 添加到 Agent 全局目录）
  iskills import [来源]    导入本地路径或 Git 来源
  iskills import -g        扫描全局 Skill 目录
  iskills list [关键词]    浏览当前项目和收藏夹
  iskills remove <技能>    从当前项目移除
  iskills remove <技能> -g 从收藏夹移除
  iskills update           更新远程来源技能
  iskills sync             同步收藏夹 Git
`);
}
