import { Box, Text, useInput, useStdout } from 'ink';
import { Provider, useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import type {
  BrowserFocus,
  BrowserResult,
  BrowserState,
  BrowserTab,
  BrowserViewInput,
  SkillGroup,
} from '../contracts/browser.js';
import { matchesSkill } from '../domain/skill-query.js';
import type { CollectedSkill, Skill, SkillLink, SkillMetadata } from '../domain/types.js';
import {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
} from './browser-state.js';
import { InkSession } from './session.js';
import { Select, Tabs, TextInput, termcnColors } from './termcn.js';

export type {
  BrowserFocus,
  BrowserResult,
  BrowserState,
  BrowserTab,
  BrowserUpdateCheck,
  BrowserUpdateChecker,
  BrowserViewInput,
  SkillGroup,
} from '../contracts/browser.js';
interface BrowserConfirmation {
  title: string;
  message: string;
  details?: string[];
  onConfirm: () => void;
  onCancel: () => void;
}
type SkillRow =
  | { type: 'group'; name: string; skills: Skill[] }
  | { type: 'skill'; group: string; skill: Skill };

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0) return 0;
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) ? 2 : 1;
}

function textWidth(value: string): number {
  return [...value].reduce((width, char) => width + charWidth(char), 0);
}

function sliceColumns(value: string, start: number, end: number): string {
  let column = 0;
  let result = '';
  for (const char of value) {
    const width = charWidth(char);
    const next = column + width;
    if (next > start && column < end) result += char;
    column = next;
    if (column >= end) break;
  }
  return result;
}

