import { cp, lstat, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
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
  ensureCollection,
  errorMessage,
  exists,
  isExactSymlink,
  isGitSource,
  listCollection,
  matches,
  metadataPath,
  moveDirectory,
  pathPresent,
  provenanceFromKnownLocks,
  readMetadata,
  sameGitIdentity,
  sanitizeTerminal,
  validateSkillTree,
} from '../domain/core.js';
import {
  registerCollectionLinks,
  replaceCollectionSkill,
  saveCollectionMetadata,
} from '../domain/collection-write.js';
import { cloneGitSource } from '../domain/git.js';
import type {
  CollectedSkill,
  GitImportContext,
  Skill,
  SkillLink,
  SkillMetadata,
} from '../domain/types.js';

function prompts(): Promise<typeof import('../ui/prompts.js')> {
  return import('../ui/prompts.js');
}

function gitSkillDisplayPath(skill: Skill, gitContext: GitImportContext): string {
  const sourcePath = assertRelativePath(
    relative(gitContext.repository, skill.path).split(sep).join('/')
  );
  const ref = gitContext.source.ref ? `#${gitContext.source.ref}` : '';
  const status = skill.collectionStatus === 'same-source'
    ? ' · 已收藏（同一来源）'
    : skill.collectionStatus === 'same-name'
      ? ' · 同名冲突（来源不同）'
      : '';
  return `${sanitizeTerminal(gitContext.source.url)}${sanitizeTerminal(ref)} · ${sanitizeTerminal(sourcePath)}${status}`;
}

function gitSkillMetadata(
  skill: Skill,
  gitContext: GitImportContext,
  tags: string[] = []
): SkillMetadata {
  return {
    name: skill.name,
    description: skill.description,
    tags,
    note: '',
    source: {
      ...gitContext.source,
      path: assertRelativePath(relative(gitContext.repository, skill.path).split(sep).join('/')),
    },
  };
}

function annotateGitCollectionStatus(
  skills: Skill[],
  gitContext: GitImportContext,
  collection: CollectedSkill[]
): Skill[] {
  return skills.map((skill) => {
    const sameName = collection.find(
      (collected) => collected.name.toLowerCase() === skill.name.toLowerCase()
    );
    if (!sameName) return skill;
    return {
      ...skill,
      collectionStatus: sameGitIdentity(sameName, gitSkillMetadata(skill, gitContext))
        ? 'same-source'
        : 'same-name',
    };
  });
}

