import { Box, Text, useInput, useStdout } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { matches } from '../core.js';
import { checkGitSkillUpdates } from '../git.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../types.js';
import { InkSession } from './session.js';
import { Select, Tabs, TextInput, termcnColors } from './termcn.js';

export type BrowserTab = 'project' | 'collection' | 'global';
export type BrowserFocus = 'tabs' | 'agents' | 'list';
export interface SkillGroup {
  agent: string;
  skills: Skill[];
}
interface BrowserState {
  tab: BrowserTab;
  query: string;
  cursor: number;
  selected: string[];
  agent: string;
  focus: BrowserFocus;
}
export type BrowserResult =
  | { type: 'quit' }
  | (BrowserState & (
      | { type: 'sync' }
      | { type: 'tags'; skills: Skill[] }
      | { type: 'update'; skill: CollectedSkill }
      | { type: 'add'; skills: CollectedSkill[] }
      | { type: 'import'; skills: Skill[] }
      | { type: 'open'; skill: Skill; collection: boolean }
    ));

type SkillRow =
  | { type: 'group'; name: string; skills: Skill[] }
  | { type: 'skill'; group: string; skill: Skill };

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function useSpinner(active: boolean): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      setIndex((value) => (value + 1) % spinnerFrames.length);
    }, 80);
    return () => clearInterval(timer);
  }, [active]);
  return spinnerFrames[index] ?? '⠋';
}

function skillGroups(skill: Skill): string[] {
  return [...new Set(skill.tags?.length ? skill.tags : ['未分组'])];
}

function groupedRows(skills: Skill[], query: string): SkillRow[] {
  if (query.trim()) {
    return skills
      .filter((skill) => matches(skill, query))
      .map((skill) => ({ type: 'skill', group: skillGroups(skill).join(' · '), skill }));
  }
  const groups = new Map<string, Skill[]>();
  for (const skill of skills) {
    for (const tag of skillGroups(skill)) {
      const group = groups.get(tag) ?? [];
      group.push(skill);
      groups.set(tag, group);
    }
  }
  const sorted = [...groups].sort(([left], [right]) => {
    if (left === right) return 0;
    return left === '未分组' ? 1 : right === '未分组' ? -1 : left.localeCompare(right);
  });
  if (sorted.length === 1 && sorted[0]?.[0] === '未分组') {
    return sorted[0][1].map((skill) => ({ type: 'skill', group: '', skill }));
  }
  const rows: SkillRow[] = [];
  for (const [name, group] of sorted) {
    rows.push({ type: 'group', name, skills: group });
    rows.push(...group.map((skill) => ({ type: 'skill' as const, group: name, skill })));
  }
  return rows;
}

