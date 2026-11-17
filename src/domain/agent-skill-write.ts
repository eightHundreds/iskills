import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  AGENTS,
  PROJECT_SKILL_DIRS,
  assertRelativePath,
  assertSkillName,
  baselinePath,
  classifyCollectionMatch,
  collectionPaths,
  discoverSkills,
  exists,
  isExactSymlink,
  metadataPath,
  parseGitSource,
  pathPresent,
  readMetadata,
  readSkill,
  readState,
  validateSkillTree,
  writeMetadata,
  writeState,
  writeJson,
  ensureCollection,
  normalizeGitRepositoryIdentity,
} from './core.js';
import {
  createCollectionSkill,
  setSkillPrivate,
  installCollectionSkill,
  removeFromCollection,
  materializeSkillReferences,
  removeSkillLocations,
  unbindCollectedSkillSource,
  type InstallCollectionSkillInput,
} from './collection-write.js';
import { installSkillTarget } from './install-target.js';
import {
  canonicalizePath,
  resolveCrossAgentInstallPlan,
} from './cross-agent-install.js';
import {
  inspectGitSource,
  readSkills,
  readSkillLocations,
  validateAgents,
} from './agent-read.js';
import {
  executeWrites,
  conflictItem,
  requireAuthorization,
  type PlannedWrite,
} from './agent-write.js';
import {
  OperationFailure,
  operationError,
  type OperationResult,
} from './operation.js';
import {
  renameTagInList,
  writeTagRenameBatch,
  normalizeNewTagName,
} from './tags.js';
import { updateGitSkill, detectRenamedSkillPath, readPrivateSkillNames } from './git.js';
import { runGit } from './process.js';
import type { Skill, SkillMetadata, GitSource } from './types.js';
import { domainNotify } from './errors.js';
import { classifyImportCollectionIssues } from './import-collection-issues.js';
import { applyRepositoryNamespace, assertNamespaceAvailable, markdownSkillInvocations, namespacedSkillName, planRepositoryNamespace, readRepositoryNamespaceRules, repositoryNamespace, transformSkillTree, uniqueSourceSkillNames } from './skill-namespace.js';

export interface SkillWriteRequest {
  command: string;
  project: string;
  names: string[];
  options: Record<string, unknown>;
  signal: AbortSignal;
}

function strings(options: Record<string, unknown>, key: string): string[] {
  return [...new Set((options[key] as string[] | undefined) ?? [])];
}

export function metadataPatch(
  before: { tags: string[]; note: string; description?: string; namespace?: { name: string } },
  options: Record<string, unknown>,
): Record<string, unknown> {
  let tags = before.tags;
  if (options.tags !== undefined) {
    if (options['add-tag'] || options['remove-tag'])
      throw new OperationFailure(
        'usage.invalidArguments',
        '--tags cannot be combined with incremental tags.',
      );
    try {
      tags = JSON.parse(options.tags as string);
    } catch {
      throw new OperationFailure(
        'usage.invalidArguments',
        'Tags must be a JSON array.',
      );
    }
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))
      throw new OperationFailure(
        'usage.invalidArguments',
        'Tags must be an array of strings.',
      );
  }
  const add = strings(options, 'add-tag');
  const remove = strings(options, 'remove-tag');
  if (before.namespace && remove.includes(before.namespace.name)) throw new OperationFailure('usage.invalidArguments', 'The namespace tag cannot be removed.');
  if (before.namespace && !tags.includes(before.namespace.name)) tags = [...tags, before.namespace.name];
  if (add.some((tag) => remove.includes(tag)))
    throw new OperationFailure(
      'usage.invalidArguments',
      'The same tag cannot be added and removed.',
    );
  tags = [...new Set([...tags, ...add].map(normalizeNewTagName))].filter(
    (tag) => !remove.includes(tag),
  );
  return {
    tags,
    note: options.note ?? before.note,
    ...(options.description !== undefined
      ? { description: options.description }
      : {}),
  };
}

export async function sameTree(left: string, right: string): Promise<boolean> {
  const a = await lstat(left);
  const b = await lstat(right);
  if (a.isSymbolicLink() || b.isSymbolicLink())
    return (
      a.isSymbolicLink() &&
      b.isSymbolicLink() &&
      (await readlink(left)) === (await readlink(right))
    );
  if (a.isDirectory() !== b.isDirectory()) return false;
  if (!a.isDirectory())
    return (
      a.isFile() &&
      b.isFile() &&
      (await readFile(left)).equals(await readFile(right))
    );
  const names = (await readdir(left)).sort();
  if (!isDeepStrictEqual(names, (await readdir(right)).sort())) return false;
  for (const name of names)
    if (!(await sameTree(join(left, name), join(right, name)))) return false;
  return true;
}

export interface SkillTargetInput {
  name: string;
  source: string;
  target: string;
  copy: boolean;
  registerUsage: boolean;
  replace: boolean;
  agents?: string[];
  scope?: 'project' | 'global' | null;
  rejectSelfReference?: boolean;
}

/** One planner owns target identity, unchanged content, replacement and recovery. */
export async function planSkillTargets(
  inputs: SkillTargetInput[],
): Promise<PlannedWrite[]> {
  const plans = new Map<string, PlannedWrite>();
  const sources = new Map<string, string>();
  for (const input of inputs) {
    const { name, source, target, copy } = input;
    const physicalSource = await canonicalizePath(source);
    const key = join(await canonicalizePath(dirname(target)), basename(target));
    if (sources.has(key) && sources.get(key) !== physicalSource)
      throw new OperationFailure(
        'usage.ambiguousSelection',
        'Multiple sources resolve to the same installation target.',
        { target },
      );
    const previous = plans.get(key);
    if (previous) {
      previous.item.agents = [
        ...new Set([
          ...(previous.item.agents as string[]),
          ...(input.agents ?? []),
        ]),
      ];
      continue;
    }
    const exact = await isExactSymlink(target, source);
    const physicalTarget = await canonicalizePath(target);
    if (
      (physicalTarget === physicalSource &&
        (input.rejectSelfReference || !exact)) ||
      physicalTarget.startsWith(`${physicalSource}${sep}`)
    )
      throw new OperationFailure(
        'usage.invalidLocation',
        'The target points to or is inside the source itself.',
        { target },
      );
    let item: Record<string, unknown> = {
      name,
      target,
      agents: input.agents ?? [],
      scope: input.scope ?? null,
      action: copy ? 'copy' : 'link',
      status: 'planned',
    };
    if (exact && !copy)
      item = { ...item, status: 'unchanged', reason: 'same-reference' };
    else if (await pathPresent(target)) {
      if (
        copy &&
        !(await lstat(target)).isSymbolicLink() &&
        (await sameTree(source, target))
      )
        item = { ...item, status: 'unchanged', reason: 'same-content' };
      else if (!input.replace)
        item = conflictItem(item, 'conflict.targetExists', {
          target,
          requiredFlags: ['--replace'],
        });
    }
    plans.set(key, {
      item,
      execute: () =>
        installSkillTarget(name, source, target, copy, input.registerUsage),
    });
    sources.set(key, physicalSource);
  }
  return [...plans.values()];
}

