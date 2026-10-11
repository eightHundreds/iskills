import {
  lstat,
  readdir,
  readFile,
  realpath,
  rm,
  mkdtemp,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import {
  AGENTS,
  agentIds,
  collectionPaths,
  exists,
  isAgentPresent,
  readMetadata,
  readSkill,
  readState,
  discoverSkills,
  validateSkillTree,
  classifyCollectionMatch,
  classifyPreCloneCollectionMatch,
  parseGitSource,
} from './core.js';
import { listCollectionSkillsMissingMetadata } from './collection-write.js';
import { collectedFromRecord, mcpCollectionDir } from './mcp/collection.js';
import { readJsonObject } from './mcp/io.js';
import { readMcpSecrets } from './mcp/secrets.js';
import { isPlaceholder } from './mcp/recipe.js';
import {
  agentMcpWritable,
  ownedFilePath,
  mcpAgentIds,
  readOwnedRows,
  readBorrowedEntries,
} from './mcp/dialects/index.js';
import { toLocationEntries } from './mcp/dialects/shared.js';
import {
  OperationFailure,
  operationError,
  type OperationResult,
} from './operation.js';
import { runGit } from './process.js';
import type {
  CollectedSkill,
  GitImportContext,
  SkillMetadata,
} from './types.js';
import type { CollectedMcp, McpLocationEntry, McpScope } from './mcp/types.js';

export interface ReadIssue {
  path: string;
  error: ReturnType<typeof operationError>;
}

export function readResult(
  result: Record<string, unknown>,
  issues: ReadIssue[] = [],
): OperationResult {
  return {
    result: { ...result, issues },
    ...(issues.length
      ? { error: issues[0]!.error, exitCode: 1, partial: true }
      : {}),
  };
}

/** Read each collection entry independently; malformed neighbors remain visible as issues. */
export async function readSkills(): Promise<{
  items: CollectedSkill[];
  issues: ReadIssue[];
}> {
  const { skills, metadata } = collectionPaths();
  const items: CollectedSkill[] = [];
  const issues: ReadIssue[] = [];
  if (!(await exists(skills))) return { items, issues };
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(skills, entry.name);
    try {
      const skill = await readSkill(path);
      if (skill.name !== entry.name) throw new Error('name mismatch');
      const meta = await readMetadata(skill.name);
      if (
        meta.name !== skill.name ||
        !Array.isArray(meta.tags) ||
        meta.tags.some((tag) => typeof tag !== 'string') ||
        typeof meta.note !== 'string' ||
        !meta.source ||
        typeof meta.source.type !== 'string'
      )
        throw new Error('invalid metadata');
      items.push({
        name: meta.name,
        path,
        description: skill.description,
        tags: meta.tags,
        note: meta.note,
        source: meta.source,
      });
    } catch (error) {
      issues.push({ path, error: operationError(error) });
    }
  }
  // Orphaned metadata is a query issue, never silently adopted or removed.
  if (await exists(metadata)) {
    for (const name of await readdir(metadata)) {
      if (
        name.endsWith('.json') &&
        !(await exists(join(skills, name.slice(0, -5))))
      ) {
        issues.push({
          path: join(metadata, name),
          error: operationError(new Error('orphan metadata')),
        });
      }
    }
  }
  return {
    items: items.sort((a, b) => a.name.localeCompare(b.name, 'en')),
    issues,
  };
}

