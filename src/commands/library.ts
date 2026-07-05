import { cp, lstat, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AGENTS,
  PROJECT_SKILL_DIRS,
  assertRelativePath,
  assertSkillName,
  baselinePath,
  collectionPaths,
  commitCollection,
  discoverSkills,
  exists,
  isExactSymlink,
  isGitSource,
  listCollection,
  matches,
  moveDirectory,
  pathPresent,
  provenanceFromKnownLocks,
  readState,
  removeFromCollection,
  validateSkillTree,
  writeMetadata,
  writeState,
} from '../core.js';
import { cloneGitSource } from '../git.js';
import {
  chooseMany,
  chooseOne,
  chooseOptionsMany,
  chooseSkillMany,
  confirm,
  input,
} from '../prompts.js';
import type { CollectedSkill, GitImportContext, Skill } from '../types.js';

async function replaceExistingCollection(name: string, allowReplace: boolean): Promise<void> {
  const target = join(collectionPaths().skills, name);
  if (!(await exists(target))) return;
  if (!allowReplace) throw new Error(`收藏夹已存在同名技能：${name}，请确认后使用 --replace`);
  await removeFromCollection(name, true);
}

async function importLocalSkill(skill: Skill, allowReplace: boolean): Promise<boolean> {
  const paths = collectionPaths();
  const selectedPath = resolve(skill.path);
  const selectedStats = await lstat(selectedPath);
  const source = selectedStats.isSymbolicLink() ? await realpath(selectedPath) : selectedPath;
  const target = join(paths.skills, assertSkillName(skill.name));
  if (source === target) return false;

  const provenance = await provenanceFromKnownLocks(skill);
  await validateSkillTree(source);
  await replaceExistingCollection(skill.name, allowReplace);
  await moveDirectory(source, target);
  try {
    await symlink(target, source, 'dir');
  } catch (error) {
    await moveDirectory(target, source);
    throw error;
  }

  await writeMetadata({
    name: skill.name,
    description: skill.description,
    tags: [],
    note: '',
    source: provenance,
  });
  if (provenance.type === 'git' && !provenance.commit) {
    const baseline = baselinePath(skill.name);
    await rm(baseline, { recursive: true, force: true });
    await cp(target, baseline, { recursive: true });
  }
  const state = await readState();
  state.links.push({ skill: skill.name, path: source, kind: 'origin' });
  if (selectedStats.isSymbolicLink()) {
    state.links.push({ skill: skill.name, path: selectedPath, kind: 'dependent' });
  }
  await writeState(state);
  return true;
}

async function importRemoteSkill(
  skill: Skill,
  gitContext: GitImportContext,
  allowReplace: boolean
): Promise<boolean> {
  const paths = collectionPaths();
  const target = join(paths.skills, assertSkillName(skill.name));
  await validateSkillTree(skill.path);
  await replaceExistingCollection(skill.name, allowReplace);
  await cp(skill.path, target, { recursive: true, errorOnExist: true });
  await writeMetadata({
    name: skill.name,
    description: skill.description,
    tags: [],
    note: '',
    source: {
      ...gitContext.source,
      path: assertRelativePath(relative(gitContext.repository, skill.path).split(sep).join('/')),
    },
  });
  return true;
}

