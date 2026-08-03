import { cp, lstat, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import {
  noPresentAgentsError,
  PROJECT_SKILL_DIRS,
  agentGlobalPath,
  agentProjectPath,
  assertRelativePath,
  classifyCollectionMatch,
  collectionPaths,
  commitCollection,
  discoverSkills,
  exists,
  isExactSymlink,
  isGitSource,
  listCollection,
  listGlobalGroups,
  listPresentAgents,
  pathPresent,
  readMetadata,
  resolveIncomingProvenance,
  sanitizeTerminal,
} from '../domain/core.js';
import {
  installCollectionSkill,
  registerCollectionLinks,
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
  SkillMetadata,
} from '../domain/types.js';
import { t } from '../i18n/index.js';

export function formatSkillIdentity(meta: SkillMetadata): string {
  const source = meta.source;
  // Local / path-only: show the path once (do not also append as /suffix).
  if (source.type === 'local' || (!source.url && !source.id && source.path)) {
    return sanitizeTerminal(source.path || source.type || 'local');
  }
  const base = source.url || source.id || source.type;
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

async function gitSkillMetadata(
  skill: Skill,
  gitContext: GitImportContext,
  tags: string[] = []
): Promise<SkillMetadata> {
  return {
    name: skill.name,
    description: skill.description,
    tags,
    note: '',
    source: await resolveIncomingProvenance(skill, gitContext),
  };
}

async function annotateGitCollectionStatus(
  skills: Skill[],
  gitContext: GitImportContext,
  collection: CollectedSkill[]
): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const skill of skills) {
    const sameName = collection.find(
      (collected) => collected.name.toLowerCase() === skill.name.toLowerCase()
    );
    if (!sameName) {
      out.push(skill);
      continue;
    }
    out.push({
      ...skill,
      collectionStatus: await classifyCollectionMatch(
        sameName,
        await gitSkillMetadata(skill, gitContext)
      ),
    });
  }
  return out;
}

/** Write only — caller owns post-write commitCollection (and success messaging). */
async function importLocalSkill(
  skill: Skill,
  allowReplace: boolean,
  tags: string[] = []
): Promise<boolean> {
  const selectedPath = resolve(skill.path);
  const selectedStats = await lstat(selectedPath);
  const originPath = selectedStats.isSymbolicLink() ? await realpath(selectedPath) : selectedPath;
  const provenance = await resolveIncomingProvenance(skill);
  const metadata: SkillMetadata = {
    name: skill.name,
    description: skill.description,
    tags,
    note: '',
    source: provenance,
  };
  const result = await installCollectionSkill({
    name: skill.name,
    sourceTree: originPath,
    metadata,
    allowReplace,
    local: {
      originPath,
      selectedPath,
      selectedWasSymlink: selectedStats.isSymbolicLink(),
    },
    commit: false,
    commitMessage: `import ${skill.name}`,
  });
  return result === 'installed' || result === 'installed-uncommitted';
}

/** Write only — caller owns post-write commitCollection (and success messaging). */
async function importRemoteSkill(
  skill: Skill,
  gitContext: GitImportContext,
  allowReplace: boolean,
  tags: string[] = []
): Promise<boolean> {
  const metadata = await gitSkillMetadata(skill, gitContext, tags);
  const result = await installCollectionSkill({
    name: skill.name,
    sourceTree: skill.path,
    metadata,
    allowReplace,
    commit: false,
    commitMessage: `import ${skill.name}`,
  });
  return result === 'installed' || result === 'installed-uncommitted';
}

export interface RemoteImportOptions {
  replace?: boolean;
  tags?: string[];
  /** Same shape as batch import confirm (single-skill list for search). */
  confirmReplace?: (candidates: ImportReplaceCandidate[]) => Promise<boolean>;
}

export interface RemoteImportResult {
  name: string;
  /** commit-failed: tree/metadata written, post-write Git commit soft-failed */
  status: 'imported' | 'unchanged' | 'cancelled' | 'commit-failed';
}

