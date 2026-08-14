import { execFileSync, spawn } from 'node:child_process';
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type {
  AgentConfig,
  CollectedSkill,
  CollectionMatch,
  CollectionPaths,
  CollectionState,
  LockEntry,
  LockFile,
  ParsedGitSource,
  Skill,
  SkillMetadata,
  SkillSource,
} from './types.js';
import { DomainError, domainNotify } from './errors.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__']);

/**
 * English product names for install/review UI (ids remain CLI --agent values).
 * Localized `agents` label is applied at the presentation boundary via
 * `agentInstallTargets(..., displayName)`.
 */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  pi: 'Pi',
  zcode: 'ZCode',
  trae: 'TRAE',
  qoder: 'Qoder',
  grok: 'Grok Build',
};

/** English fallback for the shared agents skills layout (override with i18n at UI). */
const AGENTS_DISPLAY_FALLBACK = 'Standard Agent Skills';

export const AGENTS: Record<string, AgentConfig> = {
  agents: { project: '.agents/skills', global: (home) => join(home, '.agents/skills') },
  codex: { project: '.agents/skills', global: (home) => join(home, '.codex/skills') },
  claude: { project: '.claude/skills', global: (home) => join(home, '.claude/skills') },
  cursor: { project: '.agents/skills', global: (home) => join(home, '.cursor/skills') },
  opencode: {
    project: '.opencode/skills',
    global: (home) => join(home, '.config/opencode/skills'),
  },
  pi: {
    global: (home) => join(home, '.pi/agent/skills'),
    root: (home) => join(home, '.pi'),
  },
  zcode: { project: '.zcode/skills', global: (home) => join(home, '.zcode/skills') },
  trae: { project: '.trae/skills', global: (home) => join(home, '.trae/skills') },
  qoder: { project: '.qoder/skills', global: (home) => join(home, '.qoder/skills') },
  grok: { project: '.grok/skills', global: (home) => join(home, '.grok/skills') },
};

/** Native layouts still scanned even when install project path differs (codex/cursor → .agents/skills). */
const EXTRA_PROJECT_SCAN_DIRS = ['.codex/skills', '.cursor/skills'] as const;

function uniqueProjectSkillDirs(): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const agent of Object.values(AGENTS)) {
    if (!agent.project || seen.has(agent.project)) continue;
    seen.add(agent.project);
    dirs.push(agent.project);
  }
  for (const directory of EXTRA_PROJECT_SCAN_DIRS) {
    if (seen.has(directory)) continue;
    seen.add(directory);
    dirs.push(directory);
  }
  return dirs;
}

/** Project-relative skill dirs for scan/list; derived from AGENTS (+ legacy native layouts). */
export const PROJECT_SKILL_DIRS: readonly string[] = uniqueProjectSkillDirs();

/** CLI `--agent` ids in table order (single source for help text). */
export function agentIds(): string[] {
  return Object.keys(AGENTS);
}

/** When no tool root is present and the user did not pass `--agent`. */
export function noPresentAgentsError(): DomainError {
  return new DomainError('cmd.noPresentAgents');
}

export function getAgent(name: string): AgentConfig {
  const agent = AGENTS[name];
  if (!agent) throw new DomainError('cmd.unknownAgent', { name });
  return agent;
}

/** Display label for an agent id (English fallback; pass i18n for `agents` at UI). */
export function agentDisplayName(name: string): string {
  if (name === 'agents') return AGENTS_DISPLAY_FALLBACK;
  return AGENT_DISPLAY_NAMES[name] ?? name;
}

/** Tool root used for “installed on this machine” presence (directory exists). */
export function agentRoot(config: AgentConfig, home: string): string {
  return config.root ? config.root(home) : dirname(config.global(home));
}

export async function isAgentPresent(name: string, home = homedir()): Promise<boolean> {
  const agent = AGENTS[name];
  if (!agent) return false;
  return exists(agentRoot(agent, home));
}

/** Agents whose tool root exists under home (for interactive lists / default scan scope). */
export async function listPresentAgents(home = homedir()): Promise<string[]> {
  const present: string[] = [];
  for (const name of agentIds()) {
    if (await isAgentPresent(name, home)) present.push(name);
  }
  return present;
}

export function agentGlobalPath(name: string, home = homedir()): string {
  return getAgent(name).global(home);
}

