import { cp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import type { BrowserState, BrowserTab, BrowserViewInput } from '../contracts/browser.js';
import { InterruptError } from '../contracts/terminal.js';
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
  listProject,
  listProjectGroups,
  materializeSkillReferences,
  matches,
  parseGitSource,
  readMetadata,
  readState,
  removeFromCollection,
  removeSkillLocations,
  writeMetadata,
} from '../domain/core.js';
import {
  checkGitSkillUpdates,
  cloneGitSource,
  syncCollection,
  updateGitSkill,
} from '../domain/git.js';
import { chooseOne, editInput, editTags, reviewInstall } from '../ui/prompts.js';
import type { GitSource, Skill, SkillMetadata } from '../domain/types.js';
import {
  browseSkillDetail,
  browseSkills,
  confirmBrowseAction,
  displayBrowseSkills,
} from '../ui/browser.js';
import { InkSession } from '../ui/session.js';
import {
  addSkillsToProject,
  globalSkillGroups,
  importSkillsToCollection,
} from './library.js';

const CLEAR_SCREEN = '\u001B[2J\u001B[H';
const ENTER_ALTERNATE_SCREEN = '\u001B[?1049h';
const LEAVE_ALTERNATE_SCREEN = '\u001B[?1049l';

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

async function skillDetail(
  skill: Skill,
  collection: boolean,
  session: InkSession
): Promise<void> {
  while (true) {
    const metadata: SkillMetadata = collection
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
    const action = await browseSkillDetail(skill, metadata, links, collection, session);
    if (action === 'back') return;
    if (action === 'note') {
      const note = await editInput('编辑备注（Enter 保存，Esc 取消）', metadata.note, session);
      if (note === undefined) continue;
      metadata.note = note;
      await writeMetadata(metadata);
      await commitCollection(`note ${skill.name}`);
    }
    if (action === 'tags') {
      const existing = [...new Set((await listCollection()).flatMap((item) => item.tags))]
        .sort((left, right) => left.localeCompare(right));
      const tags = await editTags(existing, metadata.tags, session);
      if (tags === undefined) continue;
      metadata.tags = tags;
      await writeMetadata(metadata);
      await commitCollection(`tag ${skill.name}`);
    }
    if (action === 'source') {
      const sourceValue = await editInput(
        'Git 来源（Enter 继续，Esc 取消）',
        metadata.source.url || '',
        session
      );
      if (sourceValue === undefined) continue;
      const sourceInput = sourceValue.trim();
      if (!isGitSource(sourceInput)) throw new Error(`不是有效的 Git 来源：${sourceInput}`);
      const parsed = parseGitSource(sourceInput);
      const refValue = await editInput(
        '分支、Tag 或 Commit（Enter 继续，Esc 取消）',
        parsed.ref || metadata.source.ref || '',
        session
      );
      if (refValue === undefined) continue;
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
        const sourcePath = await chooseOne(options, '选择仓库内 Skill：', false, session);
        if (sourcePath === undefined) continue;
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
}

export async function interactiveList(
  initialQuery = '',
  initialTab: BrowserTab = 'project'
): Promise<void> {
  let state: BrowserState = {
    query: initialQuery,
    tab: initialTab,
    cursor: 0,
    selected: [],
    agent: '',
    focus: 'tabs',
  };
  let status = '';
  let transientStatus = false;
  const session = new InkSession(true);
  process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_SCREEN}`);
  try {
    while (true) {
      const [projects, collection, globals] = await Promise.all([
        listProjectGroups(),
        listCollection(),
        globalSkillGroups(),
      ]);
      const canSync = await exists(join(collectionPaths().root, '.git'));
      const browserView = (
        overrides: Pick<BrowserViewInput, 'updatingSkillName' | 'updatingProgress' | 'workingAction'> = {}
      ): BrowserViewInput => ({
        projectGroups: projects,
        collection,
        globalGroups: globals,
        state,
        canSync,
        status,
        transientStatus,
        checkUpdates: checkGitSkillUpdates,
        ...overrides,
      });
      const result = await browseSkills(browserView(), session);
      if (result.type === 'quit') return;
      state = {
        query: result.query,
        tab: result.tab,
        cursor: result.cursor,
        selected: result.selected,
        agent: result.agent,
        focus: result.focus,
      };
      if (transientStatus) {
        status = '';
        transientStatus = false;
      }
      const confirmInBrowser = (
        message: string,
        details: string[] = [],
        title = '确认'
      ) => confirmBrowseAction(
        browserView(),
        session,
        { message, details, title }
      );
      if (result.type === 'sync') {
        session.close();
        process.stdout.write(LEAVE_ALTERNATE_SCREEN);
        try {
          await syncCollection(false);
          status = 'Git 同步完成';
          transientStatus = true;
        } finally {
          process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_SCREEN}`);
        }
        continue;
      }
      if (result.type === 'update') {
        status = '';
        transientStatus = false;
        const outcomes: string[] = [];
        let failed = 0;
        session.close();
        for (const [index, skill] of result.skills.entries()) {
          displayBrowseSkills(
            browserView({
              updatingSkillName: skill.name,
              updatingProgress: { current: index + 1, total: result.skills.length },
            }),
            session,
          );
          await delay(120);
          try {
            const updateStatus = await updateGitSkill(skill, false, {
              quietDelete: true,
              confirmDelete: (links) => confirmInBrowser(
                `上游已删除 ${skill.name}，执行收藏夹移除流程吗？`,
                links.map((link) => {
                  const kind = link.kind === 'origin' ? '原始' : link.kind === 'usage' ? '使用' : '依赖';
                  return `${kind}：${link.path}`;
                }),
                '上游删除'
              ),
            });
            outcomes.push(`${skill.name}: ${updateStatus}`);
          } catch (error) {
            failed += 1;
            outcomes.push(`${skill.name}: 更新失败 — ${errorMessage(error)}`);
          }
        }
        status = outcomes.join(' · ');
        transientStatus = failed === 0;
        continue;
      }
      if (result.type === 'tags') {
        const existing = [...new Set(collection.flatMap((skill) => skill.tags))]
          .sort((left, right) => left.localeCompare(right));
        const added = await editTags(
          existing,
          [],
          session,
          `为 ${result.skills.length} 个技能添加标签`
        );
        if (!added?.length) continue;
        await Promise.all(result.skills.map(async (skill) => {
          const metadata = await readMetadata(skill.name);
          metadata.tags = [...new Set([...metadata.tags, ...added])];
          await writeMetadata(metadata);
        }));
        await commitCollection(`tag ${result.skills.map((skill) => skill.name).join(', ')}`);
        status = `已为 ${result.skills.length} 个技能添加标签`;
        transientStatus = true;
        continue;
      }
      if (result.type === 'add') {
        const targetOptions = [
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
        const defaultProjectAgents: string[] = [];
        const defaultGlobalAgents: string[] = [];
        for (const option of targetOptions) {
          const agent = AGENTS[option.value];
          if (agent?.project && await exists(agent.project)) defaultProjectAgents.push(option.value);
          const globalPath = agent?.global(homedir());
          if (globalPath && await exists(globalPath)) {
            defaultGlobalAgents.push(option.value);
          }
        }
        const install = await reviewInstall(
          result.skills,
          targetOptions,
          defaultProjectAgents,
          defaultGlobalAgents,
          session,
        );
        if (!install) continue;
        try {
          const { count, targetCount } = await addSkillsToProject(result.skills, {
            quiet: true,
            agent: install.agents,
            copy: install.copy,
            confirmReplace: (target) => confirmInBrowser(
              `目标已存在，替换 ${target} 吗？`,
              [],
              '替换目标'
            ),
            ...(install.destination === 'global' ? { global: true } : {}),
          });
          status = `已通过${install.copy ? '复制' : '软链'}添加 ${count} 个技能到 ${targetCount} 个目录`;
          transientStatus = true;
          state = { ...state, selected: [] };
        } catch (error) {
          status = errorMessage(error);
          transientStatus = false;
        }
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'removeCollection') {
        const names = result.skills.map((skill) => skill.name);
        try {
          for (const skill of result.skills) await removeFromCollection(skill.name, true, true);
          status = names.length === 1
            ? `已从收藏夹移除 ${names[0]}`
            : `已从收藏夹移除 ${names.length} 个技能`;
          transientStatus = true;
          const removed = new Set(result.skills.map((skill) => skill.path));
          state = { ...state, selected: state.selected.filter((path) => !removed.has(path)) };
        } catch (error) {
          status = `移除失败 — ${errorMessage(error)}`;
          transientStatus = false;
        }
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'removeLocations') {
        try {
          const count = await removeSkillLocations(result.skills);
          status = count === 1
            ? `已删除 ${result.skills[0]?.name ?? ''} 的当前位置，收藏夹内容保留`
            : `已删除 ${count} 个技能位置，收藏夹内容保留`;
          transientStatus = true;
          const removed = new Set(result.skills.map((skill) => skill.path));
          state = { ...state, selected: state.selected.filter((path) => !removed.has(path)) };
        } catch (error) {
          status = `删除失败 — ${errorMessage(error)}`;
          transientStatus = false;
        }
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'materialize') {
        const controller = new AbortController();
        try {
          await materializeSkillReferences(result.skills, {
            signal: controller.signal,
            onProgress: async (skill, current, total) => {
              displayBrowseSkills(
                browserView({
                  updatingSkillName: skill.name,
                  updatingProgress: { current, total },
                  workingAction: '转换',
                }),
                session,
                () => controller.abort()
              );
              await delay(120);
            },
          });
          status = result.skills.length === 1
            ? `已将 ${result.skills[0]?.name ?? ''} 转为副本`
            : `已将 ${result.skills.length} 个引用转为副本`;
          transientStatus = true;
          state = { ...state, selected: [] };
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new InterruptError();
          }
          status = `转换失败 — ${errorMessage(error)}`;
          transientStatus = false;
        }
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'import') {
        try {
          const { count } = await importSkillsToCollection(result.skills, {
            quiet: true,
            confirmReplace: (conflicts) => confirmInBrowser(
              `替换同名收藏 ${conflicts.join(', ')} 吗？`,
              [],
              '替换收藏'
            ),
          });
          status = `已导入 ${count} 个技能到收藏夹`;
          transientStatus = true;
        } catch (error) {
          status = errorMessage(error);
          transientStatus = false;
        }
        state = { ...state, selected: [] };
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'open') {
        await skillDetail(result.skill, result.collection, session);
      }
    }
  } finally {
    session.close();
    process.stdout.write(LEAVE_ALTERNATE_SCREEN);
  }
}

