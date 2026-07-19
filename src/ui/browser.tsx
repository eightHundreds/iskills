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
import { skillFieldLabels } from './skill-labels.js';
import {
  Modal,
  Select,
  Tabs,
  TextInput,
  termcnColors,
  type ModalBackgroundLine,
} from './components/termcn.js';
import { textWidth, wrapColumns } from './components/terminal-layout.js';

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

function paneHeight(rowCount: number, viewportHeight: number): number {
  const visibleRows = Math.max(3, Math.min(rowCount, viewportHeight));
  return visibleRows + (rowCount > viewportHeight ? 1 : 0);
}

export interface BrowserFrameDimensions {
  frameHeight: number;
  frameWidth: number;
  listViewportHeight: number;
}

export function browserFrameDimensions({
  rows,
  columns,
  projectRows,
  globalRows,
  collectionRows,
  hasProjectAgents,
  hasGlobalAgents,
}: {
  rows: number | undefined;
  columns: number | undefined;
  projectRows: number;
  globalRows: number;
  collectionRows: number;
  hasProjectAgents: boolean;
  hasGlobalAgents: boolean;
}): BrowserFrameDimensions {
  const listViewportHeight = Math.max(3, (rows ?? 24) - 10);
  const tabContentHeight = Math.max(
    paneHeight(projectRows, listViewportHeight) + (hasProjectAgents ? 1 : 0),
    paneHeight(globalRows, listViewportHeight) + (hasGlobalAgents ? 1 : 0),
    paneHeight(collectionRows, listViewportHeight)
  );
  return {
    frameHeight: tabContentHeight + 2,
    frameWidth: columns ?? 80,
    listViewportHeight,
  };
}

export function detailFrameDimensions(
  frameHeight: number,
  frameWidth: number,
  terminalRows: number | undefined
): { height: number; width: number } {
  return {
    height: Math.min(frameHeight, Math.max(5, (terminalRows ?? 24) - 4)),
    width: frameWidth,
  };
}

interface DetailContentLine {
  label?: string;
  value: string;
  muted?: boolean;
}

function detailFieldLines(
  label: string,
  value: string,
  width: number,
  muted = false
): DetailContentLine[] {
  const labelText = `${label}  `;
  const indentation = ' '.repeat(textWidth(labelText));
  const valueWidth = Math.max(1, width - textWidth(labelText));
  return value
    .split(/\r?\n/)
    .flatMap((paragraph) => wrapColumns(paragraph, valueWidth))
    .map((line, index) => index === 0
      ? { label: labelText, value: line, muted }
      : { value: `${indentation}${line}`, muted });
}

function detailContentLines(
  skill: Skill,
  metadata: SkillMetadata,
  links: SkillLink[],
  collection: boolean,
  source: string,
  frameWidth: number
): DetailContentLine[] {
  const width = Math.max(1, frameWidth - 4);
  const lines = detailFieldLines(skillFieldLabels.description, skill.description || '无描述', width, true);
  if (!collection) return [...lines, ...detailFieldLines(skillFieldLabels.location, skill.path, width)];

  lines.push(
    ...detailFieldLines(skillFieldLabels.tags, metadata.tags.length ? metadata.tags.join(', ') : '无', width),
    ...detailFieldLines(skillFieldLabels.note, metadata.note || '无', width),
    ...detailFieldLines(skillFieldLabels.source, source, width)
  );
  if (metadata.source.path) {
    lines.push(...detailFieldLines(skillFieldLabels.path, metadata.source.path, width));
  }
  lines.push({ label: skillFieldLabels.relatedLocations, value: '' });
  if (!links.length) return [...lines, { value: '  无', muted: true }];
  return [
    ...lines,
    ...links.flatMap((link) => detailFieldLines(
      link.kind === 'origin' ? '  原始' : link.kind === 'usage' ? '  使用' : '  依赖',
      link.path,
      width,
      true
    )),
  ];
}

function shortcutModalContent(): string[] {
  return [
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
    'Esc 关闭',
  ];
}

function moreActionModalContent(scope: string): string[] {
  return [scope, '', '› 将引用转为副本'];
}

interface BrowserModal {
  title: string;
  content: string[];
  width: number;
  onEscape: () => void;
  muteLastContent?: boolean;
}

