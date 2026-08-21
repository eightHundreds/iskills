import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSkillName,
  baselinePath,
  clearDirectory,
  collectionPaths,
  collectionGitAddPaths,
  collectionGitStatusPaths,
  commitCollection,
  copyDirectoryContents,
  errorMessage,
  ensureCollection,
  exists,
  parseGitSource,
  readMetadata,
  readSkill,
  readState,
  sourceSkillFile,
  validateSkillTree,
  writeMetadata,
  writeState,
} from './core.js';
import {
  installMergedCollectionSkill,
  removeFromCollection,
} from './collection-write.js';
import type {
  GitImportContext,
  GitSource,
  Skill,
  SkillLink,
  SourceConflict,
  UpdateStatus,
} from './types.js';
import { DomainError, domainNotify } from './errors.js';

export function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const remoteHeadCache = new Map<string, Promise<string | undefined>>();

function remoteBranchHead(url: string, ref: string): Promise<string | undefined> {
  const key = `${url}\0${ref}`;
  const cached = remoteHeadCache.get(key);
  if (cached) return cached;
  // ponytail: process-local caching is enough for one browser session.
  const request = new Promise<string | undefined>((resolve) => {
    execFile(
      'git',
      ['ls-remote', '--heads', url, `refs/heads/${ref}`],
      {
        encoding: 'utf8',
        timeout: 8000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (error, stdout) => {
        if (error) remoteHeadCache.delete(key);
        resolve(error ? undefined : stdout.trim().split(/\s+/)[0]);
      }
    );
  });
  remoteHeadCache.set(key, request);
  return request;
}

/** After a clone confirms the branch tip, keep the session check cache in sync. */
function rememberRemoteBranchHead(url: string, ref: string, commit: string): void {
  remoteHeadCache.set(`${url}\0${ref}`, Promise.resolve(commit));
}

export async function checkGitSkillUpdates(skills: Skill[]): Promise<{
  updates: Set<string>;
  failed: number;
}> {
  const checkable = skills.flatMap((skill) => {
    const source = skill.source;
    if (
      source?.type !== 'git' ||
      source.refType !== 'branch' ||
      !source.url ||
      !source.ref ||
      !source.commit
    ) return [];
    return [{ name: skill.name, url: source.url, ref: source.ref, commit: source.commit }];
  });
  const results = await Promise.all(checkable.map(async (skill) => ({
    ...skill,
    remote: await remoteBranchHead(skill.url, skill.ref),
  })));

  return {
    updates: new Set(results.filter((skill) => skill.remote && skill.remote !== skill.commit)
      .map((skill) => skill.name)),
    failed: results.filter((skill) => !skill.remote).length,
  };
}

export async function initCollectionGit(): Promise<boolean> {
  const { root } = await ensureCollection();
  const gitDir = join(root, '.git');
  const created = !(await exists(gitDir));

  try {
    if (created) git(['-C', root, 'init', '--quiet', '-b', 'main']);
    try {
      git(['-C', root, 'rev-parse', '--verify', '--quiet', 'HEAD']);
      return false;
    } catch {}

    for (const [key, fallback] of [
      ['user.name', 'Skill Collection'],
      ['user.email', 'iskills@localhost'],
    ] as const) {
      let value = '';
      try {
        value = git(['-C', root, 'config', '--get', key]);
      } catch {}
      if (!value) git(['-C', root, 'config', key, fallback]);
    }
    git(['-C', root, 'add', '-A', '--', ...(await collectionGitAddPaths(root))]);
    git(['-C', root, 'commit', '--quiet', '-m', 'initialize skill collection']);
    return true;
  } catch (error) {
    if (created) await rm(gitDir, { recursive: true, force: true });
    throw new DomainError('git.initFailed', { error: errorMessage(error) });
  }
}

/** Current collection `origin` URL, if configured. */
export async function getCollectionRemote(): Promise<string | undefined> {
  const { root } = collectionPaths();
  if (!(await exists(join(root, '.git')))) return undefined;
  try {
    const remotes = git(['-C', root, 'remote']).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes('origin')) return undefined;
    const url = git(['-C', root, 'remote', 'get-url', 'origin']).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Set collection `origin` to a non-empty URL.
 * Initializes the collection Git repo when needed (same as `iskills init` without remote).
 */
export async function configureCollectionRemote(remote: string): Promise<void> {
  const url = remote.trim();
  if (!url) throw new DomainError('git.remoteEmpty');
  await initCollectionGit();
  const { root } = collectionPaths();
  const remotes = git(['-C', root, 'remote']).split(/\r?\n/).filter(Boolean);
  git(['-C', root, 'remote', remotes.includes('origin') ? 'set-url' : 'add', 'origin', url]);
}

/** Remove collection `origin` when present. No-op if the repo or remote is missing. */
export async function clearCollectionRemote(): Promise<void> {
  const { root } = collectionPaths();
  if (!(await exists(join(root, '.git')))) return;
  let remotes: string[] = [];
  try {
    remotes = git(['-C', root, 'remote']).split(/\r?\n/).filter(Boolean);
  } catch {
    return;
  }
  if (!remotes.includes('origin')) return;
  git(['-C', root, 'remote', 'remove', 'origin']);
}

export async function cloneGitSource(input: string): Promise<GitImportContext> {
  const parsed = parseGitSource(input);
  const temporary = await mkdtemp(join(tmpdir(), 'iskills-source-'));
  const repository = join(temporary, 'repository');
  const cloneArgs = ['clone', '--quiet'];
  const isCommitRef = Boolean(parsed.ref && /^[0-9a-f]{7,40}$/i.test(parsed.ref));
  // Collect/import only needs HEAD of the chosen ref. Skip depth for SHA pins
  // so the later checkout can still see that object.
  if (!isCommitRef) cloneArgs.push('--depth', '1');
  if (parsed.ref && !isCommitRef) cloneArgs.push('--branch', parsed.ref);
  let cloneSource = parsed.url;
  if (cloneSource.startsWith('file://')) {
    try {
      cloneSource = fileURLToPath(cloneSource);
    } catch {}
  }
  cloneArgs.push(cloneSource, repository);
  try {
    git(cloneArgs);
    if (parsed.ref && /^[0-9a-f]{7,40}$/i.test(parsed.ref)) {
      git(['-C', repository, 'checkout', '--quiet', parsed.ref]);
    }
    const commit = git(['-C', repository, 'rev-parse', 'HEAD']);
    let branch = '';
    try {
      branch = git(['-C', repository, 'symbolic-ref', '--short', 'HEAD']);
    } catch {}
    const tags = git(['-C', repository, 'tag', '--points-at', 'HEAD'])
      .split(/\r?\n/)
      .filter(Boolean);
    const refType = parsed.ref
      ? /^[0-9a-f]{7,40}$/i.test(parsed.ref)
        ? 'commit'
        : tags.includes(parsed.ref)
          ? 'tag'
          : 'branch'
      : 'branch';
    return {
      temporary,
      repository,
      source: {
        type: 'git',
        url: parsed.url,
        ref: parsed.ref || branch,
        refType,
        commit,
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw new DomainError('git.cloneFailed', { error: errorMessage(error) });
  }
}

function gitObjectExists(repository: string, object: string): boolean {
  try {
    execFileSync('git', ['-C', repository, 'cat-file', '-e', object], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectRenamedSkillPath(
  repository: string,
  fromCommit: string,
  toCommit: string,
  sourcePath: string
): string {
  let output = '';
  try {
    output = git(['-C', repository, 'diff', '--name-status', '-M', fromCommit, toCommit]);
  } catch {
    return sourcePath;
  }
  const skillFile = sourceSkillFile(sourcePath);
  for (const line of output.split(/\r?\n/)) {
    const [status, oldPath, newPath] = line.split('\t');
    if (status?.startsWith('R') && oldPath === skillFile && newPath?.endsWith('/SKILL.md')) {
      return dirname(newPath).split(sep).join('/');
    }
  }
  return sourcePath;
}

async function prepareDirectoryMerge(
  name: string,
  baseSkill: string,
  remoteSkill: string
): Promise<{ workspace: string; conflicted: boolean }> {
  const paths = collectionPaths();
  const workspace = join(paths.local, 'conflicts', assertSkillName(name));
  await rm(workspace, { recursive: true, force: true });
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(paths.local, { recursive: true })]);
  await Promise.all([validateSkillTree(baseSkill), validateSkillTree(remoteSkill)]);
  await copyDirectoryContents(baseSkill, workspace);
  git(['-C', workspace, 'init', '--quiet', '-b', 'base']);
  git(['-C', workspace, 'config', 'user.name', 'Skill Collection']);
  git(['-C', workspace, 'config', 'user.email', 'iskills@localhost']);
  git(['-C', workspace, 'add', '-A']);
  git(['-C', workspace, 'commit', '--quiet', '-m', 'base']);
  const base = git(['-C', workspace, 'rev-parse', 'HEAD']);

  git(['-C', workspace, 'checkout', '--quiet', '-b', 'remote', base]);
  await clearDirectory(workspace, true);
  await copyDirectoryContents(remoteSkill, workspace);
  git(['-C', workspace, 'add', '-A']);
  git(['-C', workspace, 'commit', '--quiet', '--allow-empty', '-m', 'remote']);
  const remote = git(['-C', workspace, 'rev-parse', 'HEAD']);

  git(['-C', workspace, 'checkout', '--quiet', '-b', 'local', base]);
  await clearDirectory(workspace, true);
  await copyDirectoryContents(join(paths.skills, name), workspace);
  git(['-C', workspace, 'add', '-A']);
  git(['-C', workspace, 'commit', '--quiet', '--allow-empty', '-m', 'local']);

  let conflicted = false;
  try {
    execFileSync('git', ['-C', workspace, 'merge', '--quiet', '--no-edit', remote], {
      stdio: 'ignore',
    });
  } catch {
    conflicted = true;
  }
  return { workspace, conflicted };
}

let updateWorktreeSeq = 0;

async function removeUpdateWorktrees(repository: string, trees: string[]): Promise<void> {
  for (const tree of trees) {
    try {
      git(['-C', repository, 'worktree', 'remove', '--force', tree]);
    } catch {}
    await rm(tree, { recursive: true, force: true });
  }
}

async function prepareSourceMerge(
  name: string,
  repository: string,
  baseCommit: string,
  latestCommit: string,
  oldPath: string,
  newPath: string
): Promise<{ workspace: string; conflicted: boolean }> {
  const token = `${assertSkillName(name)}-${process.pid}-${++updateWorktreeSeq}`;
  const root = dirname(repository);
  const baseTree = join(root, `base-${token}`);
  const remoteTree = join(root, `remote-${token}`);
  const added: string[] = [];
  try {
    git(['-C', repository, 'worktree', 'add', '--quiet', '--detach', baseTree, baseCommit]);
    added.push(baseTree);
    git(['-C', repository, 'worktree', 'add', '--quiet', '--detach', remoteTree, latestCommit]);
    added.push(remoteTree);
    return await prepareDirectoryMerge(name, join(baseTree, oldPath), join(remoteTree, newPath));
  } finally {
    await removeUpdateWorktrees(repository, added);
  }
}

/** Apply source-update conflict workspaces that the user finished resolving. */
export async function finalizeResolvedConflicts(): Promise<void> {
  const state = await readState();
  const remaining = [];
  let finalized = false;
  for (const conflict of state.conflicts) {
    if (conflict.type !== 'source') continue;
    if (!(await exists(conflict.path))) {
      remaining.push(conflict);
      continue;
    }
    let clean = false;
    try {
      const unmerged = git(['-C', conflict.path, 'diff', '--name-only', '--diff-filter=U']);
      const status = git(['-C', conflict.path, 'status', '--porcelain']);
      let mergeInProgress = true;
      try {
        git(['-C', conflict.path, 'rev-parse', '-q', '--verify', 'MERGE_HEAD']);
      } catch {
        mergeInProgress = false;
      }
      clean = !unmerged && !status && !mergeInProgress;
    } catch {}
    if (!clean) {
      remaining.push(conflict);
      continue;
    }
    await installMergedCollectionSkill(conflict.skill, conflict.path, conflict.source);
    await rm(conflict.path, { recursive: true, force: true });
    if (conflict.baseline) await rm(conflict.baseline, { recursive: true, force: true });
    domainNotify('git.appliedManualUpdate', { skill: conflict.skill });
    finalized = true;
  }
  if (remaining.length !== state.conflicts.length) {
    state.conflicts = remaining;
    await writeState(state);
  }
  if (finalized) await commitCollection('apply resolved source updates');
}

export async function backgroundCollectionSync(): Promise<void> {
  const paths = collectionPaths();
  const lock = join(paths.local, 'git-sync.lock');
  try {
    await writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw error;
  }

  let worktree: string | undefined;
  let worktreeRoot: string | undefined;
  try {
    const remotes = git(['-C', paths.root, 'remote']).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes('origin')) return;
    const branch = git(['-C', paths.root, 'symbolic-ref', '--short', 'HEAD']);
    const localHead = git(['-C', paths.root, 'rev-parse', 'HEAD']);
    git(['-C', paths.root, 'fetch', '--quiet', 'origin']);
    const upstream = `refs/remotes/origin/${branch}`;
    if (!gitObjectExists(paths.root, upstream)) {
      git(['-C', paths.root, 'push', '--quiet', '-u', 'origin', branch]);
      return;
    }
    const remoteHead = git(['-C', paths.root, 'rev-parse', upstream]);
    if (remoteHead === localHead) return;

    worktreeRoot = await mkdtemp(join(tmpdir(), 'iskills-collection-sync-'));
    worktree = join(worktreeRoot, 'worktree');
    git(['-C', paths.root, 'worktree', 'add', '--quiet', '--detach', worktree, localHead]);
    git(['-C', worktree, 'config', 'user.name', 'Skill Collection']);
    git(['-C', worktree, 'config', 'user.email', 'iskills@localhost']);
    try {
      execFileSync('git', ['-C', worktree, 'merge', '--quiet', '--no-edit', remoteHead], {
        stdio: 'ignore',
      });
    } catch {
      // Leave main tree clean; UI health probe reports live divergence.
      return;
    }

    const mergedHead = git(['-C', worktree, 'rev-parse', 'HEAD']);
    const currentHead = git(['-C', paths.root, 'rev-parse', 'HEAD']);
    const dirty = git([
      '-C',
      paths.root,
      'status',
      '--porcelain',
      '--',
      ...collectionGitStatusPaths(),
    ]);
    if (currentHead !== localHead || dirty) return;
    git(['-C', paths.root, 'merge', '--quiet', '--ff-only', mergedHead]);
    git(['-C', paths.root, 'push', '--quiet', 'origin', branch]);
  } catch {
    // Soft-fail background sync; no on-disk conflict cache.
  } finally {
    if (worktree && worktreeRoot) {
      try {
        git(['-C', paths.root, 'worktree', 'remove', '--force', worktree]);
      } catch {}
      await rm(worktreeRoot, { recursive: true, force: true });
    }
    await rm(lock, { force: true });
  }
}

interface SkillUpdateClone {
  temporary: string;
  repository: string;
}

export interface UpdateGitSkillOptions {
  confirmDelete?: (links: SkillLink[], skill: Skill) => Promise<boolean>;
  quietDelete?: boolean;
}

export interface GitSkillBatchUpdateOptions extends UpdateGitSkillOptions {
  onProgress?: (skill: Skill, current: number, total: number) => void | Promise<void>;
  onSkill?: (skill: Skill, status: UpdateStatus) => void | Promise<void>;
}

export type GitSkillUpdateOutcome =
  | { skill: Skill; status: UpdateStatus }
  | { skill: Skill; error: unknown };

async function cloneForSkillUpdate(url: string): Promise<SkillUpdateClone> {
  const temporary = await mkdtemp(join(tmpdir(), 'iskills-update-'));
  const repository = join(temporary, 'repository');
  try {
    git(['clone', '--quiet', '--no-checkout', url, repository]);
    return { temporary, repository };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function drainUpdateClones(
  clones: Map<string, Promise<SkillUpdateClone>>
): Promise<void> {
  for (const pending of clones.values()) {
    try {
      const clone = await pending;
      await rm(clone.temporary, { recursive: true, force: true });
    } catch {}
  }
}

async function acquireUpdateClone(
  url: string,
  clones: Map<string, Promise<SkillUpdateClone>> | undefined
): Promise<{ clone: SkillUpdateClone; owned: boolean }> {
  if (!clones) {
    return { clone: await cloneForSkillUpdate(url), owned: true };
  }
  let pending = clones.get(url);
  if (!pending) {
    pending = cloneForSkillUpdate(url).catch((error) => {
      clones.delete(url);
      throw error;
    });
    clones.set(url, pending);
  }
  return { clone: await pending, owned: false };
}

async function applyGitSkillUpdate(
  skill: Skill,
  allowDelete: boolean,
  options: UpdateGitSkillOptions,
  clones?: Map<string, Promise<SkillUpdateClone>>
): Promise<UpdateStatus> {
  const metadata = await readMetadata(skill.name);
  const source = metadata.source;
  if (source.type !== 'git' || !source.url || !source.refType || !source.path) return 'unmanaged';
  if (source.refType !== 'branch') return 'pinned';
  const gitSource: GitSource = {
    ...source,
    type: 'git',
    url: source.url,
    refType: source.refType,
    path: source.path,
  };

  const state = await readState();
  if (state.conflicts.some((conflict) => conflict.type === 'source' && conflict.skill === skill.name)) {
    return 'conflict';
  }

  const { clone, owned } = await acquireUpdateClone(gitSource.url, clones);
  const repository = clone.repository;
  try {
    const latestRef = gitSource.ref
      ? `refs/remotes/origin/${gitSource.ref}`
      : 'refs/remotes/origin/HEAD';
    if (!gitObjectExists(repository, latestRef) && gitSource.ref) {
      if (gitObjectExists(repository, `refs/tags/${gitSource.ref}`)) {
        metadata.source.refType = 'tag';
        await writeMetadata(metadata);
        return 'pinned';
      }
      throw new DomainError('git.branchMissing', { ref: gitSource.ref });
    }
    const latestCommit = git(['-C', repository, 'rev-parse', latestRef]);
    if (gitSource.ref) rememberRemoteBranchHead(gitSource.url, gitSource.ref, latestCommit);
    if (latestCommit === gitSource.commit) return 'unchanged';
    if (gitSource.commit && !gitObjectExists(repository, gitSource.commit)) {
      throw new DomainError('git.commitMissing', { commit: gitSource.commit });
    }

    const newPath = gitSource.commit
      ? detectRenamedSkillPath(
          repository,
          gitSource.commit,
          latestCommit,
          gitSource.path ?? '.'
        )
      : gitSource.path;
    if (!gitObjectExists(repository, `${latestCommit}:${sourceSkillFile(newPath ?? '.')}`)) {
      if (!allowDelete) {
        const links = (await readState()).links.filter((link) => link.skill === skill.name);
        if (!options.confirmDelete) {
          throw new DomainError('git.upstreamDeletedNeedsConfirm', { name: skill.name });
        }
        const confirmed = await options.confirmDelete(links, skill);
        if (!confirmed) return 'delete-skipped';
      }
      await removeFromCollection(skill.name, true, options.quietDelete ?? false);
      return 'deleted';
    }

    let merge: { workspace: string; conflicted: boolean };
    let baseline: string | undefined;
    if (gitSource.commit) {
      merge = await prepareSourceMerge(
        skill.name,
        repository,
        gitSource.commit,
        latestCommit,
        gitSource.path,
        newPath
      );
    } else {
      baseline = baselinePath(skill.name);
      if (!(await exists(join(baseline, 'SKILL.md')))) {
        throw new DomainError('git.missingBaseline');
      }
      const remoteTree = join(
        dirname(repository),
        `remote-${assertSkillName(skill.name)}-${process.pid}`
      );
      git(['-C', repository, 'worktree', 'add', '--quiet', '--detach', remoteTree, latestCommit]);
      try {
        merge = await prepareDirectoryMerge(skill.name, baseline, join(remoteTree, newPath));
      } finally {
        await removeUpdateWorktrees(repository, [remoteTree]);
      }
    }
    const nextSource: GitSource = {
      ...gitSource,
      ref:
        gitSource.ref ||
        git(['-C', repository, 'symbolic-ref', '--short', latestRef]).replace('origin/', ''),
      path: newPath,
      commit: latestCommit,
    };
    if (merge.conflicted) {
      const conflict: SourceConflict = {
        type: 'source',
        skill: skill.name,
        path: merge.workspace,
        source: nextSource,
        ...(baseline ? { baseline } : {}),
      };
      state.conflicts.push(conflict);
      await writeState(state);
      return 'conflict';
    }

    await installMergedCollectionSkill(skill.name, merge.workspace, nextSource);
    await rm(merge.workspace, { recursive: true, force: true });
    if (baseline) await rm(baseline, { recursive: true, force: true });
    await commitCollection(`update ${skill.name}`);
    return 'updated';
  } finally {
    if (owned) await rm(clone.temporary, { recursive: true, force: true });
  }
}

export async function updateGitSkill(
  skill: Skill,
  allowDelete: boolean,
  options: UpdateGitSkillOptions = {}
): Promise<UpdateStatus> {
  return applyGitSkillUpdate(skill, allowDelete, options);
}

export async function updateGitSkills(
  skills: Skill[],
  allowDelete: boolean,
  options: GitSkillBatchUpdateOptions = {}
): Promise<GitSkillUpdateOutcome[]> {
  const clones = new Map<string, Promise<SkillUpdateClone>>();
  const outcomes: GitSkillUpdateOutcome[] = [];
  try {
    for (const [index, skill] of skills.entries()) {
      await options.onProgress?.(skill, index + 1, skills.length);
      try {
        const status = await applyGitSkillUpdate(skill, allowDelete, options, clones);
        await options.onSkill?.(skill, status);
        outcomes.push({ skill, status });
      } catch (error) {
        if (error instanceof Error && error.name === 'InterruptError') throw error;
        outcomes.push({ skill, error });
      }
    }
    return outcomes;
  } finally {
    await drainUpdateClones(clones);
  }
}

/** Foreground git with captured stderr so DomainError can surface the real failure. */
function gitForeground(args: string[]): void {
  try {
    execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

/** Abort leftover rebase from older pull --rebase paths so the main tree is usable again. */
async function abortLeftoverCollectionRebase(root: string): Promise<void> {
  const gitDir = join(root, '.git');
  const inProgress =
    (await exists(join(gitDir, 'rebase-merge'))) ||
    (await exists(join(gitDir, 'rebase-apply')));
  if (!inProgress) return;
  try {
    gitForeground(['-C', root, 'rebase', '--abort']);
  } catch (error) {
    throw new Error(
      `collection git rebase in progress and could not abort: ${errorMessage(error)}`
    );
  }
}

/**
 * Foreground collection sync: commit pending managed paths, then merge origin in a
 * detached worktree and only ff-only apply to the live tree (same isolation model as
 * background sync). Never runs `pull --rebase` on the main collection, so a conflict
 * cannot leave skills/metadata mid-rebase.
 */
async function foregroundCollectionSync(): Promise<void> {
  const paths = collectionPaths();
  const root = paths.root;
  const lock = join(paths.local, 'git-sync.lock');
  try {
    await writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new DomainError('git.syncFailed', { error: 'sync already in progress' });
    }
    throw error;
  }

  let worktree: string | undefined;
  let worktreeRoot: string | undefined;
  try {
    // Flush local WIP first so dirty skills/metadata never block sync.
    // Skip background child — this call is the sync.
    await commitCollection('sync pending collection changes', true, false);
    await abortLeftoverCollectionRebase(root);

    const remotes = git(['-C', root, 'remote']).split(/\r?\n/).filter(Boolean);
    if (!remotes.includes('origin')) {
      throw new DomainError('git.syncFailed', { error: 'no origin remote' });
    }

    const branch = git(['-C', root, 'symbolic-ref', '--short', 'HEAD']);
    const localHead = git(['-C', root, 'rev-parse', 'HEAD']);
    gitForeground(['-C', root, 'fetch', 'origin']);
    const upstream = `refs/remotes/origin/${branch}`;
    if (!gitObjectExists(root, upstream)) {
      gitForeground(['-C', root, 'push', '-u', 'origin', branch]);
      return;
    }

    const remoteHead = git(['-C', root, 'rev-parse', upstream]);
    if (remoteHead === localHead) {
      return;
    }

    worktreeRoot = await mkdtemp(join(tmpdir(), 'iskills-collection-sync-'));
    worktree = join(worktreeRoot, 'worktree');
    git(['-C', root, 'worktree', 'add', '--quiet', '--detach', worktree, localHead]);
    git(['-C', worktree, 'config', 'user.name', 'Skill Collection']);
    git(['-C', worktree, 'config', 'user.email', 'iskills@localhost']);
    try {
      gitForeground(['-C', worktree, 'merge', '--no-edit', remoteHead]);
    } catch {
      throw new DomainError('git.conflictWithOrigin');
    }

    const mergedHead = git(['-C', worktree, 'rev-parse', 'HEAD']);
    const currentHead = git(['-C', root, 'rev-parse', 'HEAD']);
    const dirty = git([
      '-C',
      root,
      'status',
      '--porcelain',
      '--',
      ...collectionGitStatusPaths(),
    ]);
    if (currentHead !== localHead || dirty) {
      throw new DomainError('git.syncFailed', {
        error: 'collection changed during sync',
      });
    }
    git(['-C', root, 'merge', '--quiet', '--ff-only', mergedHead]);
    gitForeground(['-C', root, 'push', 'origin', branch]);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('git.syncFailed', { error: errorMessage(error) });
  } finally {
    if (worktree && worktreeRoot) {
      try {
        git(['-C', root, 'worktree', 'remove', '--force', worktree]);
      } catch {}
      await rm(worktreeRoot, { recursive: true, force: true });
    }
    await rm(lock, { force: true });
  }
}

export async function syncCollection(background: boolean): Promise<void> {
  const { root } = collectionPaths();
  if (!(await exists(join(root, '.git')))) throw new DomainError('git.notARepo');
  if (background) return backgroundCollectionSync();
  return foregroundCollectionSync();
}
