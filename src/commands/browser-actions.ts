import { cp, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertRelativePath,
  baselinePath,
  collectionPaths,
  commitCollection,
  discoverSkills,
  errorMessage,
  exists,
  getAgent,
  isGitSource,
  listCollection,
  noPresentAgentsError,
  agentInstallTargets,
  listPresentAgents,
  listProjectGroups,
  parseGitSource,
  primaryPresentAgent,
  readMetadata,
  writeMetadata,
} from '../domain/core.js';
import {
  materializeSkillReferences,
  removeFromCollection,
  removeSkillLocations,
} from '../domain/collection-write.js';
import { cloneGitSource, syncCollection, updateGitSkill } from '../domain/git.js';
import type { CollectedSkill, GitSource, Skill, SkillMetadata } from '../domain/types.js';
import type { InstallReviewTarget } from '../ui/install/types.js';
import { Modal } from '../ui/overlay/static.js';
import {
  promptChoice,
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
  globalSkillGroups,
  importSkillsToCollection,
} from './library.js';
import { t } from '../i18n/index.js';

async function bindMetadataSource(
  skillName: string,
  metadata: SkillMetadata,
  input: string,
  ref: string | undefined,
  sourcePath: string,
  refType?: GitSource['refType']
): Promise<void> {
  if (!isGitSource(input)) throw new Error(t('cmd.invalidGitSource', { input }));
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
  const [projectGroups, collection, globalGroups] = await Promise.all([
    listProjectGroups(),
    listCollection(),
    globalSkillGroups(),
  ]);
  const canSync = await exists(join(collectionPaths().root, '.git'));
  return { projectGroups, collection, globalGroups, canSync };
}

async function installTargetsAndDefaults(): Promise<{
  targets: InstallReviewTarget[];
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
}> {
  const present = await listPresentAgents();
  if (!present.length) throw new Error(noPresentAgentsError());
  const targets = agentInstallTargets(present);
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
    case 'import':
      await handleImport(host, result.skills);
      break;
    default:
      break;
  }

  await host.reloadData();
  return 'continue';
}

async function handleSync(host: BrowserActionHost): Promise<void> {
  await host.lifecycle.suspendForSubprocess(async () => {
    await syncCollection(false);
  });
  host.setStatus(t('cmd.syncDone'), true, 'normal');
}

async function handleUpdate(host: BrowserActionHost, skills: CollectedSkill[]): Promise<void> {
  host.setStatus('', false);
  host.setWorkingProgress(null);
  const outcomes: string[] = [];
  let failed = 0;
  for (const [index, skill] of skills.entries()) {
    host.setWorkingProgress({
      skillName: skill.name,
      current: index + 1,
      total: skills.length,
      workingAction: 'update',
    });
    await delay(120);
    try {
      const updateStatus = await updateGitSkill(skill, false, {
        quietDelete: true,
        confirmDelete: (links) => Modal.confirm({
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
      });
      outcomes.push(`${skill.name}: ${updateStatus}`);
    } catch (error) {
      failed += 1;
      outcomes.push(t('cmd.updateFailedLine', { name: skill.name, error: errorMessage(error) }));
    }
  }
  host.setWorkingProgress(null);
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
  await commitCollection(`tag ${skills.map((skill) => skill.name).join(', ')}`);
  host.setStatus(t('cmd.tagged'), true, 'normal');
}

async function handleAdd(host: BrowserActionHost, skills: CollectedSkill[]): Promise<void> {
  let targets: InstallReviewTarget[];
  let defaultProjectAgents: string[];
  let defaultGlobalAgents: string[];
  try {
    ({ targets, defaultProjectAgents, defaultGlobalAgents } =
      await installTargetsAndDefaults());
  } catch (error) {
    host.setStatus(errorMessage(error), false, 'error');
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
    host.setStatus(t('common.failed', { error: errorMessage(error) }), false, 'error');
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
    host.setStatus(t('common.failed', { error: errorMessage(error) }), false, 'error');
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
    host.setStatus(t('common.failed', { error: errorMessage(error) }), false, 'error');
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
    host.setStatus(t('common.failed', { error: errorMessage(error) }), false, 'error');
  } finally {
    host.setAbortController(null);
  }
}

async function handleImport(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  try {
    const { count } = await importSkillsToCollection(skills, {
      quiet: true,
      confirmReplace: (conflicts) => Modal.confirm({
        title: t('cmd.replaceCollectionTitle'),
        message: t('cmd.replaceSameNameConfirm', { names: conflicts.join(', ') }),
      }),
    });
    host.setStatus(t('cmd.importedShort', { count }), true, 'normal');
  } catch (error) {
    host.setStatus(t('common.failed', { error: errorMessage(error) }), false, 'error');
  }
  host.setNavigation({ ...host.getNavigation(), selected: [] });
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
    if (!isGitSource(sourceInput)) throw new Error(t('cmd.invalidGitSource', { input: sourceInput }));
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
      if (!options.length) throw new Error(t('cmd.noSkillMdInRepo'));
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