export function agentProjectPath(name: string): string {
  const agent = getAgent(name);
  if (!agent.project) {
    throw new DomainError('cmd.agentGlobalOnly', { name });
  }
  return resolve(agent.project);
}

/** Same shape as install UI targets; domain owns the data, UI may `import type`. */
export interface AgentInstallTarget {
  value: string;
  projectLabel?: string;
  globalLabel?: string;
}

function tildeHomePath(absolute: string, home: string): string {
  const prefix = home.endsWith(sep) ? home : `${home}${sep}`;
  if (absolute === home || absolute === home.replace(/\/$/, '')) return '~';
  if (absolute.startsWith(prefix)) {
    return `~/${absolute.slice(prefix.length).split(sep).join('/')}`;
  }
  return absolute;
}

/**
 * Install-review rows for agent ids (order preserved).
 * Shared project paths (e.g. agents/codex/cursor → `.agents/skills`) keep one projectLabel
 * on the first id so the project tab does not list the same destination thrice.
 * Global rows stay one-per-agent (paths differ).
 */
export function agentInstallTargets(
  names: string[],
  home = homedir(),
  displayName: (name: string) => string = agentDisplayName
): AgentInstallTarget[] {
  const seenProject = new Set<string>();
  return names.map((name) => {
    const agent = getAgent(name);
    const label = displayName(name);
    const globalPath = tildeHomePath(agent.global(home), home);
    let projectLabel: string | undefined;
    if (agent.project && !seenProject.has(agent.project)) {
      seenProject.add(agent.project);
      projectLabel = `${label} (${agent.project})`;
    }
    return {
      value: name,
      ...(projectLabel ? { projectLabel } : {}),
      globalLabel: `${label} (${globalPath})`,
    };
  });
}

/** Prefer a single primary default among present agents (agents first, else table order). */
export function primaryPresentAgent(present: string[]): string | undefined {
  if (present.includes('agents')) return 'agents';
  return present[0];
}

export function collectionPaths(): CollectionPaths {
  const root = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'iskills');
  return {
    root,
    skills: join(root, 'skills'),
    metadata: join(root, 'metadata'),
    local: join(root, '.local'),
    state: join(root, '.local/state.json'),
    collectionConflict: join(root, '.local/collection-conflict.json'),
  };
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const execError = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
    const stderr = typeof execError.stderr === 'string'
      ? execError.stderr
      : Buffer.isBuffer(execError.stderr)
        ? execError.stderr.toString('utf8')
        : '';
    const stdout = typeof execError.stdout === 'string'
      ? execError.stdout
      : Buffer.isBuffer(execError.stdout)
        ? execError.stdout.toString('utf8')
        : '';
    const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n').trim();
    if (detail) return detail;
    if (typeof execError.message === 'string' && execError.message) return execError.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function pathPresent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Paths collection Git add/status should cover when the files exist. */
const COLLECTION_GIT_BASE_PATHS = ['skills', 'metadata', '.gitignore'] as const;

async function readGitignoreText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Keep `.local/` ignored; never ignore `config.json` (it is collection Git content). */
export function nextCollectionGitignore(existing: string | undefined): string {
  const required = ['.local/'];
  const drop = new Set(['config.json']);
  const lines = existing === undefined ? [] : existing.split(/\r?\n/);
  const kept: string[] = [];
  const present = new Set<string>();
  for (const line of lines) {
    if (drop.has(line)) continue;
    kept.push(line);
    if (line) present.add(line);
  }
  const missing = required.filter((line) => !present.has(line));
  let next = kept.join('\n');
  if (missing.length) {
    if (next && !next.endsWith('\n')) next += '\n';
    next += `${missing.join('\n')}\n`;
  } else if (next && !next.endsWith('\n')) {
    next += '\n';
  }
  return next || `${required.join('\n')}\n`;
}

/** `git add` pathspecs: include `config.json` only when the file exists. */
export async function collectionGitAddPaths(root: string): Promise<string[]> {
  const paths: string[] = [...COLLECTION_GIT_BASE_PATHS];
  if (await exists(join(root, 'config.json'))) paths.push('config.json');
  return paths;
}

/** `git status` pathspecs: always include `config.json` so a missing tracked file is visible. */
export function collectionGitStatusPaths(): string[] {
  return [...COLLECTION_GIT_BASE_PATHS, 'config.json'];
}

