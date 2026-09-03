import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  assertSkillName,
  baselinePath,
  classifyCollectionMatch,
  collectionPaths,
  commitCollection,
  copyDirectoryContents,
  ensureCollection,
  errorMessage,
  exists,
  isBoundGitSource,
  isExactSymlink,
  metadataPath,
  moveDirectory,
  pathPresent,
  readMetadata,
  readSkill,
  readState,
  resolveIdentityPath,
  validateSkillTree,
  writeMetadata,
  writeState,
} from './core.js';
import type {
  CollectionState,
  GitSource,
  Skill,
  SkillLink,
  SkillMetadata,
  SourceConflict,
} from './types.js';
import { DomainError, domainNotify } from './errors.js';

export interface ReplacementInput {
  name: string;
  staged: string;
  metadata: SkillMetadata;
  local?: { source: string; selectedPath: string; selectedWasSymlink: boolean };
  /** Defaults to `import ${name}`. */
  commitMessage?: string;
  /** When false, skip post-write Git commit (caller owns the commit point). Default true. */
  commit?: boolean;
}

/**
 * `installed` — write done; if `commit` was true, Git commit also succeeded (or no-op).
 * `installed-uncommitted` — write done but post-write Git commit soft-failed (when commit true).
 * `unchanged` — same-source / already at target.
 */
export type InstallCollectionSkillResult =
  | 'installed'
  | 'installed-uncommitted'
  | 'unchanged';

export interface InstallCollectionSkillInput {
  name: string;
  /** Absolute path of the skill tree to install (copied for remote; moved for local). */
  sourceTree: string;
  metadata: SkillMetadata;
  allowReplace: boolean;
  /** Local origin: move into collection and leave a symlink at origin. */
  local?: {
    originPath: string;
    selectedPath: string;
    selectedWasSymlink: boolean;
  };
  /**
   * When false, skip post-write Git commit for both first install and replace.
   * Default true. Batch import should pass false and commit once at the end.
   */
  commit?: boolean;
  commitMessage?: string;
}

/**
 * Single 收藏夹写入 entry for import: first install or replace.
 * Same-source is a no-op. Callers decide allowReplace after confirm.
 */