function SkillPane({
  rows,
  cursor,
  isActive,
  preferNote = false,
  showSource = false,
  showReferences = false,
  showGroup = false,
  updates = new Set<string>(),
  updatingSkillName,
  modal,
  viewportHeight,
}: {
  rows: SkillRow[];
  cursor: number;
  isActive: boolean;
  preferNote?: boolean;
  showSource?: boolean;
  showReferences?: boolean;
  showGroup?: boolean;
  updates?: Set<string>;
  updatingSkillName?: string | undefined;
  modal?: BrowserModal | undefined;
  viewportHeight?: number | undefined;
}) {
  const { stdout } = useStdout();
  const selected = useAtomValue(browserSelectionAtom);
  const paneHeight = viewportHeight ?? Math.max(3, (stdout.rows ?? 24) - 8);
  const height = rows.length > paneHeight ? Math.max(3, paneHeight - 1) : paneHeight;
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(offset, offset + height);
  const paneWidth = Math.max(20, (stdout.columns ?? 80) - 4);
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
  const backgroundLines: ModalBackgroundLine[] = visible.map((row, visibleIndex) => {
    const index = offset + visibleIndex;
    return { text: rowText(row, index), content: renderRow(row, index) };
  });
  return (
    <Box flexDirection="column" minHeight={3}>
      {modal ? (
        <Modal
          open
          title={modal.title}
          content={modal.content}
          width={modal.width}
          viewportWidth={paneWidth}
          viewportHeight={height}
          backgroundLines={backgroundLines}
          onEscape={modal.onEscape}
          {...(modal.muteLastContent ? { muteLastContent: true } : {})}
        />
      ) : rows.length ? (
        visible.map((row, visibleIndex) => renderRow(row, offset + visibleIndex))
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
      frameHeight: frame.frameHeight,
      frameWidth: frame.frameWidth,
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
  const frame = browserFrameDimensions({
    rows: stdout.rows,
    columns: stdout.columns,
    projectRows: projectRows.length,
    globalRows: globalRows.length,
    collectionRows: collectionRows.length,
    hasProjectAgents: visibleProjectGroups.length > 0,
    hasGlobalAgents: visibleGlobalGroups.length > 0,
  });
  const agentPaneViewportHeight = Math.max(3, frame.frameHeight - 3);
  const collectionPaneViewportHeight = Math.max(3, frame.frameHeight - 2);
  const modal: BrowserModal | undefined = activeConfirmation
    ? {
        title: ` ${activeConfirmation.title} `,
        content: [
          activeConfirmation.message,
          ...(activeConfirmation.details?.length ? activeConfirmation.details : []),
          '(y/N)',
        ],
        width: Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6)),
        onEscape: activeConfirmation.onCancel,
        muteLastContent: true,
      }
    : showActions
      ? {
          title: ' 更多操作 ',
          content: moreActionModalContent(
            selectedProject.length
              ? `已选择 ${actionSkills.length} 个技能`
              : `技能：${actionSkills[0]?.name ?? ''}`
          ),
          width: Math.min(64, Math.max(36, (stdout.columns ?? 80) - 6)),
          onEscape: () => setShowActions(false),
        }
      : showShortcuts
        ? {
            title: ' 完整快捷键 ',
            content: shortcutModalContent(),
            width: Math.min(76, Math.max(36, (stdout.columns ?? 80) - 6)),
            onEscape: () => setShowShortcuts(false),
          }
        : undefined;
  useInput(
    (input, key) => {
      const choice = input.trim().toLowerCase();
      if (choice === 'y') return activeConfirmation?.onConfirm();
      if (choice === 'n' || key.return) {
        return activeConfirmation?.onCancel();
      }
    },
    { isActive: Boolean(activeConfirmation) }
  );
  useInput(
    (input, key) => {
      if (key.return || input.includes('\r') || input.includes('\n')) {
        return finish({ ...browserState(), type: 'materialize', skills: actionSkills });
      }
    },
    { isActive: showActions && !activeConfirmation }
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
        !modal &&
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
        <Box flexDirection="column" minHeight={frame.frameHeight - 2}>
          <AgentTabs
            groups={visibleProjectGroups}
            agent={activeProjectAgent}
            focused={focus === 'agents'}
          />
          <SkillPane
            rows={projectRows}
            cursor={cursor}
            isActive={focus === 'list'}
            viewportHeight={agentPaneViewportHeight}
            modal={modal}
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
        <Box flexDirection="column" minHeight={frame.frameHeight - 2}>
          <AgentTabs
            groups={visibleGlobalGroups}
            agent={activeGlobalAgent}
            focused={focus === 'agents'}
          />
          <SkillPane
            rows={globalRows}
            cursor={cursor}
            isActive={focus === 'list'}
            viewportHeight={agentPaneViewportHeight}
            modal={modal}
            showSource
          />
        </Box>
      ),
    },
    {
      key: 'collection',
      label: `收藏夹 ${collection.length}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 2}>
          <SkillPane
            rows={collectionRows}
            cursor={cursor}
            isActive={focus === 'list'}
            viewportHeight={collectionPaneViewportHeight}
            modal={modal}
            preferNote
            showGroup={Boolean(query.trim())}
            updates={updateCheck.updates}
            updatingSkillName={updatingSkillName}
          />
        </Box>
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
        isActive={!searching && !modal && focus === 'tabs'}
        enableArrowNav={false}
        focused={!searching && !modal && focus === 'tabs'}
        width={frame.frameWidth}
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
          {(selected.size > 0 || actions.length > 0) && (
            <Text color={termcnColors.muted} wrap="truncate-end">
              {[...actions, selected.size ? `已选 ${selected.size}` : ''].filter(Boolean).join(' · ')}
            </Text>
          )}
          <Text color={termcnColors.muted} wrap="truncate-end">
            {updatingSkillName
              ? `正在${workingAction} · 请稍候`
              : activeConfirmation
              ? '等待确认'
              : showActions
              ? 'Enter 执行 · Esc 返回'
              : showShortcuts
              ? 'Esc 关闭'
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
  frameHeight,
  frameWidth,
  finish,
}: {
  skill: Skill;
  metadata: SkillMetadata;
  links: SkillLink[];
  collection: boolean;
  frameHeight: number;
  frameWidth: number;
  finish: (action: DetailAction) => void;
}) {
  const { stdout } = useStdout();
  const detailFrame = detailFrameDimensions(frameHeight, frameWidth, stdout.rows);
  const [detailOffset, setDetailOffset] = useState(0);
  const source = metadata.source.url
    ? `${metadata.source.url}${metadata.source.ref ? ` @ ${metadata.source.ref}` : ''}`
    : metadata.source.type;
  const lines = detailContentLines(skill, metadata, links, collection, source, detailFrame.width);
  const viewportHeight = Math.max(1, detailFrame.height - 2);
  const maxOffset = Math.max(0, lines.length - viewportHeight);
  const offset = Math.min(detailOffset, maxOffset);
  const visibleLines = lines.slice(offset, offset + viewportHeight);
  useInput((input, key) => {
    if (key.upArrow && maxOffset) {
      setDetailOffset((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow && maxOffset) {
      setDetailOffset((current) => Math.min(maxOffset, current + 1));
      return;
    }
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
  return (
    <Box flexDirection="column">
      <Text color={termcnColors.primary} bold>‹ {skill.name}</Text>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={termcnColors.border}
        paddingX={1}
        height={detailFrame.height}
        width={detailFrame.width}
        overflow="hidden"
      >
        {visibleLines.map((line, index) => (
          <Text
            key={`${offset + index}:${line.label ?? ''}:${line.value}`}
            {...(line.muted ? { color: termcnColors.muted } : {})}
          >
            {line.label && <Text bold>{line.label}</Text>}{line.value}
          </Text>
        ))}
      </Box>
      <Text color={termcnColors.muted}>
        {`${maxOffset ? '↑/↓ 滚动 · ' : ''}${collection ? 'n 备注 · t 标签 · s 来源 · Esc 返回' : 'Esc 返回'}`}
      </Text>
    </Box>
  );
}

export function browseSkillDetail(
  skill: Skill,
  metadata: SkillMetadata,
  links: SkillLink[],
  collection: boolean,
  frameHeight: number,
  frameWidth: number,
  session: InkSession
): Promise<DetailAction> {
  return session.show<DetailAction>('back', (finish) => (
      <Detail
        skill={skill}
        metadata={metadata}
        links={links}
        collection={collection}
        frameHeight={frameHeight}
        frameWidth={frameWidth}
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
