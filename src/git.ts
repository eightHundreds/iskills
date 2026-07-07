import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import {
  assertSkillName,
  baselinePath,
  clearDirectory,
  collectionPaths,
  commitCollection,
  copyDirectoryContents,
  errorMessage,
  ensureCollection,
  exists,
  parseGitSource,
  readMetadata,
  readSkill,
  readState,
  removeFromCollection,
  sourceSkillFile,
  validateSkillTree,
  writeJson,
  writeMetadata,
  writeState,
} from './core.js';
import { confirm } from './prompts.js';
import type {
  GitImportContext,
  GitSource,
  Skill,
  SourceConflict,
  UpdateStatus,
} from './types.js';

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
    git(['-C', root, 'add', '-A', '--', 'skills', 'metadata', '.gitignore']);
    git(['-C', root, 'commit', '--quiet', '-m', 'initialize skill collection']);
    return true;
  } catch (error) {
    if (created) await rm(gitDir, { recursive: true, force: true });
    throw new Error(`无法初始化收藏夹 Git：${errorMessage(error)}`);
  }
}

export async function configureCollectionRemote(remote: string): Promise<void> {
  if (!remote.trim()) throw new Error('远程仓库地址不能为空');
  const { root } = await ensureCollection();
  const remotes = git(['-C', root, 'remote']).split(/\r?\n/).filter(Boolean);
  git(['-C', root, 'remote', remotes.includes('origin') ? 'set-url' : 'add', 'origin', remote]);
}

