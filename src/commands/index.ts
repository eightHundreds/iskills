import { parseArgs } from 'node:util';
import {
  configureCollectionRemote,
  initCollectionGit,
} from '../domain/git.js';
import type { BrowserTab } from '../contracts/browser.js';

export async function commandAdd(argv: string[]): Promise<void> {
  return (await import('./library.js')).commandAdd(argv);
}

export async function commandImport(argv: string[]): Promise<void> {
  return (await import('./library.js')).commandImport(argv);
}

export async function commandSearch(argv: string[]): Promise<void> {
  return (await import('./search.js')).commandSearch(argv);
}

export async function interactiveList(
  initialQuery = '',
  initialTab: BrowserTab = 'project'
): Promise<void> {
  return (await import('./browser.js')).interactiveList(initialQuery, initialTab);
}

export async function commandInit(argv: string[] = []): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { remote: { type: 'string' } },
  });
  const initialized = await initCollectionGit();
  console.log(initialized ? '已初始化收藏夹 Git。' : '收藏夹 Git 已初始化。');
  let remote = values.remote;
  if (!remote && initialized && process.stdin.isTTY) {
    const { confirm, input } = await import('../ui/prompts.js');
    if (await confirm('是否配置远程仓库？')) remote = await input('远程仓库地址：');
  }
  if (remote) {
    await configureCollectionRemote(remote);
    console.log('已配置远程仓库 origin。');
  }
}

const COMMAND_HELP: Record<string, string> = {
  search: `用法：
  iskills search [关键词]

实时搜索 skills.sh，选择后保存到收藏夹。

选项：
  --replace          替换异源同名收藏
  -h, --help         显示帮助
`,
  add: `用法：
  iskills add [技能...] [选项]

从收藏夹添加技能到当前项目或 Agent 全局目录。

选项：
  --agent <名称>     限定 Agent，可重复使用（agents、codex、claude、cursor、opencode、pi）
  -g, --global       添加到 Agent 全局 Skill 目录
  --to <目录>        指定目标目录
  --copy             复制而非创建软链
  --replace          替换已存在的技能
  -y, --yes          跳过确认
  -h, --help         显示帮助
`,
  import: `用法：
  iskills import [路径或 Git URL] [选项]

导入本地路径或 Git 来源到收藏夹。

选项：
  -g, --global       扫描 Agent 全局 Skill 目录
  --agent <名称>     限定 Agent，可重复使用（agents、codex、claude、cursor、opencode、pi）
  --all              导入发现的全部技能
  --replace          替换收藏夹中的同名技能
  -y, --yes          跳过确认
  -h, --help         显示帮助
`,
  init: `用法：
  iskills init [选项]

初始化收藏夹 Git 仓库并创建首次提交。

选项：
  --remote <Git URL>  配置或更新 origin
  -h, --help         显示帮助
`,
};

export function printHelp(command?: string): void {
  const help = command ? COMMAND_HELP[command] : undefined;
  if (help) {
    console.log(help);
    return;
  }
  if (command) throw new Error(`未知命令：${command}`);
  console.log(`Skill 收藏夹

用法：
  iskills [命令] [选项]

命令：
  search [关键词]    搜索技能并保存到收藏夹
  add [技能...]      从收藏夹添加到当前项目
  import [来源]      导入本地路径或 Git 来源
  init               初始化收藏夹 Git

选项：
  -h, --help         显示帮助（可用 iskills help <命令>）
  -v, --version      显示版本

`);
}