function flatRows(skills: Skill[], query: string): SkillRow[] {
  return skills
    .filter((skill) => matches(skill, query))
    .map((skill) => ({ type: 'skill', group: '', skill }));
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
  isActive,
  preferNote = false,
  showSource = false,
  showGroup = false,
  updates = new Set<string>(),
  updatingSkillName,
}: {
  rows: SkillRow[];
  cursor: number;
  selected: Set<string>;
  isActive: boolean;
  preferNote?: boolean;
  showSource?: boolean;
  showGroup?: boolean;
  updates?: Set<string>;
  updatingSkillName?: string | undefined;
}) {
  const { stdout } = useStdout();
  const spinner = useSpinner(Boolean(updatingSkillName));
  const height = Math.max(3, (stdout.rows ?? 24) - 8);
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
                {...(isActive && index === active ? { color: termcnColors.primary } : {})}
              >
                {`${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`}
              </Text>
            );
          }
          const skill = row.skill;
          const summary = (preferNote && skill.note) || skill.description;
          const selectable = !showSource || !skill.fromCollection;
          const selectionMarker = selectable
            ? selected.has(skill.path)
              ? '●'
              : '○'
            : ' ';
          return (
            <Text
              key={`${row.group}:${skill.path}`}
              wrap="truncate-end"
              {...(isActive && index === active ? { color: termcnColors.primary } : {})}
            >
              {`  ${isActive && index === active ? '›' : ' '} ${selectionMarker} `}
              {showGroup && row.group && (
                <Text color={termcnColors.muted}>{row.group} / </Text>
              )}
              {showSource && !skill.fromCollection ? (
                `本地 · ${skill.name}`
              ) : (
                <Text bold={isActive && index === active}>{skill.name}</Text>
              )}
              {updatingSkillName === skill.name ? (
                <Text color={termcnColors.primary}> {spinner}</Text>
              ) : updates.has(skill.name) ? (
                <Text color={termcnColors.primary}> ↑</Text>
              ) : null}
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

function AgentTabs({
  groups,
  agent,
  focused,
}: {
  groups: SkillGroup[];
  agent: string;
  focused: boolean;
}) {
  return (
    <Box paddingLeft={1}>
      {groups.map((group, index) => (
        <Box key={group.agent}>
          <Text
            color={group.agent === agent ? termcnColors.primary : termcnColors.muted}
            bold={group.agent === agent}
            underline={group.agent === agent}
            inverse={focused && group.agent === agent}
          >
            {group.agent} ({group.skills.length})
          </Text>
          {index < groups.length - 1 && <Text color={termcnColors.border}> │ </Text>}
        </Box>
      ))}
    </Box>
  );
}

function visibleAgentGroups(groups: SkillGroup[]): SkillGroup[] {
  return groups.filter((group) => group.skills.length > 0);
}

function Browser({
  projectGroups,
  collection,
  globalGroups,
  initialQuery,
  initialTab,
  initialAgent,
  initialFocus,
  initialCursor,
  initialSelected,
  canSync,
  status,
  transientStatus,
  updatingSkillName,
  finish,
}: {
  projectGroups: SkillGroup[];
  collection: CollectedSkill[];
  globalGroups: SkillGroup[];
  initialQuery: string;
  initialTab: BrowserTab;
  initialAgent: string;
  initialFocus: BrowserFocus;
  initialCursor: number;
  initialSelected: string[];
  canSync: boolean;
  status: string;
  transientStatus: boolean;
  updatingSkillName?: string | undefined;
  finish: (result: BrowserResult) => void;
}) {
  const [tab, setTab] = useState<BrowserTab>(initialTab);
  const [query, setQuery] = useState(initialQuery);
  const [visibleStatus, setVisibleStatus] = useState(status);
  const visibleProjectGroups = useMemo(() => visibleAgentGroups(projectGroups), [projectGroups]);
  const visibleGlobalGroups = useMemo(() => visibleAgentGroups(globalGroups), [globalGroups]);
  const allAgents = [
    ...new Set([...visibleProjectGroups, ...visibleGlobalGroups].map((group) => group.agent)),
  ];
  const [agent, setAgent] = useState(
    allAgents.includes(initialAgent)
      ? initialAgent
      : visibleProjectGroups[0]?.agent ?? visibleGlobalGroups[0]?.agent ?? ''
  );
  const [focus, setFocus] = useState<BrowserFocus>(initialFocus);
  const activeProjectAgent = visibleProjectGroups.some((group) => group.agent === agent)
    ? agent
    : visibleProjectGroups[0]?.agent ?? '';
  const activeGlobalAgent = visibleGlobalGroups.some((group) => group.agent === agent)
    ? agent
    : visibleGlobalGroups[0]?.agent ?? '';
  const activeAgent = tab === 'global' ? activeGlobalAgent : activeProjectAgent;
  const currentAgentGroups =
    tab === 'project' ? visibleProjectGroups : tab === 'global' ? visibleGlobalGroups : [];
  const hasAgentTabs = currentAgentGroups.length > 0;
  const project = projectGroups.flatMap((group) => group.skills);
  const projectGroup =
    visibleProjectGroups.find((group) => group.agent === activeProjectAgent) ??
    visibleProjectGroups[0];
  const projectRows = useMemo(
    () => groupedRows(projectGroup?.skills ?? [], query),
    [projectGroup, query]
  );
  const collectionRows = useMemo(() => groupedRows(collection, query), [collection, query]);
  const globalGroup =
    visibleGlobalGroups.find((group) => group.agent === activeGlobalAgent) ??
    visibleGlobalGroups[0];
  const globalRows = useMemo(
    () => flatRows(globalGroup?.skills ?? [], query),
    [globalGroup, query]
  );
  const rows = tab === 'project' ? projectRows : tab === 'global' ? globalRows : collectionRows;
  const [cursor, setCursor] = useState(() =>
    Math.min(initialCursor, Math.max(0, rows.length - 1))
  );
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [searching, setSearching] = useState(false);
  const [choosingGroup, setChoosingGroup] = useState(false);
  const [queryBeforeSearch, setQueryBeforeSearch] = useState(initialQuery);
  const [cursorBeforeSearch, setCursorBeforeSearch] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [updateCheck, setUpdateCheck] = useState<{
    checking: boolean;
    updates: Set<string>;
    failed: number;
  }>({ checking: false, updates: new Set(), failed: 0 });
  useEffect(() => {
    setVisibleStatus(status);
    if (!status || !transientStatus) return undefined;
    const timer = setTimeout(() => setVisibleStatus(''), 3500);
    return () => clearTimeout(timer);
  }, [status, transientStatus]);
  const selectedCollection = collection.filter((skill) => selected.has(skill.path));
  const selectedProjectLocal = project.filter(
    (skill) => selected.has(skill.path) && !skill.fromCollection
  );
  const selectedGlobalLocal = globalGroups.flatMap((group) =>
    group.skills.filter((skill) => selected.has(skill.path) && !skill.fromCollection)
  );
  const groupRows = useMemo(
    () => groupedRows(tab === 'project' ? project : collection, ''),
    [collection, project, tab]
  );
  const groups = groupRows.filter(
    (row): row is Extract<SkillRow, { type: 'group' }> => row.type === 'group'
  );

  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) {
      setCursor(0);
      setSelected(new Set());
      previousTab.current = tab;
    }
  }, [tab]);
  const previousAgent = useRef(agent);
  useEffect(() => {
    if (previousAgent.current !== agent) {
      setCursor(0);
      previousAgent.current = agent;
    }
  }, [agent]);
  useEffect(() => {
    if (focus === 'agents' && !hasAgentTabs) setFocus('list');
  }, [focus, hasAgentTabs]);
  const checkedUpdates = useRef(false);
  useEffect(() => {
    if (tab !== 'collection' || checkedUpdates.current) return;
    checkedUpdates.current = true;
    let active = true;
    setUpdateCheck((current) => ({ ...current, checking: true }));
    void checkGitSkillUpdates(collection).then(({ updates, failed }) => {
      if (active) setUpdateCheck({ checking: false, updates, failed });
    });
    return () => {
      active = false;
    };
  }, [collection, tab]);

  const browserState = (): BrowserState => ({
    tab,
    query,
    cursor: cursorRef.current,
    selected: [...selected],
    agent: activeAgent,
    focus,
  });

  const openDetail = (skill: Skill, collection: boolean) =>
    finish({
      ...browserState(),
      type: 'open',
      skill,
      collection,
    });
  useInput(
    (input, key) => {
      if (key.escape || input === 'q') return finish({ type: 'quit' });
      if (input === '/') {
        setQueryBeforeSearch(query);
        setCursorBeforeSearch(cursorRef.current);
        return setSearching(true);
      }
      if (input === 'g' && tab !== 'global' && groups.length) {
        return setChoosingGroup(true);
      }
      if (input === 's' && tab === 'collection' && canSync) {
        return finish({ ...browserState(), type: 'sync' });
      }
      if (focus === 'tabs') {
        if (key.downArrow) return setFocus(hasAgentTabs ? 'agents' : 'list');
        if (key.leftArrow || key.rightArrow) {
          const order: BrowserTab[] = ['project', 'global', 'collection'];
          const index = order.indexOf(tab);
          const next = order[index + (key.leftArrow ? -1 : 1)];
          if (next) setTab(next);
        }
        return;
      }
      if (focus === 'agents') {
        if (key.upArrow) return setFocus('tabs');
        if (key.downArrow) return setFocus('list');
        if (key.leftArrow || key.rightArrow) {
          const names = currentAgentGroups.map((group) => group.agent);
          const index = names.indexOf(activeAgent);
          const next = names[index + (key.leftArrow ? -1 : 1)];
          if (next) setAgent(next);
        }
        return;
      }
      const row = rows[cursorRef.current];
      if (
        input === 'u' &&
        tab === 'collection' &&
        row?.type === 'skill' &&
        row.skill.source?.type === 'git' &&
        row.skill.source.refType === 'branch'
      ) {
        return finish({ ...browserState(), type: 'update', skill: row.skill as CollectedSkill });
      }
      if (input === 't' && tab === 'collection' && selectedCollection.length) {
        return finish({ ...browserState(), type: 'tags', skills: selectedCollection });
      }
      const selectedLocal = tab === 'project' ? selectedProjectLocal : selectedGlobalLocal;
      if (input === 'i' && tab !== 'collection' && selectedLocal.length) {
        return finish({ ...browserState(), type: 'import', skills: selectedLocal });
      }
      if (key.upArrow) {
        if (cursorRef.current === 0) return setFocus(hasAgentTabs ? 'agents' : 'tabs');
        return setCursor((index) => index - 1);
      }
      if (key.downArrow) {
        return setCursor((index) => Math.min(Math.max(0, rows.length - 1), index + 1));
      }
      if (input === ' ' && row) {
        const paths = selectableSkills(row, tab !== 'collection').map((skill) => skill.path);
        if (!paths.length) return;
        return setSelected((previous) => {
          const next = new Set(previous);
          const allSelected = paths.every((path) => previous.has(path));
          for (const path of paths) allSelected ? next.delete(path) : next.add(path);
          return next;
        });
      }
      if (key.rightArrow && tab === 'collection' && row?.type === 'skill') {
        return openDetail(row.skill, true);
      }
      if (key.return || input.includes('\r') || input.includes('\n')) {
        if (tab === 'collection' && selectedCollection.length) {
          return finish({ ...browserState(), type: 'add', skills: selectedCollection });
        }
        if (tab !== 'collection') {
          const skill = row?.type === 'skill' ? row.skill : row?.skills[0];
          if (skill) openDetail(skill, false);
        }
      }
    },
    { isActive: !searching && !choosingGroup && !updatingSkillName }
  );
  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        setChoosingGroup(false);
      }
    },
    { isActive: choosingGroup }
  );

  const tabs = [
    {
      key: 'project',
      label: `当前项目 ${project.length}`,
      content: (
        <Box flexDirection="column">
          <AgentTabs
            groups={visibleProjectGroups}
            agent={activeProjectAgent}
            focused={focus === 'agents'}
          />
          <SkillPane
            rows={projectRows}
            cursor={cursor}
            selected={selected}
            isActive={focus === 'list'}
            showSource
            showGroup={Boolean(query.trim())}
          />
        </Box>
      ),
    },
    {
      key: 'global',
      label: `全局 ${globalGroups.reduce((count, group) => count + group.skills.length, 0)}`,
      content: (
        <Box flexDirection="column">
          <AgentTabs
            groups={visibleGlobalGroups}
            agent={activeGlobalAgent}
            focused={focus === 'agents'}
          />
          <SkillPane
            rows={globalRows}
            cursor={cursor}
            selected={selected}
            isActive={focus === 'list'}
            showSource
          />
        </Box>
      ),
    },
    {
      key: 'collection',
      label: `收藏夹 ${collection.length}`,
      content: (
        <SkillPane
          rows={collectionRows}
          cursor={cursor}
          selected={selected}
          isActive={focus === 'list'}
          preferNote
          showGroup={Boolean(query.trim())}
          updates={updateCheck.updates}
          updatingSkillName={updatingSkillName}
        />
      ),
    },
  ];

  if (choosingGroup) {
    return (
      <Select
        label="跳转到分组："
        numbered
        options={groups.map((group) => ({
          label: `${group.name} (${group.skills.length})`,
          value: group.name,
        }))}
        onSubmit={(name) => {
          setQuery('');
          setCursor(groupRows.findIndex((row) => row.type === 'group' && row.name === name));
          setFocus('list');
          setChoosingGroup(false);
        }}
      />
    );
  }

  const currentRow = rows[cursor];
  const actions = [
    tab !== 'global' && groups.length ? 'g 分组' : '',
    tab === 'project' && selectedProjectLocal.length ? 'i 加入收藏夹' : '',
    tab === 'global' && selectedGlobalLocal.length ? 'i 加入收藏夹' : '',
    tab === 'collection' && selectedCollection.length ? 'Enter 添加 · t 批量加标签' : '',
    tab === 'collection' && canSync ? 's 同步 Git' : '',
    tab === 'collection' && currentRow?.type === 'skill' && updateCheck.updates.has(currentRow.skill.name)
      && !updatingSkillName
      ? 'u 更新当前技能'
      : '',
  ].filter(Boolean);
  const activity = [
    updatingSkillName ? `正在更新 ${updatingSkillName}…` : '',
    updateCheck.checking ? '正在检查更新…' : '',
    !updateCheck.checking && updateCheck.failed ? `${updateCheck.failed} 个技能检查失败` : '',
    visibleStatus,
    query ? `搜索：${query}` : '',
  ].filter(Boolean);

  return (
    <Box flexDirection="column">
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as BrowserTab)}
        isActive={!searching && focus === 'tabs'}
        enableArrowNav={false}
        focused={!searching && focus === 'tabs'}
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
        <Box flexDirection="column">
          <Text color={termcnColors.muted} wrap="truncate-end">
            {updatingSkillName
              ? '正在更新 · 请稍候'
              : focus === 'tabs'
              ? '←/→ 切换 Tab · ↓ 进入 · / 搜索 · q 退出'
              : focus === 'agents'
                ? '←/→ 切换 Agent · ↑ 返回 · ↓ 进入 · / 搜索 · q 退出'
                : tab === 'collection'
                  ? '↑/↓ 移动 · Space 选择 · → 查看 · / 搜索 · q 退出'
                  : '↑/↓ 移动 · Space 选择 · Enter 查看 · / 搜索 · q 退出'}
          </Text>
          {(selected.size > 0 || actions.length > 0) && (
            <Text color={termcnColors.muted} wrap="truncate-end">
              {[selected.size ? `已选 ${selected.size}` : '', ...actions].filter(Boolean).join(' · ')}
            </Text>
          )}
          {activity.length > 0 && (
            <Text color={updateCheck.failed ? termcnColors.error : termcnColors.muted} wrap="truncate-end">
              {activity.join(' · ')}
            </Text>
          )}
        </Box>
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
            {metadata.source.path && <Text><Text bold>路径  </Text>{metadata.source.path}</Text>}
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
        {collection ? 'n 备注 · t 标签 · s 来源 · Esc 返回' : 'Esc 返回'}
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
  projectGroups: SkillGroup[],
  collection: CollectedSkill[],
  globalGroups: SkillGroup[],
  session: InkSession,
  initialQuery = '',
  initialTab: BrowserTab = 'project',
  canSync = false,
  status = '',
  initialCursor = 0,
  initialSelected: string[] = [],
  initialAgent = '',
  initialFocus: BrowserFocus = 'tabs',
  transientStatus = false,
  updatingSkillName?: string
): Promise<BrowserResult> {
  return session.show<BrowserResult>({ type: 'quit' }, (finish) => (
      <Browser
        projectGroups={projectGroups}
        collection={collection}
        globalGroups={globalGroups}
        initialQuery={initialQuery}
        initialTab={initialTab}
        initialAgent={initialAgent}
        initialFocus={initialFocus}
        initialCursor={initialCursor}
        initialSelected={initialSelected}
        canSync={canSync}
        status={status}
        transientStatus={transientStatus}
        updatingSkillName={updatingSkillName}
        finish={finish}
      />
  ), false);
}

export function displayBrowseSkills(
  projectGroups: SkillGroup[],
  collection: CollectedSkill[],
  globalGroups: SkillGroup[],
  session: InkSession,
  initialQuery = '',
  initialTab: BrowserTab = 'project',
  canSync = false,
  status = '',
  initialCursor = 0,
  initialSelected: string[] = [],
  initialAgent = '',
  initialFocus: BrowserFocus = 'tabs',
  transientStatus = false,
  updatingSkillName?: string
): void {
  session.display(
    <Browser
      projectGroups={projectGroups}
      collection={collection}
      globalGroups={globalGroups}
      initialQuery={initialQuery}
      initialTab={initialTab}
      initialAgent={initialAgent}
      initialFocus={initialFocus}
      initialCursor={initialCursor}
      initialSelected={initialSelected}
      canSync={canSync}
      status={status}
      transientStatus={transientStatus}
      updatingSkillName={updatingSkillName}
      finish={() => undefined}
    />
  );
}
