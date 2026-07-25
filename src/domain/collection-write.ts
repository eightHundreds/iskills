import { cp, lstat, mkdir, mkdtemp, readdir, readlink, realpath, rename, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  assertSkillName,
  baselinePath,
  collectionPaths,
  commitCollection,
  copyDirectoryContents,
  errorMessage,
  exists,
  isExactSymlink,
  metadataPath,
  moveDirectory,
  pathPresent,
  readMetadata,
  readSkill,
  readState,
  validateSkillTree,
  writeMetadata,
  writeState,
} from './core.js';
import type { CollectionState, GitSource, Skill, SkillLink, SkillMetadata } from './types.js';

export interface ReplacementInput {
  name: string;
  staged: string;
  metadata: SkillMetadata;
  local?: { source: string; selectedPath: string; selectedWasSymlink: boolean };
}

// Replaces one collected Skill while keeping its tree, metadata, links and baseline coherent.
export async function replaceCollectionSkill(input: ReplacementInput): Promise<void> {
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
    await commitCollection(`import ${input.name}`);
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

export async function registerCollectionLinks(links: SkillLink[]): Promise<void> {
  if (!links.length) return;
  const state = await readState();
  state.links.push(...links);
  await writeState(state);
}

export async function removeCollectionUsage(name: string, from?: string): Promise<number> {
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
  await writeState({
    ...state,
    links: state.links.filter((link) => !removed.has(resolve(link.path))),
  });
  return candidates.length;
}

export async function removeFromCollection(
  name: string,
  confirmed = false,
  quiet = false
): Promise<void> {
  const paths = collectionPaths();
  const skillPath = join(paths.skills, assertSkillName(name));
  if (!(await exists(skillPath))) throw new Error(`收藏夹中不存在：${name}`);
  const state = await readState();
  const links = state.links.filter((link) => link.skill === name);
  const origin = links.find((link) => link.kind === 'origin');

  if (origin && !(await isExactSymlink(origin.path, skillPath))) {
    throw new Error(`原始位置已不是指向收藏夹的软链，已中止：${origin.path}`);
  }
  for (const link of links.filter((item) => item.kind === 'usage')) {
    if (await isExactSymlink(link.path, skillPath)) await rm(link.path);
  }

  if (origin) {
    await rm(origin.path);
    await moveDirectory(skillPath, origin.path);
  } else {
    if (!confirmed) throw new Error('删除收藏需要确认');
    await rm(skillPath, { recursive: true });
  }
  await rm(metadataPath(name), { force: true });
  await rm(baselinePath(name), { recursive: true, force: true });
  for (const conflict of state.conflicts) {
    if (conflict.type === 'source' && conflict.skill === name) {
      await rm(conflict.path, { recursive: true, force: true });
    }
  }
  state.links = state.links.filter((link) => link.skill !== name);
  state.conflicts = state.conflicts.filter(
    (conflict) => conflict.type !== 'source' || conflict.skill !== name
  );
  await writeState(state);
  await commitCollection(`remove ${name}`);
  if (!quiet) {
    console.log(
      origin ? `已从收藏夹移除 ${name}，并还回 ${origin.path}。` : `已从收藏夹移除 ${name}。`
    );
  }
}

async function validateMaterializableSkillTree(
  root: string,
  current = root,
  ancestors = new Set<string>()
): Promise<void> {
  const currentReal = await realpath(current);
  if (ancestors.has(currentReal)) {
    throw new Error(`技能包含循环软链：${current}`);
  }
  const nextAncestors = new Set(ancestors).add(currentReal);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(path);
      } catch {
        throw new Error(`技能包含无法解析的软链：${path}`);
      }
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        throw new Error(`技能包含指向目录外的软链：${path}`);
      }
      if ((await lstat(target)).isDirectory()) {
        await validateMaterializableSkillTree(root, target, nextAncestors);
      }
    } else if (entry.isDirectory()) {
      await validateMaterializableSkillTree(root, path, nextAncestors);
    }
  }
}

async function assertMaterializedTree(current: string): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`副本仍包含软链：${path}`);
    }
    if (entry.isDirectory()) await assertMaterializedTree(path);
  }
}

async function validateSkillLocations(
  skills: Skill[],
  operation: '删除' | '转换'
): Promise<Map<string, Skill>> {
  const collectionRoot = resolve(collectionPaths().root);
  const unique = new Map<string, Skill>();
  for (const skill of skills) unique.set(resolve(skill.path), skill);

  for (const [path, skill] of unique) {
    if (path === collectionRoot || path.startsWith(`${collectionRoot}${sep}`)) {
      throw new Error(`不能通过位置${operation}收藏夹内容：${path}`);
    }
    if (!(await pathPresent(path))) throw new Error(`技能位置已不存在：${path}`);
    let current: Skill;
    try {
      current = await readSkill(path);
    } catch {
      throw new Error(`技能位置已发生变化${operation === '删除' ? '，未删除' : ''}：${path}`);
    }
    if (current.name !== skill.name) {
      throw new Error(`技能位置已发生变化${operation === '删除' ? '，未删除' : ''}：${path}`);
    }
  }
  return unique;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('操作已中断');
  error.name = 'AbortError';
  throw error;
}

export interface MaterializeSkillReferencesOptions {
  signal?: AbortSignal;
  onProgress?: (skill: Skill, current: number, total: number) => void | Promise<void>;
}

interface PreparedMaterialization {
  skill: Skill;
  path: string;
  source: string;
  workspace: string;
  staged: string;
  backup: string;
  replaced: boolean;
}

