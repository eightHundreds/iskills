/**
 * Live collection health probe — no on-disk conflict cache.
 * UI maps issues to footer ⚠ + alert modal; re-run after reload/sync.
 */
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionPaths, exists, readState } from './core.js';

export type CollectionHealthIssue =
  | { id: 'git-rebase'; kind: 'git-rebase' }
  | { id: 'git-merge'; kind: 'git-merge' }
  | { id: 'git-diverged'; kind: 'git-diverged'; branch: string }
  | { id: string; kind: 'source-conflict'; skill: string };

function isAncestor(root: string, maybeAncestor: string, maybeDescendant: string): boolean {
  try {
    execFileSync(
      'git',
      ['-C', root, 'merge-base', '--is-ancestor', maybeAncestor, maybeDescendant],
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

function gitQuiet(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

/** Drop legacy collection-conflict.json if present (no longer a source of truth). */
export async function discardStaleCollectionConflictCache(): Promise<void> {
  await rm(collectionPaths().collectionConflict, { force: true });
}

/**
 * Snapshot current collection health from git + source conflict workspaces.
 * Does not fetch; uses existing origin/* refs. Never throws for probe failures.
 */
export async function probeCollectionHealth(): Promise<CollectionHealthIssue[]> {
  const issues: CollectionHealthIssue[] = [];
  const paths = collectionPaths();
  try {
    await discardStaleCollectionConflictCache();
  } catch {
    /* ignore */
  }

  const gitDir = join(paths.root, '.git');
  if (await exists(gitDir)) {
    if (await exists(join(gitDir, 'rebase-merge')) || await exists(join(gitDir, 'rebase-apply'))) {
      issues.push({ id: 'git-rebase', kind: 'git-rebase' });
    }
    if (await exists(join(gitDir, 'MERGE_HEAD'))) {
      issues.push({ id: 'git-merge', kind: 'git-merge' });
    }

    const remotes = gitQuiet(paths.root, ['remote']);
    if (remotes?.split(/\r?\n/).includes('origin')) {
      const branch = gitQuiet(paths.root, ['symbolic-ref', '--short', 'HEAD']);
      const localHead = gitQuiet(paths.root, ['rev-parse', 'HEAD']);
      if (branch && localHead) {
        const upstream = `refs/remotes/origin/${branch}`;
        const remoteHead = gitQuiet(paths.root, ['rev-parse', upstream]);
        if (
          remoteHead &&
          remoteHead !== localHead &&
          !isAncestor(paths.root, localHead, remoteHead) &&
          !isAncestor(paths.root, remoteHead, localHead)
        ) {
          issues.push({ id: 'git-diverged', kind: 'git-diverged', branch });
        }
      }
    }
  }

  try {
    const state = await readState();
    for (const conflict of state.conflicts) {
      if (conflict.type !== 'source') continue;
      if (!(await exists(conflict.path))) continue;
      issues.push({
        id: `source:${conflict.skill}`,
        kind: 'source-conflict',
        skill: conflict.skill,
      });
    }
  } catch {
    /* ignore state read failures */
  }

  return issues;
}