export async function readMcps(): Promise<{
  items: CollectedMcp[];
  issues: ReadIssue[];
}> {
  const items: CollectedMcp[] = [];
  const issues: ReadIssue[] = [];
  const root = mcpCollectionDir();
  if (!(await exists(root))) return { items, issues };
  for (const file of await readdir(root)) {
    if (!file.endsWith('.json')) continue;
    const path = join(root, file);
    try {
      const raw = await readJsonObject(path);
      const recipe = raw.recipe as Record<string, unknown> | undefined;
      if (
        raw.name !== file.slice(0, -5) ||
        !Array.isArray(raw.tags) ||
        raw.tags.some((tag) => typeof tag !== 'string') ||
        !recipe ||
        !['stdio', 'http', 'sse'].includes(String(recipe.transport)) ||
        !Array.isArray(recipe.envKeys) ||
        !Array.isArray(recipe.headerKeys) ||
        (recipe.transport === 'stdio'
          ? typeof recipe.command !== 'string'
          : typeof recipe.url !== 'string')
      )
        throw new Error('invalid recipe');
      items.push(collectedFromRecord(raw, file.slice(0, -5)));
    } catch (error) {
      issues.push({ path, error: operationError(error) });
    }
  }
  return {
    items: items.sort((a, b) => a.name.localeCompare(b.name, 'en')),
    issues,
  };
}

export async function secretStatus(
  mcp: CollectedMcp,
): Promise<Record<string, unknown>[]> {
  const secrets = mcp.secretsResetPending
    ? { env: {}, headers: {} }
    : await readMcpSecrets(mcp.name);
  const rows: Record<string, unknown>[] = [];
  for (const slot of ['env', 'headers'] as const) {
    const declared =
      slot === 'env' ? mcp.recipe.envKeys : mcp.recipe.headerKeys;
    for (const key of new Set([...declared, ...Object.keys(secrets[slot])])) {
      const stored = Object.keys(secrets[slot]).find((value) =>
        slot === 'headers'
          ? value.toLowerCase() === key.toLowerCase()
          : value === key,
      );
      rows.push({
        slot,
        key,
        declared: declared.some((value) =>
          slot === 'headers'
            ? value.toLowerCase() === key.toLowerCase()
            : value === key,
        ),
        configured: Boolean(
          stored &&
          secrets[slot][stored] &&
          !isPlaceholder(secrets[slot][stored]!),
        ),
      });
    }
  }
  if (mcp.recipe.transport !== 'stdio')
    rows.push({
      slot: 'url',
      key: 'url',
      declared: false,
      configured: Boolean(secrets.url),
    });
  return rows;
}

export function publicMcp(mcp: CollectedMcp): Record<string, unknown> {
  return {
    name: mcp.name,
    description: mcp.description,
    tags: mcp.tags,
    note: mcp.note,
    source: mcp.source,
    recipe: publicRecipe(mcp.recipe),
    ...(mcp.secretsResetPending ? { secretsResetPending: true } : {}),
  };
}

export function publicRecipe(
  recipe: CollectedMcp['recipe'],
): Record<string, unknown> {
  return {
    transport: recipe.transport,
    ...(recipe.command ? { command: recipe.command } : {}),
    ...(recipe.url ? { url: recipe.url } : {}),
    ...(recipe.args ? { args: recipe.args.map(() => '[redacted]') } : {}),
    ...(recipe.cwd ? { cwd: '[redacted]' } : {}),
    envKeys: recipe.envKeys,
    headerKeys: recipe.headerKeys,
  };
}

export function mcpSelector(entry: McpLocationEntry, project: string): string {
  return `mcp1-${Buffer.from(JSON.stringify([project, entry.agent, entry.scope, entry.ownership, entry.filePath, entry.nativeKey])).toString('base64url')}`;
}

export function publicLocation(
  entry: McpLocationEntry,
  project: string,
): Record<string, unknown> {
  const mutable = entry.ownership === 'owned' && entry.writable;
  const switchable =
    mutable ||
    (entry.ownership === 'borrowed' && ['pi', 'grok'].includes(entry.agent));
  return {
    selector: mcpSelector(entry, project),
    agent: entry.agent,
    scope: entry.scope,
    nativeKey: entry.nativeKey,
    file: entry.filePath,
    ownership: entry.ownership,
    borrowedFrom: entry.borrowedFrom ?? null,
    enabled: entry.enabled,
    recipe: publicRecipe(entry.recipe),
    canImport: true,
    canEnable: switchable,
    canDisable: switchable,
    canUpdate: mutable,
    canUninstall: mutable,
    reason: mutable
      ? null
      : entry.ownership === 'borrowed'
        ? 'borrowed'
        : 'not-writable',
  };
}

