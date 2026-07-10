import { execFileSync, spawn } from 'node:child_process';
import {
  access,
  appendFile,
  cp,
  lstat,
  mkdir,
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

export const PROJECT_SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.cursor/skills',
  '.opencode/skills',
] as const;

export const AGENTS: Record<string, AgentConfig> = {
  agents: { project: '.agents/skills', global: (home) => join(home, '.agents/skills') },
  codex: { project: '.agents/skills', global: (home) => join(home, '.codex/skills') },
  claude: { project: '.claude/skills', global: (home) => join(home, '.claude/skills') },
  cursor: { project: '.agents/skills', global: (home) => join(home, '.cursor/skills') },
  opencode: {
    project: '.opencode/skills',
    global: (home) => join(home, '.config/opencode/skills'),
  },
};

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

function startBackgroundSync(): void {
  if (process.env.SK_NO_BACKGROUND_SYNC === '1' || process.env.SK_SYNC_CHILD === '1') return;
  const entry = process.argv[1];
  if (!entry) return;
  const child = spawn(process.execPath, [entry, 'sync', '--background'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, SK_SYNC_CHILD: '1' },
  });
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
            ? { ...collected, path: skill.path, fromCollection: true }
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

export function matches(skill: Skill, query: string): boolean {
  if (!query) return true;
  const haystack = [
    skill.name,
    skill.description,
    skill.note,
    ...(skill.tags || []),
    skill.source?.url,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
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

export async function removeSkillLocations(skills: Skill[]): Promise<number> {
  const paths = collectionPaths();
  const collectionRoot = resolve(paths.root);
  const unique = new Map<string, Skill>();
  for (const skill of skills) unique.set(resolve(skill.path), skill);

  for (const [path, skill] of unique) {
    if (path === collectionRoot || path.startsWith(`${collectionRoot}${sep}`)) {
      throw new Error(`不能通过位置删除收藏夹内容：${path}`);
    }
    if (!(await pathPresent(path))) throw new Error(`技能位置已不存在：${path}`);
    let current: Skill;
    try {
      current = await readSkill(path);
    } catch {
      throw new Error(`技能位置已发生变化，未删除：${path}`);
    }
    if (current.name !== skill.name) {
      throw new Error(`技能位置已发生变化，未删除：${path}`);
    }
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