export async function materializeSkillReferences(
  skills: Skill[],
  options: MaterializeSkillReferencesOptions = {}
): Promise<number> {
  if (!skills.length) return 0;
  const unique = await validateSkillLocations(skills, '转换');
  const preflight: Array<{ skill: Skill; path: string; source: string }> = [];
  for (const [path, skill] of unique) {
    throwIfAborted(options.signal);
    if (!(await lstat(path)).isSymbolicLink()) {
      throw new Error(`技能位置不是引用：${path}`);
    }
    let source: string;
    try {
      source = await realpath(path);
    } catch {
      throw new Error(`技能引用无法解析：${path}`);
    }
    if (!(await lstat(source)).isDirectory()) {
      throw new Error(`技能引用目标不是目录：${path}`);
    }
    await validateMaterializableSkillTree(source);
    preflight.push({ skill, path, source });
  }

  const prepared: PreparedMaterialization[] = [];
  let committed = false;
  try {
    for (const [index, input] of preflight.entries()) {
      throwIfAborted(options.signal);
      await options.onProgress?.(input.skill, index + 1, preflight.length);
      throwIfAborted(options.signal);
      const workspace = await mkdtemp(
        join(dirname(input.path), `.iskills-materialize-${basename(input.path)}-`)
      );
      const staged = join(workspace, 'tree');
      const item: PreparedMaterialization = {
        ...input,
        workspace,
        staged,
        backup: join(workspace, 'reference'),
        replaced: false,
      };
      prepared.push(item);
      await cp(input.source, staged, {
        recursive: true,
        dereference: true,
        errorOnExist: true,
      });
      throwIfAborted(options.signal);
      await assertMaterializedTree(staged);
      const copied = await readSkill(staged);
      if (copied.name !== input.skill.name) {
        throw new Error(`复制结果中的技能名称已发生变化：${input.path}`);
      }
    }

    const state = await readState();
    const convertedPaths = new Set(prepared.map((item) => resolve(item.path)));
    const convertedOrigins = new Set(
      state.links
        .filter(
          (link) => link.kind === 'origin' && convertedPaths.has(resolve(link.path))
        )
        .map((link) => link.skill)
    );
    const nextLinks = state.links.filter(
      (link) =>
        !convertedPaths.has(resolve(link.path)) &&
        !(link.kind === 'dependent' && convertedOrigins.has(link.skill))
    );
    const stateChanged = nextLinks.length !== state.links.length;
    let stateWriteAttempted = false;

    try {
      for (const item of prepared) {
        throwIfAborted(options.signal);
        await rename(item.path, item.backup);
        try {
          await rename(item.staged, item.path);
          item.replaced = true;
        } catch (error) {
          try {
            await rename(item.backup, item.path);
          } catch (rollbackError) {
            throw new Error(
              `转换失败：${errorMessage(error)}；回滚失败：${item.path}: ${errorMessage(rollbackError)}`
            );
          }
          throw error;
        }
      }
      throwIfAborted(options.signal);
      if (stateChanged) {
        stateWriteAttempted = true;
        await writeState({ ...state, links: nextLinks });
      }
      committed = true;
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const item of [...prepared].reverse()) {
        if (!item.replaced) continue;
        try {
          await rm(item.path, { recursive: true, force: true });
          await rename(item.backup, item.path);
          item.replaced = false;
        } catch (rollbackError) {
          rollbackErrors.push(`${item.path}: ${errorMessage(rollbackError)}`);
        }
      }
      if (stateWriteAttempted) {
        try {
          await writeState(state);
        } catch (rollbackError) {
          rollbackErrors.push(`状态：${errorMessage(rollbackError)}`);
        }
      }
      if (rollbackErrors.length) {
        throw new Error(
          `转换失败：${errorMessage(error)}；回滚失败：${rollbackErrors.join('；')}`
        );
      }
      throw error;
    }
  } finally {
    for (const item of prepared) {
      if (committed || !(await pathPresent(item.backup))) {
        await rm(item.workspace, { recursive: true, force: true }).catch((error) => {
          console.error(`警告：转换临时目录清理失败：${errorMessage(error)}`);
        });
      }
    }
  }
  return prepared.length;
}

export async function removeSkillLocations(skills: Skill[]): Promise<number> {
  const paths = collectionPaths();
  const unique = await validateSkillLocations(skills, '删除');

  for (const [path, skill] of unique) {
    if (skill.fromCollection) {
      const target = join(paths.skills, assertSkillName(skill.name));
      if (!(await isExactSymlink(path, target))) {
        throw new Error(`收藏夹链接已发生变化，未删除：${path}`);
      }
    }
  }

  for (const path of unique.keys()) await rm(path, { recursive: true });

  const removed = new Set(unique.keys());
  const state = await readState();
  state.links = state.links.filter((link) => !removed.has(resolve(link.path)));
  await writeState(state);
  return unique.size;
}

export async function installMergedCollectionSkill(
  name: string,
  workspace: string,
  source: GitSource
): Promise<void> {
  const paths = collectionPaths();
  const target = join(paths.skills, assertSkillName(name));
  const staged = join(paths.skills, `.${name}.update-${process.pid}`);
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true });
  await validateSkillTree(workspace);
  await copyDirectoryContents(workspace, staged);
  if (!(await exists(join(staged, 'SKILL.md')))) {
    await rm(staged, { recursive: true, force: true });
    throw new Error(`合并结果不是有效技能：${name}`);
  }
  await rm(target, { recursive: true });
  await rename(staged, target);
  const metadata = await readMetadata(name);
  metadata.description = (await readSkill(target)).description;
  metadata.source = source;
  await writeMetadata(metadata);
}
