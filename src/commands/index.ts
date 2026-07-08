import { parseArgs } from 'node:util';
import { errorMessage, listCollection, readState } from '../core.js';
import {
  configureCollectionRemote,
  initCollectionGit,
  syncCollection,
  updateGitSkill,
} from '../git.js';
import { chooseMany, confirm, input } from '../prompts.js';
import type { CollectedSkill, UpdateStatus } from '../types.js';
import { commandList, interactiveList } from './browser.js';
import { commandAdd, commandImport, commandRemove } from './library.js';
import { commandSearch } from './search.js';

export { commandAdd, commandImport, commandList, commandRemove, commandSearch, interactiveList };

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

export async function commandInit(argv: string[] = []): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { remote: { type: 'string' } },
  });
  const initialized = await initCollectionGit();
  console.log(initialized ? '已初始化收藏夹 Git。' : '收藏夹 Git 已初始化。');
  let remote = values.remote;
  if (!remote && initialized && process.stdin.isTTY && await confirm('是否配置远程仓库？')) {
    remote = await input('远程仓库地址：');
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
  -h, --help         显示帮助
`,
  add: `用法：
  iskills add [技能...] [选项]

从收藏夹添加技能到当前项目或 Agent 全局目录。

选项：
  --agent <名称>     限定 Agent，可重复使用
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
  --agent <名称>     限定 Agent，可重复使用
  --all              导入发现的全部技能
  --replace          替换收藏夹中的同名技能
  -y, --yes          跳过确认
  -h, --help         显示帮助
`,
  list: `用法：
  iskills list [关键词] [选项]

交互浏览当前项目、收藏夹和 Agent 全局技能；JSON 输出项目与收藏夹。

选项：
  --json             以 JSON 格式输出
  --note <文本>      编辑收藏夹技能的备注（需指定技能名）
  --tags <标签>      编辑收藏夹技能的标签，逗号分隔（需指定技能名）
  --source <类型>    绑定来源类型（需指定技能名和 --source-path）
  --ref <引用>       绑定来源引用
  --source-path <路径>  绑定来源路径
  -h, --help         显示帮助
`,
  remove: `用法：
  iskills remove <技能> [选项]

从当前项目或收藏夹移除技能。

选项：
  -g, --global       从收藏夹移除（还回原始位置）
  --from <目录>      限定移除范围
  -y, --yes          跳过确认
  -h, --help         显示帮助
`,
  update: `用法：
  iskills update [技能...] [选项]

更新 Git 来源的技能。

选项：
  --all              更新全部可更新的技能
  -y, --yes          自动接受远端变更
  -h, --help         显示帮助
`,
  sync: `用法：
  iskills sync [选项]

同步收藏夹 Git 仓库。

选项：
  --background       后台异步同步
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
  console.log(`Skill 收藏夹

用法：
  iskills [命令] [选项]

命令：
  search [关键词]    搜索技能并保存到收藏夹
  add [技能...]      从收藏夹添加到当前项目
  import [来源]      导入本地路径或 Git 来源
  list [关键词]      浏览当前项目、收藏夹和全局技能
  remove <技能>      从当前项目或收藏夹移除
  update [技能...]   更新 Git 来源技能
  init               初始化收藏夹 Git
  sync               同步收藏夹 Git

选项：
  -h, --help         显示帮助（可用 iskills help <命令>）
  -v, --version      显示版本

不带命令时打开交互式浏览界面。
`);
}
