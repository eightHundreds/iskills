import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { baselinePath, collectionPaths, ensureCollection, isExactSymlink, listCollection, metadataPath, normalizeGitRepositoryIdentity, pathPresent, readJson, readState, writeJson, writeMetadata, writeState } from './core.js';
import type { SkillMetadata } from './types.js';

export type RepositoryNamespaceRules = Record<string, string>;

export async function readRepositoryNamespaceRules(): Promise<RepositoryNamespaceRules> {
  const rules = await readJson<unknown>(join(collectionPaths().root, 'namespaces.json'), {});
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || Object.values(rules).some((value) => typeof value !== 'string')) {
    throw new Error('Invalid repository namespace rules.');
  }
  return rules as RepositoryNamespaceRules;
}

/** Determine the rule for a repository and reject inconsistent existing state. */
export function repositoryNamespace(
  skills: readonly SkillMetadata[],
  repository: string,
): string | undefined {
  const identity = normalizeGitRepositoryIdentity(repository);
  const members = skills.filter((skill) => skill.source.type === 'git' && skill.source.url &&
    normalizeGitRepositoryIdentity(skill.source.url) === identity);
  const names = new Set(members.map((skill) => skill.namespace?.name ?? ''));
  if (names.size > 1) throw new Error('Repository skills have inconsistent namespace assignments.');
  return names.values().next().value || undefined;
}

/** Namespace names must remain unique across different repositories. */
export function assertNamespaceAvailable(
  skills: readonly SkillMetadata[],
  repository: string,
  namespace: string,
): void {
  const identity = normalizeGitRepositoryIdentity(repository);
  for (const skill of skills) {
    if (skill.namespace?.name !== namespace) continue;
    if (skill.source.type !== 'git' || !skill.source.url ||
        normalizeGitRepositoryIdentity(skill.source.url) !== identity) {
      throw new Error(`Namespace ${namespace} belongs to another repository.`);
    }
  }
}

