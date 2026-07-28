import { execFileSync, spawn } from 'node:child_process';
import {
  access,
  appendFile,
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
import { basename, dirname, join, resolve, sep } from 'node:path';
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

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '__pycache__']);

/** Display names for install/review UI; ids remain CLI --agent values. */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  agents: '标准 Agent Skills',
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
export const NO_PRESENT_AGENTS_ERROR =
  '未检测到已安装的 Agent 根目录，请使用 --agent 指定';

export function getAgent(name: string): AgentConfig {
  const agent = AGENTS[name];
  if (!agent) throw new Error(`未知 Agent：${name}`);
  return agent;
}

function agentDisplayName(name: string): string {
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
    throw new Error(`Agent ${name} 只支持全局 Skill 目录，请使用 --global`);
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
  home = homedir()
): AgentInstallTarget[] {
  const seenProject = new Set<string>();
  return names.map((name) => {
    const agent = getAgent(name);
    const label = agentDisplayName(name);
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

export async function ensureCollection(): Promise<CollectionPaths> {
  const paths = collectionPaths();
  await Promise.all([
    mkdir(paths.skills, { recursive: true }),
    mkdir(paths.metadata, { recursive: true }),
    mkdir(paths.local, { recursive: true }),
  ]);

  const gitignore = join(paths.root, '.gitignore');
  if (!(await exists(gitignore))) {
    await writeFile(gitignore, '.local/\n', 'utf8');
  } else if (!(await readFile(gitignore, 'utf8')).split(/\r?\n/).includes('.local/')) {
    await appendFile(gitignore, '\n.local/\n', 'utf8');
  }
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
    throw new Error(`不安全的技能名称：${name}`);
  }
  return name;
}

export function assertRelativePath(path: string): string {
  const normalized = (path || '.').replace(/\\/g, '/').replace(/^\.\//, '') || '.';
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`不安全的来源子路径：${path}`);
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

export function classifyCollectionMatch(
  current: SkillMetadata,
  incoming: SkillMetadata
): CollectionMatch {
  if (sameGitIdentity(current, incoming)) return 'same-source';
  const comparable = current.source.type === 'git' &&
    incoming.source.type === 'git' &&
    !!current.source.url &&
    !!incoming.source.url;
  return comparable ? 'conflicting-source' : 'unverified-source';
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
        throw new Error(`技能包含逃出目录的软链：${path}`);
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
  const state = await readJson<CollectionState>(paths.state, { links: [], conflicts: [] });
  const collectionConflict = await readJson<CollectionState['conflicts'][number] | null>(
    paths.collectionConflict,
    null
  );
  if (collectionConflict) {
    state.conflicts = state.conflicts.filter((conflict) => conflict.type !== 'collection');
    state.conflicts.push(collectionConflict);
  }
  return state;
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

export async function commitCollection(message: string, strict = false): Promise<void> {
  const { root } = collectionPaths();
  if (!(await exists(join(root, '.git')))) return;
  try {
    execFileSync('git', ['-C', root, 'add', '-A', '--', 'skills', 'metadata', '.gitignore'], {
      stdio: 'ignore',
    });
    const changed = execFileSync(
      'git',
      ['-C', root, 'status', '--porcelain', '--', 'skills', 'metadata', '.gitignore'],
      { encoding: 'utf8' }
    ).trim();
    if (changed) {
      execFileSync('git', ['-C', root, 'commit', '-m', message], { stdio: 'ignore' });
      startBackgroundSync();
    }
  } catch (error) {
    if (strict) throw error;
    console.error(`警告：收藏夹 Git 提交失败：${errorMessage(error)}`);
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
  const collectedByPath = new Map<string, CollectedSkill>();
  for (const skill of await listCollection()) {
    try {
      collectedByPath.set(await realpath(skill.path), skill);
    } catch {}
  }
  return Promise.all(PROJECT_SKILL_DIRS.map(async (directory) => {
    const skills = await Promise.all(
      (await discoverSkills(join(cwd, directory), 0, 2)).map(async (skill) => {
        try {
          const collected = collectedByPath.get(await realpath(skill.path));
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
    return {
      agent: directory.split('/')[0]!.slice(1),
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }));
}

export async function listProject(cwd = process.cwd()): Promise<Skill[]> {
  const found: Skill[] = [];
  const seen = new Set<string>();
  for (const group of await listProjectGroups(cwd)) {
    for (const skill of group.skills) {
      let key = skill.path;
      try {
        key = await realpath(skill.path);
      } catch {}
      if (!seen.has(key)) {
        seen.add(key);
        found.push(skill);
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