export async function installCollectionSkill(
  input: InstallCollectionSkillInput
): Promise<InstallCollectionSkillResult> {
  const skillName = assertSkillName(input.name);
  await ensureCollection();
  const paths = collectionPaths();
  const target = join(paths.skills, skillName);
  const commitMessage = input.commitMessage ?? `import ${skillName}`;

  // Canonical name is the install key; never write mismatched metadata files.
  const metadata: SkillMetadata = { ...input.metadata, name: skillName };
  if (input.local && resolve(input.sourceTree) !== resolve(input.local.originPath)) {
    throw new DomainError('domain.unsafeSourcePath', { path: input.sourceTree });
  }

  if (input.local) {
    const originReal = await resolveIdentityPath(input.local.originPath);
    const targetReal = await resolveIdentityPath(target);
    if (originReal === targetReal) return 'unchanged';
  }

  await validateSkillTree(input.sourceTree);

  if (await pathPresent(target)) {
    const current = await readMetadata(skillName);
    if ((await classifyCollectionMatch(current, metadata)) === 'same-source') {
      return 'unchanged';
    }
    if (!input.allowReplace) {
      throw new DomainError('cmd.sameNameExistsReplace', { name: skillName });
    }
    const transaction = await mkdtemp(join(paths.local, `.prepare-${skillName}-`));
    const staged = join(transaction, 'tree');
    try {
      await cp(input.sourceTree, staged, { recursive: true, errorOnExist: true });
      const replacement: ReplacementInput = {
        name: skillName,
        staged,
        metadata,
        commitMessage,
      };
      if (input.local) {
        replacement.local = {
          source: input.local.originPath,
          selectedPath: input.local.selectedPath,
          selectedWasSymlink: input.local.selectedWasSymlink,
        };
      }
      if (input.commit === false) replacement.commit = false;
      const replaceCommit = await replaceCollectionSkill(replacement);
      if (replaceCommit === 'failed') return 'installed-uncommitted';
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
    return 'installed';
  }

  // First-time install: tree + metadata + links (+ baseline); optional commit.
  const stateBefore = await readState();
  let sourceMoved = false;
  let linksRegistered = false;
  try {
    if (input.local) {
      await moveDirectory(input.local.originPath, target);
      sourceMoved = true;
      try {
        await symlink(target, input.local.originPath, 'dir');
      } catch (error) {
        await moveDirectory(target, input.local.originPath);
        sourceMoved = false;
        throw error;
      }
    } else {
      await cp(input.sourceTree, target, { recursive: true, errorOnExist: true });
    }

    await writeMetadata(metadata);
    // Align with replace: always clear stale baseline, then recreate when needed.
    await rm(baselinePath(skillName), { recursive: true, force: true });
    if (metadata.source.type === 'git' && !metadata.source.commit) {
      await cp(target, baselinePath(skillName), { recursive: true });
    }
    if (input.local) {
      const links: SkillLink[] = [
        { skill: skillName, path: input.local.originPath, kind: 'origin' },
      ];
      if (input.local.selectedWasSymlink) {
        links.push({
          skill: skillName,
          path: input.local.selectedPath,
          kind: 'dependent',
        });
      }
      await registerCollectionLinks(links);
      linksRegistered = true;
    }
    if (input.commit !== false) {
      if (!(await commitCollection(commitMessage))) return 'installed-uncommitted';
    }
  } catch (error) {
    try {
      if (linksRegistered) {
        await writeState(stateBefore);
      }
      if (input.local && sourceMoved) {
        await rm(input.local.originPath, { recursive: true, force: true });
        if (await pathPresent(target)) {
          await moveDirectory(target, input.local.originPath);
        }
      } else if (await pathPresent(target)) {
        await rm(target, { recursive: true, force: true });
      }
      await rm(metadataPath(skillName), { force: true });
      await rm(baselinePath(skillName), { recursive: true, force: true });
    } catch (rollbackError) {
      throw new DomainError('domain.importFailedRollback', {
        error: errorMessage(error),
        rollback: errorMessage(rollbackError),
      });
    }
    throw error;
  }
  return 'installed';
}

export type CreateCollectionSkillResult = {
  path: string;
  /** false when post-write Git commit soft-failed (tree already exists). */
  committed: boolean;
};

/** Creates a minimal collected Skill born in the collection (not an import). */
export async function createCollectionSkill(name: string): Promise<CreateCollectionSkillResult> {
  const skillName = assertSkillName(name);
  const paths = await ensureCollection();
  const target = join(paths.skills, skillName);
  if (await pathPresent(target)) {
    throw new DomainError('domain.skillExistsInCollection', { name: skillName });
  }
  const metadata = metadataPath(skillName);
  let created = false;
  try {
    // Exclusive create: skills/ already exists via ensureCollection; never clobber.
    try {
      await mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new DomainError('domain.skillExistsInCollection', { name: skillName });
      }
      throw error;
    }
    created = true;
    await writeFile(
      join(target, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: \n---\n\n# ${skillName}\n\n`,
      'utf8'
    );
    await writeMetadata({
      name: skillName,
      description: '',
      tags: [],
      note: '',
      source: { type: 'unknown' },
    });
  } catch (error) {
    // Only remove what this call created — never rm on pre-existing EEXIST.
    if (created) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      await rm(metadata, { force: true }).catch(() => {});
    }
    throw error;
  }
  const committed = await commitCollection(`create ${skillName}`);
  return { path: target, committed };
}

/**
 * Collected skill trees that have SKILL.md but no metadata file on disk.
 * Skips directory/frontmatter name mismatches (those need interactive repair).
 */