interface ImportToCollectionOptions {
  replace?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

export async function importSkillsToCollection(
  skills: Skill[],
  options: ImportToCollectionOptions = {}
): Promise<{ count: number }> {
  if (!skills.length) return { count: 0 };
  let selected = skills;
  let allowReplace = options.replace ?? false;
  const paths = collectionPaths();
  const conflicts: string[] = [];
  for (const skill of selected) {
    if (await exists(join(paths.skills, skill.name))) conflicts.push(skill.name);
  }
  if (conflicts.length && !allowReplace) {
    if (!process.stdin.isTTY || options.yes) {
      throw new Error(`收藏夹已存在：${conflicts.join(', ')}；确认后使用 --replace`);
    }
    allowReplace = await confirm(`替换同名收藏 ${conflicts.join(', ')} 吗？`);
    if (!allowReplace) {
      selected = selected.filter((skill) => !conflicts.includes(skill.name));
    }
  }
  if (!selected.length) return { count: 0 };
  let count = 0;
  for (const skill of selected) {
    if (await importLocalSkill(skill, allowReplace)) count++;
  }
  await commitCollection(`import ${selected.map((skill) => skill.name).join(', ')}`);
  if (!options.quiet) {
    console.log(`已导入 ${count} 个技能。`);
  }
  return { count };
}

async function globalSkillGroups(names: string[] = []): Promise<
  { agent: string; root: string; skills: Skill[] }[]
> {
  const home = homedir();
  const selected = names.length
    ? names.map((name) => {
        const agent = AGENTS[name];
        if (!agent) throw new Error(`未知 Agent：${name}`);
        return { name, agent };
      })
    : Object.entries(AGENTS).map(([name, agent]) => ({ name, agent }));
  const groups: { agent: string; root: string; skills: Skill[] }[] = [];
  for (const { name, agent } of selected) {
    const root = agent.global(home);
    if (!(await exists(root))) continue;
    const skills = (await discoverSkills(root)).sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ agent: name, root, skills });
  }
  return groups.sort((a, b) => a.agent.localeCompare(b.agent));
}

export async function commandImport(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      global: { type: 'boolean', short: 'g' },
      all: { type: 'boolean' },
      agent: { type: 'string', multiple: true },
      replace: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  if (values.global && positionals.length) throw new Error('不能同时指定来源和 -g');
  if (positionals.length > 1) throw new Error('一次只能指定一个导入根目录');

  const input = positionals[0];
  const gitContext = input && isGitSource(input) ? await cloneGitSource(input) : undefined;
  try {
    const paths = collectionPaths();
    const isCollected = (skill: Skill) =>
      skill.path !== join(paths.skills, skill.name) &&
      !skill.path.startsWith(`${paths.root}${sep}`);

    let skills: Skill[];
    let globalGroups: { agent: string; skills: Skill[] }[] | undefined;
    if (gitContext) {
      skills = (await discoverSkills(gitContext.repository)).filter(isCollected);
    } else if (values.global) {
      const groups = await globalSkillGroups(values.agent);
      globalGroups = groups
        .map((group) => ({ agent: group.agent, skills: group.skills.filter(isCollected) }))
        .filter((group) => group.skills.length > 0);
      skills = globalGroups.flatMap((group) => group.skills);
    } else {
      skills = (await discoverSkills(resolve(input || '.'))).filter(isCollected);
    }
    if (!skills.length) throw new Error('没有找到 SKILL.md');

    let selected = skills;
    if (!values.all && skills.length > 1) {
      if (!process.stdin.isTTY) throw new Error('找到多个技能，请使用 --all 或交互选择');
      selected = await chooseSkillMany(
        globalGroups ?? [{ agent: gitContext ? 'Git' : '本地', skills }],
        globalGroups ? '扫描全局 Skill 目录' : '发现以下技能'
      );
    }
    if (!selected.length) return;

    if (!values.yes) {
      if (!process.stdin.isTTY) throw new Error('请使用 --yes 确认导入');
      console.log(
        gitContext
          ? '\n即将把以下 Git 来源技能加入收藏夹：'
          : '\n即将把技能移入收藏夹，并在原位置创建软链：'
      );
      selected.forEach((skill) => console.log(`- ${skill.name}: ${skill.path}`));
      if (!(await confirm('继续吗？'))) return;
    }

    let allowReplace = values.replace ?? false;
    if (!gitContext) {
      await importSkillsToCollection(selected, {
        replace: allowReplace,
        yes: values.yes ?? false,
      });
      return;
    }
    const conflicts: string[] = [];
    for (const skill of selected) {
      if (await exists(join(paths.skills, skill.name))) conflicts.push(skill.name);
    }
    if (conflicts.length && !allowReplace) {
      if (!process.stdin.isTTY) {
        throw new Error(`收藏夹已存在：${conflicts.join(', ')}；确认后使用 --replace`);
      }
      allowReplace = await confirm(`替换同名收藏 ${conflicts.join(', ')} 吗？`);
      if (!allowReplace) selected = selected.filter((skill) => !conflicts.includes(skill.name));
    }
    let count = 0;
    for (const skill of selected) {
      if (await importRemoteSkill(skill, gitContext, allowReplace)) count++;
    }
    await commitCollection(`import ${selected.map((skill) => skill.name).join(', ')}`);
    console.log(`已导入 ${count} 个技能。`);
  } finally {
    if (gitContext) await rm(gitContext.temporary, { recursive: true, force: true });
  }
}

