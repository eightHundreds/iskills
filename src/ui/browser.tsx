import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { matches } from '../core.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../types.js';
import { InkSession } from './session.js';
import { Tabs, TextInput, termcnColors } from './termcn.js';

export type BrowserTab = 'project' | 'collection';
export type BrowserResult =
  | { type: 'quit' }
  | { type: 'sync'; tab: BrowserTab; query: string }
  | { type: 'tags'; skills: Skill[]; tab: BrowserTab; query: string }
  | { type: 'add'; skills: CollectedSkill[]; tab: BrowserTab; query: string }
  | { type: 'import'; skills: Skill[]; tab: BrowserTab; query: string; cursor: number; selected: string[] }
  | { type: 'open'; skill: Skill; collection: boolean; tab: BrowserTab; query: string; cursor: number; selected: string[] };

type SkillRow =
  | { type: 'group'; name: string; skills: Skill[] }
  | { type: 'skill'; group: string; skill: Skill };

function groupedRows(skills: Skill[], query: string): SkillRow[] {
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    for (const tag of new Set(skill.tags?.length ? skill.tags : ['未分组'])) {
      const group = groups.get(tag) ?? [];
      group.push(skill);
      groups.set(tag, group);
    }
  }
  const sorted = [...groups].sort(([left], [right]) => {
    if (left === right) return 0;
    return left === '未分组' ? 1 : right === '未分组' ? -1 : left.localeCompare(right);
  });
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchingGroups = new Set(
    sorted
      .filter(([name]) => words.length && words.every((word) => name.toLowerCase().includes(word)))
      .map(([name]) => name)
  );
  const rows: SkillRow[] = [];
  for (const [name, group] of sorted) {
    if (matchingGroups.size && !matchingGroups.has(name)) continue;
    const visible = matchingGroups.size ? group : group.filter((skill) => matches(skill, query));
    if (!visible.length) continue;
    rows.push({ type: 'group', name, skills: visible });
    rows.push(...visible.map((skill) => ({ type: 'skill' as const, group: name, skill })));
  }
  return rows;
}

function selectableSkills(row: SkillRow, localOnly: boolean): Skill[] {
  if (row.type === 'group') {
    return localOnly ? row.skills.filter((skill) => !skill.fromCollection) : row.skills;
  }
  if (localOnly && row.skill.fromCollection) return [];
  return [row.skill];
}

function SkillPane({
  rows,
  cursor,
  selected,
  preferNote = false,
  showSource = false,
}: {
  rows: SkillRow[];
  cursor: number;
  selected: Set<string>;
  preferNote?: boolean;
  showSource?: boolean;
}) {
  const { stdout } = useStdout();
  const height = Math.max(3, stdout.rows - 8);
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(offset, offset + height);
  return (
    <Box flexDirection="column" minHeight={3}>
      {rows.length ? (
        visible.map((row, visibleIndex) => {
          const index = offset + visibleIndex;
          if (row.type === 'group') {
            const groupSkills = showSource
              ? row.skills.filter((skill) => !skill.fromCollection)
              : row.skills;
            const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
            const marker =
              count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
            return (
              <Text
                key={`group:${row.name}`}
                bold
                {...(index === active ? { color: termcnColors.primary } : {})}
              >
                {`${index === active ? '›' : ' '} ${marker} ${row.name} (${showSource ? groupSkills.length : row.skills.length})`}
              </Text>
            );
          }
          const skill = row.skill;
          const summary = (preferNote && skill.note) || skill.description;
          return (
            <Text
              key={`${row.group}:${skill.path}`}
              wrap="truncate-end"
              {...(index === active ? { color: termcnColors.primary } : {})}
            >
              {`  ${index === active ? '›' : ' '} ${selected.has(skill.path) ? '●' : '○'} `}
              {showSource && !skill.fromCollection && (
                <Text color={termcnColors.muted}>本地 · </Text>
              )}
              <Text bold={index === active}>{skill.name}</Text>
              {summary && (
                <Text color={termcnColors.muted}> — {summary}</Text>
              )}
            </Text>
          );
        })
      ) : (
        <Text color={termcnColors.muted}>没有匹配的技能</Text>
      )}
      {rows.length > height && (
        <Text color={termcnColors.muted}>
          {offset + 1}–{Math.min(offset + height, rows.length)} / {rows.length}
        </Text>
      )}
    </Box>
  );
}

