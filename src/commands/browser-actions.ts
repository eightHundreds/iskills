import { cp, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertRelativePath,
  baselinePath,
  collectionPaths,
  commitCollection,
  discoverSkills,
  exists,
  getAgent,
  isGitSource,
  listCollection,
  noPresentAgentsError,
  agentDisplayName,
  agentGlobalPath,
  agentInstallTargets,
  agentProjectPath,
  listPresentAgents,
  listGlobalGroups,
  listProjectGroups,
  parseGitSource,
  primaryPresentAgent,
  readMetadata,
  writeMetadata,
} from '../domain/core.js';
import {
  adoptCollectionSkillsMissingMetadata,
  listCollectionSkillsMissingMetadata,
  materializeSkillReferences,
  removeFromCollection,
  removeSkillLocations,
  unbindCollectedSkillSource,
} from '../domain/collection-write.js';
import {
  canonicalizePath,
  collectSkillSourceRoots,
} from '../domain/cross-agent-install.js';
import { DomainError } from '../domain/errors.js';
import { cloneGitSource, syncCollection, updateGitSkills } from '../domain/git.js';
import type { CollectedSkill, GitSource, Skill, SkillMetadata } from '../domain/types.js';
import type { InstallReviewTarget } from '../ui/install/types.js';
import { Modal } from '../ui/overlay/static.js';
import {
  promptChoice,
  promptChoicesMany,
  promptInstallReview,
  promptTags,
  promptText,
} from '../ui/prompts/present.js';
import { InterruptError } from '../ui/shell/terminal.js';
import type {
  BrowserActionHost,
  BrowserDataSnapshot,
  BrowserResult,
  DetailEditorContext,
  DetailViewContext,
} from '../ui/browser/types.js';
import {
  addSkillsToProject,
  confirmCollectionReplace,
  importGitUrlToCollection,
  importSkillsToCollection,
  installSkillsAcrossAgents,
  type ImportToCollectionResult,
} from './library.js';
import { formatAppError, t } from '../i18n/index.js';
import { persistFailureLog } from '../util/run-log-session.js';

async function bindMetadataSource(
  skillName: string,
  metadata: SkillMetadata,
  input: string,
  ref: string | undefined,
  sourcePath: string,
  refType?: GitSource['refType']
): Promise<void> {
  if (!isGitSource(input)) throw new DomainError('cmd.invalidGitSource', { input });
  const parsed = parseGitSource(input);
  const resolvedRef = ref || parsed.ref;
  const source: GitSource = {
    type: 'git',
    url: parsed.url,
    refType: refType || (/^[0-9a-f]{7,40}$/i.test(resolvedRef || '') ? 'commit' : 'branch'),
    path: assertRelativePath(sourcePath),
    ...(resolvedRef ? { ref: resolvedRef } : {}),
  };
  metadata.source = source;
  const baseline = baselinePath(skillName);
  await rm(baseline, { recursive: true, force: true });
  await cp(join(collectionPaths().skills, skillName), baseline, { recursive: true });
}

export async function loadBrowserData(): Promise<BrowserDataSnapshot> {
  const [projectGroups, collection, globalGroups, skillsMissingMetadata] = await Promise.all([
    listProjectGroups(),
    listCollection(),
    listGlobalGroups(),
    listCollectionSkillsMissingMetadata(),
  ]);
  const canSync = await exists(join(collectionPaths().root, '.git'));
  return { projectGroups, collection, globalGroups, canSync, skillsMissingMetadata };
}

/** One-shot adopt for skills that landed under skills/ without metadata. */
export async function adoptMissingCollectionMetadata(
  names?: string[]
): Promise<string[]> {
  return adoptCollectionSkillsMissingMetadata(names);
}

async function installTargetsAndDefaults(): Promise<{
  targets: InstallReviewTarget[];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
}> {
  const present = await listPresentAgents();
  if (!present.length) throw noPresentAgentsError();
  const targets = agentInstallTargets(present, undefined, (name) =>
    name === 'agents' ? t('cmd.agentDisplayAgents') : agentDisplayName(name)
  );
  // Available: tool root present. Project default: only if this project already has that skills dir
  // (e.g. ~/.zcode exists → zcode is listed, but not pre-checked until .zcode/skills exists).
  const defaultProjectAgents: string[] = [];
  for (const target of targets) {
    if (!target.projectLabel) continue;
    const project = getAgent(target.value).project;
    if (project && (await exists(resolve(project)))) defaultProjectAgents.push(target.value);
  }
  // Global: single primary default (agents first) to avoid multi-tool blast radius.
  const primary = primaryPresentAgent(present);
  const defaultGlobalAgents = primary ? [primary] : [];
  return { targets, defaultProjectAgents, defaultGlobalAgents };
}

