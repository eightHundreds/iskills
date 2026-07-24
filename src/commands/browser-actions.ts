import { cp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserResult } from '../contracts/browser.js';
import type { BrowserAppLifecycle, DetailViewContext } from '../contracts/browser-app.js';
import type {
  BrowserActionHost,
  BrowserConfirmRequest,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
  BrowserPromptBridge,
  DetailEditorContext,
  InstallReviewTarget,
} from '../contracts/browser-app-actions.js';
import {
  AGENTS,
  assertRelativePath,
  baselinePath,
  collectionPaths,
  commitCollection,
  discoverSkills,
  errorMessage,
  exists,
  isGitSource,
  listCollection,
  listProjectGroups,
  parseGitSource,
  readMetadata,
} from '../domain/core.js';
import {
  materializeSkillReferences,
  removeFromCollection,
  removeSkillLocations,
  saveCollectionMetadata,
} from '../domain/collection-write.js';
import { cloneGitSource, syncCollection, updateGitSkill } from '../domain/git.js';
import type { CollectedSkill, GitSource, Skill, SkillMetadata } from '../domain/types.js';
import { InterruptError } from '../contracts/terminal.js';
import {
  addSkillsToProject,
  globalSkillGroups,
  importSkillsToCollection,
} from './library.js';

export type { BrowserActionHost, BrowserPromptBridge } from '../contracts/browser-app-actions.js';

async function bindMetadataSource(
  skillName: string,
  metadata: SkillMetadata,
  input: string,
  ref: string | undefined,
  sourcePath: string,
  refType?: GitSource['refType']
): Promise<void> {
  if (!isGitSource(input)) throw new Error(`不是有效的 Git 来源：${input}`);
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

function navigationFromResult(result: BrowserResult): BrowserNavigationSnapshot | null {
  if (result.type === 'quit' || result.type === 'open') return null;
  return {
    tab: result.tab,
    query: result.query,
    cursor: result.cursor,
    selected: result.selected,
    agent: result.agent,
    focus: result.focus,
  };
}

const INSTALL_TARGETS: InstallReviewTarget[] = [
  {
    value: 'agents',
    projectLabel: '标准 Agent Skills (.agents/skills)',
    globalLabel: '标准 Agent Skills (~/.agents/skills)',
  },
  {
    value: 'claude',
    projectLabel: 'Claude Code (.claude/skills)',
    globalLabel: 'Claude Code (~/.claude/skills)',
  },
  {
    value: 'pi',
    globalLabel: 'Pi (~/.pi/agent/skills)',
  },
];

async function defaultInstallAgents(): Promise<{
  defaultProjectAgents: string[];
  defaultGlobalAgents: string[];
}> {
  const defaultProjectAgents: string[] = [];
  const defaultGlobalAgents: string[] = [];
  for (const option of INSTALL_TARGETS) {
    const agent = AGENTS[option.value];
    if (agent?.project && await exists(agent.project)) defaultProjectAgents.push(option.value);
    const globalPath = agent?.global(homedir());
    if (globalPath && await exists(globalPath)) defaultGlobalAgents.push(option.value);
  }
  return { defaultProjectAgents, defaultGlobalAgents };
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

  const navigation = navigationFromResult(result);
  if (navigation) host.setNavigation(navigation);

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
    case 'open':
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
  host.setStatus('Git 同步完成', true);
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
      workingAction: '更新',
    });
    await delay(120);
    try {
      const updateStatus = await updateGitSkill(skill, false, {
        quietDelete: true,
        confirmDelete: (links) => host.requestConfirm({
          title: '上游删除',
          message: `上游已删除 ${skill.name}，执行收藏夹移除流程吗？`,
          details: links.map((link) => {
            const kind = link.kind === 'origin' ? '原始' : link.kind === 'usage' ? '使用' : '依赖';
            return `${kind}：${link.path}`;
          }),
        }),
      });
      outcomes.push(`${skill.name}: ${updateStatus}`);
    } catch (error) {
      failed += 1;
      outcomes.push(`${skill.name}: 更新失败 — ${errorMessage(error)}`);
    }
  }
  host.setWorkingProgress(null);
  host.setStatus(outcomes.join(' · '), failed === 0);
  host.setNavigation({ ...host.getNavigation(), selected: [] });
}

async function handleTags(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  const collection = await listCollection();
  const existing = [...new Set(collection.flatMap((skill) => skill.tags))]
    .sort((left, right) => left.localeCompare(right));
  const added = await host.prompts.editTags(
    existing,
    [],
    `为 ${skills.length} 个技能添加标签`
  );
  if (!added?.length) return;
  await Promise.all(skills.map(async (skill) => {
    const metadata = await readMetadata(skill.name);
    metadata.tags = [...new Set([...metadata.tags, ...added])];
    await saveCollectionMetadata(metadata);
  }));
  await commitCollection(`tag ${skills.map((skill) => skill.name).join(', ')}`);
  host.setStatus(`已为 ${skills.length} 个技能添加标签`, true);
}