function Browser({
  project,
  collection,
  initialQuery,
  initialTab,
  initialCursor,
  initialSelected,
  canSync,
  status,
  finish,
}: {
  project: Skill[];
  collection: CollectedSkill[];
  initialQuery: string;
  initialTab: BrowserTab;
  initialCursor: number;
  initialSelected: string[];
  canSync: boolean;
  status: string;
  finish: (result: BrowserResult) => void;
}) {
  const [tab, setTab] = useState<BrowserTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const projectRows = useMemo(() => groupedRows(project, query), [project, query]);
  const collectionRows = useMemo(() => groupedRows(collection, query), [collection, query]);
  const rows = tab === 'project' ? projectRows : collectionRows;
  const [cursor, setCursor] = useState(() =>
    Math.min(initialCursor, Math.max(0, (tab === 'project' ? projectRows : collectionRows).length - 1))
  );
  const [searching, setSearching] = useState(false);
  const [queryBeforeSearch, setQueryBeforeSearch] = useState(initialQuery);
  const [cursorBeforeSearch, setCursorBeforeSearch] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const selectedCollection = collection.filter((skill) => selected.has(skill.path));
  const selectedLocal = project.filter((skill) => selected.has(skill.path) && !skill.fromCollection);

  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) {
      setCursor(0);
      setSelected(new Set());
      previousTab.current = tab;
    }
  }, [tab]);

  const openDetail = (skill: Skill, collection: boolean) =>
    finish({
      type: 'open',
      skill,
      collection,
      tab,
      query,
      cursor,
      selected: [...selected],
    });
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 'c') || input === 'q') return finish({ type: 'quit' });
      if (input === 'g') return setTab('collection');
      if (input === 'p') return setTab('project');
      if (input === 's' && tab === 'collection' && canSync) {
        return finish({ type: 'sync', tab, query });
      }
      if (input === 't' && tab === 'collection' && selectedCollection.length) {
        return finish({ type: 'tags', skills: selectedCollection, tab, query });
      }
      if (input === 'i' && tab === 'project' && selectedLocal.length) {
        return finish({
          type: 'import',
          skills: selectedLocal,
          tab,
          query,
          cursor,
          selected: [...selected],
        });
      }
      if (input === '/') {
        setQueryBeforeSearch(query);
        setCursorBeforeSearch(cursor);
        return setSearching(true);
      }
      if (key.upArrow) return setCursor((index) => Math.max(0, index - 1));
      if (key.downArrow) {
        return setCursor((index) => Math.min(Math.max(0, rows.length - 1), index + 1));
      }
      const row = rows[cursor];
      if (input === ' ' && row) {
        const paths = selectableSkills(row, tab === 'project').map((skill) => skill.path);
        if (!paths.length) return;
        return setSelected((previous) => {
          const next = new Set(previous);
          const allSelected = paths.every((path) => previous.has(path));
          for (const path of paths) allSelected ? next.delete(path) : next.add(path);
          return next;
        });
      }
      if (key.leftArrow) {
        if (tab === 'collection') return setTab('project');
        return;
      }
      if (key.rightArrow) {
        if (tab === 'collection') {
          if (row?.type === 'skill') {
            return openDetail(row.skill, true);
          }
          return setTab('project');
        }
        return setTab('collection');
      }
      if (key.return) {
        if (tab === 'collection' && selectedCollection.length) {
          return finish({ type: 'add', skills: selectedCollection, tab, query });
        }
        if (tab === 'project') {
          const skill = row?.type === 'skill' ? row.skill : row?.skills[0];
          if (skill) openDetail(skill, false);
        }
      }
    },
    { isActive: !searching }
  );

  const tabs = [
    {
      key: 'project',
      label: `当前项目 ${project.length}`,
      content: <SkillPane rows={projectRows} cursor={cursor} selected={selected} showSource />,
    },
    {
      key: 'collection',
      label: `收藏夹 ${collection.length}`,
      content: (
        <SkillPane
          rows={collectionRows}
          cursor={cursor}
          selected={selected}
          preferNote
        />
      ),
    },
  ];

  return (
    <Box flexDirection="column">
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as BrowserTab)}
        isActive={!searching}
        enableArrowNav={false}
      />
      {searching ? (
        <TextInput
          label="搜索技能（Enter 确认，Esc 取消）"
          initialValue={query}
          onChange={(value) => {
            setQuery(value);
            setCursor(0);
          }}
          onCancel={() => {
            setQuery(queryBeforeSearch);
            setCursor(cursorBeforeSearch);
            setSearching(false);
          }}
          onSubmit={(value) => {
            setQuery(value);
            setSearching(false);
          }}
        />
      ) : (
        <Text color={termcnColors.muted}>
          {tab === 'collection'
            ? '←/→ 切换 · ↑/↓ 移动 · Space 选择 · → 查看 · / 搜索 · q 退出'
            : '←/→ 切换 · ↑/↓ 移动 · Space 选择 · Enter 查看 · / 搜索 · q 退出'}
          {selected.size ? ` · 已选 ${selected.size}` : ''}
          {tab === 'project' && selectedLocal.length ? ' · i 加入收藏夹' : ''}
          {tab === 'collection' && selectedCollection.length ? ' · Enter 添加' : ''}
          {tab === 'collection' && selectedCollection.length ? ' · t 批量加标签' : ''}
          {tab === 'collection' && canSync ? ' · s 同步 Git' : ''}
          {status ? ` · ${status}` : ''}
          {query ? ` · 搜索：${query}` : ''}
        </Text>
      )}
    </Box>
  );
}