function padColumns(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - textWidth(value)))}`;
}

function wrapColumns(value: string, width: number): string[] {
  if (!value) return [''];
  const lines: string[] = [];
  let line = '';
  let columns = 0;
  for (const char of value) {
    const charColumns = charWidth(char);
    if (line && columns + charColumns > width) {
      lines.push(line);
      line = '';
      columns = 0;
    }
    line += char;
    columns += charColumns;
  }
  if (line) lines.push(line);
  return lines;
}

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
      .filter((skill) => matchesSkill(skill, query))
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
    .filter((skill) => matchesSkill(skill, query))
    .map((skill) => ({ type: 'skill', group: '', skill }));
}

function selectableSkills(row: SkillRow): Skill[] {
  return row.type === 'group' ? row.skills : [row.skill];
}

function framedLines(title: string, content: string[], width: number): string[] {
  const inner = width - 4;
  const titleWidth = textWidth(title);
  const body = content
    .flatMap((line) => wrapColumns(line, inner))
    .map((line) => padColumns(line, inner));
  return [
    `╭─${title}${'─'.repeat(Math.max(0, width - titleWidth - 3))}╮`,
    ...body.map((line) => `│ ${line} │`),
    `╰${'─'.repeat(width - 2)}╯`,
  ];
}

function shortcutHelpLines(width: number): string[] {
  const content = [
    '↑/↓ 移动焦点或列表项',
    '←/→ 切换当前层级 Tab；收藏夹内 → 查看详情',
    'Space 选择当前项或当前分组',
    'Enter 查看、添加或提交当前选择',
    '/ 搜索技能',
    'g 跳转到分组（当前项目/收藏夹有分组时）',
    'i 加入收藏夹（当前项目/全局已选择本地技能时）',
    't 批量加标签（收藏夹已选择技能时）',
    's 同步 Git（收藏夹可同步时）',
    'u 更新可更新的已选技能；无选择时更新当前技能',
    'd/Delete 删除已选技能；无选择时删除当前技能',
    'm 更多操作（当前项目引用可转换时）',
    'q 退出 · Esc 取消当前上下文',
    '',
    'Esc / q / ? 关闭',
  ];
  return framedLines(' 完整快捷键 ', content, width);
}

function moreActionLines(scope: string, width: number): string[] {
  return framedLines(' 更多操作 ', [scope, '', '› 将引用转为副本'], width);
}

function confirmationLines(confirmation: BrowserConfirmation, width: number): string[] {
  return framedLines(
    ` ${confirmation.title} `,
    [
      confirmation.message,
      ...(confirmation.details?.length ? confirmation.details : []),
      '(y/N)',
    ],
    width
  );
}

function PopupLine({
  line,
  index,
  last,
  muteLastContent,
}: {
  line: string;
  index: number;
  last: number;
  muteLastContent: boolean;
}) {
  if (index === 0 || index === last) {
    return <Text color={termcnColors.primary}>{line}</Text>;
  }
  const content = line.slice(2, -2);
  return (
    <Text>
      <Text color={termcnColors.primary}>│ </Text>
      {muteLastContent && index === last - 1 ? (
        <Text color={termcnColors.muted}>{content}</Text>
      ) : (
        content
      )}
      <Text color={termcnColors.primary}> │</Text>
    </Text>
  );
}

function SkillPane({
  rows,
  cursor,
  isActive,
  showShortcuts = false,
  preferNote = false,
  showSource = false,
  showReferences = false,
  showGroup = false,
  updates = new Set<string>(),
  updatingSkillName,
  overlayLines,
  overlayMuteLastContent = true,
}: {
  rows: SkillRow[];
  cursor: number;
  isActive: boolean;
  showShortcuts?: boolean;
  preferNote?: boolean;
  showSource?: boolean;
  showReferences?: boolean;
  showGroup?: boolean;
  updates?: Set<string>;
  updatingSkillName?: string | undefined;
  overlayLines?: string[] | undefined;
  overlayMuteLastContent?: boolean;
}) {
  const { stdout } = useStdout();
  const selected = useAtomValue(browserSelectionAtom);
  const height = Math.max(3, (stdout.rows ?? 24) - 8);
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(offset, offset + height);
  const popupLines = overlayLines ?? (
    showShortcuts ? shortcutHelpLines(Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6))) : undefined
  );
  const popupHeight = popupLines?.length ?? 0;
  const compositeHeight = popupLines ? Math.max(visible.length, popupHeight) : visible.length;
  const popupTop = Math.max(0, Math.floor((compositeHeight - popupHeight) / 2));
  const paneWidth = Math.max(20, (stdout.columns ?? 80) - 4);
  const popupWidth = textWidth(popupLines?.[0] ?? '');
  const popupLeft = Math.max(0, Math.floor((paneWidth - popupWidth) / 2));
  const rowText = (row: SkillRow, index: number): string => {
    if (row.type === 'group') {
      const groupSkills = row.skills;
      const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
      const marker =
        count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
      return `${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`;
    }
    const skill = row.skill;
    const summary = (preferNote && skill.note) || skill.description;
    const selectionMarker = selected.has(skill.path) ? '●' : '○';
    const name = showReferences && skill.isReference
      ? `引用 · ${skill.name}`
      : showSource && !skill.fromCollection
        ? `本地 · ${skill.name}`
        : skill.name;
    const group = showGroup && row.group ? `${row.group} / ` : '';
    const update = updatingSkillName === skill.name ? ' 更新中' : updates.has(skill.name) ? ' ↑' : '';
    return `  ${isActive && index === active ? '›' : ' '} ${selectionMarker} ${group}${name}${update}${summary ? ` — ${summary}` : ''}`;
  };
  const renderRow = (row: SkillRow, index: number) => {
    if (row.type === 'group') {
      const groupSkills = row.skills;
      const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
      const marker =
        count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
      return (
        <Text
          key={`group:${row.name}:${index}`}
          bold
          {...(isActive && index === active ? { color: termcnColors.primary } : {})}
        >
          {`${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`}
        </Text>
      );
    }
    const skill = row.skill;
    const summary = (preferNote && skill.note) || skill.description;
    const selectionMarker = selected.has(skill.path) ? '●' : '○';
    return (
      <Text
        key={`${row.group}:${skill.path}:${index}`}
        wrap="truncate-end"
        {...(isActive && index === active ? { color: termcnColors.primary } : {})}
      >
        {`  ${isActive && index === active ? '›' : ' '} ${selectionMarker} `}
        {showGroup && row.group && (
          <Text color={termcnColors.muted}>{row.group} / </Text>
        )}
        {showReferences && skill.isReference ? (
          <>
            <Text color={termcnColors.muted}>引用 · </Text>
            <Text bold={isActive && index === active}>{skill.name}</Text>
          </>
        ) : showSource && !skill.fromCollection ? (
          `本地 · ${skill.name}`
        ) : (
          <Text bold={isActive && index === active}>{skill.name}</Text>
        )}
        {updatingSkillName === skill.name ? (
          <Text color={termcnColors.primary}> 更新中</Text>
        ) : updates.has(skill.name) ? (
          <Text color={termcnColors.primary}> ↑</Text>
        ) : null}
        {summary && (
          <Text color={termcnColors.muted}> — {summary}</Text>
        )}
      </Text>
    );
  };
  const renderRows = () => {
    if (!popupLines) {
      return visible.map((row, visibleIndex) => renderRow(row, offset + visibleIndex));
    }
    return Array.from({ length: compositeHeight }, (_, visibleIndex) => {
      const row = visible[visibleIndex];
      const index = offset + visibleIndex;
      const popupIndex = visibleIndex - popupTop;
      const popupLine = popupLines[popupIndex];
      if (popupLine === undefined) {
        return row ? renderRow(row, index) : <Text key={`shortcut-empty:${visibleIndex}`}> </Text>;
      }
      const base = row ? rowText(row, index) : '';
      const prefix = padColumns(sliceColumns(base, 0, popupLeft), popupLeft);
      const suffix = sliceColumns(base, popupLeft + popupWidth, paneWidth);
      return (
        <Text key={`shortcut-overlay:${visibleIndex}`} wrap="truncate-end">
          {prefix}
          <PopupLine
            line={popupLine}
            index={popupIndex}
            last={popupLines.length - 1}
            muteLastContent={overlayLines ? overlayMuteLastContent : true}
          />
          {suffix}
        </Text>
      );
    });
  };
  return (
    <Box flexDirection="column" minHeight={3}>
      {rows.length || popupLines ? (
        renderRows()
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

interface BrowserProps extends BrowserViewInput {
  confirmation?: BrowserConfirmation | undefined;
  finish: (result: BrowserResult) => void;
}

function BrowserContent({
  projectGroups,
  collection,
  globalGroups,
  canSync,
  status,
  transientStatus,
  checkUpdates,
  updatingSkillName,
  updatingProgress,
  workingAction = '更新',
  confirmation,
  finish,
}: Omit<BrowserProps, 'state'>) {
  const [navigation, setNavigation] = useAtom(browserNavigationAtom);
  const { tab, query, cursor, agent, focus } = navigation;
  const [visibleStatus, setVisibleStatus] = useState(status);
  const visibleProjectGroups = useMemo(() => visibleAgentGroups(projectGroups), [projectGroups]);
  const visibleGlobalGroups = useMemo(() => visibleAgentGroups(globalGroups), [globalGroups]);
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
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const setTab = (value: BrowserTab): void => {
    setNavigation((current) => ({ ...current, tab: value }));
  };
  const setQuery = (value: string): void => {
    setNavigation((current) => ({ ...current, query: value }));
  };
  const setAgent = (value: string): void => {
    setNavigation((current) => ({ ...current, agent: value }));
  };
  const setFocus = (value: BrowserFocus): void => {
    setNavigation((current) => ({ ...current, focus: value }));
  };
  const setCursor = (value: SetStateAction<number>): void => {
    setNavigation((current) => {
      const cursor = typeof value === 'function' ? value(current.cursor) : value;
      cursorRef.current = cursor;
      return { ...current, cursor };
    });
  };
  const [searching, setSearching] = useState(false);
  const [choosingGroup, setChoosingGroup] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [removeConfirmation, setRemoveConfirmation] = useState<{
    scope: 'collection' | 'location';
    skills: Skill[];
  } | undefined>();
  const [queryBeforeSearch, setQueryBeforeSearch] = useState(query);
  const [cursorBeforeSearch, setCursorBeforeSearch] = useState(0);
  const [selected, setSelected] = useAtom(browserSelectionAtom);
  const [updateCheck, setUpdateCheck] = useState<{
    checking: boolean;
    updates: Set<string>;
    failed: number;
  }>({ checking: false, updates: new Set(), failed: 0 });
  const updateSpinner = useSpinner(Boolean(updatingSkillName));
  useEffect(() => {
    setVisibleStatus(status);
    if (!status || !transientStatus) return undefined;
    const timer = setTimeout(() => setVisibleStatus(''), 3500);
    return () => clearTimeout(timer);
  }, [status, transientStatus]);
  const selectedCollection = collection.filter((skill) => selected.has(skill.path));
  const selectedUpdates = selectedCollection.filter((skill) => updateCheck.updates.has(skill.name));
  const selectedProject = project.filter((skill) => selected.has(skill.path));
  const selectedGlobal = globalGroups.flatMap((group) =>
    group.skills.filter((skill) => selected.has(skill.path))
  );
  const selectedProjectLocal = project.filter(
    (skill) => selected.has(skill.path) && !skill.fromCollection
  );
  const selectedGlobalLocal = globalGroups.flatMap((group) =>
    group.skills.filter((skill) => selected.has(skill.path) && !skill.fromCollection)
  );
  const currentRow = rows[cursor];
  const actionSkills = tab === 'project'
    ? selectedProject.length
      ? selectedProject
      : currentRow?.type === 'skill'
        ? [currentRow.skill]
        : []
    : [];
  const canOpenActions =
    !updatingSkillName &&
    focus === 'list' &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => skill.isReference);
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
    void checkUpdates(collection)
      .then(({ updates, failed }) => {
        if (active) setUpdateCheck({ checking: false, updates, failed });
      })
      .catch(() => {
        if (active) setUpdateCheck({ checking: false, updates: new Set(), failed: collection.length });
      });
    return () => {
      active = false;
    };
  }, [checkUpdates, collection, tab]);

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
  const localConfirmation: BrowserConfirmation | undefined = removeConfirmation
    ? removeConfirmation.scope === 'collection'
      ? {
          title: '删除收藏',
          message: removeConfirmation.skills.length === 1
            ? `从收藏夹移除 ${removeConfirmation.skills[0]?.name ?? ''} 吗？`
            : `从收藏夹移除 ${removeConfirmation.skills.length} 个技能吗？`,
          details: removeConfirmation.skills.length > 1
            ? [`技能：${removeConfirmation.skills.map((skill) => skill.name).join(', ')}`]
            : [],
          onConfirm: () => finish({
            ...browserState(),
            type: 'removeCollection',
            skills: removeConfirmation.skills as CollectedSkill[],
          }),
          onCancel: () => setRemoveConfirmation(undefined),
        }
      : {
          title: '删除技能',
          message: removeConfirmation.skills.length === 1
            ? `删除 ${removeConfirmation.skills[0]?.name ?? ''} 的当前位置吗？`
            : `删除所选 ${removeConfirmation.skills.length} 个技能位置吗？`,
          details: [
            '将永久删除以下位置；收藏夹内容（如有）保留。',
            ...removeConfirmation.skills.map((skill) => skill.path),
          ],
          onConfirm: () => finish({
            ...browserState(),
            type: 'removeLocations',
            skills: removeConfirmation.skills,
          }),
          onCancel: () => setRemoveConfirmation(undefined),
        }
    : undefined;
  const activeConfirmation = confirmation ?? localConfirmation;
  const { stdout } = useStdout();
  const overlayLines = activeConfirmation
    ? confirmationLines(
        activeConfirmation,
        Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6))
      )
    : showActions
      ? moreActionLines(
          selectedProject.length
            ? `已选择 ${actionSkills.length} 个技能`
            : `技能：${actionSkills[0]?.name ?? ''}`,
          Math.min(64, Math.max(36, (stdout.columns ?? 80) - 6))
        )
      : undefined;
  useInput(
    (input, key) => {
      const choice = input.trim().toLowerCase();
      if (choice === 'y') return activeConfirmation?.onConfirm();
      if (choice === 'n' || key.return || key.escape) {
        return activeConfirmation?.onCancel();
      }
    },
    { isActive: Boolean(activeConfirmation) }
  );
  useInput(
    (input, key) => {
      if (key.escape) return setShowActions(false);
      if (key.return || input.includes('\r') || input.includes('\n')) {
        return finish({ ...browserState(), type: 'materialize', skills: actionSkills });
      }
    },
    { isActive: showActions && !activeConfirmation }
  );
  useInput(
    (input, key) => {
      if (key.escape || input === 'q' || input === '?') {
        setShowShortcuts(false);
      }
    },
    { isActive: showShortcuts && !activeConfirmation }
  );
  useInput(
    (input, key) => {
      if (input === '?') return setShowShortcuts(true);
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
      if (input === 'm' && canOpenActions) return setShowActions(true);
      if (input === 'u' && tab === 'collection') {
        const updateable = selectedCollection.length
          ? selectedUpdates
          : row?.type === 'skill' && updateCheck.updates.has(row.skill.name)
            ? [row.skill as CollectedSkill]
            : [];
        if (updateable.length) {
          return finish({ ...browserState(), type: 'update', skills: updateable });
        }
      }
      if (input === 't' && tab === 'collection' && selectedCollection.length) {
        return finish({ ...browserState(), type: 'tags', skills: selectedCollection });
      }
      const removableCollection = tab === 'collection'
        ? selectedCollection.length
          ? selectedCollection
          : row?.type === 'skill'
            ? [row.skill as CollectedSkill]
            : []
        : [];
      const removableLocations = tab === 'project'
        ? selectedProject.length
          ? selectedProject
          : row?.type === 'skill'
            ? [row.skill]
            : []
        : tab === 'global'
          ? selectedGlobal.length
            ? selectedGlobal
            : row?.type === 'skill'
              ? [row.skill]
              : []
          : [];
      if ((input === 'd' || key.delete) && removableCollection.length) {
        setShowShortcuts(false);
        return setRemoveConfirmation({ scope: 'collection', skills: removableCollection });
      }
      if ((input === 'd' || key.delete) && removableLocations.length) {
        setShowShortcuts(false);
        return setRemoveConfirmation({ scope: 'location', skills: removableLocations });
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
        const paths = selectableSkills(row).map((skill) => skill.path);
        if (!paths.length) return;
        return setSelected((previous) => {
          const next = new Set(previous);
          const allSelected = paths.every((path) => previous.has(path));
          for (const path of paths) allSelected ? next.delete(path) : next.add(path);
          return next;
        });
      }
      if (key.rightArrow && row?.type === 'skill') {
        if (tab === 'collection') return openDetail(row.skill, true);
        if (row.skill.fromCollection) return openDetail(row.skill, true);
      }
      if (key.return || input.includes('\r') || input.includes('\n')) {
        if (tab === 'collection' && selectedCollection.length) {
          return finish({ ...browserState(), type: 'add', skills: selectedCollection });
        }
        if (tab !== 'collection') {
          if (row?.type === 'skill') openDetail(row.skill, false);
        }
      }
    },
    {
      isActive:
        !searching &&
        !choosingGroup &&
        !showShortcuts &&
        !showActions &&
        !updatingSkillName &&
        !activeConfirmation,
    }
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
            isActive={focus === 'list'}
            showShortcuts={showShortcuts}
            overlayLines={overlayLines}
            overlayMuteLastContent={Boolean(activeConfirmation)}
            showSource
            showReferences
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
            isActive={focus === 'list'}
            showShortcuts={showShortcuts}
            overlayLines={overlayLines}
            overlayMuteLastContent={Boolean(activeConfirmation)}
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
          isActive={focus === 'list'}
          showShortcuts={showShortcuts}
          overlayLines={overlayLines}
          overlayMuteLastContent={Boolean(activeConfirmation)}
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

  const canViewWithRightArrow =
    currentRow?.type === 'skill' && (tab === 'collection' || currentRow.skill.fromCollection);
  const canViewWithEnter =
    currentRow?.type === 'skill' && tab !== 'collection' && !canViewWithRightArrow;
  const canDelete =
    (tab === 'collection' && selectedCollection.length > 0) ||
    (tab === 'project' && selectedProject.length > 0) ||
    (tab === 'global' && selectedGlobal.length > 0) ||
    currentRow?.type === 'skill';
  const actions = updatingSkillName ? [] : [
    canOpenActions ? 'm 更多操作' : '',
    tab === 'project' && selectedProjectLocal.length ? 'i 加入收藏夹' : '',
    tab === 'global' && selectedGlobalLocal.length ? 'i 加入收藏夹' : '',
    tab === 'collection' && selectedCollection.length ? 'Enter 添加 · t 批量加标签' : '',
    tab === 'collection' && !updatingSkillName && selectedCollection.length && selectedUpdates.length
      ? `u 更新可更新的已选技能 (${selectedUpdates.length})`
      : tab === 'collection' && !updatingSkillName && !selectedCollection.length
        && currentRow?.type === 'skill' && updateCheck.updates.has(currentRow.skill.name)
      ? 'u 更新当前技能'
      : '',
  ].filter(Boolean);
  const activity = [
    updatingSkillName
      ? `${updateSpinner} 正在${workingAction}${updatingProgress &&
        (workingAction === '转换' || updatingProgress.total > 1)
        ? ` ${updatingProgress.current}/${updatingProgress.total}`
        : ''}：${updatingSkillName}`
      : '',
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
        isActive={!searching && !showShortcuts && !showActions && focus === 'tabs'}
        enableArrowNav={false}
        focused={!searching && !showShortcuts && focus === 'tabs'}
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
              ? `正在${workingAction} · 请稍候`
              : activeConfirmation
              ? '等待确认'
              : showActions
              ? 'Enter 执行 · Esc 返回'
              : showShortcuts
              ? 'Esc / q / ? 关闭'
              : focus === 'tabs'
              ? '←/→ 切换 Tab · ↓ 进入 · / 搜索 · ? 快捷键 · q 退出'
              : focus === 'agents'
                ? '←/→ 切换 Agent · ↑ 返回 · ↓ 进入 · / 搜索 · ? 快捷键 · q 退出'
                : canViewWithRightArrow
                  ? '→ 查看 · d 删除 · / 搜索 · ? 快捷键 · q 退出'
                  : canViewWithEnter
                    ? 'Enter 查看 · d 删除 · / 搜索 · ? 快捷键 · q 退出'
                  : canDelete
                    ? 'd 删除 · / 搜索 · ? 快捷键 · q 退出'
                    : '/ 搜索 · ? 快捷键 · q 退出'}
          </Text>
          {(selected.size > 0 || actions.length > 0) && (
            <>
              <Text> </Text>
              <Text color={termcnColors.muted} wrap="truncate-end">
                {[selected.size ? `已选 ${selected.size}` : '', ...actions].filter(Boolean).join(' · ')}
              </Text>
            </>
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

function Browser({ state, ...props }: BrowserProps) {
  const [store] = useState(() => {
    const agents = [...props.projectGroups, ...props.globalGroups]
      .filter((group) => group.skills.length > 0)
      .map((group) => group.agent);
    const agent = agents.includes(state.agent) ? state.agent : agents[0] ?? '';
    return createBrowserStore({ ...state, agent });
  });
  return (
    <Provider store={store}>
      <BrowserContent {...props} />
    </Provider>
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
  input: BrowserViewInput,
  session: InkSession
): Promise<BrowserResult> {
  return session.show<BrowserResult>({ type: 'quit' }, (finish) => (
      <Browser {...input} finish={finish} />
  ), false);
}

export interface BrowserConfirmationRequest {
  message: string;
  details?: string[];
  title?: string;
}

export function confirmBrowseAction(
  input: BrowserViewInput,
  session: InkSession,
  { message, details = [], title = '确认' }: BrowserConfirmationRequest
): Promise<boolean> {
  return session.show<boolean>(false, (finish) => (
      <Browser
        {...input}
        confirmation={{
          title,
          message,
          details,
          onConfirm: () => finish(true),
          onCancel: () => finish(false),
        }}
        finish={() => undefined}
      />
  ), false);
}

export function displayBrowseSkills(
  input: BrowserViewInput,
  session: InkSession,
  onInterrupt?: () => void
): void {
  session.display(
    <Browser
      {...input}
      finish={() => undefined}
    />,
    onInterrupt
  );
}