export function validateAgents(names: string[]): string[] {
  for (const name of names)
    if (!Object.hasOwn(AGENTS, name))
      throw new OperationFailure(
        'usage.unsupportedCapability',
        'Unknown Agent.',
        { agent: name },
      );
  return names.length ? names : agentIds();
}

export async function readMcpLocations(
  project: string,
  names: string[],
  scopes: McpScope[],
): Promise<{ entries: McpLocationEntry[]; issues: ReadIssue[] }> {
  const entries: McpLocationEntry[] = [];
  const issues: ReadIssue[] = [];
  const ctx = { home: homedir(), cwd: project };
  for (const name of names)
    if (!mcpAgentIds().includes(name as ReturnType<typeof mcpAgentIds>[number]))
      throw new OperationFailure(
        'usage.unsupportedCapability',
        'The Agent does not support MCP.',
        { agent: name },
      );
  for (const scope of scopes)
    for (const agent of mcpAgentIds().filter((id) =>
      validateAgents(names).includes(id),
    )) {
      try {
        const writable = await agentMcpWritable(agent, scope, ctx);
        entries.push(
          ...toLocationEntries(
            agent,
            scope,
            await readOwnedRows(agent, scope, ctx),
            'owned',
            writable,
          ),
        );
        entries.push(...(await readBorrowedEntries(agent, scope, ctx)));
      } catch (error) {
        issues.push({
          path: ownedFilePath(agent, scope, ctx) ?? agent,
          error: operationError(error),
        });
      }
    }
  return { entries, issues };
}

export async function readSkillLocations(
  project: string,
  names: string[],
  scopes: McpScope[],
  root?: string,
): Promise<OperationResult> {
  const roots = new Map<string, { agents: string[]; scope: McpScope | null }>();
  if (root) roots.set(resolve(project, root), { agents: [], scope: null });
  else
    for (const scope of scopes)
      for (const agent of validateAgents(names)) {
        const config = AGENTS[agent]!;
        if (scope === 'project' && !config.project) {
          if (names.length && scopes.length === 1)
            throw new OperationFailure(
              'usage.unsupportedCapability',
              'The Agent has no project skill directory.',
              { agent, scope },
            );
          continue;
        }
        const paths =
          scope === 'global'
            ? [config.global(homedir())]
            : [
                join(project, config.project!),
                ...(['codex', 'cursor'].includes(agent)
                  ? [join(project, `.${agent}/skills`)]
                  : []),
              ];
        for (const path of paths) {
          const previous = roots.get(path);
          roots.set(path, {
            scope,
            agents: [...(previous?.agents ?? []), agent],
          });
        }
      }
  const items: Record<string, unknown>[] = [];
  const issues: ReadIssue[] = [];
  for (const [path, context] of roots) {
    if (!(await exists(path))) continue;
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      issues.push({ path, error: operationError(error) });
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const location = join(path, entry.name);
      try {
        const linked = (await lstat(location)).isSymbolicLink();
        let kind = linked ? 'external-link' : 'local';
        let collectionName: string | null = null;
        let name = entry.name;
        if (linked && !(await exists(location))) kind = 'broken-link';
        else {
          const skill = await readSkill(location);
          name = skill.name;
          const actual = await realpath(location);
          if (
            linked &&
            actual ===
              (await realpath(join(collectionPaths().skills, skill.name)).catch(
                () => '',
              ))
          ) {
            kind = 'collection-reference';
            collectionName = skill.name;
          }
        }
        items.push({
          path: location,
          name,
          ...context,
          kind,
          collectionName,
          canUninstall: true,
          canMaterialize:
            context.scope === 'project' &&
            !['local', 'broken-link'].includes(kind),
          canInstallAcrossAgents:
            context.scope !== null &&
            ['local', 'collection-reference'].includes(kind),
          reason: kind === 'broken-link' ? 'broken-link' : null,
        });
      } catch (error) {
        issues.push({ path: location, error: operationError(error) });
      }
    }
  }
  return readResult({ items }, issues);
}