export async function cloneGitSource(input: string): Promise<GitImportContext> {
  const parsed = parseGitSource(input);
  const temporary = await mkdtemp(join(tmpdir(), 'iskills-source-'));
  const repository = join(temporary, 'repository');
  const cloneArgs = ['clone', '--quiet'];
  if (parsed.ref && !/^[0-9a-f]{7,40}$/i.test(parsed.ref)) cloneArgs.push('--branch', parsed.ref);
  cloneArgs.push(parsed.url, repository);
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
    throw new Error(`无法克隆 Git 来源：${errorMessage(error)}`);
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

async function prepareSourceMerge(
  name: string,
  repository: string,
  baseCommit: string,
  latestCommit: string,
  oldPath: string,
  newPath: string
): Promise<{ workspace: string; conflicted: boolean }> {
  const baseTree = join(dirname(repository), 'base');
  const remoteTree = join(dirname(repository), 'remote');
  git(['-C', repository, 'worktree', 'add', '--quiet', '--detach', baseTree, baseCommit]);
  git(['-C', repository, 'worktree', 'add', '--quiet', '--detach', remoteTree, latestCommit]);
  return prepareDirectoryMerge(name, join(baseTree, oldPath), join(remoteTree, newPath));
}

async function installMergedSkill(name: string, workspace: string, source: GitSource): Promise<void> {
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

export async function finalizeResolvedConflicts(): Promise<void> {
  const state = await readState();
  const remaining = [];
  let finalized = false;
  for (const conflict of state.conflicts) {
    if (conflict.type === 'collection') {
      const { root } = collectionPaths();
      const gitDir = join(root, '.git');
      const inProgress =
        (await exists(join(gitDir, 'MERGE_HEAD'))) ||
        (await exists(join(gitDir, 'rebase-merge'))) ||
        (await exists(join(gitDir, 'rebase-apply')));
      let clean = false;
      let remoteMerged = false;
      try {
        clean = !git(['-C', root, 'status', '--porcelain']);
        if (conflict.remoteHead) {
          execFileSync(
            'git',
            ['-C', root, 'merge-base', '--is-ancestor', conflict.remoteHead, 'HEAD'],
            { stdio: 'ignore' }
          );
          remoteMerged = true;
        }
      } catch {}
      if (!inProgress && clean && remoteMerged) {
        await rm(collectionPaths().collectionConflict, { force: true });
        console.error('收藏夹 Git 冲突已解决。');
        finalized = true;
      } else {
        remaining.push(conflict);
      }
      continue;
    }
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
    await installMergedSkill(conflict.skill, conflict.path, conflict.source);
    await rm(conflict.path, { recursive: true, force: true });
    if (conflict.baseline) await rm(conflict.baseline, { recursive: true, force: true });
    console.error(`已应用手动解决的更新：${conflict.skill}`);
    finalized = true;
  }
  if (remaining.length !== state.conflicts.length) {
    state.conflicts = remaining;
    await writeState(state);
  }
  if (finalized) await commitCollection('apply resolved source updates');
}

async function markCollectionConflict(message: string, remoteHead?: string): Promise<void> {
  await writeJson(collectionPaths().collectionConflict, {
    type: 'collection',
    message,
    ...(remoteHead ? { remoteHead } : {}),
  });
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
      await markCollectionConflict(
        '收藏夹与 origin 存在冲突，请运行 iskills sync 后手动解决',
        remoteHead
      );
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
      'skills',
      'metadata',
      '.gitignore',
    ]);
    if (currentHead !== localHead || dirty) return;
    git(['-C', paths.root, 'merge', '--quiet', '--ff-only', mergedHead]);
    git(['-C', paths.root, 'push', '--quiet', 'origin', branch]);
  } catch (error) {
    await markCollectionConflict(`收藏夹后台同步失败：${errorMessage(error)}`);
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

export async function updateGitSkill(skill: Skill, allowDelete: boolean): Promise<UpdateStatus> {
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

  const temporary = await mkdtemp(join(tmpdir(), 'iskills-update-'));
  const repository = join(temporary, 'repository');
  try {
    git(['clone', '--quiet', '--no-checkout', gitSource.url, repository]);
    const latestRef = gitSource.ref
      ? `refs/remotes/origin/${gitSource.ref}`
      : 'refs/remotes/origin/HEAD';
    if (!gitObjectExists(repository, latestRef) && gitSource.ref) {
      if (gitObjectExists(repository, `refs/tags/${gitSource.ref}`)) {
        metadata.source.refType = 'tag';
        await writeMetadata(metadata);
        return 'pinned';
      }
      throw new Error(`来源分支不存在：${gitSource.ref}`);
    }
    const latestCommit = git(['-C', repository, 'rev-parse', latestRef]);
    if (latestCommit === gitSource.commit) return 'unchanged';
    if (gitSource.commit && !gitObjectExists(repository, gitSource.commit)) {
      throw new Error(`来源历史中找不到上次同步 Commit：${gitSource.commit}`);
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
        if (!process.stdin.isTTY) throw new Error(`上游已删除 ${skill.name}；确认后使用 --yes`);
        const links = (await readState()).links.filter((link) => link.skill === skill.name);
        console.log(`上游已删除 ${skill.name}，以下位置会受影响：`);
        links.forEach((link) => console.log(`- ${link.path} (${link.kind})`));
        if (!(await confirm('执行收藏夹移除流程吗？'))) return 'delete-skipped';
      }
      await removeFromCollection(skill.name, true);
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
        throw new Error('缺少首次更新所需的导入基线，请重新导入或重新绑定来源');
      }
      const remoteTree = join(temporary, 'remote');
      git(['-C', repository, 'worktree', 'add', '--quiet', '--detach', remoteTree, latestCommit]);
      merge = await prepareDirectoryMerge(skill.name, baseline, join(remoteTree, newPath));
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

    await installMergedSkill(skill.name, merge.workspace, nextSource);
    await rm(merge.workspace, { recursive: true, force: true });
    if (baseline) await rm(baseline, { recursive: true, force: true });
    await commitCollection(`update ${skill.name}`);
    return 'updated';
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function syncCollection(background: boolean): Promise<void> {
  const { root } = collectionPaths();
  if (!(await exists(join(root, '.git')))) throw new Error('收藏夹不是 Git 仓库');
  if (background) return backgroundCollectionSync();
  try {
    let hasUpstream = true;
    try {
      git(['-C', root, 'rev-parse', '--abbrev-ref', '@{u}']);
    } catch {
      hasUpstream = false;
    }
    if (hasUpstream) {
      execFileSync('git', ['-C', root, 'pull', '--rebase'], { stdio: 'inherit' });
      execFileSync('git', ['-C', root, 'push'], { stdio: 'inherit' });
    } else {
      const branch = git(['-C', root, 'symbolic-ref', '--short', 'HEAD']);
      execFileSync('git', ['-C', root, 'push', '-u', 'origin', branch], { stdio: 'inherit' });
    }
    const state = await readState();
    state.conflicts = state.conflicts.filter((conflict) => conflict.type !== 'collection');
    await writeState(state);
    await rm(collectionPaths().collectionConflict, { force: true });
  } catch (error) {
    await markCollectionConflict('收藏夹 Git 同步冲突，请使用 Git 手动解决');
    throw new Error(`收藏夹 Git 同步失败：${errorMessage(error)}`);
  }
}