export async function loadDetailContext(
  skill: import('../domain/types.js').Skill,
  collection: boolean,
  frameHeight: number,
  frameWidth: number
): Promise<DetailViewContext> {
  const { readState } = await import('../domain/core.js');
  const metadata = collection
    ? await readMetadata(skill.name)
    : {
        name: skill.name,
        description: skill.description,
        tags: skill.tags || [],
        note: skill.note || '',
        source: skill.source || { type: 'unknown' },
      };
  const state = await readState();
  const links = state.links.filter((link) => link.skill === skill.name);
  return { skill, collection, frameHeight, frameWidth, metadata, links };
}

export async function handleBrowserResult(
  host: BrowserActionHost,
  result: BrowserResult
): Promise<'quit' | 'continue'> {
  if (result.type === 'quit') return 'quit';
  // Navigation is owned by the app store; intents never re-ship BrowserState.
  if (result.type === 'open') return 'continue';

  switch (result.type) {
    case 'sync':
      await handleSync(host);
      break;
    case 'update':
      await handleUpdate(host, result.skills);
      break;
    case 'tags':
      await handleTags(host, result.skills);
      break;
    case 'editTags':
    case 'editNote': {
      const metadata = await readMetadata(result.skill.name);
      await handleDetailAction(
        host,
        { skill: result.skill, metadata },
        result.type === 'editTags' ? 'tags' : 'note'
      );
      break;
    }
    case 'add':
      await handleAdd(host, result.skills);
      break;
    case 'removeCollection':
      await handleRemoveCollection(host, result.skills);
      break;
    case 'removeLocations':
      await handleRemoveLocations(host, result.skills);
      break;
    case 'materialize':
      await handleMaterialize(host, result.skills);
      break;
    case 'installToAgents':
      await handleInstallToAgents(host, result.skills, result.scope);
      break;
    case 'import':
      await handleImport(host, result.skills);
      break;
    case 'openSource':
      await handleOpenCollectedGitHubSource(host, result.skill);
      break;
    case 'unbindSource':
      await handleUnbindSource(host, result.skill.name);
      break;
    default:
      break;
  }

  await host.reloadData();
  return 'continue';
}

async function presentActionFailure(
  host: BrowserActionHost,
  error: unknown,
  wrap = false
): Promise<void> {
  if (error instanceof InterruptError) throw error;
  const message = wrap
    ? t('common.failed', { error: formatAppError(error) })
    : formatAppError(error);
  const path = await persistFailureLog(error);
  host.setStatus(
    path ? `${message}\n${t('cli.logWritten', { path })}` : message,
    false,
    'error'
  );
}

async function handleSync(host: BrowserActionHost): Promise<void> {
  host.setStatus('', false);
  // Busy gate: browser disables input while workingAction/updatingSkillName is set.
  host.setWorkingProgress({
    skillName: '',
    current: 1,
    total: 1,
    workingAction: 'sync',
  });
  try {
    // In-process git (no interactive TTY child). Keep TUI mounted so failures
    // land in the status bar instead of being lost across suspend/resume.
    await syncCollection(false);
    host.setStatus(t('cmd.syncDone'), true, 'normal');
  } catch (error) {
    if (error instanceof InterruptError) throw error;
    // Prefer DomainError text alone — avoid "失败：收藏夹 Git 同步失败：…" double prefix.
    await presentActionFailure(host, error);
  } finally {
    host.setWorkingProgress(null);
  }
}