export async function readAgents(project: string): Promise<OperationResult> {
  const ctx = { cwd: project, home: homedir() };
  const items = [];
  for (const id of agentIds()) {
    const config = AGENTS[id]!;
    const mcp = {} as Record<string, unknown>;
    for (const scope of ['project', 'global'] as const) {
      const mcpId = mcpAgentIds().find((value) => value === id)!;
      const file = ownedFilePath(mcpId, scope, ctx);
      const writable = await agentMcpWritable(mcpId, scope, ctx);
      mcp[scope] = {
        file: file ?? null,
        supported: Boolean(file),
        writable,
        reason: writable ? null : 'not-present-or-unsupported',
      };
    }
    items.push({
      id,
      present: await isAgentPresent(id),
      skills: {
        project: {
          supported: Boolean(config.project),
          path: config.project ? join(project, config.project) : null,
        },
        global: { supported: true, path: config.global(homedir()) },
      },
      mcp,
    });
  }
  return readResult({ items });
}

export async function optionalGit(
  root: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    return await runGit(['-C', root, ...args], signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export async function readStatus(
  signal?: AbortSignal,
): Promise<OperationResult> {
  const paths = collectionPaths();
  const repository = await exists(join(paths.root, '.git'));
  const issues: ReadIssue[] = [];
  let state;
  try {
    state = await readState();
  } catch (error) {
    issues.push({ path: paths.state, error: operationError(error) });
    state = { conflicts: [], links: [] };
  }
  const git = repository
    ? {
        repository: true,
        branch: await optionalGit(
          paths.root,
          ['symbolic-ref', '--short', 'HEAD'],
          signal,
        ),
        origin: await optionalGit(
          paths.root,
          ['remote', 'get-url', 'origin'],
          signal,
        ),
        dirty: Boolean(
          await runGit(['-C', paths.root, 'status', '--porcelain'], signal),
        ),
        merge: await exists(join(paths.root, '.git/MERGE_HEAD')),
        rebase:
          (await exists(join(paths.root, '.git/rebase-merge'))) ||
          (await exists(join(paths.root, '.git/rebase-apply'))),
      }
    : {
        repository: false,
        branch: null,
        origin: null,
        dirty: false,
        merge: false,
        rebase: false,
      };
  const skills = await readSkills();
  const mcps = await readMcps();
  issues.push(...skills.issues, ...mcps.issues);
  return readResult(
    {
      collection: { initialized: await exists(paths.skills), path: paths.root },
      git,
      conflicts: state.conflicts,
      missingMetadata: await listCollectionSkillsMissingMetadata(),
    },
    issues,
  );
}

/** Clone in a disposable directory; no collection state, cache, or logging is touched. */
export async function inspectGitSource(
  input: string,
  signal?: AbortSignal,
  full = false,
): Promise<GitImportContext> {
  const parsed = parseGitSource(input);
  const temporary = await mkdtemp(join(tmpdir(), 'iskills-source-'));
  const repository = join(temporary, 'repository');
  const pinned = Boolean(parsed.ref && /^[0-9a-f]{7,40}$/i.test(parsed.ref));
  try {
    await runGit(
      [
        'clone',
        '--quiet',
        ...(!pinned && !full ? ['--depth', '1'] : []),
        ...(parsed.ref && !pinned ? ['--branch', parsed.ref] : []),
        '--',
        parsed.url,
        repository,
      ],
      signal,
    );
    if (pinned)
      await runGit(
        ['-C', repository, 'checkout', '--quiet', parsed.ref!],
        signal,
      );
    const commit = await runGit(
      ['-C', repository, 'rev-parse', 'HEAD'],
      signal,
    );
    const branch = await optionalGit(
      repository,
      ['symbolic-ref', '--short', 'HEAD'],
      signal,
    );
    const tags = await runGit(
      ['-C', repository, 'tag', '--points-at', 'HEAD'],
      signal,
    );
    return {
      temporary,
      repository,
      source: {
        type: 'git',
        url: parsed.url,
        commit,
        ...(parsed.ref || branch ? { ref: parsed.ref ?? branch! } : {}),
        refType: pinned
          ? 'commit'
          : parsed.ref && tags.split('\n').includes(parsed.ref)
            ? 'tag'
            : 'branch',
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function readDiscovery(
  project: string,
  input: { git?: string; local?: string },
  signal?: AbortSignal,
): Promise<OperationResult> {
  const cloned = input.git
    ? await inspectGitSource(input.git, signal)
    : undefined;
  const root = cloned?.repository ?? resolve(project, input.local!);
  try {
    if (!(await exists(root)))
      throw new OperationFailure(
        'usage.invalidLocation',
        'The source directory does not exist.',
        { path: root },
      );
    const collection = await readSkills();
    const skills = await discoverSkills(root);
    const items = [];
    for (const skill of skills) {
      await validateSkillTree(await realpath(skill.path));
      const path = relative(root, skill.path) || '.';
      const source = cloned
        ? { ...cloned.source, path }
        : { type: 'local', path: await realpath(skill.path) };
      const meta: SkillMetadata = {
        name: skill.name,
        description: skill.description,
        tags: [],
        note: '',
        source,
      };
      const existing = collection.items.find(
        (item) => item.name === skill.name,
      );
      items.push({
        name: skill.name,
        description: skill.description,
        path,
        duplicateName:
          skills.filter((item) => item.name === skill.name).length > 1,
        collectedMatch: existing
          ? await classifyCollectionMatch(existing, meta)
          : 'not-collected',
      });
    }
    return readResult(
      {
        ...(cloned
          ? {
              source: {
                ...cloned.source,
                resolvedCommit: cloned.source.commit,
              },
            }
          : { root }),
        items,
      },
      collection.issues,
    );
  } finally {
    if (cloned) await rm(cloned.temporary, { recursive: true, force: true });
  }
}

export async function readSearch(
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<OperationResult> {
  const url = new URL(
    '/api/search',
    process.env.SKILLS_API_URL ?? 'https://skills.sh',
  );
  url.search = new URLSearchParams({
    q: query,
    limit: String(limit),
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
  } catch {
    throw new OperationFailure(
      'execution.networkFailed',
      'The search request failed.',
      { stage: 'search', timeoutMs: 30_000 },
      1,
    );
  }
  if (!response.ok)
    throw new OperationFailure(
      'execution.networkFailed',
      'The search provider returned an error.',
      { status: response.status },
      1,
    );
  const payload = (await response.json()) as { skills?: unknown };
  if (!Array.isArray(payload.skills))
    throw new OperationFailure(
      'execution.readFailed',
      'The search response is invalid.',
      {},
      1,
    );
  const collection = await readSkills();
  const items = payload.skills.flatMap((raw) => {
    const item = raw as {
      name?: unknown;
      source?: unknown;
      id?: unknown;
      installs?: unknown;
    };
    if (
      typeof item.name !== 'string' ||
      typeof item.source !== 'string' ||
      typeof item.id !== 'string' ||
      !/^[\w.-]+\/[\w.-]+$/.test(item.source)
    )
      return [];
    return [
      {
        name: item.name,
        source: item.source,
        git: `https://github.com/${item.source}.git`,
        resultId: item.id,
        installs: typeof item.installs === 'number' ? item.installs : null,
        collectedMatch:
          classifyPreCloneCollectionMatch(
            collection.items,
            item.name,
            item.source,
          ) ?? 'not-collected',
      },
    ];
  });
  return readResult(
    { items: items.slice(0, limit), truncated: items.length >= limit },
    collection.issues,
  );
}