interface AddValues {
  agent?: string[];
  global?: boolean;
  to?: string;
  copy?: boolean;
  replace?: boolean;
  yes?: boolean;
  quiet?: boolean;
}

async function resolveTargets(values: AddValues): Promise<string[]> {
  if (values.to) return [resolve(values.to)];
  const requestedAgents = values.agent || [];
  if (values.global) {
    let names = requestedAgents;
    if (!names.length) {
      if (!process.stdin.isTTY) throw new Error('添加到全局目录时请指定 --agent');
      names = await chooseOptionsMany(
        Object.keys(AGENTS).map((name) => ({ label: name, value: name })),
        '选择全局 Agent 目录：'
      );
    }
    return [
      ...new Set(
        names.map((name) => {
          const agent = AGENTS[name];
          if (!agent) throw new Error(`未知 Agent：${name}`);
          return agent.global(homedir());
        })
      ),
    ];
  }
  if (requestedAgents.length) {
    return [
      ...new Set(
        requestedAgents.map((name) => {
          const agent = AGENTS[name];
          if (!agent) throw new Error(`未知 Agent：${name}`);
          return resolve(agent.project);
        })
      ),
    ];
  }

  const detected: string[] = [];
  for (const directory of PROJECT_SKILL_DIRS) {
    if (await exists(resolve(directory))) detected.push(resolve(directory));
  }
  const unique = [...new Set(detected)];
  if (unique.length <= 1) return unique.length ? unique : [resolve('.agents/skills')];
  if (!process.stdin.isTTY) return [resolve('.agents/skills')];
  return chooseOptionsMany(
    unique.map((path) => ({ label: relative(process.cwd(), path), value: path })),
    '检测到多个 Agent 目录：'
  );
}

async function selectCollectionSkills(names: string[]): Promise<CollectedSkill[]> {
  const skills = await listCollection();
  if (names.length) {
    const selected = names.flatMap((name) => {
      const skill = skills.find((item) => item.name === name);
      return skill ? [skill] : [];
    });
    const found = new Set(selected.map((skill) => skill.name));
    const missing = names.filter((name) => !found.has(name));
    if (missing.length) throw new Error(`收藏夹中不存在：${missing.join(', ')}`);
    return selected;
  }
  if (!process.stdin.isTTY) throw new Error('请指定技能名称');
  if (!skills.length) {
    let source: string | undefined;
    source = await chooseOne(
      [
        { label: '扫描当前目录', value: 'current' },
        { label: '扫描常见全局 Agent 目录', value: 'global' },
        { label: '输入本地路径或 Git 来源', value: 'custom' },
      ],
      '收藏夹还是空的，先从哪里导入技能？'
    );
    if (source === 'custom') source = await input('路径或 Git 来源：');
    if (!source) return [];
    await commandImport(source === 'global' ? ['-g'] : source === 'current' ? [] : [source]);
    return listCollection();
  }
  const query = await input('搜索收藏夹：');
  if (query === undefined) return [];
  return chooseMany(
    skills.filter((skill) => matches(skill, query)),
    '选择技能：'
  );
}