export async function listCollectionSkillsMissingMetadata(): Promise<string[]> {
  const paths = collectionPaths();
  if (!(await exists(paths.skills))) return [];
  const missing: string[] = [];
  for (const entry of await readdir(paths.skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(paths.skills, entry.name);
    if (!(await exists(join(skillDir, 'SKILL.md')))) continue;
    let skill;
    try {
      skill = await readSkill(skillDir);
    } catch {
      continue;
    }
    if (skill.name !== entry.name) continue;
    if (await pathPresent(metadataPath(skill.name))) continue;
    missing.push(skill.name);
  }
  return missing.sort((a, b) => a.localeCompare(b));
}

/**
 * Adopt skill trees already under skills/ by writing create-shaped metadata
 * (`source: unknown`). Does not invent git/local provenance or origin links.
 */
export async function adoptCollectionSkillsMissingMetadata(
  names?: string[]
): Promise<string[]> {
  const candidates = names ?? (await listCollectionSkillsMissingMetadata());
  const adopted: string[] = [];
  const paths = collectionPaths();

  for (const name of candidates) {
    const skillName = assertSkillName(name);
    const skillDir = join(paths.skills, skillName);
    if (!(await exists(join(skillDir, 'SKILL.md')))) continue;
    let skill;
    try {
      skill = await readSkill(skillDir);
    } catch {
      continue;
    }
    if (skill.name !== skillName) continue;
    if (await pathPresent(metadataPath(skillName))) continue;

    await writeMetadata({
      name: skillName,
      description: skill.description,
      tags: [],
      note: '',
      source: { type: 'unknown' },
    });
    adopted.push(skillName);
  }

  if (adopted.length) {
    await commitCollection(`adopt ${adopted.join(', ')}`);
  }
  return adopted;
}

export type ReplaceCommitResult = 'ok' | 'deferred' | 'failed';

/** Drop source-update conflicts for one skill; callers own workspace cleanup. */
export function dropSourceConflicts(
  state: CollectionState,
  name: string
): { state: CollectionState; dropped: SourceConflict[] } {
  const dropped = state.conflicts.filter(
    (conflict): conflict is SourceConflict =>
      conflict.type === 'source' && conflict.skill === name
  );
  if (!dropped.length) return { state, dropped };
  return {
    state: {
      ...state,
      conflicts: state.conflicts.filter(
        (conflict) => conflict.type !== 'source' || conflict.skill !== name
      ),
    },
    dropped,
  };
}

// Replaces one collected Skill while keeping its tree, metadata, links and baseline coherent.
/** @returns deferred when commit:false; failed when commit soft-failed; ok otherwise. */
export async function replaceCollectionSkill(
  input: ReplacementInput
): Promise<ReplaceCommitResult> {
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
    throw new DomainError('domain.originNotCollectionLink', { path: origin.path });
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
    const { state: withoutSourceConflicts, dropped } = dropSourceConflicts(state, input.name);
    const nextState: CollectionState = {
      links: withoutSourceConflicts.links.filter(
        (link) => link.skill !== input.name || link.kind === 'usage'
      ),
      conflicts: withoutSourceConflicts.conflicts,
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
    let commitResult: ReplaceCommitResult = 'deferred';
    if (input.commit !== false) {
      commitResult = (await commitCollection(input.commitMessage ?? `import ${input.name}`))
        ? 'ok'
        : 'failed';
    }
    for (const conflict of dropped) {
      await rm(conflict.path, { recursive: true, force: true }).catch((error) => {
        domainNotify('domain.warnConflictCleanup', { error: errorMessage(error) });
      });
    }
    await rm(transaction, { recursive: true, force: true }).catch((error) => {
      domainNotify('domain.warnReplaceBackupCleanup', { error: errorMessage(error) });
    });
    return commitResult;
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
      throw new DomainError('domain.importFailedRollback', {
        error: errorMessage(error),
        rollback: errorMessage(rollbackError),
      });
    }
    await rm(transaction, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
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
  if (!candidates.length) throw new DomainError('domain.noUsageInScope', { name });
  for (const link of candidates) {
    if (!(await isExactSymlink(link.path, collectionTarget))) {
      throw new DomainError('domain.usageNotExpectedLink', { path: link.path });
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
  if (!(await exists(skillPath))) throw new DomainError('domain.notInCollection', { name });
  const state = await readState();
  const links = state.links.filter((link) => link.skill === name);
  const origin = links.find((link) => link.kind === 'origin');
  const originRestorable = Boolean(origin && (await isExactSymlink(origin.path, skillPath)));

  for (const link of links.filter((item) => item.kind === 'usage')) {
    if (await isExactSymlink(link.path, skillPath)) await rm(link.path);
  }

  if (origin && originRestorable) {
    await rm(origin.path);
    await moveDirectory(skillPath, origin.path);
  } else {
    if (!confirmed) throw new DomainError('domain.removeNeedsConfirm');
    await rm(skillPath, { recursive: true });
  }
  await rm(metadataPath(name), { force: true });
  await rm(baselinePath(name), { recursive: true, force: true });
  const { state: withoutSourceConflicts, dropped } = dropSourceConflicts(state, name);
  for (const conflict of dropped) {
    await rm(conflict.path, { recursive: true, force: true });
  }
  state.links = state.links.filter((link) => link.skill !== name);
  state.conflicts = withoutSourceConflicts.conflicts;
  await writeState(state);
  const commitOk = await commitCollection(`remove ${name}`);
  // Success lines only after a non-failed commit point (domain-invariants 消息真实性).
  if (origin && !originRestorable) {
    domainNotify('domain.warnOriginNotRestored', { path: origin.path });
  }
  if (!quiet && commitOk) {
    domainNotify(
      originRestorable ? 'domain.removedWithRestore' : 'domain.removed',
      originRestorable && origin ? { name, path: origin.path } : { name },
    );
  }
}

/**
 * Drop Git provenance so the collected skill is no longer tracked for updates.
 * Keeps the skill tree and origin/usage/dependent links.
 */
export async function unbindCollectedSkillSource(name: string): Promise<void> {
  const skillName = assertSkillName(name);
  const skillPath = join(collectionPaths().skills, skillName);
  if (!(await exists(skillPath))) throw new DomainError('domain.notInCollection', { name: skillName });
  const previous = await readMetadata(skillName);
  if (!isBoundGitSource(previous.source)) {
    throw new DomainError('domain.sourceNotBound', { name: skillName });
  }
  const state = await readState();
  const { state: nextState, dropped } = dropSourceConflicts(state, skillName);
  const next: SkillMetadata = { ...previous, source: { type: 'unknown' } };
  let wroteState = false;
  try {
    await writeMetadata(next);
    if (dropped.length) {
      await writeState(nextState);
      wroteState = true;
    }
  } catch (error) {
    try {
      await writeMetadata(previous);
      if (wroteState) await writeState(state);
    } catch (rollbackError) {
      throw new DomainError('domain.unbindFailedRollback', {
        error: errorMessage(error),
        rollback: errorMessage(rollbackError),
      });
    }
    throw error;
  }
  await rm(baselinePath(skillName), { recursive: true, force: true });
  for (const conflict of dropped) {
    await rm(conflict.path, { recursive: true, force: true }).catch((cleanupError) => {
      domainNotify('domain.warnConflictCleanup', { error: errorMessage(cleanupError) });
    });
  }
  await commitCollection(`unbind source ${skillName}`);
}

async function validateMaterializableSkillTree(
  root: string,
  current = root,
  ancestors = new Set<string>()
): Promise<void> {
  const currentReal = await realpath(current);
  if (ancestors.has(currentReal)) {
    throw new DomainError('domain.cyclicSymlink', { path: current });
  }
  const nextAncestors = new Set(ancestors).add(currentReal);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(path);
      } catch {
        throw new DomainError('domain.unresolvableSymlink', { path });
      }
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        throw new DomainError('domain.symlinkOutside', { path });
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
      throw new DomainError('domain.copyStillHasSymlink', { path });
    }
    if (entry.isDirectory()) await assertMaterializedTree(path);
  }
}

async function validateSkillLocations(
  skills: Skill[],
  operation: 'delete' | 'materialize'
): Promise<Map<string, Skill>> {
  const collectionRoot = resolve(collectionPaths().root);
  const unique = new Map<string, Skill>();
  for (const skill of skills) unique.set(resolve(skill.path), skill);

  for (const [path, skill] of unique) {
    if (path === collectionRoot || path.startsWith(`${collectionRoot}${sep}`)) {
      throw new DomainError('domain.cannotOpCollectionByPath', {
        operation: operation === 'delete' ? 'domain.opDelete' : 'domain.opMaterialize',
        path,
      });
    }
    if (!(await pathPresent(path))) throw new DomainError('domain.locationGone', { path });
    let current: Skill;
    try {
      current = await readSkill(path);
    } catch {
      throw new DomainError(
        operation === 'delete' ? 'domain.locationChangedNotDeleted' : 'domain.locationChanged',
        { path }
      );
    }
    if (current.name !== skill.name) {
      throw new DomainError(
        operation === 'delete' ? 'domain.locationChangedNotDeleted' : 'domain.locationChanged',
        { path }
      );
    }
  }
  return unique;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new DomainError('common.interrupted');
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
  const unique = await validateSkillLocations(skills, 'materialize');
  const preflight: Array<{ skill: Skill; path: string; source: string }> = [];
  for (const [path, skill] of unique) {
    throwIfAborted(options.signal);
    if (!(await lstat(path)).isSymbolicLink()) {
      throw new DomainError('domain.notAReference', { path });
    }
    let source: string;
    try {
      source = await realpath(path);
    } catch {
      throw new DomainError('domain.referenceUnresolvable', { path });
    }
    if (!(await lstat(source)).isDirectory()) {
      throw new DomainError('domain.referenceNotDir', { path });
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
        throw new DomainError('domain.copyNameChanged', { path: input.path });
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
            throw new DomainError('domain.materializeFailedRollbackItem', {
              error: errorMessage(error),
              path: item.path,
              rollback: errorMessage(rollbackError),
            });

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
          // Technical fragment only — outer DomainError is localized via formatAppError.
          rollbackErrors.push(`state: ${errorMessage(rollbackError)}`);
        }
      }
      if (rollbackErrors.length) {
        throw new DomainError('domain.materializeFailedRollback', {
          error: errorMessage(error),
          rollback: rollbackErrors.join('; '),
        });
      }
      throw error;
    }
  } finally {
    for (const item of prepared) {
      if (committed || !(await pathPresent(item.backup))) {
        await rm(item.workspace, { recursive: true, force: true }).catch((error) => {
          domainNotify('domain.warnMaterializeTempCleanup', { error: errorMessage(error) });
        });
      }
    }
  }
  return prepared.length;
}