async function handleUpdate(host: BrowserActionHost, skills: CollectedSkill[]): Promise<void> {
  host.setStatus('', false);
  host.setWorkingProgress(null);
  host.discardStaleUpdateCheck();
  let failed = 0;
  try {
    const outcomes = await updateGitSkills(skills, false, {
      quietDelete: true,
      confirmDelete: (links, skill) => Modal.confirm({
        title: t('cmd.upstreamDeleted'),
        message: t('cmd.upstreamDeletedConfirm', { name: skill.name }),
        details: links.map((link) => {
          const kind = link.kind === 'origin'
            ? t('common.origin')
            : link.kind === 'usage'
              ? t('common.usage')
              : t('common.dependent');
          return t('cmd.linkKindLine', { kind, path: link.path });
        }),
      }),
      onProgress: async (skill, current, total) => {
        host.setWorkingProgress({
          skillName: skill.name,
          current,
          total,
          workingAction: 'update',
        });
        await delay(120);
      },
      onSkill: (skill, status) => {
        if (
          status === 'updated' ||
          status === 'unchanged' ||
          status === 'pinned' ||
          status === 'deleted'
        ) {
          host.markSkillsCurrent([skill.name]);
        }
      },
    });
    failed = outcomes.filter((outcome) => 'error' in outcome).length;
  } finally {
    host.setWorkingProgress(null);
  }
  const updated = skills.length - failed;
  host.setStatus(
    failed === 0
      ? t('cmd.updatedCount', { count: updated })
      : t('cmd.updatedWithFailed', { updated, failed }),
    failed === 0,
    failed === 0 ? 'normal' : 'error'
  );
  host.setNavigation({ ...host.getNavigation(), selected: [] });
}

async function handleTags(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  const collection = await listCollection();
  const existing = [...new Set(collection.flatMap((skill) => skill.tags))]
    .sort((left, right) => left.localeCompare(right));
  const added = await promptTags(
    existing,
    [],
    t('cmd.addTagsForSkills', { count: skills.length })
  );
  if (!added?.length) return;
  await Promise.all(skills.map(async (skill) => {
    const metadata = await readMetadata(skill.name);
    metadata.tags = [...new Set([...metadata.tags, ...added])];
    await writeMetadata(metadata);
  }));
  if (await commitCollection(`tag ${skills.map((skill) => skill.name).join(', ')}`)) {
    host.setStatus(t('cmd.tagged'), true, 'normal');
  }
  // Clear multi-select like other bulk list actions (add/update/import).
  host.setNavigation({ ...host.getNavigation(), selected: [] });
}

async function handleAdd(host: BrowserActionHost, skills: CollectedSkill[]): Promise<void> {
  let targets: InstallReviewTarget[];
  let defaultProjectAgents: string[];
  let defaultGlobalAgents: string[];
  try {
    ({ targets, defaultProjectAgents, defaultGlobalAgents } =
      await installTargetsAndDefaults());
  } catch (error) {
    await presentActionFailure(host, error);
    return;
  }
  const install = await promptInstallReview(
    skills,
    targets,
    defaultProjectAgents,
    defaultGlobalAgents
  );
  if (!install) return;
  try {
    const { count, targetCount } = await addSkillsToProject(skills, {
      quiet: true,
      agent: install.agents,
      copy: install.copy,
      confirmReplace: (target) => Modal.confirm({
        title: t('cmd.replaceTargetTitle'),
        message: t('cmd.replaceTargetConfirm', { target }),
      }),
      ...(install.destination === 'global' ? { global: true } : {}),
    });
    host.setStatus(t('cmd.addedCount', { count }), true, 'normal');
    host.setNavigation({ ...host.getNavigation(), selected: [] });
  } catch (error) {
    await presentActionFailure(host, error, true);
  }
}

async function handleRemoveCollection(
  host: BrowserActionHost,
  skills: CollectedSkill[]
): Promise<void> {
  const names = skills.map((skill) => skill.name);
  try {
    for (const skill of skills) await removeFromCollection(skill.name, true, true);
    host.setStatus(
      names.length === 1 ? t('cmd.removedOne', { name: names[0] ?? '' }) : t('cmd.removedCount', { count: names.length }),
      true,
      'normal'
    );
    const removed = new Set(skills.map((skill) => skill.path));
    host.setNavigation({
      ...host.getNavigation(),
      selected: host.getNavigation().selected.filter((path) => !removed.has(path)),
    });
  } catch (error) {
    await presentActionFailure(host, error, true);
  }
}

async function handleRemoveLocations(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  try {
    const count = await removeSkillLocations(skills);
    host.setStatus(
      count === 1 ? t('cmd.deletedOne', { name: skills[0]?.name ?? '' }) : t('cmd.deletedCount', { count }),
      true,
      'normal'
    );
    const removed = new Set(skills.map((skill) => skill.path));
    host.setNavigation({
      ...host.getNavigation(),
      selected: host.getNavigation().selected.filter((path) => !removed.has(path)),
    });
  } catch (error) {
    await presentActionFailure(host, error, true);
  }
}

