import { cp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
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
  matches,
  parseGitSource,
  readMetadata,
  readState,
  writeMetadata,
} from '../core.js';
import { cloneGitSource, syncCollection, updateGitSkill } from '../git.js';
import { chooseOne, chooseOptionsMany, editInput, editTags } from '../prompts.js';
import type { GitSource, Skill, SkillMetadata } from '../types.js';
import {
  browseSkillDetail,
  browseSkills,
  displayBrowseSkills,
  type BrowserFocus,
  type BrowserTab,
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
  let query = initialQuery;
  let tab: BrowserTab = initialTab;
  let cursor = 0;
  let selected: string[] = [];
  let agent = '';
  let focus: BrowserFocus = 'tabs';
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
      const result = await browseSkills(
        projects,
        collection,
        globals,
        session,
        query,
        tab,
        canSync,
        status,
        cursor,
        selected,
        agent,
        focus,
        transientStatus
      );
      if (result.type === 'quit') return;
      query = result.query;
      tab = result.tab;
      cursor = result.cursor;
      selected = result.selected;
      agent = result.agent;
      focus = result.focus;
      if (transientStatus) {
        status = '';
        transientStatus = false;
      }
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
        session.close();
        displayBrowseSkills(
          projects,
          collection,
          globals,
          session,
          query,
          tab,
          canSync,
          status,
          cursor,
          selected,
          agent,
          focus,
          transientStatus,
          result.skill.name
        );
        await delay(120);
        try {
          const updateStatus = await updateGitSkill(result.skill, false);
          status = `${result.skill.name}: ${updateStatus}`;
          transientStatus = updateStatus === 'updated' || updateStatus === 'unchanged';
        } catch (error) {
          status = `${result.skill.name}: 更新失败 — ${errorMessage(error)}`;
          transientStatus = false;
        }
        process.stdout.write(CLEAR_SCREEN);
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
        const destination = await chooseOne(
          [
            { label: '当前项目', value: 'project' },
            { label: '全局', value: 'global' },
          ],
          '添加到：',
          false,
          session
        );
        if (!destination) continue;
        const mode = await chooseOne(
          [
            { label: '软链（推荐）', value: 'link' },
            { label: '复制', value: 'copy' },
          ],
          '添加方式：',
          false,
          session
        );
        if (!mode) continue;
        const isGlobal = destination === 'global';
        const targetOptions = [
          {
            label: `标准 Agent Skills (${isGlobal ? '~/.agents/skills' : '.agents/skills'})`,
            value: 'agents',
          },
          {
            label: `Claude Code (${isGlobal ? '~/.claude/skills' : '.claude/skills'})`,
            value: 'claude',
          },
        ];
        const defaultAgents: string[] = [];
        for (const option of targetOptions) {
          const agent = AGENTS[option.value];
          const path = isGlobal ? agent?.global(homedir()) : agent?.project;
          if (path && await exists(path)) defaultAgents.push(option.value);
        }
        const agents = await chooseOptionsMany(
          targetOptions,
          destination === 'global' ? '选择全局 Skill 目录：' : '选择项目 Skill 目录：',
          session,
          defaultAgents
        );
        if (!agents.length) continue;
        try {
          const { count, targetCount } = await addSkillsToProject(result.skills, {
            quiet: true,
            agent: agents,
            copy: mode === 'copy',
            ...(isGlobal ? { global: true } : {}),
          });
          status = `已通过${mode === 'copy' ? '复制' : '软链'}添加 ${count} 个技能到 ${targetCount} 个目录`;
          transientStatus = true;
          selected = [];
        } catch (error) {
          status = errorMessage(error);
          transientStatus = false;
        }
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'import') {
        try {
          const { count } = await importSkillsToCollection(result.skills, { quiet: true });
          status = `已导入 ${count} 个技能到收藏夹`;
          transientStatus = true;
        } catch (error) {
          status = errorMessage(error);
          transientStatus = false;
        }
        selected = [];
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'open') {
        cursor = result.cursor;
        selected = result.selected;
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
