import { cp, lstat, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import {
  noPresentAgentsError,
  PROJECT_SKILL_DIRS,
  agentGlobalPath,
  agentProjectPath,
  assertRelativePath,
  assertSkillName,
  baselinePath,
  classifyCollectionMatch,
  collectionPaths,
  commitCollection,
  discoverSkills,
  ensureCollection,
  exists,
  getAgent,
  isExactSymlink,
  isGitSource,
  listCollection,
  listGlobalGroups,
  listPresentAgents,
  metadataPath,
  moveDirectory,
  pathPresent,
  provenanceFromKnownLocks,
  readMetadata,
  sameGitIdentity,
  sanitizeTerminal,
  validateSkillTree,
  writeMetadata,
} from '../domain/core.js';
import {
  registerCollectionLinks,
  replaceCollectionSkill,
} from '../domain/collection-write.js';
import { DomainError } from '../domain/errors.js';
import { matchesSkill } from '../domain/skill-query.js';
import { cloneGitSource } from '../domain/git.js';
import { collectionMatchLabels } from '../ui/collection-match.js';
import type {
  CollectedSkill,
  CollectionMatch,
  GitImportContext,
  Skill,
  SkillLink,
  SkillMetadata,
} from '../domain/types.js';
import { t } from '../i18n/index.js';

export function formatSkillIdentity(meta: SkillMetadata): string {
  const source = meta.source;
  const base = source.url || source.id || source.path || source.type;
  const path = source.path && source.path !== '.' ? `/${source.path}` : '';
  return sanitizeTerminal(`${String(base).replace(/\/$/, '')}${path}`);
}

export type ImportReplaceCandidate = {
  name: string;
  match: CollectionMatch;
  current: SkillMetadata;
  incoming: SkillMetadata;
};

type PresentModule = typeof import('../ui/prompts/present.js');

function present(): Promise<PresentModule> {
  return import('../ui/prompts/present.js');
}

function gitSkillDisplayPath(skill: Skill, gitContext: GitImportContext): string {
  const sourcePath = assertRelativePath(
    relative(gitContext.repository, skill.path).split(sep).join('/')
  );
  const ref = gitContext.source.ref ? `#${gitContext.source.ref}` : '';
  const status = skill.collectionStatus
    ? ` · ${collectionMatchLabels()[skill.collectionStatus]}`
    : '';
  return `${sanitizeTerminal(gitContext.source.url)}${sanitizeTerminal(ref)} · ${sanitizeTerminal(sourcePath)}${status}`;
}

function gitSkillMetadata(
  skill: Skill,
  gitContext: GitImportContext,
  tags: string[] = []
): SkillMetadata {
  return {
    name: skill.name,
    description: skill.description,
    tags,
    note: '',
    source: {
      ...gitContext.source,
      path: assertRelativePath(relative(gitContext.repository, skill.path).split(sep).join('/')),
    },
  };
}

function annotateGitCollectionStatus(
  skills: Skill[],
  gitContext: GitImportContext,
  collection: CollectedSkill[]
): Skill[] {
  return skills.map((skill) => {
    const sameName = collection.find(
      (collected) => collected.name.toLowerCase() === skill.name.toLowerCase()
    );
    if (!sameName) return skill;
    return {
      ...skill,
      collectionStatus: classifyCollectionMatch(sameName, gitSkillMetadata(skill, gitContext)),
    };
  });
}

async function importLocalSkill(
  skill: Skill,
  allowReplace: boolean,
  tags: string[] = []
): Promise<boolean> {
  const paths = collectionPaths();
  const selectedPath = resolve(skill.path);
  const selectedStats = await lstat(selectedPath);
  const source = selectedStats.isSymbolicLink() ? await realpath(selectedPath) : selectedPath;
  const target = join(paths.skills, assertSkillName(skill.name));
  if (source === target) return false;

  // Same provenance builder as classifyImportReplacements (locks, then local path).
  const lockSource = await provenanceFromKnownLocks(skill);
  const provenance: SkillMetadata['source'] = skill.source?.type
    ? (skill.source as SkillMetadata['source'])
    : lockSource.type
      ? lockSource
      : { type: 'local', path: skill.path };
  await validateSkillTree(source);
  if (await pathPresent(target)) {
    const current = await readMetadata(skill.name);
    const incoming: SkillMetadata = {
      name: skill.name,
      description: skill.description,
      tags,
      note: '',
      source: provenance,
    };
    // Same-source is a no-op (annotated status or git identity).
    if (
      skill.collectionStatus === 'same-source' ||
      classifyCollectionMatch(current, incoming) === 'same-source'
    ) {
      return false;
    }
    if (!allowReplace) {
      throw new DomainError('cmd.sameNameExistsReplace', { name: skill.name });
    }
    await ensureCollection();
    const transaction = await mkdtemp(join(paths.local, `.prepare-${skill.name}-`));
    const staged = join(transaction, 'tree');
    try {
      await cp(source, staged, { recursive: true, errorOnExist: true });
      await replaceCollectionSkill({
        name: skill.name,
        staged,
        metadata: incoming,
        local: {
          source,
          selectedPath,
          selectedWasSymlink: selectedStats.isSymbolicLink(),
        },
      });
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
    return true;
  }
  await ensureCollection();
  await moveDirectory(source, target);
  try {
    await symlink(target, source, 'dir');
  } catch (error) {
    await moveDirectory(target, source);
    throw error;
  }

  await writeMetadata({
    name: skill.name,
    description: skill.description,
    tags,
    note: '',
    source: provenance,
  });
  if (provenance.type === 'git' && !provenance.commit) {
    const baseline = baselinePath(skill.name);
    await rm(baseline, { recursive: true, force: true });
    await cp(target, baseline, { recursive: true });
  }
  const links: SkillLink[] = [{ skill: skill.name, path: source, kind: 'origin' }];
  if (selectedStats.isSymbolicLink()) {
    links.push({ skill: skill.name, path: selectedPath, kind: 'dependent' });
  }
  await registerCollectionLinks(links);
  return true;
}

async function importRemoteSkill(
  skill: Skill,
  gitContext: GitImportContext,
  allowReplace: boolean,
  tags: string[] = []
): Promise<boolean> {
  const paths = collectionPaths();
  const target = join(paths.skills, assertSkillName(skill.name));
  const metadata = gitSkillMetadata(skill, gitContext, tags);
  await validateSkillTree(skill.path);
  if (await pathPresent(target)) {
    const current = await readMetadata(skill.name);
    if (sameGitIdentity(current, metadata)) return false;
    if (!allowReplace) {
      throw new DomainError('cmd.sameNameExistsReplace', { name: skill.name });
    }
    await ensureCollection();
    const transaction = await mkdtemp(join(paths.local, `.prepare-${skill.name}-`));
    const staged = join(transaction, 'tree');
    try {
      await cp(skill.path, staged, { recursive: true, errorOnExist: true });
      await replaceCollectionSkill({
        name: skill.name,
        staged,
        metadata,
      });
    } finally {
      await rm(transaction, { recursive: true, force: true });
    }
    return true;
  }
  await ensureCollection();
  await cp(skill.path, target, { recursive: true, errorOnExist: true });
  await writeMetadata(metadata);
  return true;
}

export interface RemoteImportOptions {
  replace?: boolean;
  tags?: string[];
  confirmReplace?: (current: SkillMetadata, incoming: SkillMetadata) => Promise<boolean>;
}

export interface RemoteImportResult {
  name: string;
  status: 'imported' | 'unchanged' | 'cancelled';
}

export async function importRemoteSkillToCollection(
  source: string,
  skillName: string,
  options: RemoteImportOptions = {}
): Promise<RemoteImportResult> {
  const gitContext = await cloneGitSource(source);
  try {
    const found = (await discoverSkills(gitContext.repository)).filter(
      (skill) => skill.name.toLowerCase() === skillName.toLowerCase()
    );
    if (!found.length) throw new DomainError('cmd.skillMissingInSource', { name: skillName });
    if (found.length > 1) throw new DomainError('cmd.skillDuplicateInSource', { name: skillName });
    const skill = found[0]!;
    const incoming = gitSkillMetadata(skill, gitContext);
    const target = join(collectionPaths().skills, skill.name);
    const replacing = await pathPresent(target);
    if (replacing) {
      const current = await readMetadata(skill.name);
      const match = classifyCollectionMatch(current, incoming);
      if (match === 'same-source') {
        return { name: skill.name, status: 'unchanged' };
      }
      if (!options.replace) {
        if (!options.confirmReplace) {
          throw new DomainError(
            match === 'unverified-source'
              ? 'cmd.unverifiedSourceExists'
              : 'cmd.conflictingSourceExists',
            { name: skill.name }
          );
        }
        if (!(await options.confirmReplace(current, incoming))) {
          return { name: skill.name, status: 'cancelled' };
        }
      }
    }
    await importRemoteSkill(skill, gitContext, replacing, options.tags ?? []);
    if (!replacing) await commitCollection(`import ${skill.name}`);
    return { name: skill.name, status: 'imported' };
  } finally {
    await rm(gitContext.temporary, { recursive: true, force: true });
  }
}

interface ImportToCollectionOptions {
  replace?: boolean;
  yes?: boolean;
  quiet?: boolean;
  tags?: string[];
  /** Confirm only for conflicting / unverified same-name entries (not same-source). */
  confirmReplace?: (candidates: ImportReplaceCandidate[]) => Promise<boolean>;
}

async function classifyImportReplacements(
  skills: Skill[]
): Promise<{ sameSource: string[]; candidates: ImportReplaceCandidate[] }> {
  const paths = collectionPaths();
  const sameSource: string[] = [];
  const candidates: ImportReplaceCandidate[] = [];
  for (const skill of skills) {
    if (!(await pathPresent(join(paths.skills, skill.name)))) continue;
    const current = await readMetadata(skill.name);
    const lockSource = await provenanceFromKnownLocks(skill);
    const provenance: SkillMetadata['source'] = skill.source?.type
      ? (skill.source as SkillMetadata['source'])
      : lockSource.type
        ? lockSource
        : { type: 'local', path: skill.path };
    const incoming: SkillMetadata = {
      name: skill.name,
      description: skill.description,
      tags: skill.tags ?? [],
      note: skill.note ?? '',
      source: provenance,
    };
    // Prefer pre-annotated git match when present; else full metadata classify.
    const match =
      skill.collectionStatus ??
      classifyCollectionMatch(current, incoming);
    if (match === 'same-source') {
      sameSource.push(skill.name);
      continue;
    }
    candidates.push({ name: skill.name, match, current, incoming });
  }
  return { sameSource, candidates };
}

function defaultReplaceConfirmMessage(candidates: ImportReplaceCandidate[]): {
  message: string;
  details: string[];
} {
  if (candidates.length === 1) {
    const item = candidates[0]!;
    return {
      message: t('cmd.replaceIdentityConfirm', {
        name: item.name,
        from: formatSkillIdentity(item.current),
        to: formatSkillIdentity(item.incoming),
      }),
      details: [collectionMatchLabels()[item.match]],
    };
  }
  return {
    message: t('cmd.replaceSameNameConfirm', {
      names: candidates.map((c) => c.name).join(t('common.listSep')),
    }),
    details: candidates.map(
      (c) =>
        `${c.name}: ${formatSkillIdentity(c.current)} → ${formatSkillIdentity(c.incoming)} · ${collectionMatchLabels()[c.match]}`
    ),
  };
}

export async function importSkillsToCollection(
  skills: Skill[],
  options: ImportToCollectionOptions = {}
): Promise<{ count: number }> {
  if (!skills.length) return { count: 0 };
  let selected = skills;
  const replaceNames = new Set<string>();
  if (options.replace) {
    for (const skill of selected) replaceNames.add(skill.name);
  }
  const { candidates } = await classifyImportReplacements(selected);
  if (candidates.length && !options.replace) {
    if (!process.stdin.isTTY || options.yes) {
      throw new DomainError('cmd.conflictsExistReplace', {
        names: candidates.map((c) => c.name).join(t('common.listSep')),
      });
    }
    const confirm = options.confirmReplace
      ? await options.confirmReplace(candidates)
      : await (async () => {
          const { message, details } = defaultReplaceConfirmMessage(candidates);
          return (await import('../ui/overlay/static.js')).Modal.confirm({
            title: t('cmd.replaceCollectionTitle'),
            message,
            details,
          });
        })();
    if (!confirm) {
      const blocked = new Set(candidates.map((c) => c.name));
      selected = selected.filter((skill) => !blocked.has(skill.name));
    } else {
      for (const c of candidates) replaceNames.add(c.name);
    }
  }
  if (!selected.length) return { count: 0 };
  let count = 0;
  for (const skill of selected) {
    // Same-source names never get replace permission; importLocalSkill no-ops them.
    if (await importLocalSkill(skill, replaceNames.has(skill.name), options.tags ?? [])) {
      count++;
    }
  }
  await commitCollection(`import ${selected.map((skill) => skill.name).join(', ')}`);
  if (!options.quiet) {
    console.log(t('cmd.importedCount', { count }));
  }
  return { count };
}

export async function commandImport(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      global: { type: 'boolean', short: 'g' },
      all: { type: 'boolean' },
      agent: { type: 'string', multiple: true },
      replace: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  if (values.global && positionals.length) throw new DomainError('cmd.cannotSourceAndGlobal');
  if (positionals.length > 1) throw new DomainError('cmd.oneImportRootOnly');

  const input = positionals[0];
  const localInput = input ? resolve(input) : undefined;
  const gitContext = input && localInput && !(await exists(localInput)) && isGitSource(input)
    ? await cloneGitSource(input)
    : undefined;
  try {
    const paths = collectionPaths();
    const isCollected = (skill: Skill) =>
      skill.path !== join(paths.skills, skill.name) &&
      !skill.path.startsWith(`${paths.root}${sep}`);

    let skills: Skill[];
    let globalGroups: { agent: string; skills: Skill[] }[] | undefined;
    if (gitContext) {
      const collection = await listCollection().catch(() => []);
      skills = annotateGitCollectionStatus(
        (await discoverSkills(gitContext.repository)).filter(isCollected),
        gitContext,
        collection
      );
    } else if (values.global) {
      if (!(values.agent?.length) && !(await listPresentAgents()).length) {
        throw noPresentAgentsError();
      }
      const groups = await listGlobalGroups(values.agent);
      globalGroups = groups
        .map((group) => ({
          agent: group.agent,
          skills: group.skills.filter((skill) => !skill.fromCollection && isCollected(skill)),
        }))
        .filter((group) => group.skills.length > 0);
      skills = globalGroups.flatMap((group) => group.skills);
    } else {
      skills = (await discoverSkills(localInput || resolve('.'))).filter(isCollected);
    }
    if (!skills.length) throw new DomainError('cmd.noSkillMd');

    let selected = skills;
    if (!values.all && (skills.length > 1 || !input)) {
      if (!process.stdin.isTTY) throw new DomainError('cmd.useAllOrInteractive');
      const groups = globalGroups ?? [{ agent: gitContext ? t('common.git') : t('common.local'), skills }];
      selected = await (await present()).promptSkillGroups(
        groups,
        globalGroups
          ? t('cmd.scanGlobalSkills')
          : !input
            ? t('cmd.selectRepoSkills')
            : t('cmd.foundSkills')
      );
    }
    if (!selected.length) return;

    let importTags: string[] = [];
    if (!values.yes) {
      if (!process.stdin.isTTY) throw new DomainError('cmd.useYesToConfirmImport');
      const existingTags = [...new Set((await listCollection().catch(() => []))
        .flatMap((skill) => skill.tags))]
        .sort((a, b) => a.localeCompare(b));
      const review = await (await present()).promptImportReview(
        selected.map((skill) => ({
          skill,
          detail: gitContext
            ? gitSkillDisplayPath(skill, gitContext)
            : sanitizeTerminal(skill.path),
        })),
        existingTags
      );
      if (!review) return;
      importTags = review.tags;
    }

    if (!gitContext) {
      await importSkillsToCollection(selected, {
        replace: values.replace ?? false,
        yes: values.yes ?? false,
        tags: importTags,
      });
      return;
    }
    const replaceNames = new Set<string>();
    if (values.replace) {
      for (const skill of selected) replaceNames.add(skill.name);
    }
    const candidates: ImportReplaceCandidate[] = [];
    for (const skill of selected) {
      if (!(await pathPresent(join(paths.skills, skill.name)))) continue;
      if (skill.collectionStatus === 'same-source') continue;
      const current = await readMetadata(skill.name);
      const incoming = gitSkillMetadata(skill, gitContext, importTags);
      const match =
        skill.collectionStatus ?? classifyCollectionMatch(current, incoming);
      if (match === 'same-source') continue;
      candidates.push({ name: skill.name, match, current, incoming });
    }
    if (candidates.length && !values.replace) {
      if (!process.stdin.isTTY || values.yes) {
        throw new DomainError('cmd.conflictsExistReplace', {
          names: candidates.map((c) => c.name).join(t('common.listSep')),
        });
      }
      const { message, details } = defaultReplaceConfirmMessage(candidates);
      const confirmed = await (await import('../ui/overlay/static.js')).Modal.confirm({
        title: t('cmd.replaceCollectionTitle'),
        message,
        details,
      });
      if (!confirmed) {
        const blocked = new Set(candidates.map((c) => c.name));
        selected = selected.filter((skill) => !blocked.has(skill.name));
      } else {
        for (const c of candidates) replaceNames.add(c.name);
      }
    }
    let count = 0;
    for (const skill of selected) {
      if (await importRemoteSkill(skill, gitContext, replaceNames.has(skill.name), importTags)) {
        count++;
      }
    }
    await commitCollection(`import ${selected.map((skill) => skill.name).join(', ')}`);
    console.log(t('cmd.importedCount', { count }));
  } finally {
    if (gitContext) await rm(gitContext.temporary, { recursive: true, force: true });
  }
}

interface AddValues {
  agent?: string[];
  global?: boolean;
  to?: string;
  copy?: boolean;
  replace?: boolean;
  yes?: boolean;
  quiet?: boolean;
  confirmReplace?: (target: string) => Promise<boolean>;
}

async function resolveTargets(values: AddValues): Promise<string[]> {
  if (values.to) return [resolve(values.to)];
  const requestedAgents = values.agent || [];
  if (values.global) {
    let names = requestedAgents;
    if (!names.length) {
      if (!process.stdin.isTTY) throw new DomainError('cmd.globalNeedsAgent');
      const presentNames = await listPresentAgents();
      if (!presentNames.length) throw noPresentAgentsError();
      names = await (await present()).promptChoicesMany(
        presentNames.map((name) => ({ label: name, value: name })),
        t('cmd.selectGlobalAgent')
      );
      if (!names.length) throw noPresentAgentsError();
    }
    return [...new Set(names.map((name) => agentGlobalPath(name)))];
  }
  if (requestedAgents.length) {
    return [...new Set(requestedAgents.map((name) => agentProjectPath(name)))];
  }

  const detected: string[] = [];
  for (const directory of PROJECT_SKILL_DIRS) {
    if (await exists(resolve(directory))) detected.push(resolve(directory));
  }
  const unique = [...new Set(detected)];
  if (unique.length <= 1) return unique.length ? unique : [resolve('.agents/skills')];
  if (!process.stdin.isTTY) return [resolve('.agents/skills')];
  return (await present()).promptChoicesMany(
    unique.map((path) => ({ label: relative(process.cwd(), path), value: path })),
    t('cmd.multipleAgentDirs')
  );
}

async function selectCollectionSkills(names: string[]): Promise<CollectedSkill[]> {
  const skills = await listCollection();
  if (names.length) {
    const selected = names.flatMap((name) => {
      const skill = skills.find((item) => item.name === name);
      return skill ? [skill] : [];
    });
    const found = new Set(selected.map((skill) => skill.name));
    const missing = names.filter((name) => !found.has(name));
    if (missing.length) throw new DomainError('cmd.missingInCollection', { names: missing.join(', ') });
    return selected;
  }
  if (!process.stdin.isTTY) throw new DomainError('cmd.specifySkillNames');
  if (!skills.length) {
    let source: string | undefined;
    const ui = await present();
    source = await ui.promptChoice(
      [
        { label: t('cmd.scanCurrentDir'), value: 'current' },
        { label: t('cmd.scanGlobalAgents'), value: 'global' },
        { label: t('cmd.enterPathOrGit'), value: 'custom' },
      ],
      t('cmd.emptyCollectionImportWhere')
    );
    if (source === 'custom') source = await ui.promptText(t('cmd.pathOrGitPrompt'));
    if (!source) return [];
    await commandImport(source === 'global' ? ['-g'] : source === 'current' ? [] : [source]);
    return listCollection();
  }
  const ui = await present();
  const query = await ui.promptText(t('cmd.searchCollection'));
  if (query === undefined) return [];
  return ui.promptSkills(
    skills.filter((skill) => matchesSkill(skill, query)),
    t('cmd.selectSkills')
  );
}

export async function addSkillsToProject(
  skills: CollectedSkill[],
  values: AddValues = {}
): Promise<{ count: number; targetCount: number }> {
  if (!skills.length) return { count: 0, targetCount: 0 };
  const targetRoots = await resolveTargets(values);
  if (!targetRoots.length) return { count: 0, targetCount: 0 };
  await Promise.all(targetRoots.map((targetRoot) => mkdir(targetRoot, { recursive: true })));
  const addedSkills = new Set<string>();
  const addedTargets = new Set<string>();
  const usageLinks: Array<{ skill: string; path: string; kind: 'usage' }> = [];

  for (const targetRoot of targetRoots) {
    for (const skill of skills) {
      const target = join(targetRoot, skill.name);
      if (target === resolve(skill.path) || target.startsWith(`${resolve(skill.path)}${sep}`)) {
        throw new DomainError('cmd.targetPointsSelf', { target });
      }
      if (await pathPresent(target)) {
        if (await isExactSymlink(target, skill.path)) continue;
        let replace = values.replace ?? false;
        if (!replace && process.stdin.isTTY && !values.yes) {
          replace = values.confirmReplace
            ? await values.confirmReplace(target)
            : await (await import('../ui/overlay/static.js')).Modal.confirm({
              title: t('common.confirm'),
              message: t('cmd.replaceTargetConfirm', { target }),
            });
        }
        if (!replace) {
          if (process.stdin.isTTY && !values.yes) continue;
          throw new DomainError('cmd.targetExistsReplace', { target });
        }
        await rm(target, { recursive: true });
      }
      if (values.copy) {
        await cp(skill.path, target, { recursive: true, errorOnExist: true });
      } else {
        await symlink(skill.path, target, 'dir');
        usageLinks.push({ skill: skill.name, path: target, kind: 'usage' });
      }
      addedSkills.add(skill.name);
      addedTargets.add(targetRoot);
    }
  }
  await registerCollectionLinks(usageLinks);
  if (!values.quiet) {
    console.log(
      t('cmd.addedSkillsToDirs', {
        skills: addedSkills.size,
        dirs: addedTargets.size,
        copy: values.copy ? t('cmd.addedCopySuffix') : '',
      })
    );
  }
  return { count: addedSkills.size, targetCount: addedTargets.size };
}

export async function commandAdd(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      agent: { type: 'string', multiple: true },
      global: { type: 'boolean', short: 'g' },
      to: { type: 'string' },
      copy: { type: 'boolean' },
      replace: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  const skills = await selectCollectionSkills(positionals);
  if (!skills.length) return;
  const options: AddValues = {};
  if (values.agent) options.agent = values.agent;
  if (values.global !== undefined) options.global = values.global;
  if (values.to) options.to = values.to;
  if (values.copy !== undefined) options.copy = values.copy;
  if (values.replace !== undefined) options.replace = values.replace;
  if (values.yes !== undefined) options.yes = values.yes;
  await addSkillsToProject(skills, options);
}