async function handleInstallToAgents(
  host: BrowserActionHost,
  skills: Skill[],
  scope: 'project' | 'global'
): Promise<void> {
  if (!skills.length) return;
  let present: string[];
  try {
    present = await listPresentAgents();
  } catch (error) {
    await presentActionFailure(host, error);
    return;
  }
  if (!present.length) {
    await presentActionFailure(host, noPresentAgentsError());
    return;
  }
  // Exclude every source skill root (lexical + canonical — symlink aliases collapse).
  const sourceRoots = await collectSkillSourceRoots(skills);
  const targets = agentInstallTargets(present, undefined, (name) =>
    name === 'agents' ? t('cmd.agentDisplayAgents') : agentDisplayName(name)
  );
  const choices: Array<{ label: string; value: string }> = [];
  const seenRoots = new Set<string>();
  for (const target of targets) {
    let root: string | undefined;
    let label: string | undefined;
    if (scope === 'project') {
      if (!target.projectLabel) continue;
      try {
        root = resolve(agentProjectPath(target.value));
      } catch {
        continue;
      }
      label = target.projectLabel;
    } else {
      if (!target.globalLabel) continue;
      root = resolve(agentGlobalPath(target.value));
      label = target.globalLabel;
    }
    const rootCanon = await canonicalizePath(root);
    if (sourceRoots.has(root) || sourceRoots.has(rootCanon)) continue;
    if (seenRoots.has(rootCanon)) continue;
    seenRoots.add(rootCanon);
    choices.push({ label, value: target.value });
  }
  if (!choices.length) {
    await presentActionFailure(host, new DomainError('cmd.noOtherAgentTargets'));
    return;
  }
  const selectedAgents = await promptChoicesMany(
    choices,
    t('cmd.selectInstallAgents'),
    []
  );
  if (!selectedAgents.length) return;
  // Dedupe by canonical root so symlink-aliased agents are not written twice.
  const rootsByCanon = new Map<string, string>();
  for (const name of selectedAgents) {
    const root =
      scope === 'project' ? resolve(agentProjectPath(name)) : resolve(agentGlobalPath(name));
    const canon = await canonicalizePath(root);
    if (!rootsByCanon.has(canon)) rootsByCanon.set(canon, root);
  }
  const roots = [...rootsByCanon.values()];
  try {
    const { count } = await installSkillsAcrossAgents(skills, roots, {
      confirmReplaceAll: (conflicts) =>
        Modal.confirm({
          title: t('cmd.replaceTargetTitle'),
          message: t('cmd.replaceTargetsConfirm', { count: conflicts.length }),
          details: conflicts,
        }),
    });
    host.setStatus(t('cmd.addedCount', { count }), true, 'normal');
    host.setNavigation({ ...host.getNavigation(), selected: [] });
  } catch (error) {
    await presentActionFailure(host, error, true);
  }
}