async function handleAdd(host: BrowserActionHost, skills: CollectedSkill[]): Promise<void> {
  const { defaultProjectAgents, defaultGlobalAgents } = await defaultInstallAgents();
  const install = await host.prompts.reviewInstall(
    skills,
    INSTALL_TARGETS,
    defaultProjectAgents,
    defaultGlobalAgents
  );
  if (!install) return;
  try {
    const { count, targetCount } = await addSkillsToProject(skills, {
      quiet: true,
      agent: install.agents,
      copy: install.copy,
      confirmReplace: (target) => host.requestConfirm({
        title: '替换目标',
        message: `目标已存在，替换 ${target} 吗？`,
      }),
      ...(install.destination === 'global' ? { global: true } : {}),
    });
    host.setStatus(
      `已通过${install.copy ? '复制' : '软链'}添加 ${count} 个技能到 ${targetCount} 个目录`,
      true
    );
    host.setNavigation({ ...host.getNavigation(), selected: [] });
  } catch (error) {
    host.setStatus(errorMessage(error), false);
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
      names.length === 1
        ? `已从收藏夹移除 ${names[0]}`
        : `已从收藏夹移除 ${names.length} 个技能`,
      true
    );
    const removed = new Set(skills.map((skill) => skill.path));
    host.setNavigation({
      ...host.getNavigation(),
      selected: host.getNavigation().selected.filter((path) => !removed.has(path)),
    });
  } catch (error) {
    host.setStatus(`移除失败 — ${errorMessage(error)}`, false);
  }
}

async function handleRemoveLocations(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  try {
    const count = await removeSkillLocations(skills);
    host.setStatus(
      count === 1
        ? `已删除 ${skills[0]?.name ?? ''} 的当前位置，收藏夹内容保留`
        : `已删除 ${count} 个技能位置，收藏夹内容保留`,
      true
    );
    const removed = new Set(skills.map((skill) => skill.path));
    host.setNavigation({
      ...host.getNavigation(),
      selected: host.getNavigation().selected.filter((path) => !removed.has(path)),
    });
  } catch (error) {
    host.setStatus(`删除失败 — ${errorMessage(error)}`, false);
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
          workingAction: '转换',
        });
        for (let tick = 0; tick < 12; tick += 1) {
          if (controller.signal.aborted) throw new InterruptError();
          await delay(10);
        }
      },
    });
    host.setWorkingProgress(null);
    host.setStatus(
      skills.length === 1
        ? `已将 ${skills[0]?.name ?? ''} 转为副本`
        : `已将 ${skills.length} 个引用转为副本`,
      true
    );
    host.setNavigation({ ...host.getNavigation(), selected: [] });
  } catch (error) {
    host.setWorkingProgress(null);
    if (error instanceof InterruptError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new InterruptError();
    host.setStatus(`转换失败 — ${errorMessage(error)}`, false);
  } finally {
    host.setAbortController(null);
  }
}

async function handleImport(host: BrowserActionHost, skills: Skill[]): Promise<void> {
  try {
    const { count } = await importSkillsToCollection(skills, {
      quiet: true,
      confirmReplace: (conflicts) => host.requestConfirm({
        title: '替换收藏',
        message: `替换同名收藏 ${conflicts.join(', ')} 吗？`,
      }),
    });
    host.setStatus(`已导入 ${count} 个技能到收藏夹`, true);
  } catch (error) {
    host.setStatus(errorMessage(error), false);
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
    const note = await host.prompts.editInput('编辑备注（Enter 保存，Esc 取消）', metadata.note);
    if (note === undefined) return;
    metadata.note = note;
    await saveCollectionMetadata(metadata);
    await commitCollection(`note ${skill.name}`);
    return;
  }
  if (action === 'tags') {
    const existing = [...new Set((await listCollection()).flatMap((item) => item.tags))]
      .sort((left, right) => left.localeCompare(right));
    const tags = await host.prompts.editTags(existing, metadata.tags, '编辑标签');
    if (tags === undefined) return;
    metadata.tags = tags;
    await saveCollectionMetadata(metadata);
    await commitCollection(`tag ${skill.name}`);
    return;
  }
  if (action === 'source') {
    const sourceValue = await host.prompts.editInput(
      'Git 来源（Enter 继续，Esc 取消）',
      metadata.source.url || ''
    );
    if (sourceValue === undefined) return;
    const sourceInput = sourceValue.trim();
    if (!isGitSource(sourceInput)) throw new Error(`不是有效的 Git 来源：${sourceInput}`);
    const parsed = parseGitSource(sourceInput);
    const refValue = await host.prompts.editInput(
      '分支、Tag 或 Commit（Enter 继续，Esc 取消）',
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
      if (!options.length) throw new Error('目标仓库中没有找到 SKILL.md');
      const sourcePath = await host.prompts.chooseOne(options, '选择仓库内 Skill：');
      if (sourcePath === undefined) return;
      await bindMetadataSource(
        skill.name,
        metadata,
        gitContext.source.url,
        gitContext.source.ref,
        sourcePath,
        gitContext.source.refType
      );
      await saveCollectionMetadata(metadata);
      await commitCollection(`source ${skill.name}`);
    } finally {
      await rm(gitContext.temporary, { recursive: true, force: true });
    }
  }
}