async function importLocalSkill(
  skill: Skill,
  allowReplace: boolean,
  tags: string[] = []
): Promise<boolean> {
  const paths = collectionPaths();
  const selectedPath = resolve(skill.path);
  const selectedStats = await lstat(selectedPath);
  const source = selectedStats.isSymbolicLink() ? await realpath(selectedPath) : selectedPath;
  const target = join(paths.skills, assertSkillName(skill.name));
  if (source === target) return false;

  const provenance = await provenanceFromKnownLocks(skill);
  await validateSkillTree(source);
  if (await pathPresent(target)) {
    if (!allowReplace) {
      throw new Error(`收藏夹已存在同名技能：${skill.name}，请确认后使用 --replace`);
    }
    await ensureCollection();
    const transaction = await mkdtemp(join(paths.local, `.prepare-${skill.name}-`));
    const staged = join(transaction, 'tree');
    try {
      await cp(source, staged, { recursive: true, errorOnExist: true });
      await replaceCollectionSkill({
        name: skill.name,
        staged,
        metadata: {
          name: skill.name,
          description: skill.description,
          tags,
          note: '',
          source: provenance,
        },
        local: {
          source,
          selectedPath,
          selectedWasSymlink: selectedStats.isSymbolicLink(),
        },
      });
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
    return true;
  }
  await ensureCollection();
  await moveDirectory(source, target);
  try {
    await symlink(target, source, 'dir');
  } catch (error) {
    await moveDirectory(target, source);
    throw error;
  }

  await saveCollectionMetadata({
    name: skill.name,
    description: skill.description,
    tags,
    note: '',
    source: provenance,
  });
  if (provenance.type === 'git' && !provenance.commit) {
    const baseline = baselinePath(skill.name);
    await rm(baseline, { recursive: true, force: true });
    await cp(target, baseline, { recursive: true });
  }
  const links: SkillLink[] = [{ skill: skill.name, path: source, kind: 'origin' }];
  if (selectedStats.isSymbolicLink()) {
    links.push({ skill: skill.name, path: selectedPath, kind: 'dependent' });
  }
  await registerCollectionLinks(links);
  return true;
}

async function importRemoteSkill(
  skill: Skill,
  gitContext: GitImportContext,
  allowReplace: boolean,
  tags: string[] = []
): Promise<boolean> {
  const paths = collectionPaths();
  const target = join(paths.skills, assertSkillName(skill.name));
  const metadata = gitSkillMetadata(skill, gitContext, tags);
  await validateSkillTree(skill.path);
  if (await pathPresent(target)) {
    const current = await readMetadata(skill.name);
    if (sameGitIdentity(current, metadata)) return false;
    if (!allowReplace) {
      throw new Error(`收藏夹已存在同名技能：${skill.name}，请确认后使用 --replace`);
    }
    await ensureCollection();
    const transaction = await mkdtemp(join(paths.local, `.prepare-${skill.name}-`));
    const staged = join(transaction, 'tree');
    try {
      await cp(skill.path, staged, { recursive: true, errorOnExist: true });
      await replaceCollectionSkill({
        name: skill.name,
        staged,
        metadata,
      });
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
    return true;
  }
  await ensureCollection();
  await cp(skill.path, target, { recursive: true, errorOnExist: true });
  await saveCollectionMetadata(metadata);
  return true;
}

export interface RemoteImportOptions {
  replace?: boolean;
  tags?: string[];
  confirmReplace?: (current: SkillMetadata, incoming: SkillMetadata) => Promise<boolean>;
}

export interface RemoteImportResult {
  name: string;
  status: 'imported' | 'unchanged' | 'cancelled';
}

export async function importRemoteSkillToCollection(
  source: string,
  skillName: string,
  options: RemoteImportOptions = {}
): Promise<RemoteImportResult> {
  const gitContext = await cloneGitSource(source);
  try {
    const found = (await discoverSkills(gitContext.repository)).filter(
      (skill) => skill.name.toLowerCase() === skillName.toLowerCase()
    );
    if (!found.length) throw new Error(`来源仓库中不存在技能：${skillName}`);
    if (found.length > 1) throw new Error(`来源仓库中存在多个同名技能：${skillName}`);
    const skill = found[0]!;
    const incoming = gitSkillMetadata(skill, gitContext);
    const target = join(collectionPaths().skills, skill.name);
    const replacing = await pathPresent(target);
    if (replacing) {
      const current = await readMetadata(skill.name);
      if (sameGitIdentity(current, incoming)) {
        return { name: skill.name, status: 'unchanged' };
      }
      if (!options.replace) {
        if (!options.confirmReplace) {
          throw new Error(`收藏夹已存在异源同名技能：${skill.name}；请使用 --replace`);
        }
        if (!(await options.confirmReplace(current, incoming))) {
          return { name: skill.name, status: 'cancelled' };
        }
      }
    }
    await importRemoteSkill(skill, gitContext, replacing, options.tags ?? []);
    if (!replacing) await commitCollection(`import ${skill.name}`);
    return { name: skill.name, status: 'imported' };
  } finally {
    await rm(gitContext.temporary, { recursive: true, force: true });
  }
}

interface ImportToCollectionOptions {
  replace?: boolean;
  yes?: boolean;
  quiet?: boolean;
  tags?: string[];
  confirmReplace?: (conflicts: string[]) => Promise<boolean>;
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
    allowReplace = options.confirmReplace
      ? await options.confirmReplace(conflicts)
      : await (await prompts()).confirm(`替换同名收藏 ${conflicts.join(', ')} 吗？`);
    if (!allowReplace) {
      selected = selected.filter((skill) => !conflicts.includes(skill.name));
    }
  }
  if (!selected.length) return { count: 0 };
  let count = 0;
  for (const skill of selected) {
    if (await importLocalSkill(skill, allowReplace, options.tags ?? [])) count++;
  }
  await commitCollection(`import ${selected.map((skill) => skill.name).join(', ')}`);
  if (!options.quiet) {
    console.log(`已导入 ${count} 个技能。`);
  }
  return { count };
}

export async function globalSkillGroups(names: string[] = []): Promise<
  { agent: string; root: string; skills: Skill[] }[]
> {
  const home = homedir();
  const collectedByPath = new Map<string, CollectedSkill>();
  for (const skill of await listCollection()) {
    try {
      collectedByPath.set(await realpath(skill.path), skill);
    } catch {}
  }
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
    const skills = await Promise.all(
      (await discoverSkills(root)).map(async (skill) => {
        try {
          const collected = collectedByPath.get(await realpath(skill.path));
          return collected
            ? { ...collected, path: skill.path, fromCollection: true }
            : { ...skill, fromCollection: false };
        } catch {
          return { ...skill, fromCollection: false };
        }
      })
    );
    skills.sort((a, b) => a.name.localeCompare(b.name));
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
  const localInput = input ? resolve(input) : undefined;
  const gitContext = input && localInput && !(await exists(localInput)) && isGitSource(input)
    ? await cloneGitSource(input)
    : undefined;
  try {
    const paths = collectionPaths();
    const isCollected = (skill: Skill) =>
      skill.path !== join(paths.skills, skill.name) &&
      !skill.path.startsWith(`${paths.root}${sep}`);

    let skills: Skill[];
    let globalGroups: { agent: string; skills: Skill[] }[] | undefined;
    if (gitContext) {
      const collection = await listCollection().catch(() => []);
      skills = annotateGitCollectionStatus(
        (await discoverSkills(gitContext.repository)).filter(isCollected),
        gitContext,
        collection
      );
    } else if (values.global) {
      const groups = await globalSkillGroups(values.agent);
      globalGroups = groups
        .map((group) => ({
          agent: group.agent,
          skills: group.skills.filter((skill) => !skill.fromCollection && isCollected(skill)),
        }))
        .filter((group) => group.skills.length > 0);
      skills = globalGroups.flatMap((group) => group.skills);
    } else {
      skills = (await discoverSkills(localInput || resolve('.'))).filter(isCollected);
    }
    if (!skills.length) throw new Error('没有找到 SKILL.md');

    let selected = skills;
    if (!values.all && (skills.length > 1 || !input)) {
      if (!process.stdin.isTTY) throw new Error('请使用 --all 或交互选择要导入的技能');
      const groups = globalGroups ?? [{ agent: gitContext ? 'Git' : '本地', skills }];
      selected = await (await prompts()).chooseSkillMany(
        groups,
        globalGroups
          ? '扫描全局 Skill 目录'
          : !input
            ? '选择当前仓库技能'
            : '发现以下技能'
      );
    }
    if (!selected.length) return;

    let importTags: string[] = [];
    if (!values.yes) {
      if (!process.stdin.isTTY) throw new Error('请使用 --yes 确认导入');
      const existingTags = [...new Set((await listCollection().catch(() => []))
        .flatMap((skill) => skill.tags))]
        .sort((a, b) => a.localeCompare(b));
      const review = await (await prompts()).reviewImport(
        selected.map((skill) => ({
          skill,
          detail: gitContext
            ? gitSkillDisplayPath(skill, gitContext)
            : sanitizeTerminal(skill.path),
        })),
        existingTags
      );
      if (!review) return;
      importTags = review.tags;
    }

    let allowReplace = values.replace ?? false;
    if (!gitContext) {
      await importSkillsToCollection(selected, {
        replace: allowReplace,
        yes: values.yes ?? false,
        tags: importTags,
      });
      return;
    }
    const conflicts: string[] = [];
    for (const skill of selected) {
      if (
        await exists(join(paths.skills, skill.name)) &&
        skill.collectionStatus !== 'same-source'
      ) {
        conflicts.push(skill.name);
      }
    }
    if (conflicts.length && !allowReplace) {
      if (!process.stdin.isTTY) {
        throw new Error(`收藏夹已存在：${conflicts.join(', ')}；确认后使用 --replace`);
      }
      allowReplace = await (await prompts()).confirm(`替换同名收藏 ${conflicts.join(', ')} 吗？`);
      if (!allowReplace) selected = selected.filter((skill) => !conflicts.includes(skill.name));
    }
    let count = 0;
    for (const skill of selected) {
      if (await importRemoteSkill(skill, gitContext, allowReplace, importTags)) count++;
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
  confirmReplace?: (target: string) => Promise<boolean>;
}

async function resolveTargets(values: AddValues): Promise<string[]> {
  if (values.to) return [resolve(values.to)];
  const requestedAgents = values.agent || [];
  if (values.global) {
    let names = requestedAgents;
    if (!names.length) {
      if (!process.stdin.isTTY) throw new Error('添加到全局目录时请指定 --agent');
      names = await (await prompts()).chooseOptionsMany(
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
          if (!agent.project) {
            throw new Error(`Agent ${name} 只支持全局 Skill 目录，请使用 --global`);
          }
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
  return (await prompts()).chooseOptionsMany(
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
    source = await (await prompts()).chooseOne(
      [
        { label: '扫描当前目录', value: 'current' },
        { label: '扫描常见全局 Agent 目录', value: 'global' },
        { label: '输入本地路径或 Git 来源', value: 'custom' },
      ],
      '收藏夹还是空的，先从哪里导入技能？'
    );
    if (source === 'custom') source = await (await prompts()).input('路径或 Git 来源：');
    if (!source) return [];
    await commandImport(source === 'global' ? ['-g'] : source === 'current' ? [] : [source]);
    return listCollection();
  }
  const query = await (await prompts()).input('搜索收藏夹：');
  if (query === undefined) return [];
  return (await prompts()).chooseMany(
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
  const addedSkills = new Set<string>();
  const addedTargets = new Set<string>();
  const usageLinks: Array<{ skill: string; path: string; kind: 'usage' }> = [];

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
          replace = values.confirmReplace
            ? await values.confirmReplace(target)
            : await (await prompts()).confirm(`目标已存在，替换 ${target} 吗？`);
        }
        if (!replace) {
          if (process.stdin.isTTY && !values.yes) continue;
          throw new Error(`目标已存在：${target}，请确认后使用 --replace`);
        }
        await rm(target, { recursive: true });
      }
      if (values.copy) {
        await cp(skill.path, target, { recursive: true, errorOnExist: true });
      } else {
        await symlink(skill.path, target, 'dir');
        usageLinks.push({ skill: skill.name, path: target, kind: 'usage' });
      }
      addedSkills.add(skill.name);
      addedTargets.add(targetRoot);
    }
  }
  await registerCollectionLinks(usageLinks);
  if (!values.quiet) {
    console.log(
      `已添加 ${addedSkills.size} 个技能到 ${addedTargets.size} 个目录${values.copy ? '（复制）' : ''}。`
    );
  }
  return { count: addedSkills.size, targetCount: addedTargets.size };
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