/** A namespace is deliberately restricted to portable Agent Skills names. */
export function namespacedSkillName(namespace: string, originalName: string): string {
  const valid = (value: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  const name = `${namespace}-${originalName}`;
  if (!valid(namespace) || !valid(originalName) || name.length > 64) {
    throw new Error('Namespace and skill name must form a valid Agent Skills name of at most 64 characters.');
  }
  return name;
}

/** Change only a simple top-level name field, preserving the rest of the document. */
export function rewriteSkillFrontmatterName(content: string, name: string): string {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
  if (!frontmatter || frontmatter.index !== 0) throw new Error('Skill frontmatter is required.');
  const fields = [...frontmatter[1]!.matchAll(/^name:[^\r\n]*$/gm)];
  if (fields.length !== 1) throw new Error('Skill must have exactly one simple name field.');
  const current = fields[0]![0];
  if (/^name:\s*[>|]/.test(current)) throw new Error('Block-scalar skill names cannot be rewritten safely.');
  const offset = frontmatter[0].indexOf(frontmatter[1]!) + fields[0]!.index!;
  return content.slice(0, offset) + `name: ${name}` + content.slice(offset + current.length);
}

/** Extract complete explicit slash/$ skill invocations from Markdown text. */
export function explicitSkillInvocations(content: string): string[] {
  return [...content.matchAll(/(^|[\s`('"\\[{])([/$])([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-zA-Z0-9_./-])/gm)]
    .map((match) => match[3]!)
    .filter((name, index, names) => names.indexOf(name) === index);
}

export async function markdownSkillInvocations(root: string): Promise<string[]> {
  const names = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        for (const name of explicitSkillInvocations(await readFile(path, 'utf8'))) names.add(name);
      }
    }
  };
  await visit(root);
  return [...names];
}

/** Rewrite only complete explicit invocations present in the supplied mapping. */
export function rewriteSkillInvocations(content: string, names: ReadonlyMap<string, string>): string {
  return content.replace(/(^|[\s`('"\[{])([/$])([a-z0-9]+(?:-[a-z0-9]+)*)(?![a-zA-Z0-9_./-])/gm,
    (match, before: string, sigil: string, name: string) => {
      const replacement = names.get(name);
      return replacement ? `${before}${sigil}${replacement}` : match;
    });
}

export interface NamespaceChange {
  before: SkillMetadata;
  after: SkillMetadata;
  unresolvedReferences: string[];
}

/** Prepare a whole-repository change without modifying collection content. */
export async function planRepositoryNamespace(
  repository: string,
  namespace: string | undefined,
  sourceNames: readonly string[],
): Promise<NamespaceChange[]> {
  const skills = await listCollection();
  const identity = normalizeGitRepositoryIdentity(repository);
  if (!identity.startsWith('github.com/')) throw new Error('Namespaces require a GitHub repository.');
  repositoryNamespace(skills, repository);
  if (namespace) {
    assertNamespaceAvailable(skills, repository, namespace);
    const identity = normalizeGitRepositoryIdentity(repository);
    const rules = await readRepositoryNamespaceRules();
    if (Object.entries(rules).some(([other, value]) => other !== identity && value === namespace)) {
      throw new Error(`Namespace ${namespace} belongs to another repository.`);
    }
  }
  const members = skills.filter((skill) => skill.source.type === 'git' && skill.source.url &&
    normalizeGitRepositoryIdentity(skill.source.url) === identity);
  const previousNames = new Set(members.map((skill) => skill.name));
  const collectedOriginalNames = new Set(members.map((skill) => skill.namespace?.originalName ?? skill.name));
  const sourceCounts = new Map<string, number>();
  for (const sourceName of sourceNames) sourceCounts.set(sourceName, (sourceCounts.get(sourceName) ?? 0) + 1);
  const unresolvedTargets = new Set(sourceNames.filter((sourceName) => !collectedOriginalNames.has(sourceName) || (sourceCounts.get(sourceName) ?? 0) > 1));
  const targets = new Set<string>();
  const result: NamespaceChange[] = [];
  for (const member of members) {
    const { path: _path, namespace: previous, ...metadata } = member;
    const originalName = previous?.originalName ?? member.name;
    const name = namespace ? namespacedSkillName(namespace, originalName) : originalName;
    const target = name.toLowerCase();
    if (targets.has(target) || skills.some((skill) => !previousNames.has(skill.name) && skill.name.toLowerCase() === target)) {
      throw new Error(`Skill name conflicts with an existing skill: ${name}`);
    }
    targets.add(target);
    const tags = previous ? metadata.tags.filter((tag) => tag !== previous.name) : [...metadata.tags];
    if (previous?.preserveTag && !tags.includes(previous.name)) tags.push(previous.name);
    const preserveTag = namespace
      ? namespace === previous?.name ? previous.preserveTag === true : tags.includes(namespace)
      : false;
    const after: SkillMetadata = {
      ...metadata,
      name,
      tags: namespace ? [...new Set([...tags, namespace])] : tags,
      ...(namespace ? { namespace: { name: namespace, originalName, sourceNames: [...new Set(sourceNames)], ...(preserveTag ? { preserveTag: true } : {}) } } : {}),
    };
    const referenced = await markdownSkillInvocations(member.path);
    const unresolvedReferences = referenced.filter((reference) => unresolvedTargets.has(reference));
    result.push({ before: member, after, unresolvedReferences });
  }
  return result;
}

/** Atomically replace the selected repository's skills and their tracked usage links. */
export async function applyRepositoryNamespace(changes: readonly NamespaceChange[]): Promise<void> {
  if (!changes.length) return;
  const paths = await ensureCollection();
  const namespace = changes[0]!.after.namespace?.name;
  const rulePath = join(paths.root, 'namespaces.json');
  const hadRules = await pathPresent(rulePath);
  const oldRules = await readRepositoryNamespaceRules();
  const repository = changes[0]!.before.source.url;
  if (!repository) throw new Error('Repository URL is required.');
  const identity = normalizeGitRepositoryIdentity(repository);
  if (!identity.startsWith('github.com/')) {
    if (namespace) throw new Error('Namespaces require a GitHub repository.');
  }
  const newRules = { ...oldRules };
  if (namespace) newRules[identity] = namespace;
  else delete newRules[identity];
  const state = await readState();
  const oldNames = new Set(changes.map(({ before }) => before.name));
  if (state.conflicts.some((conflict) => conflict.type === 'source' && oldNames.has(conflict.skill))) {
    throw new Error('Resolve source update conflicts before changing the namespace.');
  }
  const { readPrivateSkillNames } = await import('./git.js');
  const { setSkillPrivate } = await import('./collection-write.js');
  const privateNames = new Set(await readPrivateSkillNames(paths.root));
  const privateAdditions = changes.filter(({ before, after }) => privateNames.has(before.name) && before.name !== after.name).map(({ after }) => after.name);
  const mapping = new Map(changes.map(({ before, after }) => [before.name, after.name]));
  const invocations = new Map<string, string>();
  for (const { before, after } of changes) {
    const originalNames = new Set([...(before.namespace?.sourceNames ?? []), ...(after.namespace?.sourceNames ?? []), before.namespace?.originalName ?? before.name]);
    for (const original of originalNames) {
      const oldName = before.namespace ? namespacedSkillName(before.namespace.name, original) : original;
      const newName = after.namespace ? namespacedSkillName(after.namespace.name, original) : original;
      invocations.set(oldName, newName);
    }
  }
  const linkChanges: Array<{ old: string; next: string; oldTarget: string; nextTarget: string }> = [];
  for (const link of state.links.filter((entry) => oldNames.has(entry.skill))) {
    const newName = mapping.get(link.skill)!;
    const oldTarget = join(paths.skills, link.skill);
    if (!(await isExactSymlink(link.path, oldTarget))) continue;
    if (link.kind !== 'usage') throw new Error(`Cannot safely rename a skill with an active ${link.kind} link: ${link.path}`);
    const next = join(dirname(link.path), newName);
    if (next !== link.path && await pathPresent(next)) throw new Error(`Installation target already exists: ${next}`);
    linkChanges.push({ old: link.path, next, oldTarget, nextTarget: join(paths.skills, newName) });
  }
  const newNames = new Set(changes.map(({ after }) => after.name));
  for (const name of newNames) {
    if (!oldNames.has(name) && (await pathPresent(join(paths.skills, name)) || await pathPresent(metadataPath(name)) || await pathPresent(baselinePath(name)))) {
      throw new Error(`Target already exists: ${name}`);
    }
  }
  const temp = await mkdtemp(join(paths.local, '.namespace-'));
  const staged: string[] = [];
  const installed: string[] = [];
  const privateInstalled: string[] = [];
  const linksInstalled: typeof linkChanges = [];
  let stateWritten = false;
  let rulesWritten = false;
  let succeeded = false;
  try {
    for (const [index, change] of changes.entries()) {
      const dir = join(temp, `new-${index}`);
      await cp(join(paths.skills, change.before.name), dir, { recursive: true, errorOnExist: true });
      await transformSkillTree(dir, change.after.name, invocations);
    }
    for (const name of privateAdditions) {
      await setSkillPrivate(paths.root, name, true);
      privateInstalled.push(name);
    }
    for (const [index, change] of changes.entries()) {
      for (const [kind, path] of [['tree', join(paths.skills, change.before.name)], ['metadata', metadataPath(change.before.name)], ['baseline', baselinePath(change.before.name)]] as const) {
        if (await pathPresent(path)) {
          await rename(path, join(temp, `old-${index}-${kind}`));
          staged.push(`${index}:${kind}`);
        }
      }
    }
    for (const [index, change] of changes.entries()) {
      await rename(join(temp, `new-${index}`), join(paths.skills, change.after.name));
      installed.push(join(paths.skills, change.after.name));
      await writeMetadata(change.after);
      installed.push(metadataPath(change.after.name));
      const oldBaseline = join(temp, `old-${index}-baseline`);
      if (await pathPresent(oldBaseline)) {
        await mkdir(dirname(baselinePath(change.after.name)), { recursive: true });
        await cp(oldBaseline, baselinePath(change.after.name), { recursive: true, errorOnExist: true });
        installed.push(baselinePath(change.after.name));
      }
    }
    for (const link of linkChanges) {
      await rename(link.old, join(temp, `link-${linksInstalled.length}`));
      try { await symlink(link.nextTarget, link.next, 'dir'); }
      catch (error) { await rename(join(temp, `link-${linksInstalled.length}`), link.old); throw error; }
      linksInstalled.push(link);
    }
    await writeState({ ...state, links: state.links.map((link) => {
      const nextName = mapping.get(link.skill);
      const changedLink = linkChanges.find((item) => item.old === link.path);
      if (!nextName || !changedLink) return link;
      return { ...link, skill: nextName, path: changedLink.next };
    }) });
    stateWritten = true;
    await writeJson(rulePath, newRules);
    rulesWritten = true;
    succeeded = true;
  } catch (error) {
    try {
      if (rulesWritten) {
        if (hadRules) await writeJson(rulePath, oldRules);
        else await rm(rulePath, { force: true });
      }
      if (stateWritten) await writeState(state);
      for (let index = linksInstalled.length - 1; index >= 0; index--) {
        const link = linksInstalled[index]!;
        await rm(link.next, { force: true });
        await rename(join(temp, `link-${index}`), link.old);
      }
      for (const path of installed.reverse()) await rm(path, { recursive: true, force: true });
      for (const name of privateInstalled.reverse()) await setSkillPrivate(paths.root, name, false);
      for (const key of staged.reverse()) {
        const [rawIndex, kind] = key.split(':');
        const index = Number(rawIndex);
        const change = changes[index]!;
        const dest = kind === 'tree' ? join(paths.skills, change.before.name) : kind === 'metadata' ? metadataPath(change.before.name) : baselinePath(change.before.name);
        await mkdir(dirname(dest), { recursive: true });
        await rename(join(temp, `old-${index}-${kind}`), dest);
      }
    } catch (rollbackError) {
      throw new Error(`Namespace rollback failed; recovery data retained at ${temp}: ${String(rollbackError)}`);
    }
    throw error;
  } finally {
    if (succeeded || !(await pathPresent(join(temp, 'old-0-tree')))) await rm(temp, { recursive: true, force: true });
  }
}

/** Rewrite a staged skill tree; the caller owns its transaction. */
export async function transformSkillTree(
  root: string,
  actualName: string,
  invocations: ReadonlyMap<string, string>,
): Promise<void> {
  const skillFile = join(root, 'SKILL.md');
  const original = await readFile(skillFile, 'utf8');
  await writeFile(skillFile, rewriteSkillFrontmatterName(original, actualName));
  await rewriteMarkdownInvocations(root, invocations);
}

/** Only regular Markdown files within the tree are transformed; symlinks are never followed. */
export async function rewriteMarkdownInvocations(root: string, names: ReadonlyMap<string, string>): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await rewriteMarkdownInvocations(path, names);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const original = await readFile(path, 'utf8');
      const updated = rewriteSkillInvocations(original, names);
      if (updated !== original) await writeFile(path, updated);
    }
  }
}
