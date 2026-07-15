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
  readState,
  removeFromCollection,
  sameGitIdentity,
  sanitizeTerminal,
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
  reviewImport,
} from '../prompts.js';
import type {
  CollectedSkill,
  CollectionState,
  GitImportContext,
  Skill,
  SkillMetadata,
} from '../types.js';

function gitSkillDisplayPath(skill: Skill, gitContext: GitImportContext): string {
  const sourcePath = assertRelativePath(
    relative(gitContext.repository, skill.path).split(sep).join('/')
  );
  const ref = gitContext.source.ref ? `#${gitContext.source.ref}` : '';
  const status = skill.collectionStatus === 'same-source'
    ? ' · 已收藏自同一来源'
    : skill.collectionStatus === 'same-name'
      ? ' · 已收藏同名技能'
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

interface ReplacementInput {
  name: string;
  staged: string;
  metadata: SkillMetadata;
  local?: { source: string; selectedPath: string; selectedWasSymlink: boolean };
}

async function replaceCollectionSkill(input: ReplacementInput): Promise<void> {
  const paths = collectionPaths();
  const target = join(paths.skills, input.name);
  const metadata = metadataPath(input.name);
  const baseline = baselinePath(input.name);
  const transaction = await mkdtemp(join(paths.local, `.replace-${input.name}-`));
  const oldTree = join(transaction, 'old-tree');
  const oldMetadata = join(transaction, 'old-metadata.json');
  const oldBaseline = join(transaction, 'old-baseline');
  const newSource = join(transaction, 'new-source');
  const state = await readState();
  const links = state.links.filter((link) => link.skill === input.name);
  const origin = links.find((link) => link.kind === 'origin');
  const hadMetadata = await pathPresent(metadata);
  const hadBaseline = await pathPresent(baseline);
  let sourceMoved = false;

  if (origin && !(await isExactSymlink(origin.path, target))) {
    await rm(transaction, { recursive: true, force: true });
    throw new Error(`原始位置已不是指向收藏夹的软链，已中止：${origin.path}`);
  }

  try {
    await cp(target, oldTree, { recursive: true, errorOnExist: true });
    if (hadMetadata) await cp(metadata, oldMetadata, { errorOnExist: true });
    if (hadBaseline) await cp(baseline, oldBaseline, { recursive: true, errorOnExist: true });
  } catch (error) {
    await rm(transaction, { recursive: true, force: true });
    throw error;
  }

  try {
    if (input.local) {
      await moveDirectory(input.local.source, newSource);
      sourceMoved = true;
    }
    if (origin) {
      await rm(origin.path);
      await cp(oldTree, origin.path, { recursive: true, errorOnExist: true });
    }

    await rm(target, { recursive: true, force: true });
    await moveDirectory(input.staged, target);
    if (input.local) await symlink(target, input.local.source, 'dir');
    await writeMetadata(input.metadata);
    await rm(baseline, { recursive: true, force: true });
    if (input.metadata.source.type === 'git' && !input.metadata.source.commit) {
      await cp(target, baseline, { recursive: true });
    }
    const nextState: CollectionState = {
      links: state.links.filter((link) => link.skill !== input.name || link.kind === 'usage'),
      conflicts: state.conflicts.filter(
        (conflict) => conflict.type !== 'source' || conflict.skill !== input.name
      ),
    };
    if (input.local) {
      nextState.links.push({ skill: input.name, path: input.local.source, kind: 'origin' });
      if (input.local.selectedWasSymlink) {
        nextState.links.push({
          skill: input.name,
          path: input.local.selectedPath,
          kind: 'dependent',
        });
      }
    }
    await writeState(nextState);
    await commitCollection(`import ${input.name}`, true);
  } catch (error) {
    try {
      if (input.local && sourceMoved) {
        await rm(input.local.source, { recursive: true, force: true });
        await moveDirectory(newSource, input.local.source);
      }
      await rm(target, { recursive: true, force: true });
      await cp(oldTree, target, { recursive: true, errorOnExist: true });
      if (hadMetadata) await cp(oldMetadata, metadata, { force: true });
      else await rm(metadata, { force: true });
      await rm(baseline, { recursive: true, force: true });
      if (hadBaseline) await cp(oldBaseline, baseline, { recursive: true });
      await writeState(state);
      if (origin) {
        await rm(origin.path, { recursive: true, force: true });
        await mkdir(resolve(origin.path, '..'), { recursive: true });
        await symlink(target, origin.path, 'dir');
      }
      await commitCollection(`rollback import ${input.name}`);
    } catch (rollbackError) {
      throw new Error(
        `导入失败：${errorMessage(error)}；回滚失败：${errorMessage(rollbackError)}`
      );
    }
    await rm(transaction, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  for (const conflict of state.conflicts) {
    if (conflict.type === 'source' && conflict.skill === input.name) {
      await rm(conflict.path, { recursive: true, force: true }).catch((error) => {
        console.error(`警告：旧冲突目录清理失败：${errorMessage(error)}`);
      });
    }
  }
  await rm(transaction, { recursive: true, force: true }).catch((error) => {
    console.error(`警告：替换备份清理失败：${errorMessage(error)}`);
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

  await writeMetadata({
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
  await writeMetadata(metadata);
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
      : await confirm(`替换同名收藏 ${conflicts.join(', ')} 吗？`);
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
      selected = await chooseSkillMany(
        globalGroups ?? [{ agent: gitContext ? 'Git' : '本地', skills }],
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
      const review = await reviewImport(
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
      allowReplace = await confirm(`替换同名收藏 ${conflicts.join(', ')} 吗？`);
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
  const addedSkills = new Set<string>();
  const addedTargets = new Set<string>();

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
            : await confirm(`目标已存在，替换 ${target} 吗？`);
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
        state.links.push({ skill: skill.name, path: target, kind: 'usage' });
      }
      addedSkills.add(skill.name);
      addedTargets.add(targetRoot);
    }
  }
  await writeState(state);
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
