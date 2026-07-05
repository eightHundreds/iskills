import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AGENTS,
  assertRelativePath,
  baselinePath,
  collectionPaths,
  commitCollection,
  errorMessage,
  exists,
  isGitSource,
  listCollection,
  listProject,
  matches,
  parseGitSource,
  readMetadata,
  readState,
  writeMetadata,
} from '../core.js';
import { syncCollection } from '../git.js';
import { chooseOne, chooseOptionsMany, editInput, editTags } from '../prompts.js';
import type { GitSource, Skill, SkillMetadata } from '../types.js';
import {
  browseSkillDetail,
  browseSkills,
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
  sourcePath: string
): Promise<void> {
  if (!isGitSource(input)) throw new Error(`不是有效的 Git 来源：${input}`);
  const parsed = parseGitSource(input);
  const resolvedRef = ref || parsed.ref;
  const source: GitSource = {
    type: 'git',
    url: parsed.url,
    refType: /^[0-9a-f]{7,40}$/i.test(resolvedRef || '') ? 'commit' : 'branch',
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
      const parsed = parseGitSource(sourceInput);
      const refValue = await editInput(
        '分支、Tag 或 Commit（Enter 继续，Esc 取消）',
        metadata.source.ref || parsed.ref || '',
        session
      );
      if (refValue === undefined) continue;
      const pathValue = await editInput(
        '仓库内 Skill 路径（Enter 保存，Esc 取消）',
        metadata.source.path || '',
        session
      );
      if (pathValue === undefined) continue;
      const ref = refValue.trim();
      const sourcePath = assertRelativePath(pathValue.trim());
      await bindMetadataSource(skill.name, metadata, sourceInput, ref, sourcePath);
      await writeMetadata(metadata);
      await commitCollection(`source ${skill.name}`);
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
  const session = new InkSession();
  process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_SCREEN}`);
  try {
    while (true) {
      const [project, collection, globals] = await Promise.all([
        listProject(),
        listCollection(),
        globalSkillGroups(),
      ]);
      const canSync = await exists(join(collectionPaths().root, '.git'));
      const result = await browseSkills(
        project,
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
        focus
      );
      if (result.type === 'quit') return;
      query = result.query;
      tab = result.tab;
      cursor = result.cursor;
      selected = result.selected;
      agent = result.agent;
      focus = result.focus;
      if (result.type === 'sync') {
        await syncCollection(false);
        status = 'Git 同步完成';
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
        const agents = destination === 'global'
          ? await chooseOptionsMany(
              Object.keys(AGENTS).map((name) => ({ label: name, value: name })),
              '选择全局 Agent：',
              session
            )
          : [];
        if (destination === 'global' && !agents.length) continue;
        try {
          const { count, targetCount } = await addSkillsToProject(result.skills, {
            quiet: true,
            ...(destination === 'global' ? { global: true, agent: agents } : {}),
          });
          status = `已添加 ${count} 个技能到 ${targetCount} 个目录`;
          selected = [];
        } catch (error) {
          status = errorMessage(error);
        }
        process.stdout.write(CLEAR_SCREEN);
        continue;
      }
      if (result.type === 'import') {
        try {
          const { count } = await importSkillsToCollection(result.skills, { quiet: true });
          status = `已导入 ${count} 个技能到收藏夹`;
        } catch (error) {
          status = errorMessage(error);
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
