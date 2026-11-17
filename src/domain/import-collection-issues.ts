import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { collectionPaths, normalizeGitRepositoryIdentity } from './core.js';
import type { ReadIssue } from './agent-read.js';

export interface ImportCollectionIssue extends ReadIssue {
  reason: 'unrelated-incomplete' | 'target-conflict' | 'same-repository' | 'namespace-conflict' | 'unverified';
}

/** Classify damaged entries conservatively without mutating collection data. */
export async function classifyImportCollectionIssues(
  issues: readonly ReadIssue[],
  targetNames: readonly string[],
  repository: string | undefined,
  namespace: string | undefined,
): Promise<{ blocking: ImportCollectionIssue[]; unrelated: ImportCollectionIssue[] }> {
  const paths = collectionPaths();
  const targets = new Set(targetNames.map((name) => name.toLowerCase()));
  const identity = repository ? normalizeGitRepositoryIdentity(repository) : undefined;
  const blocking: ImportCollectionIssue[] = [];
  const unrelated: ImportCollectionIssue[] = [];
  for (const issue of issues) {
    const inSkills = dirname(resolve(issue.path)) === resolve(paths.skills);
    const inMetadata = dirname(resolve(issue.path)) === resolve(paths.metadata) && issue.path.endsWith('.json');
    const name = inMetadata ? basename(issue.path, '.json') : basename(issue.path);
    const result: ImportCollectionIssue = { ...issue, reason: 'unverified' };
    if (targets.has(name.toLowerCase())) {
      result.reason = 'target-conflict';
      blocking.push(result);
      continue;
    }
    if (!inSkills && !inMetadata) { blocking.push(result); continue; }
    try {
      if (inSkills) {
        const stat = await lstat(issue.path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(issue.path)).length !== 0) {
          blocking.push(result);
          continue;
        }
      }
      const metadataPath = inMetadata ? issue.path : join(paths.metadata, `${name}.json`);
      let metadata: unknown;
      try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); }
      catch (error) {
        if (inSkills && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          result.reason = 'unrelated-incomplete';
          unrelated.push(result);
          continue;
        }
        blocking.push(result);
        continue;
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) { blocking.push(result); continue; }
      const value = metadata as { name?: unknown; source?: { type?: unknown; url?: unknown }; namespace?: { name?: unknown } };
      if (typeof value.name !== 'string' || value.name !== name || !value.source || !['git', 'local', 'unknown'].includes(String(value.source.type)) ||
          (value.namespace !== undefined && (!value.namespace || typeof value.namespace !== 'object' || typeof value.namespace.name !== 'string'))) {
        blocking.push(result);
        continue;
      }
      if (namespace && value.namespace?.name === namespace) result.reason = 'namespace-conflict';
      else if (identity && typeof value.source.url === 'string' && normalizeGitRepositoryIdentity(value.source.url) === identity) result.reason = 'same-repository';
      else if (value.source.type === 'git' && typeof value.source.url !== 'string') result.reason = 'unverified';
      else result.reason = 'unrelated-incomplete';
      (result.reason === 'unrelated-incomplete' ? unrelated : blocking).push(result);
    } catch {
      blocking.push(result);
    }
  }
  return { blocking, unrelated };
}
