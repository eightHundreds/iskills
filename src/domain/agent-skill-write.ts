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
  ensureCollection,
  normalizeGitRepositoryIdentity,
} from './core.js';
import {
  createCollectionSkill,
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
import { updateGitSkill, detectRenamedSkillPath } from './git.js';
import { runGit } from './process.js';
import type { Skill, SkillMetadata, GitSource } from './types.js';
import { domainNotify } from './errors.js';

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
  before: { tags: string[]; note: string; description?: string },
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

async function requireSkills(
  names: string[],
  all = false,
): Promise<SkillMetadata[]> {
  const collection = await readSkills();
  if (collection.issues.length)
    throw new OperationFailure(
      'execution.readFailed',
      'The collection has unreadable entries.',
      { issues: collection.issues },
      1,
    );
  const selected = all
    ? collection.items
    : names.map((name) => {
        const skill = collection.items.find((item) => item.name === name);
        if (!skill)
          throw new OperationFailure(
            'usage.selectionNotFound',
            'The skill does not exist.',
            { name },
          );
        return skill;
      });
  return selected.map(({ name, description, tags, note, source }) => ({
    name,
    description,
    tags,
    note,
    source,
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
  if (command === 'skill.create') {
    const name = names[0]!;
    const target = join(collectionPaths().skills, name);
    const template = `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`;
    let item: Record<string, unknown> = {
      name,
      path: target,
      action: 'create',
      status: 'planned',
    };
    if (await pathPresent(target)) {
      const metadata = await readMetadata(name);
      const expected = {
        name,
        description: '',
        tags: [],
        note: '',
        source: { type: 'unknown' },
      };
      const entries = await readdir(target);
      item =
        (await pathPresent(metadataPath(name))) &&
        isDeepStrictEqual(metadata, expected) &&
        entries.length === 1 &&
        (await readFile(join(target, 'SKILL.md'), 'utf8')) === template
          ? { ...item, status: 'unchanged', reason: 'same-template' }
          : conflictItem(item, 'conflict.alreadyExists', { name });
    }
    plans.push({
      item,
      execute: async () => {
        await createCollectionSkill(name);
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
      plans.push({
        item: {
          name,
          action: 'adopt',
          status: present ? 'unchanged' : 'planned',
          reason: 'metadata-present',
        },
        execute: () =>
          writeMetadata({
            name,
            description: skill.description,
            tags: [],
            note: '',
            source: { type: 'unknown' },
          }),
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
        if (
          !['tags', 'add-tag', 'remove-tag', 'note'].some(
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
        plans.push({
          item: {
            name: before.name,
            action: 'edit',
            status: isDeepStrictEqual(before, after) ? 'unchanged' : 'planned',
            reason: 'same-value',
          },
          execute: () => writeMetadata(after),
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
        item = { ...item, status: 'unchanged', reason: 'same-source' };
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
    const plans: PlannedWrite[] = [];
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
      const metadata: SkillMetadata = {
        name: skill.name,
        description: skill.description,
        tags: strings(options, 'tag'),
        note: '',
        source,
      };
      const target = join(collectionPaths().skills, skill.name);
      let item: Record<string, unknown> = {
        name: skill.name,
        action: 'import',
        status: 'planned',
        source,
        collectionPath: target,
        ...(!cloned
          ? { originPath: actual, moved: true, originLink: actual }
          : {}),
      };
      if (await pathPresent(target)) {
        const current = await readMetadata(skill.name);
        const match = await classifyCollectionMatch(current, metadata);
        if (match === 'same-source')
          item = {
            ...item,
            status: 'unchanged',
            reason: 'same-source',
            moved: false,
          };
        else if (!options.replace)
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
          try {
            await installCollectionSkill({
              name: skill.name,
              sourceTree: actual,
              metadata,
              allowReplace: options.replace === true,
              commit: false,
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
            item.restored = 'unknown';
            throw error;
          }
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