function validateNames(names: string[]): string[] {
  for (const name of names) {
    try {
      if (assertSkillName(name) !== name) throw new Error();
    } catch {
      throw new OperationFailure(
        'usage.invalidArguments',
        'Invalid skill name.',
        { name },
      );
    }
  }
  return names;
}

async function matchesCreateTemplate(name: string, target: string): Promise<boolean> {
  try {
    if (!(await lstat(target)).isDirectory()) return false;
    if (!(await pathPresent(metadataPath(name)))) return false;
    if (!isDeepStrictEqual(await readMetadata(name), {
      name,
      description: '',
      tags: [],
      note: '',
      source: { type: 'unknown' },
    })) return false;
    const entries = await readdir(target);
    return entries.length === 1 &&
      entries[0] === 'SKILL.md' &&
      (await lstat(join(target, 'SKILL.md'))).isFile() &&
      (await readFile(join(target, 'SKILL.md'), 'utf8')) ===
        `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

async function requireSkills(
  names: string[],
  all = false,
): Promise<SkillMetadata[]> {
  const collection = await readSkills();
  const selected = all
    ? collection.items
    : names.map((name) => {
        const skill = collection.items.find((item) => item.name === name);
        if (!skill) {
          const issue = collection.issues.find((entry) => entry.path.endsWith(`/${name}`));
          if (issue)
            throw new OperationFailure(
              'execution.readFailed',
              'The selected skill in collection is unreadable.',
              { name, issue },
              1,
            );
          throw new OperationFailure(
            'usage.selectionNotFound',
            'The skill does not exist.',
            { name },
          );
        }
        return skill;
      });
  return selected.map(({ name, description, tags, note, source, namespace }) => ({
    name,
    description,
    tags,
    note,
    source,
    ...(namespace ? { namespace } : {}),
  }));
}

export async function executeSkillWrite(
  request: SkillWriteRequest,
): Promise<OperationResult> {
  const { command, project, options, signal } = request;
  const names =
    command === 'skill.tag.rename'
      ? request.names
      : [...new Set(request.names)];
  const dryRun = options['dry-run'] === true;
  const plans: PlannedWrite[] = [];
  if (command.startsWith('skill.namespace.')) return executeNamespaceWrite(request);
  if (command === 'skill.import') return importSkills(request);
  if (command === 'skill.install') return installSkills(request);
  if (['skill.uninstall', 'skill.materialize'].includes(command))
    return maintainLocations(request);
  if (command === 'skill.tag.rename') {
    const [from, to] = names;
    if (names.length !== 2)
      throw new OperationFailure(
        'usage.invalidArguments',
        'Two tag names are required.',
      );
    normalizeNewTagName(to!);
    const selected = await requireSkills([], true);
    if (selected.some((skill) => skill.namespace?.name === from)) throw new OperationFailure('usage.invalidArguments', 'Rename a namespace through the namespace command.');
    const changes = selected.flatMap((before) => {
      const tags = renameTagInList(before.tags, from!, to!);
      return tags ? [{ before, after: { ...before, tags } }] : [];
    });
    return executeWrites(
      [
        {
          item: {
            name: from,
            action: 'rename-tag',
            status: changes.length ? 'planned' : 'unchanged',
            reason: 'same-value',
            affectedNames: changes.map((change) => change.before.name),
          },
          execute: () => writeTagRenameBatch(changes, writeMetadata),
        },
      ],
      dryRun,
      true,
      command,
      signal,
    );
  }
  validateNames(names);
  if (options.all && names.length)
    throw new OperationFailure(
      'usage.invalidArguments',
      '--all and names are mutually exclusive.',
    );
  if (!names.length && !options.all)
    throw new OperationFailure(
      'usage.selectionRequired',
      'Select at least one skill.',
    );
  if (
    [
      'skill.create',
      'skill.edit',
      'skill.source.bind',
      'skill.source.unbind',
    ].includes(command) &&
    names.length !== 1
  )
    throw new OperationFailure(
      'usage.invalidArguments',
      'Exactly one skill name is required.',
    );
  if (['skill.remove', 'skill.source.unbind'].includes(command))
    requireAuthorization(options.yes === true, dryRun, names);
  const privateNames = options.private || options.public
    ? new Set(await readPrivateSkillNames())
    : new Set<string>();
  if (command === 'skill.create') {
    const name = names[0]!;
    const target = join(collectionPaths().skills, name);
    const present = await pathPresent(target);
    const privacyChanged = options.private === true && !privateNames.has(name);
    let item: Record<string, unknown> = {
      name,
      path: target,
      action: 'create',
      ...(options.private ? { private: true } : {}),
      status: 'planned',
    };
    if (present) {
      item = await matchesCreateTemplate(name, target)
        ? { ...item, status: privacyChanged ? 'planned' : 'unchanged', reason: 'same-template' }
        : conflictItem(item, 'conflict.alreadyExists', { name });
    }
    plans.push({
      item,
      execute: async () => {
        if (!present) {
          await createCollectionSkill(name, { private: options.private === true });
          return;
        }
        if (!(await matchesCreateTemplate(name, target)))
          throw new OperationFailure(
            'conflict.alreadyExists',
            'The existing skill no longer matches the creation template.',
            { name },
            1,
          );
        if (privacyChanged) await setSkillPrivate(collectionPaths().root, name, true);
      },
    });
  } else if (command === 'skill.adopt') {
    const candidates = options.all
      ? (
          await readdir(collectionPaths().skills, {
            withFileTypes: true,
          }).catch(() => [])
        )
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : names;
    for (const name of candidates) {
      const skill = await readSkill(join(collectionPaths().skills, name));
      if (skill.name !== name)
        throw new OperationFailure(
          'source.invalidSkill',
          'Skill directory and name disagree.',
          { name },
          1,
        );
      const present = await pathPresent(metadataPath(name));
      const privacyChanged = options.private === true && !privateNames.has(name);
      plans.push({
        item: {
          name,
          action: 'adopt',
          ...(options.private ? { private: true } : {}),
          status: present && !privacyChanged ? 'unchanged' : 'planned',
          reason: 'metadata-present',
        },
        execute: async () => {
          if (privacyChanged) await setSkillPrivate(collectionPaths().root, name, true);
          if (!present) await writeMetadata({
            name,
            description: skill.description,
            tags: [],
            note: '',
            source: { type: 'unknown' },
          });
        },
      });
    }
  } else if (command === 'skill.remove') {
    const state = await readState();
    for (const name of names) {
      const target = join(collectionPaths().skills, name);
      if (await pathPresent(target)) {
        const skill = await readSkill(target);
        if (skill.name !== name || (await lstat(target)).isSymbolicLink())
          throw new OperationFailure(
            'usage.invalidLocation',
            'The collected skill directory is invalid.',
            { name, path: target },
          );
      }
      const links = state.links.filter((link) => link.skill === name);
      const origin = links.find((link) => link.kind === 'origin');
      const restore =
        origin && (await isExactSymlink(origin.path, target))
          ? origin.path
          : null;
      const usage = [];
      for (const link of links.filter((link) => link.kind === 'usage'))
        if (await isExactSymlink(link.path, target)) usage.push(link.path);
      plans.push({
        item: {
          name,
          action: 'remove',
          status: (await pathPresent(target)) ? 'planned' : 'unchanged',
          reason: 'absent',
          restoredOrigin: restore,
          removedUsagePaths: usage,
          requiredFlags: ['--yes'],
        },
        execute: () => removeFromCollection(name, true, true),
      });
    }
  } else if (command === 'skill.update') return updateSkills(request);
  else {
    const selected = await requireSkills(names);
    for (const before of selected) {
      if (command === 'skill.edit') {
        if (options.private && options.public)
          throw new OperationFailure('usage.invalidArguments', '--private and --public are mutually exclusive.');
        if (
          !['tags', 'add-tag', 'remove-tag', 'note', 'private', 'public'].some(
            (key) => options[key] !== undefined,
          )
        )
          throw new OperationFailure(
            'usage.invalidArguments',
            'At least one metadata field is required.',
          );
        const after = {
          ...before,
          ...metadataPatch(before, options),
        } as SkillMetadata;
        const privacyChanged = (options.private === true || options.public === true) &&
          privateNames.has(before.name) !== (options.private === true);
        const metadataChanged = !isDeepStrictEqual(before, after);
        plans.push({
          item: {
            name: before.name,
            action: 'edit',
            ...(options.private || options.public ? { private: options.private === true } : {}),
            status: !privacyChanged && !metadataChanged ? 'unchanged' : 'planned',
            reason: 'same-value',
          },
          execute: async () => {
            if (privacyChanged)
              await setSkillPrivate(collectionPaths().root, before.name, options.private === true);
            if (metadataChanged) await writeMetadata(after);
          },
        });
      } else if (command === 'skill.source.unbind') {
        if (!['git', 'unknown'].includes(before.source.type))
          throw new OperationFailure(
            'usage.unsupportedCapability',
            'Only a Git source can be unbound.',
            { name: before.name },
          );
        plans.push({
          item: {
            name: before.name,
            action: 'unbind',
            status: before.source.type === 'unknown' ? 'unchanged' : 'planned',
            reason: 'already-unbound',
            baseline: baselinePath(before.name),
            clearsConflicts: (await readState()).conflicts.filter(
              (conflict) =>
                conflict.type === 'source' && conflict.skill === before.name,
            ),
            requiredFlags: ['--yes'],
          },
          execute: () => unbindCollectedSkillSource(before.name),
        });
      } else if (command === 'skill.source.bind') {
        if (typeof options.git !== 'string' || typeof options.path !== 'string')
          throw new OperationFailure(
            'usage.invalidArguments',
            '--git and --path are required.',
          );
        const parsed = parseGitSource(options.git);
        const source: GitSource = {
          type: 'git',
          url: parsed.url,
          path: assertRelativePath(options.path),
          refType: /^[0-9a-f]{7,40}$/i.test(parsed.ref ?? '')
            ? 'commit'
            : 'branch',
          ...(parsed.ref ? { ref: parsed.ref } : {}),
        };
        const same =
          before.source.type === 'git' &&
          normalizeGitRepositoryIdentity(before.source.url ?? '') ===
            normalizeGitRepositoryIdentity(source.url) &&
          before.source.path === source.path &&
          before.source.ref === source.ref &&
          before.source.refType === source.refType;
        let item: Record<string, unknown> = {
          name: before.name,
          action: 'bind',
          status: same ? 'unchanged' : 'planned',
          reason: 'same-source',
          source,
          baseline: baselinePath(before.name),
          clearsConflicts: (await readState()).conflicts.filter(
            (conflict) =>
              conflict.type === 'source' && conflict.skill === before.name,
          ),
        };
        if (!same && before.source.type === 'git' && !options.replace)
          item = conflictItem(item, 'conflict.sameName', {
            existing: before.source,
            incoming: source,
            requiredFlags: ['--replace'],
          });
        plans.push({ item, execute: () => bindSource(before, source) });
      } else
        throw new OperationFailure(
          'usage.unknownCommand',
          'Unknown skill operation.',
          { command },
        );
    }
  }
  return executeWrites(plans, dryRun, true, command, signal);
}

/** Both presenters pass reviewed imports through the same tree validation and executor. */
export async function executePreparedSkillImports(
  inputs: InstallCollectionSkillInput[],
  signal: AbortSignal = new AbortController().signal,
): Promise<OperationResult> {
  if (new Set(inputs.map((input) => input.name)).size !== inputs.length)
    throw new OperationFailure(
      'usage.ambiguousSelection',
      'Duplicate skill names.',
    );
  const plans: PlannedWrite[] = [];
  const privateNames = inputs.some((input) => input.private)
    ? new Set(await readPrivateSkillNames())
    : new Set<string>();
  for (const input of inputs) {
    await validateSkillTree(input.sourceTree);
    const target = join(collectionPaths().skills, input.name);
    let item: Record<string, unknown> = {
      name: input.name,
      action: 'import',
      status: 'planned',
      source: input.metadata.source,
    };
    if (await pathPresent(target)) {
      const match = await classifyCollectionMatch(
        await readMetadata(input.name),
        input.metadata,
      );
      if (match === 'same-source')
        item = { ...item, status: input.private && !privateNames.has(input.name) ? 'planned' : 'unchanged', reason: 'same-source' };
      else if (!input.allowReplace)
        item = conflictItem(
          item,
          match === 'unverified-source'
            ? 'conflict.sourceUnverified'
            : 'conflict.sameName',
          { name: input.name, requiredFlags: ['--replace'] },
        );
    }
    plans.push({
      item,
      execute: async () => {
        await installCollectionSkill({ ...input, commit: false });
      },
    });
  }
  return executeWrites(plans, false, true, 'skill.import', signal);
}

export async function bindSource(
  before: SkillMetadata,
  source: GitSource,
): Promise<void> {
  const paths = await ensureCollection();
  const transaction = await mkdtemp(join(paths.local, '.bind-'));
  const baseline = baselinePath(before.name);
  const backup = join(transaction, 'old');
  const state = await readState();
  let backedUp = false;
  let baselineInstalled = false;
  try {
    await cp(join(paths.skills, before.name), join(transaction, 'new'), {
      recursive: true,
    });
    if (await pathPresent(baseline)) {
      await rename(baseline, backup);
      backedUp = true;
    }
    await mkdir(dirname(baseline), { recursive: true });
    await rename(join(transaction, 'new'), baseline);
    baselineInstalled = true;
    await writeMetadata({ ...before, source });
    await writeState({
      ...state,
      conflicts: state.conflicts.filter(
        (conflict) =>
          conflict.type !== 'source' || conflict.skill !== before.name,
      ),
    });
  } catch (error) {
    try {
      await writeMetadata(before);
      await writeState(state);
      if (baselineInstalled)
        await rm(baseline, { recursive: true, force: true });
      if (backedUp) await rename(backup, baseline);
    } catch {
      throw new OperationFailure(
        'execution.rollbackFailed',
        'The source binding could not be restored.',
        { name: before.name, recoveryPath: transaction },
        1,
        'inspect-state',
      );
    }
    throw error;
  }
  for (const path of [
    ...state.conflicts.flatMap((conflict) =>
      conflict.type === 'source' && conflict.skill === before.name
        ? [conflict.path]
        : [],
    ),
    transaction,
  ]) {
    await rm(path, { recursive: true, force: true }).catch(() =>
      domainNotify('domain.warnConflictCleanup'),
    );
  }
}

async function executeNamespaceWrite(request: SkillWriteRequest): Promise<OperationResult> {
  const { command, names, options, signal } = request;
  const { items, issues } = await readSkills();
  if (issues.length) throw new OperationFailure('execution.readFailed', 'Collection contains unreadable skills.', { issues }, 1);
  let repository: string;
  let nextName: string | undefined;
  let sourceNames: string[];
  if (command === 'skill.namespace.remove') {
    if (names.length !== 1 || options['delete-skills'] !== true || (options.yes !== true && options['dry-run'] !== true)) throw new OperationFailure('usage.confirmationRequired', 'Namespace removal requires --delete-skills --yes; use namespace clear to keep members.', { requiredFlags: ['--delete-skills', '--yes'] }, 2);
    const members = items.filter((item) => item.namespace?.name === names[0]);
    const rules = await readRepositoryNamespaceRules();
    const rule = Object.entries(rules).find(([, value]) => value === names[0]);
    if (!members.length && !rule) throw new OperationFailure('usage.selectionNotFound', 'Namespace not found.');
    if (!members.length && rule) {
      const item = { action: command, namespace: names[0], status: 'planned' };
      return executeWrites([{ item, execute: async () => { const next = { ...rules }; delete next[rule[0]]; await writeJson(join(collectionPaths().root, 'namespaces.json'), next); } }], options['dry-run'] === true, true, command, signal);
    }
    const plans = members.map((member) => ({ item: { name: member.name, action: 'remove', status: 'planned' }, execute: () => removeFromCollection(member.name, true) }));
    const last = plans[plans.length - 1]!;
    const executeLast = last.execute;
    last.execute = async () => {
      await executeLast();
      const next = { ...rules };
      if (rule) delete next[rule[0]];
      await writeJson(join(collectionPaths().root, 'namespaces.json'), next);
    };
    return executeWrites(plans, options['dry-run'] === true, true, command, signal);
  }
  if (command === 'skill.namespace.set') {
    if (names.length || typeof options.git !== 'string' || typeof options.namespace !== 'string') {
      throw new OperationFailure('usage.invalidArguments', 'Use --git and --namespace.');
    }
    const clone = await inspectGitSource(options.git, signal);
    try {
      repository = clone.source.url;
      sourceNames = (await discoverSkills(clone.repository)).map((skill) => skill.name);
      if (!sourceNames.length) throw new OperationFailure('usage.selectionNotFound', 'No skills were found in the repository.');
    } finally { await rm(clone.temporary, { recursive: true, force: true }); }
    nextName = options.namespace;
    const identity = normalizeGitRepositoryIdentity(repository);
    const rules = await readRepositoryNamespaceRules();
    const storedRule = rules[identity];
    const existing = items.find((item) => item.source.url && normalizeGitRepositoryIdentity(item.source.url) === identity && item.namespace);
    if ((existing && existing.namespace?.name !== nextName) || (storedRule && storedRule !== nextName)) throw new OperationFailure('usage.invalidArguments', 'Rename the existing namespace explicitly.');
  } else {
    if (names.length !== (command === 'skill.namespace.rename' ? 2 : 1)) throw new OperationFailure('usage.invalidArguments', 'Specify the namespace and, for rename, the new name.');
    const rules = await readRepositoryNamespaceRules();
    const rule = Object.entries(rules).find(([, value]) => value === names[0]);
    const members = items.filter((item) => item.namespace?.name === names[0]);
    const member = members[0];
    if (!member?.source.url && !rule) throw new OperationFailure('usage.selectionNotFound', 'Namespace not found.');
    repository = member?.source.url ?? rule![0]!;
    const maximumCounts = new Map<string, number>();
    for (const item of members) {
      const counts = new Map<string, number>();
      for (const name of item.namespace?.sourceNames ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
      for (const [name, count] of counts) maximumCounts.set(name, Math.max(count, maximumCounts.get(name) ?? 0));
    }
    sourceNames = [...maximumCounts].flatMap(([name, count]) => Array<string>(count).fill(name));
    nextName = command === 'skill.namespace.rename' ? names[1] : undefined;
    if (!members.length) {
      if (nextName && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextName) || nextName.length > 62)) throw new OperationFailure('usage.invalidArguments', 'Namespace must be a portable lowercase name of at most 62 characters.');
      if (nextName && Object.entries(rules).some(([key, value]) => key !== rule![0] && value === nextName)) throw new OperationFailure('conflict.alreadyExists', 'Namespace belongs to another repository.', { namespace: nextName }, 3);
      const item = { action: command, repository, namespace: nextName ?? null, changes: [], status: 'planned' };
      return executeWrites([{ item, execute: async () => {
        const next = { ...rules };
        if (nextName) next[rule![0]] = nextName;
        else delete next[rule![0]];
        await writeJson(join(collectionPaths().root, 'namespaces.json'), next);
      } }], options['dry-run'] === true, true, command, signal);
    }
  }
  const changes = await planRepositoryNamespace(repository, nextName, sourceNames);
  if (!changes.length) throw new OperationFailure('usage.selectionNotFound', 'No collected skills from the selected repository.');
  const item: Record<string, unknown> = { action: command, repository, namespace: nextName ?? null, changes: changes.map(({ before, after, unresolvedReferences }) => ({ before: before.name, after: after.name, unresolvedReferences })), unresolvedReferences: [...new Set(changes.flatMap((change) => change.unresolvedReferences))], status: 'planned' };
  return executeWrites([{ item, execute: () => applyRepositoryNamespace(changes) }], options['dry-run'] === true, true, command, signal);
}

async function importSkills(
  request: SkillWriteRequest,
): Promise<OperationResult> {
  const { options, project, signal, command } = request;
  if (request.names.length)
    throw new OperationFailure(
      'usage.invalidArguments',
      'Import takes options, not positional names.',
    );
  if (Boolean(options.git) === Boolean(options.local))
    throw new OperationFailure(
      'usage.invalidArguments',
      'Choose --git or --local.',
    );
  const paths = strings(options, 'path');
  if (Boolean(options.all) === Boolean(paths.length))
    throw new OperationFailure(
      'usage.selectionRequired',
      'Select --all or one or more --path values.',
    );
  if (
    options['expect-commit'] &&
    (!options.git ||
      !/^[0-9a-f]{7,40}$/i.test(String(options['expect-commit'])))
  )
    throw new OperationFailure(
      'usage.invalidArguments',
      '--expect-commit requires a Git source and a valid SHA.',
    );
  const cloned = options.git
    ? await inspectGitSource(String(options.git), signal)
    : undefined;
  const root = cloned?.repository ?? resolve(project, String(options.local));
  try {
    if (
      cloned &&
      options['expect-commit'] &&
      !cloned.source
        .commit!.toLowerCase()
        .startsWith(String(options['expect-commit']).toLowerCase())
    )
      throw new OperationFailure(
        'source.commitMismatch',
        'The source commit differs from the expected commit.',
        {
          expectedCommit: options['expect-commit'],
          actualCommit: cloned.source.commit,
        },
        1,
      );
    const candidates = await discoverSkills(root);
    const collected = await readSkills();
    if (options.namespace !== undefined && !cloned) throw new OperationFailure('usage.invalidArguments', 'Namespaces require a GitHub source.');
    const identity = cloned ? normalizeGitRepositoryIdentity(cloned.source.url) : '';
    const rules = await readRepositoryNamespaceRules();
    const existingNamespace = cloned ? repositoryNamespace(collected.items, cloned.source.url) ?? rules[identity] : undefined;
    const requestedNamespace = typeof options.namespace === 'string' ? options.namespace : undefined;
    if (existingNamespace && requestedNamespace && existingNamespace !== requestedNamespace) throw new OperationFailure('usage.invalidArguments', 'Rename the repository namespace explicitly.');
    const namespace = requestedNamespace ?? existingNamespace;
    if (namespace && !identity.startsWith('github.com/')) throw new OperationFailure('usage.invalidArguments', 'Namespaces require a GitHub source.');
    if (namespace) {
      assertNamespaceAvailable(collected.items, cloned!.source.url, namespace);
      if (Object.entries(rules).some(([key, value]) => key !== identity && value === namespace)) throw new OperationFailure('usage.invalidArguments', 'Namespace belongs to another repository.');
    }
    const sourceNames = candidates.map((skill) => skill.name);
    const selected = options.all
      ? candidates.sort((a, b) => a.name.localeCompare(b.name, 'en'))
      : paths.map((path) => {
          const rel = assertRelativePath(path);
          const candidate = candidates.find(
            (skill) => (relative(root, skill.path) || '.') === rel,
          );
          if (!candidate)
            throw new OperationFailure(
              'usage.selectionNotFound',
              'The source path was not discovered.',
              {
                path,
                candidates: candidates.map((skill) => ({
                  name: skill.name,
                  path: relative(root, skill.path) || '.',
                })),
              },
            );
          return candidate;
        });
    if (!selected.length)
      throw new OperationFailure(
        'usage.selectionNotFound',
        'No skills were found.',
        { root: cloned ? null : root },
      );
    if (new Set(selected.map((skill) => skill.name)).size !== selected.length)
      throw new OperationFailure(
        'usage.ambiguousSelection',
        'The selection contains duplicate skill names.',
      );
    const issueAssessment = await classifyImportCollectionIssues(
      collected.issues,
      selected.flatMap((skill) => namespace ? [skill.name, namespacedSkillName(namespace, skill.name)] : [skill.name]),
      cloned?.source.url,
      namespace,
    );
    if (issueAssessment.blocking.length) throw new OperationFailure('execution.readFailed', 'Collection entries block this import.', { issues: issueAssessment.blocking }, 1);
    const plans: PlannedWrite[] = [];
    let migrationPlan: PlannedWrite | undefined;
    const existingRepositoryMembers = namespace
      ? collected.items.filter((item) => item.source.url && normalizeGitRepositoryIdentity(item.source.url) === identity)
      : [];
    if (namespace && existingRepositoryMembers.length && existingRepositoryMembers.every((item) => !item.namespace)) {
      const migration = await planRepositoryNamespace(cloned!.source.url, namespace, sourceNames);
      migrationPlan = {
        item: { action: 'namespace.set', repository: cloned!.source.url, namespace, changes: migration.map(({ before, after }) => ({ before: before.name, after: after.name })), unresolvedReferences: [...new Set(migration.flatMap((change) => change.unresolvedReferences))], status: 'planned' },
        execute: async () => {
          const newlyImported: string[] = [];
          const completed: PlannedWrite[] = [];
          await applyRepositoryNamespace(migration, async () => {
            const privacyBefore = new Set(await readPrivateSkillNames());
            try {
              for (const plan of plans.slice(1)) {
                if (plan.item.status === 'unchanged') continue;
                if (signal.aborted) throw new OperationFailure('execution.interrupted', 'The operation was interrupted.', {}, 130);
                const name = String(plan.item.name);
                const existed = await pathPresent(join(collectionPaths().skills, name));
                try { await plan.execute(); }
                catch (error) { plan.item.status = 'failed'; throw error; }
                if (!existed) newlyImported.push(name);
                plan.item.status = 'committed';
                completed.push(plan);
              }
            } catch (error) {
              try {
                for (const name of newlyImported.reverse()) await removeFromCollection(name, true, true);
                const privacyAfter = new Set(await readPrivateSkillNames());
                const importNames = new Set(plans.slice(1).map((plan) => String(plan.item.name)));
                for (const name of importNames) if (privacyAfter.has(name) && !privacyBefore.has(name)) await setSkillPrivate(collectionPaths().root, name, false);
                for (const plan of completed) plan.item.status = 'rolled-back';
              } catch (rollbackError) {
                throw new OperationFailure('execution.rollbackFailed', 'Could not restore imported skills after namespace failure.', { cause: String(error), rollback: String(rollbackError) }, 1, 'inspect-state');
              }
              throw error;
            }
          });
        },
      };
      plans.push(migrationPlan);
    }
    const privateNames = options.private
      ? new Set(await readPrivateSkillNames())
      : new Set<string>();
    for (const skill of selected) {
      const actual = await realpath(skill.path);
      if (!cloned) {
        const collectionRoot = await canonicalizePath(collectionPaths().root);
        if (
          actual === collectionRoot ||
          actual.startsWith(`${collectionRoot}${sep}`)
        ) {
          const metadata = await readMetadata(skill.name);
          if (
            actual !==
              (await canonicalizePath(
                join(collectionPaths().skills, skill.name),
              )) ||
            metadata.source.type !== 'local'
          )
            throw new OperationFailure(
              'usage.invalidLocation',
              'The local import source must be outside collection content.',
              { path: skill.path },
            );
        }
      }
      await validateSkillTree(actual);
      const source = cloned
        ? { ...cloned.source, path: relative(root, skill.path) || '.' }
        : { type: 'local', path: actual };
      const collectedName = namespace ? namespacedSkillName(namespace, skill.name) : skill.name;
      const collectedOriginals = new Set([...existingRepositoryMembers.map((item) => item.namespace?.originalName ?? item.name), ...selected.map((item) => item.name)]);
      const sourceCounts = new Map<string, number>();
      for (const sourceName of sourceNames) sourceCounts.set(sourceName, (sourceCounts.get(sourceName) ?? 0) + 1);
      const unresolvedReferences = namespace
        ? (await markdownSkillInvocations(actual)).filter((reference) => sourceNames.includes(reference) && (!collectedOriginals.has(reference) || (sourceCounts.get(reference) ?? 0) > 1))
        : [];
      const metadata: SkillMetadata = {
        name: collectedName,
        description: skill.description,
        tags: [...new Set([...strings(options, 'tag'), ...(namespace ? [namespace] : [])])],
        note: '',
        source,
        ...(namespace ? { namespace: { name: namespace, originalName: skill.name, sourceNames } } : {}),
      };
      let sourceTree = actual;
      if (namespace) {
        sourceTree = await mkdtemp(join(cloned!.temporary, '.namespace-import-'));
        await cp(actual, sourceTree, { recursive: true });
        await transformSkillTree(sourceTree, collectedName, new Map(uniqueSourceSkillNames(sourceNames).map((name) => [name, namespacedSkillName(namespace, name)])));
      }
      const target = join(collectionPaths().skills, collectedName);
      let item: Record<string, unknown> = {
        name: collectedName,
        action: 'import',
        ...(options.private ? { private: true } : {}),
        status: 'planned',
        source,
        ...(unresolvedReferences.length ? { unresolvedReferences: [...new Set(unresolvedReferences)] } : {}),
        collectionPath: target,
        ...(!cloned
          ? { originPath: actual, moved: true, originLink: actual }
          : {}),
      };
      if (await pathPresent(target)) {
        const current = await readMetadata(collectedName);
        const match = await classifyCollectionMatch(current, metadata);
        if (match === 'same-source')
          item = {
            ...item,
            status: options.private && !privateNames.has(collectedName) ? 'planned' : 'unchanged',
            reason: 'same-source',
            source: current.source,
            moved: false,
            ...(!cloned
              ? {
                  originPath: current.source.path,
                  originLink: current.source.path &&
                    await isExactSymlink(current.source.path, target)
                      ? current.source.path
                      : null,
                }
              : {}),
          };
        else if (!options.replace || namespace)
          item = conflictItem(
            item,
            match === 'unverified-source'
              ? 'conflict.sourceUnverified'
              : 'conflict.sameName',
            {
              existing: current.source,
              incoming: source,
              requiredFlags: ['--replace'],
            },
          );
        else item.action = 'replace';
      }
      plans.push({
        item,
        execute: async () => {
          let oldRules: Record<string, string> | undefined;
          let hadRules = false;
          try {
            if (namespace) {
              await ensureCollection();
              hadRules = await pathPresent(join(collectionPaths().root, 'namespaces.json'));
              oldRules = await readRepositoryNamespaceRules();
              await writeJson(join(collectionPaths().root, 'namespaces.json'), { ...oldRules, [identity]: namespace });
            }
            if (options.private && (await pathPresent(target)) &&
                await classifyCollectionMatch(await readMetadata(collectedName), metadata) === 'same-source') {
              await setSkillPrivate(collectionPaths().root, collectedName, true);
              return;
            }
            await installCollectionSkill({
              name: collectedName,
              sourceTree,
              metadata,
              allowReplace: options.replace === true,
              commit: false,
              ...(options.private ? { private: true } : {}),
              ...(!cloned
                ? {
                    local: {
                      originPath: actual,
                      selectedPath: skill.path,
                      selectedWasSymlink: (
                        await lstat(skill.path)
                      ).isSymbolicLink(),
                    },
                  }
                : {}),
            });
          } catch (error) {
            if (oldRules) {
              const rulesPath = join(collectionPaths().root, 'namespaces.json');
              if (hadRules) await writeJson(rulesPath, oldRules);
              else await rm(rulesPath, { force: true });
            }
            item.restored = 'unknown';
            throw error;
          }
        },
      });
    }
    const response = await executeWrites(
      plans,
      options['dry-run'] === true,
      true,
      command,
      signal,
    );
    if (issueAssessment.unrelated.length) {
      response.warnings = [...(response.warnings ?? []), {
        code: 'collection.unrelatedIssues',
        message: 'Unrelated incomplete collection entries were preserved.',
        details: { issues: issueAssessment.unrelated },
        retry: 'after-fix',
      }];
    }
    return response;
  } finally {
    if (cloned) await rm(cloned.temporary, { recursive: true, force: true });
  }
}

async function installSkills(
  request: SkillWriteRequest,
): Promise<OperationResult> {
  const { options, project, signal, command } = request;
  const sources = strings(options, 'from-location');
  if (Boolean(request.names.length) === Boolean(sources.length))
    throw new OperationFailure(
      'usage.selectionRequired',
      'Select collection names or --from-location.',
    );
  const agents = strings(options, 'agent');
  const scope = options.scope;
  if (
    options.to
      ? agents.length || scope
      : !agents.length || !['project', 'global'].includes(String(scope))
  )
    throw new OperationFailure(
      'usage.invalidArguments',
      'Choose --to or explicit --agent and --scope.',
    );
  if (sources.length && (options.to || options.copy))
    throw new OperationFailure(
      'usage.invalidArguments',
      'Cross-Agent install does not accept --to or --copy.',
    );
  if (agents.length) validateAgents(agents);
  if (sources.some((path) => !path.startsWith('/')))
    throw new OperationFailure(
      'usage.invalidLocation',
      'Source installation paths must be absolute.',
    );
  const selected = sources.length
    ? await Promise.all(
        sources.map((path) => readSkill(resolve(project, path))),
      )
    : (await requireSkills(validateNames([...new Set(request.names)]))).map(
        (skill) => ({
          ...skill,
          path: join(collectionPaths().skills, skill.name),
        }),
      );
  for (const skill of selected)
    await validateSkillTree(await realpath(skill.path));
  const inputs: SkillTargetInput[] = [];
  const locations = sources.length
    ? ((await readSkillLocations(project, [], ['project', 'global'])).result
        .items as Record<string, unknown>[])
    : [];
  for (const skill of selected) {
    const cross = sources.length
      ? await resolveCrossAgentInstallPlan(skill)
      : undefined;
    if (
      sources.length &&
      (!cross ||
        !locations.some(
          (entry) =>
            entry.path === skill.path &&
            entry.scope === scope &&
            entry.canInstallAcrossAgents,
        ))
    )
      throw new OperationFailure(
        'usage.invalidLocation',
        'The source is not an installable Agent skill in the selected scope.',
        { path: skill.path },
      );
    const source = cross?.linkTarget ?? skill.path;
    for (const agent of options.to ? ['custom'] : agents) {
      const config = AGENTS[agent];
      if (!options.to && scope === 'project' && !config?.project)
        throw new OperationFailure(
          'usage.unsupportedCapability',
          'The Agent has no project skill directory.',
          { agent, scope },
        );
      const root = options.to
        ? resolve(project, String(options.to))
        : scope === 'global'
          ? config!.global(homedir())
          : join(project, config!.project!);
      const target = join(root, skill.name);
      inputs.push({
        name: skill.name,
        source,
        target,
        agents: agent === 'custom' ? [] : [agent],
        scope: options.to ? null : (scope as 'project' | 'global'),
        copy: options.copy === true,
        registerUsage: cross?.registerUsage ?? options.copy !== true,
        replace: options.replace === true,
        rejectSelfReference: sources.length > 0,
      });
    }
  }
  return executeWrites(
    await planSkillTargets(inputs),
    options['dry-run'] === true,
    false,
    command,
    signal,
  );
}

async function maintainLocations(
  request: SkillWriteRequest,
): Promise<OperationResult> {
  const { names, options, project, signal, command } = request;
  if (!names.length)
    throw new OperationFailure(
      'usage.selectionRequired',
      'Select at least one installation path.',
    );
  const dryRun = options['dry-run'] === true;
  if (command === 'skill.uninstall')
    requireAuthorization(options.yes === true, dryRun, names);
  if (names.some((path) => !path.startsWith('/')))
    throw new OperationFailure(
      'usage.invalidLocation',
      'Installation paths must be absolute.',
    );
  const paths = [...new Set(names.map((path) => resolve(project, path)))];
  const collection = resolve(collectionPaths().root);
  const skills: Skill[] = [];
  const items = [];
  const broken = [];
  for (const path of paths) {
    const physicalParent = await canonicalizePath(dirname(path));
    const physicalCollection = await canonicalizePath(collection);
    if (
      path === collection ||
      path.startsWith(`${collection}${sep}`) ||
      physicalParent === physicalCollection ||
      physicalParent.startsWith(`${physicalCollection}${sep}`)
    )
      throw new OperationFailure(
        'usage.invalidLocation',
        'Collection content cannot be maintained by path.',
        { path },
      );
    if (!(await pathPresent(path))) {
      if (command === 'skill.materialize')
        throw new OperationFailure(
          'usage.selectionNotFound',
          'The skill reference no longer exists.',
          { path },
        );
      items.push({
        path,
        action: 'uninstall',
        status: 'unchanged',
        reason: 'absent',
      });
      continue;
    }
    if (
      (await lstat(path)).isSymbolicLink() &&
      !(await exists(path)) &&
      command === 'skill.uninstall'
    ) {
      const roots = [
        ...PROJECT_SKILL_DIRS.map((root) => resolve(project, root)),
        ...Object.values(AGENTS).map((config) => config.global(homedir())),
      ];
      if (
        !roots.includes(dirname(path)) &&
        !(await readState()).links.some((link) => resolve(link.path) === path)
      )
        throw new OperationFailure(
          'usage.invalidLocation',
          'The broken link is not a known installation location.',
          { path },
        );
      broken.push(path);
      items.push({ path, action: 'uninstall', status: 'planned' });
      continue;
    }
    let skill: Skill;
    try {
      skill = await readSkill(path);
    } catch {
      throw new OperationFailure(
        'usage.invalidLocation',
        'The selected path is not a valid skill location.',
        { path },
      );
    }
    if (command === 'skill.materialize') {
      const locations = await readSkillLocations(project, [], ['project']);
      if (
        !(locations.result.items as Record<string, unknown>[]).some(
          (entry) => entry.path === path && entry.canMaterialize,
        )
      )
        throw new OperationFailure(
          'usage.invalidLocation',
          'Only project skill references can be materialized.',
          { path },
        );
    }
    skills.push(skill);
    items.push({
      path,
      name: skill.name,
      action: command.endsWith('materialize') ? 'materialize' : 'uninstall',
      status: 'planned',
      ...(command.endsWith('uninstall') ? { requiredFlags: ['--yes'] } : {}),
    });
  }
  if (dryRun)
    return { result: { items, git: { status: 'not-needed' }, plannedGit: [] } };
  try {
    if (signal.aborted)
      throw new OperationFailure(
        'execution.interrupted',
        'The operation was interrupted.',
        {},
        130,
        'inspect-state',
      );
    if (command === 'skill.materialize')
      await materializeSkillReferences(skills, { signal });
    else await removeSkillLocations(skills, broken);
    const result = {
      items: items.map((item) => ({
        ...item,
        status: item.status === 'planned' ? 'committed' : item.status,
      })),
      git: { status: 'not-needed' },
    };
    return {
      result,
      ...(signal.aborted
        ? {
            error: {
              code: 'execution.interrupted',
              message: 'The operation was interrupted.',
              details: {},
              retry: 'inspect-state' as const,
            },
            exitCode: 130,
            partial: true,
          }
        : {}),
    };
  } catch (error) {
    const failure = signal.aborted
      ? {
          code: 'execution.interrupted',
          message: 'The operation was interrupted.',
          details: {},
          retry: 'inspect-state' as const,
        }
      : operationError(error, 'write');
    return {
      result: {
        items: items.map((item) =>
          item.status === 'planned'
            ? { ...item, status: 'failed', error: failure, restored: 'unknown' }
            : item,
        ),
        git: { status: 'not-needed' },
      },
      error: failure,
      exitCode: signal.aborted ? 130 : 1,
    };
  }
}

async function updateSkills(
  request: SkillWriteRequest,
): Promise<OperationResult> {
  const { names, options, command, signal } = request;
  if (Boolean(options['allow-delete']) !== Boolean(options.yes))
    throw new OperationFailure(
      'usage.invalidArguments',
      'Deletion requires --allow-delete and --yes together.',
    );
  const selected = await requireSkills(names, options.all === true);
  const plans: PlannedWrite[] = [];
  const clones: string[] = [];
  try {
    const state = await readState();
    for (const skill of selected) {
      let cloned: Awaited<ReturnType<typeof inspectGitSource>> | undefined;
      let item: Record<string, unknown> = {
        name: skill.name,
        action: 'update',
        status: 'planned',
        oldCommit: skill.source.commit ?? null,
      };
      if (skill.source.type !== 'git')
        item = { ...item, status: 'unchanged', reason: 'unmanaged' };
      else if (skill.source.refType !== 'branch')
        item = { ...item, status: 'unchanged', reason: 'pinned' };
      else if (
        state.conflicts.some(
          (conflict) =>
            conflict.type === 'source' && conflict.skill === skill.name,
        )
      )
        item = conflictItem(item, 'conflict.sourceMerge', {
          name: skill.name,
          conflicts: state.conflicts.filter(
            (conflict) =>
              conflict.type === 'source' && conflict.skill === skill.name,
          ),
        });
      else {
        const source = await inspectGitSource(
          `${skill.source.url}${skill.source.ref ? `#${skill.source.ref}` : ''}`,
          signal,
          true,
        );
        cloned = source;
        clones.push(source.temporary);
        item.newCommit = source.source.commit;
        if (source.source.commit === skill.source.commit)
          item = { ...item, status: 'unchanged', reason: 'same-commit' };
        else if (
          !(await exists(
            join(
              source.repository,
              skill.source.commit
                ? await detectRenamedSkillPath(
                    source.repository,
                    skill.source.commit,
                    source.source.commit!,
                    skill.source.path ?? '.',
                  )
                : (skill.source.path ?? '.'),
              'SKILL.md',
            ),
          ))
        ) {
          if (!options['allow-delete'])
            item = conflictItem(item, 'conflict.upstreamDeleted', {
              name: skill.name,
              requiredFlags: ['--allow-delete', '--yes'],
            });
          else item.action = 'remove';
        } else {
          const path = skill.source.commit
            ? await detectRenamedSkillPath(
                source.repository,
                skill.source.commit,
                source.source.commit!,
                skill.source.path ?? '.',
              )
            : (skill.source.path ?? '.');
          await readSkill(join(source.repository, path));
          await validateSkillTree(join(source.repository, path));
        }
      }
      plans.push({
        item,
        execute: async () => {
          const result = await updateGitSkill(
            { ...skill, path: join(collectionPaths().skills, skill.name) },
            options['allow-delete'] === true,
            { quietDelete: true, ...(cloned ? { clone: cloned } : {}) },
          );
          item.updateStatus = result;
          if (result === 'conflict')
            throw new OperationFailure(
              'conflict.sourceMerge',
              'The source update needs conflict resolution.',
              { name: skill.name, conflicts: (await readState()).conflicts },
              1,
              'inspect-state',
            );
        },
      });
    }
    return await executeWrites(
      plans,
      options['dry-run'] === true,
      true,
      command,
      signal,
    );
  } finally {
    for (const path of clones) await rm(path, { recursive: true, force: true });
  }
}