export interface ImportToCollectionResult {
  /** Skills written this run (0 when nothing installed or selection empty). */
  count: number;
  /**
   * Post-write Git commit soft-failed after `count` skills were written.
   * Success copy must not be shown; domainNotify already warned.
   */
  commitFailed?: true;
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
    const incoming = await gitSkillMetadata(skill, gitContext);
    const target = join(collectionPaths().skills, skill.name);
    const replacing = await pathPresent(target);
    if (replacing) {
      const current = await readMetadata(skill.name);
      const match = await classifyCollectionMatch(current, incoming);
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
        const allowed = await options.confirmReplace([
          { name: skill.name, match, current, incoming },
        ]);
        if (!allowed) {
          return { name: skill.name, status: 'cancelled' };
        }
      }
    }
    const wrote = await importRemoteSkill(skill, gitContext, replacing, options.tags ?? []);
    if (!wrote) return { name: skill.name, status: 'unchanged' };
    // Soft-fail commit: warn already emitted; distinct from user cancel.
    if (!(await commitCollection(`import ${skill.name}`))) {
      return { name: skill.name, status: 'commit-failed' };
    }
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
  skills: Skill[],
  gitContext?: GitImportContext
): Promise<{ sameSource: string[]; candidates: ImportReplaceCandidate[] }> {
  const paths = collectionPaths();
  const sameSource: string[] = [];
  const candidates: ImportReplaceCandidate[] = [];
  for (const skill of skills) {
    if (!(await pathPresent(join(paths.skills, skill.name)))) continue;
    const current = await readMetadata(skill.name);
    const incoming: SkillMetadata = gitContext
      ? await gitSkillMetadata(skill, gitContext, skill.tags ?? [])
      : {
          name: skill.name,
          description: skill.description,
          tags: skill.tags ?? [],
          note: skill.note ?? '',
          source: await resolveIncomingProvenance(skill),
        };
    // Always re-classify at plan time; scan-time collectionStatus is display-only.
    const match = await classifyCollectionMatch(current, incoming);
    if (match === 'same-source') {
      sameSource.push(skill.name);
      continue;
    }
    candidates.push({ name: skill.name, match, current, incoming });
  }
  return { sameSource, candidates };
}

export function defaultReplaceConfirmMessage(candidates: ImportReplaceCandidate[]): {
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

/** Shared replace confirm for CLI default, browser, and search. */
export async function confirmCollectionReplace(
  candidates: ImportReplaceCandidate[]
): Promise<boolean> {
  const { message, details } = defaultReplaceConfirmMessage(candidates);
  return (await import('../ui/overlay/static.js')).Modal.confirm({
    title: t('cmd.replaceCollectionTitle'),
    message,
    details,
  });
}

async function resolveImportSelection(
  skills: Skill[],
  options: ImportToCollectionOptions,
  gitContext?: GitImportContext
): Promise<{ selected: Skill[]; replaceNames: Set<string> }> {
  let selected = skills;
  const replaceNames = new Set<string>();
  if (options.replace) {
    for (const skill of selected) replaceNames.add(skill.name);
  }
  const { sameSource, candidates } = await classifyImportReplacements(selected, gitContext);
  const sameSourceNames = new Set(sameSource);
  selected = selected.filter((skill) => !sameSourceNames.has(skill.name));
  if (candidates.length && !options.replace) {
    if (!process.stdin.isTTY || options.yes) {
      throw new DomainError('cmd.conflictsExistReplace', {
        names: candidates.map((c) => c.name).join(t('common.listSep')),
      });
    }
    const confirm = options.confirmReplace
      ? await options.confirmReplace(candidates)
      : await confirmCollectionReplace(candidates);
    if (!confirm) {
      const blocked = new Set(candidates.map((c) => c.name));
      selected = selected.filter((skill) => !blocked.has(skill.name));
    } else {
      for (const c of candidates) replaceNames.add(c.name);
    }
  }
  return { selected, replaceNames };
}

export async function importSkillsToCollection(
  skills: Skill[],
  options: ImportToCollectionOptions = {}
): Promise<ImportToCollectionResult> {
  if (!skills.length) return { count: 0 };
  const { selected, replaceNames } = await resolveImportSelection(skills, options);
  if (!selected.length) return { count: 0 };
  const installed: string[] = [];
  for (const skill of selected) {
    if (await importLocalSkill(skill, replaceNames.has(skill.name), options.tags ?? [])) {
      installed.push(skill.name);
    }
  }
  if (!installed.length) return { count: 0 };
  // One commit point. Soft-fail: warn via domainNotify; no 已导入 line.
  if (!(await commitCollection(`import ${installed.join(', ')}`))) {
    return { count: installed.length, commitFailed: true };
  }
  if (!options.quiet) console.log(t('cmd.importedCount', { count: installed.length }));
  return { count: installed.length };
}

export async function importGitSkillsToCollection(
  skills: Skill[],
  gitContext: GitImportContext,
  options: ImportToCollectionOptions = {}
): Promise<ImportToCollectionResult> {
  if (!skills.length) return { count: 0 };
  const { selected, replaceNames } = await resolveImportSelection(skills, options, gitContext);
  if (!selected.length) return { count: 0 };
  const installed: string[] = [];
  for (const skill of selected) {
    if (await importRemoteSkill(skill, gitContext, replaceNames.has(skill.name), options.tags ?? [])) {
      installed.push(skill.name);
    }
  }
  if (!installed.length) return { count: 0 };
  if (!(await commitCollection(`import ${installed.join(', ')}`))) {
    return { count: installed.length, commitFailed: true };
  }
  if (!options.quiet) console.log(t('cmd.importedCount', { count: installed.length }));
  return { count: installed.length };
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
      skills = await annotateGitCollectionStatus(
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
    await importGitSkillsToCollection(selected, gitContext, {
      replace: values.replace ?? false,
      yes: values.yes ?? false,
      tags: importTags,
    });
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