export async function removeSkillLocations(skills: Skill[]): Promise<number> {
  const paths = collectionPaths();
  const unique = await validateSkillLocations(skills, 'delete');

  for (const [path, skill] of unique) {
    if (skill.fromCollection) {
      const target = join(paths.skills, assertSkillName(skill.name));
      if (!(await isExactSymlink(path, target))) {
        throw new DomainError('domain.collectionLinkChanged', { path });
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
  const skillName = assertSkillName(name);
  const target = join(paths.skills, skillName);
  if (!(await pathPresent(target))) {
    throw new DomainError('domain.mergeNotValidSkill', { name: skillName });
  }
  await validateSkillTree(workspace);
  const transaction = await mkdtemp(join(paths.local, `.merge-${skillName}-`));
  const staged = join(transaction, 'tree');
  try {
    await mkdir(staged, { recursive: true });
    await copyDirectoryContents(workspace, staged);
    if (!(await exists(join(staged, 'SKILL.md')))) {
      throw new DomainError('domain.mergeNotValidSkill', { name: skillName });
    }
    const metadata = await readMetadata(skillName);
    metadata.description = (await readSkill(staged)).description;
    metadata.source = source;
    await replaceCollectionSkill({
      name: skillName,
      staged,
      metadata,
      commitMessage: `update ${skillName}`,
    });
  } finally {
    await rm(transaction, { recursive: true, force: true }).catch(() => {});
  }
}