export type DetailAction = 'note' | 'tags' | 'source' | 'back';

function Detail({
  skill,
  metadata,
  links,
  collection,
  finish,
}: {
  skill: Skill;
  metadata: SkillMetadata;
  links: SkillLink[];
  collection: boolean;
  finish: (action: DetailAction) => void;
}) {
  useInput((input, key) => {
    if (
      key.escape ||
      key.leftArrow ||
      (key.ctrl && input === 'c') ||
      input === 'b' ||
      input === 'q'
    ) {
      return finish('back');
    }
    if (collection && input === 'n') return finish('note');
    if (collection && input === 't') return finish('tags');
    if (collection && input === 's') return finish('source');
  });
  const source = metadata.source.url
    ? `${metadata.source.url}${metadata.source.ref ? ` @ ${metadata.source.ref}` : ''}`
    : metadata.source.type;
  return (
    <Box flexDirection="column">
      <Text color={termcnColors.primary} bold>‹ {skill.name}</Text>
      <Text color={termcnColors.muted}>{skill.description || '无描述'}</Text>
      <Box flexDirection="column" borderStyle="round" borderColor={termcnColors.border} paddingX={1} marginTop={1}>
        {collection ? (
          <>
            <Text><Text bold>标签  </Text>{metadata.tags.length ? metadata.tags.join(', ') : '无'}</Text>
            <Text><Text bold>备注  </Text>{metadata.note || '无'}</Text>
            <Text><Text bold>来源  </Text>{source}</Text>
            <Text bold>关联位置</Text>
            {links.length ? links.map((link) => (
              <Text key={`${link.kind}:${link.path}`} color={termcnColors.muted}>
                {link.kind === 'origin' ? '  原始' : link.kind === 'usage' ? '  使用' : '  依赖'}  {link.path}
              </Text>
            )) : <Text color={termcnColors.muted}>  无</Text>}
          </>
        ) : (
          <Text><Text bold>位置  </Text>{skill.path}</Text>
        )}
      </Box>
      <Text color={termcnColors.muted}>
        {collection ? 'n 备注 · t 标签 · s 来源 · ←/b/Esc 返回' : '←/b/Esc 返回'}
      </Text>
    </Box>
  );
}

export function browseSkillDetail(
  skill: Skill,
  metadata: SkillMetadata,
  links: SkillLink[],
  collection: boolean,
  session: InkSession
): Promise<DetailAction> {
  return session.show<DetailAction>('back', (finish) => (
      <Detail
        skill={skill}
        metadata={metadata}
        links={links}
        collection={collection}
        finish={finish}
      />
  ), false);
}

export function browseSkills(
  project: Skill[],
  collection: CollectedSkill[],
  session: InkSession,
  initialQuery = '',
  initialTab: BrowserTab = 'project',
  canSync = false,
  status = '',
  initialCursor = 0,
  initialSelected: string[] = []
): Promise<BrowserResult> {
  return session.show<BrowserResult>({ type: 'quit' }, (finish) => (
      <Browser
        project={project}
        collection={collection}
        initialQuery={initialQuery}
        initialTab={initialTab}
        initialCursor={initialCursor}
        initialSelected={initialSelected}
        canSync={canSync}
        status={status}
        finish={finish}
      />
  ), false);
}