async function handleMaterialize(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  const controller = new AbortController();
  host.setAbortController(controller);
  try {
    await materializeSkillReferences(skills, {
      signal: controller.signal,
      onProgress: async (skill, current, total) => {
        host.setWorkingProgress({
          skillName: skill.name,
          current,
          total,
          workingAction: 'materialize',
        });
        for (let tick = 0; tick < 12; tick += 1) {
          if (controller.signal.aborted) throw new InterruptError();
          await delay(10);
        }
      },
    });
    host.setWorkingProgress(null);
    host.setStatus(
      skills.length === 1 ? t('cmd.materializedOne') : t('cmd.materializedCount', { count: skills.length }),
      true,
      'normal'
    );
    host.setNavigation({ ...host.getNavigation(), selected: [] });
  } catch (error) {
    host.setWorkingProgress(null);
    if (error instanceof InterruptError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new InterruptError();
    await presentActionFailure(host, error, true);
  } finally {
    host.setAbortController(null);
  }
}

function applyImportStatus(host: BrowserActionHost, result: ImportToCollectionResult): void {
  if (result.commitFailed) {
    host.setStatus(
      t('domain.gitCommitFailed', { error: '' }).replace(/[：:]\s*$/, ''),
      false,
      'error'
    );
    return;
  }
  if (result.count > 0) {
    host.setStatus(t('cmd.importedShort', { count: result.count }), true, 'normal');
  }
}

export async function handleOpenCollectedGitHubSource(
  host: BrowserActionHost,
  skill: Skill
): Promise<number> {
  const url = skill.source?.url?.trim();
  if (!url) return 0;
  host.setStatus('', false);
  host.setWorkingProgress({
    skillName: '',
    current: 1,
    total: 1,
    workingAction: 'openSource',
  });
  try {
    const result = await importGitUrlToCollection(url, {
      quiet: true,
      confirmReplace: confirmCollectionReplace,
    });
    applyImportStatus(host, result);
    return result.count;
  } catch (error) {
    if (error instanceof InterruptError) throw error;
    await presentActionFailure(host, error, true);
    return 0;
  } finally {
    host.setWorkingProgress(null);
  }
}

async function handleImport(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  try {
    applyImportStatus(
      host,
      await importSkillsToCollection(skills, {
        quiet: true,
        confirmReplace: confirmCollectionReplace,
      })
    );
  } catch (error) {
    await presentActionFailure(host, error, true);
  }
  host.setNavigation({ ...host.getNavigation(), selected: [] });
}

export async function handleUnbindSource(host: BrowserActionHost, skillName: string): Promise<void> {
  await unbindCollectedSkillSource(skillName);
  host.setStatus(t('browser.unbindSourceDone'), true, 'normal');
  host.markSkillsCurrent([skillName]);
  host.discardStaleUpdateCheck();
}

export async function handleDetailAction(
  host: BrowserActionHost,
  context: DetailEditorContext,
  action: 'note' | 'tags' | 'source'
): Promise<void> {
  const { skill, metadata } = context;
  if (action === 'note') {
    const note = await promptText(
      t('cmd.editNoteLabel'),
      metadata.note,
      t('cmd.editNoteTitle')
    );
    if (note === undefined) return;
    metadata.note = note;
    await writeMetadata(metadata);
    await commitCollection(`note ${skill.name}`);
    return;
  }
  if (action === 'tags') {
    const existing = [...new Set((await listCollection()).flatMap((item) => item.tags))]
      .sort((left, right) => left.localeCompare(right));
    const tags = await promptTags(existing, metadata.tags, t('cmd.editTags'));
    if (tags === undefined) return;
    metadata.tags = tags;
    await writeMetadata(metadata);
    await commitCollection(`tag ${skill.name}`);
    return;
  }
  if (action === 'source') {
    const sourceValue = await promptText(
      t('cmd.gitSourcePrompt'),
      metadata.source.url || ''
    );
    if (sourceValue === undefined) return;
    const sourceInput = sourceValue.trim();
    if (!isGitSource(sourceInput)) {
      throw new DomainError('cmd.invalidGitSource', { input: sourceInput });
    }
    const parsed = parseGitSource(sourceInput);
    const refValue = await promptText(
      t('cmd.refPrompt'),
      parsed.ref || metadata.source.ref || ''
    );
    if (refValue === undefined) return;
    const ref = refValue.trim();
    const gitContext = await cloneGitSource(ref ? `${parsed.url}#${ref}` : parsed.url);
    try {
      const options = (await discoverSkills(gitContext.repository))
        .map((candidate) => {
          const path = assertRelativePath(
            relative(gitContext.repository, candidate.path).split(sep).join('/')
          );
          return {
            label: `${candidate.name} — ${path}`,
            value: path,
            rank: candidate.name !== skill.name ? 2 : path === metadata.source.path ? 0 : 1,
          };
        })
        .sort((left, right) => left.rank - right.rank || left.value.localeCompare(right.value))
        .map(({ label, value }) => ({ label, value }));
      if (!options.length) throw new DomainError('cmd.noSkillMdInRepo');
      const sourcePath = await promptChoice(options, t('cmd.selectSkillInRepo'));
      if (sourcePath === undefined) return;
      await bindMetadataSource(
        skill.name,
        metadata,
        gitContext.source.url,
        gitContext.source.ref,
        sourcePath,
        gitContext.source.refType
      );
      await writeMetadata(metadata);
      await commitCollection(`source ${skill.name}`);
    } finally {
      await rm(gitContext.temporary, { recursive: true, force: true });
    }
  }
}