export async function ensureCollection(): Promise<CollectionPaths> {
  const paths = collectionPaths();
  await Promise.all([
    mkdir(paths.skills, { recursive: true }),
    mkdir(paths.metadata, { recursive: true }),
    mkdir(paths.local, { recursive: true }),
  ]);

  const gitignore = join(paths.root, '.gitignore');
  const existingIgnore = await readGitignoreText(gitignore);
  const nextIgnore = nextCollectionGitignore(existingIgnore);
  if (existingIgnore !== nextIgnore) await writeFile(gitignore, nextIgnore);
  if (!(await exists(paths.state))) await writeJson(paths.state, { links: [], conflicts: [] });
  return paths;
}

export function assertSkillName(name: string): string {
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    throw new DomainError('domain.unsafeSkillName', { name });
  }
  return name;
}

export function assertRelativePath(path: string): string {
  const normalized = (path || '.').replace(/\\/g, '/').replace(/^\.\//, '') || '.';
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new DomainError('domain.unsafeSourcePath', { path });
  }
  return normalized;
}

export function sourceSkillFile(path: string): string {
  return path === '.' ? 'SKILL.md' : `${path}/SKILL.md`;
}

export function sanitizeTerminal(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
}

export function normalizeGitRepositoryIdentity(value: string): string {
  const scp = value.includes('://') ? null : value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  const candidate = scp ? `ssh://${scp[1]}/${scp[2]}` : value;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const defaultPort = url.protocol === 'ssh:' ? '22' : url.protocol === 'git:' ? '9418' : '';
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
    let path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
    if (host === 'github.com') path = path.toLowerCase();
    return `${host}${port}/${path}`;
  } catch {
    return value.replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase();
  }
}

export function sameGitIdentity(current: SkillMetadata, incoming: SkillMetadata): boolean {
  return current.source.type === 'git' &&
    incoming.source.type === 'git' &&
    !!current.source.url &&
    !!incoming.source.url &&
    normalizeGitRepositoryIdentity(current.source.url) ===
      normalizeGitRepositoryIdentity(incoming.source.url) &&
    (current.source.path || '.') === (incoming.source.path || '.');
}

/** realpath for identity; returns undefined when path cannot be resolved. */
export async function tryRealpath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

/** Resolve identity path: realpath when readable, else absolute resolve (for storage only). */
export async function resolveIdentityPath(path: string): Promise<string> {
  return (await tryRealpath(path)) ?? resolve(path);
}

/**
 * Local 同源: both sources are local with paths; compare realpath (invariant).
 * Returns undefined when either side cannot realpath — cannot prove conflict either.
 */
export async function sameLocalIdentity(
  current: SkillMetadata,
  incoming: SkillMetadata
): Promise<boolean | undefined> {
  if (current.source.type !== 'local' || incoming.source.type !== 'local') return undefined;
  if (!current.source.path || !incoming.source.path) return undefined;
  const left = await tryRealpath(current.source.path);
  const right = await tryRealpath(incoming.source.path);
  if (left === undefined || right === undefined) return undefined;
  return left === right;
}

/**
 * Classify same-name collection relation (git + local realpath).
 * Unknown / mixed provenance → `unverified-source` (not the same as confirmed conflict).
 */
export async function classifyCollectionMatch(
  current: SkillMetadata,
  incoming: SkillMetadata
): Promise<CollectionMatch> {
  if (sameGitIdentity(current, incoming)) return 'same-source';
  if (
    current.source.type === 'git' &&
    incoming.source.type === 'git' &&
    current.source.url &&
    incoming.source.url
  ) {
    return 'conflicting-source';
  }
  const localSame = await sameLocalIdentity(current, incoming);
  if (localSame === true) return 'same-source';
  if (localSame === false) return 'conflicting-source';
  return 'unverified-source';
}

/**
 * Build incoming provenance for a candidate skill.
 * Prefer explicit skill.source, then lock files, then local absolute path.
 * Git import context overrides path to the in-repo relative location.
 */
export async function resolveIncomingProvenance(
  skill: Skill,
  gitContext?: { repository: string; source: SkillSource }
): Promise<SkillSource> {
  if (gitContext) {
    const rel = relative(gitContext.repository, skill.path).split(sep).join('/');
    return {
      ...gitContext.source,
      path: assertRelativePath(rel || '.'),
    };
  }
  if (skill.source?.type === 'local' && skill.source.path) {
    return { type: 'local', path: await resolveIdentityPath(skill.source.path) };
  }
  if (skill.source?.type) return skill.source;
  const lockSource = await provenanceFromKnownLocks(skill);
  if (lockSource.type && lockSource.type !== 'unknown') return lockSource;
  return { type: 'local', path: await resolveIdentityPath(skill.path) };
}