export async function commandList(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      note: { type: 'string' },
      tags: { type: 'string' },
      source: { type: 'string' },
      ref: { type: 'string' },
      'source-path': { type: 'string' },
    },
  });
  const query = positionals.join(' ');
  const edits = values.note !== undefined || values.tags !== undefined || values.source;
  if (edits) {
    if (positionals.length !== 1) throw new Error('编辑详情时请指定一个完整技能名称');
    const name = positionals[0];
    if (!name) throw new Error('编辑详情时请指定一个完整技能名称');
    const skill = (await listCollection()).find((item) => item.name === name);
    if (!skill) throw new Error(`收藏夹中不存在：${name}`);
    const metadata = await readMetadata(skill.name);
    if (values.note !== undefined) metadata.note = values.note;
    if (values.tags !== undefined) {
      metadata.tags = values.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    if (values.source) {
      if (!values['source-path']) throw new Error('绑定来源时必须指定 --source-path');
      await bindMetadataSource(
        skill.name,
        metadata,
        values.source,
        values.ref,
        values['source-path']
      );
    }
    await writeMetadata(metadata);
    await commitCollection(`metadata ${skill.name}`);
    if (!values.json) {
      console.log(`已更新 ${skill.name} 的详情。`);
      return;
    }
  }
  if (values.json || !process.stdin.isTTY) {
    const [project, collection] = await Promise.all([listProject(), listCollection()]);
    console.log(
      JSON.stringify(
        {
          project: project.filter((skill) => matches(skill, query)),
          collection: collection.filter((skill) => matches(skill, query)),
        },
        null,
        2
      )
    );
    return;
  }
  await interactiveList(query);
}