export async function addSkillsToProject(
  skills: CollectedSkill[],
  values: AddValues = {}
): Promise<{ count: number; targetCount: number }> {
  if (!skills.length) return { count: 0, targetCount: 0 };
  const targetRoots = await resolveTargets(values);
  if (!targetRoots.length) return { count: 0, targetCount: 0 };
  await Promise.all(targetRoots.map((targetRoot) => mkdir(targetRoot, { recursive: true })));
  const state = await readState();

  for (const targetRoot of targetRoots) {
    for (const skill of skills) {
      const target = join(targetRoot, skill.name);
      if (target === resolve(skill.path) || target.startsWith(`${resolve(skill.path)}${sep}`)) {
        throw new Error(`目标会指向技能自身：${target}`);
      }
      if (await pathPresent(target)) {
        if (await isExactSymlink(target, skill.path)) continue;
        let replace = values.replace ?? false;
        if (!replace && process.stdin.isTTY && !values.yes) {
          replace = await confirm(`目标已存在，替换 ${target} 吗？`);
        }
        if (!replace) throw new Error(`目标已存在：${target}，请确认后使用 --replace`);
        await rm(target, { recursive: true });
      }
      if (values.copy) {
        await cp(skill.path, target, { recursive: true, errorOnExist: true });
      } else {
        await symlink(skill.path, target, 'dir');
        state.links.push({ skill: skill.name, path: target, kind: 'usage' });
      }
    }
  }
  await writeState(state);
  if (!values.quiet) {
    console.log(
      `已添加 ${skills.length} 个技能到 ${targetRoots.length} 个目录${values.copy ? '（复制）' : ''}。`
    );
  }
  return { count: skills.length, targetCount: targetRoots.length };
}

export async function commandAdd(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: 'string', multiple: true },
      global: { type: 'boolean', short: 'g' },
      to: { type: 'string' },
      copy: { type: 'boolean' },
      replace: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  const skills = await selectCollectionSkills(positionals);
  if (!skills.length) return;
  const options: AddValues = {};
  if (values.agent) options.agent = values.agent;
  if (values.global !== undefined) options.global = values.global;
  if (values.to) options.to = values.to;
  if (values.copy !== undefined) options.copy = values.copy;
  if (values.replace !== undefined) options.replace = values.replace;
  if (values.yes !== undefined) options.yes = values.yes;
  await addSkillsToProject(skills, options);
}

async function removeUsage(name: string, from?: string): Promise<void> {
  const state = await readState();
  const collectionTarget = join(collectionPaths().skills, assertSkillName(name));
  const scope = resolve(from || process.cwd());
  const candidates = state.links.filter(
    (link) =>
      link.skill === name &&
      link.kind !== 'origin' &&
      (resolve(link.path) === scope || resolve(link.path).startsWith(`${scope}${sep}`))
  );
  if (!candidates.length) throw new Error(`当前范围没有使用技能：${name}`);
  for (const link of candidates) {
    if (!(await isExactSymlink(link.path, collectionTarget))) {
      throw new Error(`使用位置已不是预期软链，未删除：${link.path}`);
    }
  }
  for (const link of candidates) await rm(link.path);
  const removed = new Set(candidates.map((link) => resolve(link.path)));
  state.links = state.links.filter((link) => !removed.has(resolve(link.path)));
  await writeState(state);
  console.log(`已从 ${candidates.length} 个位置移除 ${name}，收藏夹内容保留。`);
}

async function selectOneCollectionSkill(name?: string): Promise<string | undefined> {
  if (name) return name;
  if (!process.stdin.isTTY) throw new Error('请指定技能名称');
  const skills = await listCollection();
  return chooseOne(
    skills.map((skill) => ({ label: skill.name, value: skill.name })),
    '选择技能：'
  );
}

export async function commandRemove(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      global: { type: 'boolean', short: 'g' },
      from: { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  if (positionals.length > 1) throw new Error('一次只能移除一个技能');
  const name = await selectOneCollectionSkill(positionals[0]);
  if (!name) return;

  if (values.global) {
    if (!values.yes) {
      if (!process.stdin.isTTY) throw new Error('从收藏夹移除需要使用 --yes 确认');
      const state = await readState();
      const links = state.links.filter((link) => link.skill === name);
      console.log('该技能关联以下位置：');
      links.forEach((link) => {
        const kind = link.kind === 'origin' ? '原始' : link.kind === 'usage' ? '使用' : '依赖';
        console.log(`- ${link.path}（${kind}）`);
      });
      if (!(await confirm('从收藏夹移除吗？'))) return;
    }
    await removeFromCollection(name, true);
  } else {
    await removeUsage(name, values.from);
  }
}