/**
 * Pre-clone match (e.g. skills.sh): repository identity is known, in-repo path is not.
 * Never returns `same-source` — only a different repository is conclusive before clone.
 */
export function classifyPreCloneCollectionMatch(
  collection: CollectedSkill[],
  skillName: string,
  repositoryUrlOrIdentity: string
): CollectionMatch | undefined {
  const collected = collection.find(
    (item) => item.name.toLowerCase() === skillName.toLowerCase()
  );
  if (!collected) return undefined;
  const collectedRepository =
    collected.source.type === 'git' && collected.source.url
      ? normalizeGitRepositoryIdentity(collected.source.url)
      : undefined;
  const incomingRepository = normalizeGitRepositoryIdentity(repositoryUrlOrIdentity);
  return collectedRepository && collectedRepository !== incomingRepository
    ? 'conflicting-source'
    : 'unverified-source';
}

async function collectedByRealpath(): Promise<Map<string, CollectedSkill>> {
  const map = new Map<string, CollectedSkill>();
  for (const skill of await listCollection()) {
    try {
      map.set(await realpath(skill.path), skill);
    } catch {
      /* ignore unreadable collection paths */
    }
  }
  return map;
}

/** Annotate discovered skills with collection membership via realpath. */
export async function annotateSkillsAgainstCollection(
  skills: Skill[],
  collectedByPath?: Map<string, CollectedSkill>
): Promise<Skill[]> {
  const map = collectedByPath ?? (await collectedByRealpath());
  return Promise.all(
    skills.map(async (skill) => {
      try {
        const collected = map.get(await realpath(skill.path));
        return collected
          ? {
              ...collected,
              path: skill.path,
              fromCollection: true,
              isReference: Boolean(skill.isReference),
            }
          : { ...skill, fromCollection: false };
      } catch {
        return { ...skill, fromCollection: false };
      }
    })
  );
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function readSkill(path: string): Promise<Skill> {
  const raw = await readFile(join(path, 'SKILL.md'), 'utf8');
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '';
  const fields: Record<string, string> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match?.[1] || match[2] === undefined) continue;
    if (/^[>|][+-]?$/.test(match[2].trim())) {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1] ?? '')) {
        block.push((lines[++index] ?? '').trim());
      }
      fields[match[1]] = match[2].startsWith('>') ? block.join(' ') : block.join('\n');
    } else {
      fields[match[1]] = parseScalar(match[2]);
    }
  }
  const name = assertSkillName(fields.name || basename(path));
  return {
    name,
    description: sanitizeTerminal(fields.description || ''),
    path: resolve(path),
    isReference: (await lstat(path)).isSymbolicLink(),
  };
}

export async function validateSkillTree(root: string, current = root): Promise<void> {
  const rootPath = resolve(root);
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path));
      if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
        throw new DomainError('domain.symlinkEscapesTree', { path });
      }
    } else if (entry.isDirectory() && entry.name !== '.git') {
      await validateSkillTree(root, path);
    }
  }
}

export async function discoverSkills(
  root: string,
  depth = 0,
  maxDepth = 5
): Promise<Skill[]> {
  if (depth > maxDepth || !(await exists(root))) return [];
  if (await exists(join(root, 'SKILL.md'))) return [await readSkill(root)];

  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(
        (entry) =>
          (entry.isDirectory() || entry.isSymbolicLink()) && !SKIP_DIRS.has(entry.name)
      )
      .map(async (entry): Promise<Skill[]> => {
        const child = join(root, entry.name);
        // ponytail: only follow a symlink when it is already a Skill; never recurse through it.
        if (entry.isSymbolicLink()) {
          return (await exists(join(child, 'SKILL.md'))) ? [await readSkill(child)] : [];
        }
        return discoverSkills(child, depth + 1, maxDepth);
      })
  );
  return nested.flat();
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export function metadataPath(name: string): string {
  return join(collectionPaths().metadata, `${assertSkillName(name)}.json`);
}

export function baselinePath(name: string): string {
  return join(collectionPaths().local, 'baselines', assertSkillName(name));
}

export async function readMetadata(name: string): Promise<SkillMetadata> {
  return readJson(metadataPath(name), {
    name,
    description: '',
    tags: [],
    note: '',
    source: { type: 'unknown' },
  });
}

export async function writeMetadata(metadata: SkillMetadata): Promise<void> {
  await writeJson(metadataPath(metadata.name), metadata);
}

export async function readState(): Promise<CollectionState> {
  const paths = collectionPaths();
  // Collection Git health is live-probed (see probeCollectionHealth); only source
  // update workspaces are persisted under conflicts.
  const state = await readJson<CollectionState>(paths.state, { links: [], conflicts: [] });
  return {
    ...state,
    conflicts: state.conflicts.filter((conflict) => conflict.type !== 'collection'),
  };
}

export async function writeState(state: CollectionState): Promise<void> {
  const links = new Map<string, CollectionState['links'][number]>();
  for (const link of state.links) links.set(`${link.skill}\0${resolve(link.path)}`, link);
  await writeJson(collectionPaths().state, {
    ...state,
    links: [...links.values()],
    conflicts: state.conflicts.filter((conflict) => conflict.type !== 'collection'),
  });
}

export function isGitSource(input: string): boolean {
  return (
    /^(?:https?|ssh|file):\/\//.test(input) ||
    input.startsWith('git@') ||
    input.startsWith('github:') ||
    input.startsWith('gitlab:') ||
    /^(?!\.{1,2}\/)[^/\s]+\/[^/\s]+(?:#.+)?$/.test(input)
  );
}

export function parseGitSource(input: string): ParsedGitSource {
  let value = input;
  let ref: string | undefined;
  const hash = value.lastIndexOf('#');
  if (hash > value.indexOf('://') + 2) {
    ref = value.slice(hash + 1) || undefined;
    value = value.slice(0, hash);
  }
  if (value.startsWith('github:')) value = `https://github.com/${value.slice(7)}`;
  if (value.startsWith('gitlab:')) value = `https://gitlab.com/${value.slice(7)}`;
  if (/^(?!\.{1,2}\/)[^/:\s]+\/[^/\s]+$/.test(value)) {
    value = `https://github.com/${value}`;
  }
  return ref ? { url: value, ref } : { url: value };
}

function normalizeLockGitSource(entry: LockEntry): SkillSource {
  const sourceType = entry.sourceType || 'unknown';
  let url = entry.sourceUrl || entry.source;
  let ref = entry.ref;
  let skillPath = entry.skillPath;
  if (!url) return { type: sourceType, id: entry.source || 'unknown' };
  if (!/^(?:https?|ssh|file):\/\//.test(url) && !url.startsWith('git@')) {
    if (sourceType === 'github') url = `https://github.com/${url}`;
    else if (sourceType === 'gitlab') url = `https://gitlab.com/${url}`;
  }
  const githubTree = url.match(
    /^(https?:\/\/github\.com\/[^/]+\/[^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.*))?$/
  );
  if (githubTree?.[1]) {
    url = githubTree[1];
    ref ||= githubTree[2];
    skillPath ||= githubTree[3];
  }
  skillPath = skillPath === 'SKILL.md' ? '.' : skillPath?.replace(/\/SKILL\.md$/, '');
  if (!isGitSource(url) || !skillPath) {
    return {
      type: sourceType,
      id: entry.source || url,
      url,
      ...(ref ? { ref } : {}),
      ...(skillPath ? { path: skillPath } : {}),
    };
  }
  return {
    type: 'git',
    url,
    refType: 'branch',
    path: assertRelativePath(skillPath),
    importedFromLock: true,
    ...(ref ? { ref } : {}),
  };
}

export async function provenanceFromKnownLocks(skill: Skill): Promise<SkillSource> {
  let directory = resolve(skill.path);
  while (true) {
    let lock: LockFile | null = null;
    try {
      lock = await readJson<LockFile | null>(join(directory, 'skills-lock.json'), null);
    } catch {}
    const entry = lock?.skills?.[skill.name];
    if (entry) return normalizeLockGitSource(entry);
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  const globalLock = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, 'skills/.skill-lock.json')
    : join(homedir(), '.agents/.skill-lock.json');
  let lock: LockFile | null = null;
  try {
    lock = await readJson<LockFile | null>(globalLock, null);
  } catch {}
  const entry = lock?.skills?.[skill.name];
  return entry ? normalizeLockGitSource(entry) : { type: 'unknown' };
}

export async function moveDirectory(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(from, to, { recursive: true, errorOnExist: true });
    await rm(from, { recursive: true });
  }
}

export async function clearDirectory(path: string, keepGit = false): Promise<void> {
  await mkdir(path, { recursive: true });
  for (const entry of await readdir(path)) {
    if (keepGit && entry === '.git') continue;
    await rm(join(path, entry), { recursive: true, force: true });
  }
}

export async function copyDirectoryContents(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (entry === '.git') continue;
    await cp(join(from, entry), join(to, entry), { recursive: true, errorOnExist: true });
  }
}

export async function isExactSymlink(path: string, target: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return false;
    const rawTarget = await readlink(path);
    const [actual, expected] = await Promise.all([
      realpath(resolve(dirname(path), rawTarget)),
      realpath(target),
    ]);
    return actual === expected;
  } catch {
    return false;
  }
}

/** Detached child: push/pull collection after commit without blocking the CLI. */
function startBackgroundSync(): void {
  if (process.env.SK_NO_BACKGROUND_SYNC === '1' || process.env.SK_SYNC_CHILD === '1') return;
  // Spawn Node once with domain/git — no dedicated entry wrapper file.
  const gitHref = new URL('./git.js', import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import(${JSON.stringify(gitHref)}).then((m) => m.backgroundCollectionSync())`,
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, SK_SYNC_CHILD: '1' },
    }
  );
  child.unref();
}

/**
 * Post-write collection Git commit (soft-fail by default).
 * @returns true when no commit failure (including no .git / no changes); false after soft-fail notify.
 * Callers MUST NOT print 已收藏 / 已导入 / 已删除 success lines when this returns false.
 * @param backgroundSync When false, skip spawning the detached push/pull child (e.g. before
 *   an explicit foreground `syncCollection`). Default true.
 */
export async function commitCollection(
  message: string,
  strict = false,
  backgroundSync = true
): Promise<boolean> {
  const { root } = collectionPaths();
  if (!(await exists(join(root, '.git')))) return true;
  try {
    execFileSync(
      'git',
      ['-C', root, 'add', '-A', '--', ...(await collectionGitAddPaths(root))],
      { stdio: 'ignore' }
    );
    const changed = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain', '--', ...collectionGitStatusPaths()],
      { encoding: 'utf8' }
    ).trim();
    if (changed) {
      execFileSync('git', ['-C', root, 'commit', '-m', message], { stdio: 'ignore' });
      if (backgroundSync) startBackgroundSync();
    }
    return true;
  } catch (error) {
    if (strict) throw error;
    domainNotify('domain.gitCommitFailed', { error: errorMessage(error) });
    return false;
  }
}

export async function listCollection(): Promise<CollectedSkill[]> {
  const paths = collectionPaths();
  if (!(await exists(paths.skills))) return [];
  const entries = await readdir(paths.skills, { withFileTypes: true });
  const skills: CollectedSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !(await exists(join(paths.skills, entry.name, 'SKILL.md')))) continue;
    const skill = await readSkill(join(paths.skills, entry.name));
    const metadata = await readMetadata(skill.name);
    skills.push({ ...metadata, path: skill.path, description: skill.description });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listProjectGroups(cwd = process.cwd()): Promise<
  { agent: string; skills: Skill[] }[]
> {
  const collectedByPath = await collectedByRealpath();
  return Promise.all(PROJECT_SKILL_DIRS.map(async (directory) => {
    const skills = await annotateSkillsAgainstCollection(
      await discoverSkills(join(cwd, directory), 0, 2),
      collectedByPath
    );
    return {
      agent: directory.split('/')[0]!.slice(1),
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }));
}

export async function listGlobalGroups(
  names: string[] = [],
  home = homedir()
): Promise<{ agent: string; root: string; skills: Skill[] }[]> {
  const collectedByPath = await collectedByRealpath();
  const selected = names.length
    ? names.map((name) => ({ name, agent: getAgent(name) }))
    : (await listPresentAgents(home)).map((name) => ({ name, agent: getAgent(name) }));
  const groups: { agent: string; root: string; skills: Skill[] }[] = [];
  for (const { name, agent } of selected) {
    const root = agent.global(home);
    const skills = await annotateSkillsAgainstCollection(
      await discoverSkills(root),
      collectedByPath
    );
    groups.push({
      agent: name,
      root,
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups.sort((a, b) => a.agent.localeCompare(b.agent));
}

