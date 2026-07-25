import { Box, Text, useInput, useStdout } from 'ink';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import type {
  BrowserFocus,
  BrowserResult,
  BrowserTab,
  BrowserViewInput,
  SkillGroup,
} from './types.js';
import type { CollectedSkill, Skill } from '../../domain/types.js';
import {
  browserNavigationAtom,
  browserSelectionAtom,
} from './store.js';
import {
  browserFrameDimensions,
  masterDetailLayout,
  masterDetailSeparator,
  masterDetailViewportHeight,
  masterDetailWidths,
} from './layout.js';
import {
  TAG_FILTER_ALL,
  browseDetailRows,
  collectionCategoryLines,
  collectionListColumnLines,
  flatRows,
  focusAfterDownFromAgents,
  focusAfterDownFromTabs,
  focusAfterUpFromList,
  focusAfterUpFromTags,
  groupedRows,
  listSkillSummary,
  masterListColumnLines,
  masterPeekColumnLines,
  masterTagColumnLines,
  moreActionModalContent,
  nextAgent,
  nextMainTab,
  selectableSkills,
  shortcutModalContent,
  skillGroups,
  skillsForTagFilter,
  tagFilterOptions,
  type CollectionDetailRow,
  type SkillRow,
  visibleAgentGroups,
} from './format.js';
import { useModal, useShellBusy } from '../shell/app-shell.js';
import { FramedPanel } from '../components/framed-panel.js';
import {
  Select,
  Tabs,
  TextInput,
  termcnColors,
} from '../components/termcn.js';
import { padColumns, sliceColumns } from '../components/terminal-layout.js';

/** Framed more-actions panel for absolute modal overlay (list shows through). */
function MoreActionsPanel({
  scope,
  onConfirm,
  onCancel,
}: {
  scope: string;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  return (
    <FramedPanel
      title=" 更多操作 "
      content={[...moreActionModalContent(scope), 'Enter 执行 · Esc 返回']}
      width={64}
      muteLastContent
      onEscape={onCancel}
      onKey={(input, key) => {
        if (key.return || input.includes('\r') || input.includes('\n')) onConfirm();
      }}
    />
  );
}

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

function masterDetailBlankRow(
  tagWidth: number,
  listWidth: number,
  peekWidth: number
): ReactNode {
  const divider = '│';
  return (
    <Box flexDirection="row">
      <Box width={tagWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', tagWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </Box>
      <Box width={listWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', listWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </Box>
      <Box width={peekWidth}>
        <Text wrap="truncate-end">{padColumns('', peekWidth)}</Text>
      </Box>
    </Box>
  );
}

function SkillPane({
  rows,
  cursor,
  isActive,
  preferNote = false,
  compact = false,
  layout = 'default',
  columnWidth,
  showPagination = true,
  showSource = false,
  showReferences = false,
  showGroup = false,
  updates = new Set<string>(),
  updatingSkillName,
  viewportHeight,
}: {
  rows: SkillRow[];
  cursor: number;
  isActive: boolean;
  preferNote?: boolean;
  compact?: boolean;
  layout?: 'default' | 'master';
  columnWidth?: number | undefined;
  showPagination?: boolean;
  showSource?: boolean;
  showReferences?: boolean;
  showGroup?: boolean;
  updates?: Set<string>;
  updatingSkillName?: string | undefined;
  viewportHeight?: number | undefined;
}) {
  const { stdout } = useStdout();
  const selected = useAtomValue(browserSelectionAtom);
  const paneHeight = viewportHeight ?? Math.max(3, (stdout.rows ?? 24) - 8);
  const height = rows.length > paneHeight ? Math.max(3, paneHeight - (showPagination ? 1 : 0)) : paneHeight;
  const active = Math.max(0, Math.min(cursor, rows.length - 1));
  const offset = Math.max(0, Math.min(active - Math.floor(height / 2), rows.length - height));
  const visible = rows.slice(offset, offset + height);
  const paneWidth = columnWidth ?? Math.max(20, (stdout.columns ?? 80) - 4);
  const summaryWidth = Math.max(8, paneWidth - 4);
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
    const current = isActive && index === active;
    const summary = compact || layout === 'master'
      ? ''
      : listSkillSummary(skill, preferNote, summaryWidth);
    const inlineSummary = summary;
    const selectionMarker = selected.has(skill.path) ? '●' : '○';
    const nameLine = (
      <>
        {`  ${current ? '›' : ' '} ${selectionMarker} `}
        {showGroup && row.group && (
          <Text color={termcnColors.muted}>{row.group} / </Text>
        )}
        {showReferences && skill.isReference ? (
          <>
            <Text color={termcnColors.muted}>引用 · </Text>
            <Text bold={current}>{skill.name}</Text>
          </>
        ) : showSource && !skill.fromCollection ? (
          `本地 · ${skill.name}`
        ) : (
          <Text bold={current}>{skill.name}</Text>
        )}
        {updatingSkillName === skill.name ? (
          <Text color={termcnColors.primary}> 更新中</Text>
        ) : updates.has(skill.name) ? (
          <Text color={termcnColors.primary}> ↑</Text>
        ) : null}
        {inlineSummary && (
          <Text color={termcnColors.muted}> — {inlineSummary}</Text>
        )}
      </>
    );
    return (
      <Text
        key={`${row.group}:${skill.path}:${index}`}
        wrap="truncate-end"
        {...(current ? { color: termcnColors.primary } : {})}
      >
        {nameLine}
      </Text>
    );
  };
  return (
    <Box flexDirection="column" minHeight={3}>
      {rows.length ? (
        visible.map((row, visibleIndex) => renderRow(row, offset + visibleIndex))
      ) : (
        <Text color={termcnColors.muted}>没有匹配的技能</Text>
      )}
      {showPagination && rows.length > height && (
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
    <Box paddingLeft={1} gap={2}>
      {groups.map((group) => {
        const active = group.agent === agent;
        // Keyboard focus only: never use foreground/white for "current agent".
        // Unfocused row stays fully muted so switching main tabs does not look
        // like the agent row is already selected.
        const highlighted = focused && active;
        return (
          <Text
            key={group.agent}
            color={highlighted ? termcnColors.primary : termcnColors.muted}
            underline={highlighted}
          >
            {`${group.agent} ${group.skills.length}`}
          </Text>
        );
      })}
    </Box>
  );
}

function masterDetailColumnText(
  line: string,
  width: number,
  options: {
    color?: string;
    bold?: boolean;
    inverse?: boolean;
    muted?: boolean;
  } = {}
): ReactNode {
  const padded = padColumns(sliceColumns(line, 0, width), width);
  return (
    <Text
      wrap="truncate-end"
      {...(options.color ? { color: options.color } : {})}
      {...(options.bold ? { bold: true } : {})}
      {...(options.inverse ? { inverse: true } : {})}
      {...(options.muted ? { color: termcnColors.muted } : {})}
    >
      {padded}
    </Text>
  );
}

function MasterDetailBody({
  tagLines,
  listLines,
  peekLines,
  tagWidth,
  listWidth,
  peekWidth,
  tagActive,
  listActive,
  collectionHome = false,
  listActiveLineIndexes,
  listSelectedLineIndexes,
  detailRows,
}: {
  tagLines: string[];
  listLines: string[];
  peekLines: string[];
  tagWidth: number;
  listWidth: number;
  peekWidth: number;
  tagActive: boolean;
  listActive: boolean;
  collectionHome?: boolean;
  listActiveLineIndexes?: Set<number>;
  listSelectedLineIndexes?: Set<number>;
  detailRows?: CollectionDetailRow[];
}): ReactNode {
  const rows = Math.max(tagLines.length, listLines.length, peekLines.length);
  const divided = collectionHome;
  const divider = divided ? '│' : '';
  const tagColumnWidth = tagWidth + (divider ? 1 : 0);
  const listColumnWidth = listWidth + (divider ? 1 : 0);
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <Box key={`master-detail-row:${index}`} flexDirection="row">
          <Box width={tagColumnWidth} flexDirection="row">
            {masterDetailColumnText(tagLines[index] ?? '', tagWidth, {
              ...(tagActive && tagLines[index]?.startsWith('›')
                ? collectionHome
                  ? { inverse: true }
                  : { color: termcnColors.primary }
                : {}),
            })}
            {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
          </Box>
          <Box width={listColumnWidth} flexDirection="row">
            {masterDetailColumnText(listLines[index] ?? '', listWidth, {
              ...(listActiveLineIndexes?.has(index)
                ? { inverse: true }
                : listSelectedLineIndexes?.has(index)
                  ? { color: termcnColors.primary, bold: true }
                  : listActive && listLines[index]?.startsWith('›')
                    ? { color: termcnColors.primary, bold: true }
                    : index % 2 === 1 && listLines[index]?.trim()
                      ? { muted: true }
                      : {}),
            })}
            {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
          </Box>
          <Box width={peekWidth}>
            {detailRows?.[index] ? (
              <Text
                wrap="truncate-end"
                {...(detailRows[index]?.primary ? { color: termcnColors.primary } : {})}
                {...(detailRows[index]?.muted ? { color: termcnColors.muted } : {})}
                {...(detailRows[index]?.bold ? { bold: true } : {})}
              >
                {padColumns(sliceColumns(detailRows[index]?.text ?? '', 0, peekWidth), peekWidth)}
              </Text>
            ) : (
              <Text
                wrap="truncate-end"
                color={index === 0 && peekLines[index] !== '选择技能查看' ? termcnColors.primary : termcnColors.muted}
                bold={index === 0 && peekLines[index] !== '选择技能查看'}
              >
                {padColumns(sliceColumns(peekLines[index] ?? '', 0, peekWidth), peekWidth)}
              </Text>
            )}
          </Box>
        </Box>
      ))}
    </>
  );
}

interface BrowserProps extends BrowserViewInput {
  finish: (result: BrowserResult) => void;
}

/**
 * Browser list view. Navigation/selection live in the parent Jotai Provider
 * (BrowserApp store). Does not create a nested store.
 * Overlays (? / more-actions) go through {@link useModal}.
 */
export function Browser({
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
  finish,
}: BrowserProps) {
  const modal = useModal();
  const shellBusy = useShellBusy();
  const [navigation, setNavigationState] = useAtom(browserNavigationAtom);
  const [selected, setSelected] = useAtom(browserSelectionAtom);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  /** Keep ref in lockstep so multi-key stdin never reads a stale focus/tab. */
  const setNavigation = (
    value: Parameters<typeof setNavigationState>[0]
  ): void => {
    setNavigationState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      navigationRef.current = next;
      return next;
    });
  };
  const tab = navigation?.tab ?? 'project';
  const query = navigation?.query ?? '';
  const cursor = navigation?.cursor ?? 0;
  const agent = navigation?.agent ?? '';
  const focus = navigation?.focus ?? 'tabs';
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
    setNavigation((current) => (current ? { ...current, tab: value } : current));
  };
  const setQuery = (value: string): void => {
    setNavigation((current) => (current ? { ...current, query: value } : current));
  };
  const setAgent = (value: string): void => {
    setNavigation((current) => (current ? { ...current, agent: value } : current));
  };
  const setFocus = (value: BrowserFocus): void => {
    setNavigation((current) => (current ? { ...current, focus: value } : current));
  };
  const setCursor = (value: SetStateAction<number>): void => {
    setNavigation((current) => {
      if (!current) return current;
      const nextCursor = typeof value === 'function' ? value(current.cursor) : value;
      cursorRef.current = nextCursor;
      return { ...current, cursor: nextCursor };
    });
  };
  const [searching, setSearching] = useState(false);
  const [choosingGroup, setChoosingGroup] = useState(false);
  const [queryBeforeSearch, setQueryBeforeSearch] = useState(query);
  const [cursorBeforeSearch, setCursorBeforeSearch] = useState(0);
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
  const { stdout } = useStdout();
  const useBrowseHome =
    masterDetailLayout(stdout.columns, stdout.rows) &&
    !query.trim();
  const useMasterDetail = useBrowseHome;
  // Scope for list + tag sidebar + g-jump: current agent (or full collection),
  // never the whole project/global flat list.
  const tabSkills =
    tab === 'collection'
      ? collection
      : tab === 'project'
        ? projectGroup?.skills ?? []
        : tab === 'global'
          ? globalGroup?.skills ?? []
          : [];
  const groupRows = useMemo(
    () => groupedRows(tabSkills, ''),
    [tabSkills]
  );
  const groups = groupRows.filter(
    (row): row is Extract<SkillRow, { type: 'group' }> => row.type === 'group'
  );
  const tagOptions = useMemo(
    () => tagFilterOptions(tabSkills, groups),
    [groups, tabSkills]
  );
  const [tagFilter, setTagFilter] = useState(TAG_FILTER_ALL);
  const [tagCursor, setTagCursor] = useState(0);
  const masterDetailSkills = useMemo(
    () => skillsForTagFilter(tabSkills, tagFilter),
    [tabSkills, tagFilter]
  );
  const masterDetailRows = useMemo(
    () => flatRows(masterDetailSkills, query),
    [masterDetailSkills, query]
  );
  const listRows = useMasterDetail ? masterDetailRows : rows;
  const currentRow = listRows[cursor];
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
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current !== tab) {
      setCursor(0);
      setSelected(new Set());
      setTagFilter(TAG_FILTER_ALL);
      setTagCursor(0);
      previousTab.current = tab;
    }
  }, [tab]);
  const previousAgent = useRef(agent);
  useEffect(() => {
    if (previousAgent.current !== agent) {
      setCursor(0);
      setTagFilter(TAG_FILTER_ALL);
      setTagCursor(0);
      previousAgent.current = agent;
    }
  }, [agent]);
  useEffect(() => {
    if (focus === 'agents' && !hasAgentTabs) setFocus(useMasterDetail ? 'tags' : 'list');
  }, [focus, hasAgentTabs, useMasterDetail]);
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

  const frame = browserFrameDimensions({
    rows: stdout.rows,
    columns: stdout.columns,
    projectRows: projectRows.length,
    globalRows: globalRows.length,
    collectionRows: collectionRows.length,
    hasProjectAgents: visibleProjectGroups.length > 0,
    hasGlobalAgents: visibleGlobalGroups.length > 0,
  });
  const openDetail = (skill: Skill, collection: boolean) =>
    finish({
      type: 'open',
      skill,
      collection,
      frameHeight: frame.frameHeight,
      frameWidth: frame.frameWidth,
    });
  const agentPaneViewportHeight = Math.max(3, frame.frameHeight - 3);
  const collectionPaneViewportHeight = Math.max(3, frame.frameHeight - 2);
  const masterDetailInnerWidth = Math.max(40, frame.frameWidth - 2);
  const masterDetailColumns = masterDetailWidths(masterDetailInnerWidth, useBrowseHome);
  const masterDetailBrowseHeight = (withAgents: boolean): number =>
    masterDetailViewportHeight(stdout.rows, 1 + 2 + 3 + (withAgents ? 1 : 0));
  const browseViewportHeight = (withAgents: boolean): number =>
    useMasterDetail
      ? masterDetailBrowseHeight(withAgents)
      : withAgents
        ? agentPaneViewportHeight
        : collectionPaneViewportHeight;
  const masterListVisibleHeight = Math.max(1, Math.floor(masterDetailBrowseHeight(false) / 2));
  const masterListOffset = useMasterDetail
    ? Math.max(
        0,
        Math.min(
          cursor - Math.floor(masterListVisibleHeight / 2),
          Math.max(0, listRows.length - masterListVisibleHeight)
        )
      )
    : 0;
  const listScrollHint = useBrowseHome && listRows.length
    ? `${cursor + 1}/${listRows.length}`
    : useMasterDetail && listRows.length > masterListVisibleHeight
      ? `${masterListOffset + 1}–${Math.min(masterListOffset + masterListVisibleHeight, listRows.length)} / ${listRows.length}`
      : '';
  const peekSkill =
    focus === 'list' && currentRow?.type === 'skill' ? currentRow.skill : undefined;
  useEffect(() => {
    if (focus === 'tags' && !useMasterDetail) setFocus('list');
  }, [focus, useMasterDetail, setFocus]);
  useInput(
    (input, key) => {
      const live = navigationRef.current;
      const liveFocus = live?.focus ?? 'tabs';
      const liveTab = live?.tab ?? 'project';
      if (input === '?') {
        void modal.info({
          title: ' 完整快捷键 ',
          content: shortcutModalContent(),
          width: 76,
        });
        return;
      }
      if (key.escape || input === 'q') return finish({ type: 'quit' });
      if (input === '/') {
        setQueryBeforeSearch(query);
        setCursorBeforeSearch(cursorRef.current);
        return setSearching(true);
      }
      if (input === 'g' && groups.length) {
        return setChoosingGroup(true);
      }
      if (input === 's' && liveTab === 'collection' && canSync) {
        return finish({ type: 'sync' });
      }
      // Focus ladder + tab/agent switching: always branch on the live ref so
      // multi-key stdin batches each advance from the latest navigation.
      if (key.downArrow || key.upArrow || key.leftArrow || key.rightArrow) {
        if (liveFocus === 'tabs' || liveFocus === 'agents' || liveFocus === 'tags') {
          const direction = key.leftArrow ? -1 : key.rightArrow ? 1 : 0;
          setNavigation((current) => {
            if (!current) return current;
            const groups =
              current.tab === 'project'
                ? visibleProjectGroups
                : current.tab === 'global'
                  ? visibleGlobalGroups
                  : [];
            const hasAgents = groups.length > 0;
            const names = groups.map((group) => group.agent);
            if (current.focus === 'tabs') {
              if (key.downArrow) {
                return {
                  ...current,
                  focus: focusAfterDownFromTabs(hasAgents, useMasterDetail),
                };
              }
              if (key.leftArrow || key.rightArrow) {
                const next = nextMainTab(current.tab, direction as -1 | 1);
                return next ? { ...current, tab: next } : current;
              }
              return current;
            }
            if (current.focus === 'agents') {
              if (key.upArrow) return { ...current, focus: 'tabs' };
              if (key.downArrow) {
                return {
                  ...current,
                  focus: focusAfterDownFromAgents(useMasterDetail),
                };
              }
              if (key.leftArrow || key.rightArrow) {
                const next = nextAgent(names, current.agent || names[0] || '', direction as -1 | 1);
                return next ? { ...current, agent: next } : current;
              }
              return current;
            }
            if (current.focus === 'tags') {
              // ↑/↓ move among tag rows (handled below). Only ←/→ change the focus ladder here.
              if (key.leftArrow) return { ...current, focus: focusAfterUpFromTags(hasAgents) };
              if (key.rightArrow) return { ...current, focus: 'list' };
              return current;
            }
            return current;
          });
          // Tag index moves stay on the tags-local path below when still on tags.
          if (liveFocus !== 'tags' || key.leftArrow || key.rightArrow) return;
        }
      }
      if (liveFocus === 'tabs' || liveFocus === 'agents') {
        return;
      }
      if (liveFocus === 'tags' || focus === 'tags') {
        const selectTag = (index: number): void => {
          const option = tagOptions[index];
          if (!option) return;
          setTagFilter(option.key);
          setTagCursor(index);
          setCursor(0);
        };
        if (key.upArrow) {
          if (tagCursor === 0) return setFocus(focusAfterUpFromTags(hasAgentTabs));
          selectTag(tagCursor - 1);
          return;
        }
        if (key.downArrow) {
          if (tagCursor >= tagOptions.length - 1) return setFocus('list');
          selectTag(tagCursor + 1);
          return;
        }
        if (key.leftArrow) return setFocus(focusAfterUpFromTags(hasAgentTabs));
        if (key.rightArrow) {
          selectTag(tagCursor);
          return setFocus('list');
        }
        const tagOption = tagOptions[tagCursor];
        if (input === ' ' && tagOption) {
          const paths = tagOption.skills.map((skill) => skill.path);
          return setSelected((previous) => {
            const next = new Set(previous);
            const allSelected = paths.every((path) => previous.has(path));
            for (const path of paths) allSelected ? next.delete(path) : next.add(path);
            return next;
          });
        }
        if (key.return || input.includes('\r') || input.includes('\n')) {
          selectTag(tagCursor);
          return setFocus('list');
        }
        return;
      }
      if ((navigationRef.current?.focus ?? focus) !== 'list') return;
      const row = listRows[cursorRef.current];
      if (input === 'm' && canOpenActions) {
        const skills = actionSkills;
        const scope = selectedProject.length
          ? `已选择 ${skills.length} 个技能`
          : `技能：${skills[0]?.name ?? ''}`;
        void modal
          .open<boolean>({
            content: (close) => (
              <MoreActionsPanel
                scope={scope}
                onConfirm={() => close(true)}
                onCancel={() => close(false)}
              />
            ),
          })
          .then((confirmed) => {
            if (confirmed) finish({ type: 'materialize', skills });
          });
        return;
      }
      if (input === 'u' && (navigationRef.current?.tab ?? tab) === 'collection') {
        const updateable = selectedCollection.length
          ? selectedUpdates
          : row?.type === 'skill' && updateCheck.updates.has(row.skill.name)
            ? [row.skill as CollectedSkill]
            : [];
        if (updateable.length) {
          return finish({ type: 'update', skills: updateable });
        }
      }
      if (input === 't' && tab === 'collection' && selectedCollection.length) {
        return finish({ type: 'tags', skills: selectedCollection });
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
        const skills = removableCollection as CollectedSkill[];
        void modal
          .confirm({
            title: '删除收藏',
            message:
              skills.length === 1
                ? `从收藏夹移除 ${skills[0]?.name ?? ''} 吗？`
                : `从收藏夹移除 ${skills.length} 个技能吗？`,
            ...(skills.length > 1
              ? { details: [`技能：${skills.map((skill) => skill.name).join(', ')}`] }
              : {}),
          })
          .then((ok) => {
            if (ok) finish({ type: 'removeCollection', skills });
          });
        return;
      }
      if ((input === 'd' || key.delete) && removableLocations.length) {
        const skills = removableLocations;
        void modal
          .confirm({
            title: '删除技能',
            message:
              skills.length === 1
                ? `删除 ${skills[0]?.name ?? ''} 的当前位置吗？`
                : `删除所选 ${skills.length} 个技能位置吗？`,
            details: [
              '将永久删除以下位置；收藏夹内容（如有）保留。',
              ...skills.map((skill) => skill.path),
            ],
          })
          .then((ok) => {
            if (ok) finish({ type: 'removeLocations', skills });
          });
        return;
      }
      const selectedLocal = tab === 'project' ? selectedProjectLocal : selectedGlobalLocal;
      if (input === 'i' && tab !== 'collection' && selectedLocal.length) {
        return finish({ type: 'import', skills: selectedLocal });
      }
      if (key.leftArrow && useMasterDetail) return setFocus('tags');
      if (key.upArrow) {
        if (cursorRef.current === 0) {
          return setFocus(focusAfterUpFromList(useMasterDetail, hasAgentTabs));
        }
        return setCursor((index) => index - 1);
      }
      if (key.downArrow) {
        return setCursor((index) => Math.min(Math.max(0, listRows.length - 1), index + 1));
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
      if (key.rightArrow && row?.type === 'skill' && !useBrowseHome) {
        if (tab === 'collection') return openDetail(row.skill, true);
        if (row.skill.fromCollection) return openDetail(row.skill, true);
      }
      if (key.return || input.includes('\r') || input.includes('\n')) {
        if (tab === 'collection' && selectedCollection.length) {
          return finish({ type: 'add', skills: selectedCollection });
        }
        if (tab === 'collection' && row?.type === 'skill') {
          return openDetail(row.skill, true);
        }
        if (tab !== 'collection') {
          if (row?.type === 'skill') openDetail(row.skill, false);
        }
      }
    },
    {
      isActive: !shellBusy && !searching && !choosingGroup && !updatingSkillName,
    }
  );
  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        setChoosingGroup(false);
      }
    },
    { isActive: !shellBusy && choosingGroup }
  );

  const renderBrowsePane = (
    paneRows: SkillRow[],
    viewportHeight: number,
    options: {
      preferNote?: boolean;
      showSource?: boolean;
      showReferences?: boolean;
      showGroup?: boolean;
      collection?: boolean;
      updates?: Set<string>;
      updatingSkillName?: string | undefined;
    } = {}
  ): ReactNode => {
    if (useBrowseHome) {
      const { tagWidth, listWidth, peekWidth } = masterDetailColumns;
      const selectedPaths = selected;
      const tagLines = collectionCategoryLines(
        tagOptions,
        tagCursor,
        focus === 'tags',
        tagWidth,
        viewportHeight
      );
      const {
        lines: listLines,
        activeLineIndexes: listActiveLineIndexes,
        selectedLineIndexes: listSelectedLineIndexes,
      } = collectionListColumnLines(
        paneRows,
        cursor,
        focus === 'list',
        options.preferNote ?? false,
        listWidth,
        viewportHeight,
        selectedPaths,
        options.updates ?? new Set<string>(),
        options.updatingSkillName
      );
      const detailRows = browseDetailRows(
        peekSkill,
        peekWidth,
        viewportHeight,
        options.collection ?? false,
        options.updates ?? new Set<string>(),
        options.updatingSkillName
      );
      const headerLine = (left: string, middle: string, right: string): ReactNode => (
        <Box flexDirection="row">
          <Box width={tagWidth + 1} flexDirection="row">
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(left, tagWidth)}
            </Text>
            <Text color={termcnColors.border}>│</Text>
          </Box>
          <Box width={listWidth + 1} flexDirection="row">
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(middle, listWidth)}
            </Text>
            <Text color={termcnColors.border}>│</Text>
          </Box>
          <Box width={peekWidth}>
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(right, peekWidth)}
            </Text>
          </Box>
        </Box>
      );
      return (
        <Box flexDirection="column">
          <Text color={termcnColors.border} wrap="truncate-end">
            {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'top', true)}
          </Text>
          {headerLine('标签', '技能', '详情')}
          {masterDetailBlankRow(tagWidth, listWidth, peekWidth)}
          <MasterDetailBody
            tagLines={tagLines}
            listLines={listLines}
            peekLines={[]}
            tagWidth={tagWidth}
            listWidth={listWidth}
            peekWidth={peekWidth}
            tagActive={focus === 'tags'}
            listActive={focus === 'list'}
            collectionHome
            {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
            {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
            detailRows={detailRows}
          />
          <Text color={termcnColors.border} wrap="truncate-end">
            {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'bottom', true)}
          </Text>
        </Box>
      );
    }
    return (
      <SkillPane
        rows={paneRows}
        cursor={cursor}
        isActive={focus === 'list'}
        viewportHeight={viewportHeight}
        {...options}
      />
    );
  };

  const tabs = [
    {
      key: 'project',
      label: `当前项目 ${project.length}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 1}>
          <AgentTabs
            groups={visibleProjectGroups}
            agent={activeProjectAgent}
            focused={!shellBusy && !searching && focus === 'agents'}
          />
          {renderBrowsePane(listRows, browseViewportHeight(true), {
            showSource: true,
            showReferences: true,
            showGroup: Boolean(query.trim()),
          })}
        </Box>
      ),
    },
    {
      key: 'global',
      label: `全局 ${globalGroups.reduce((count, group) => count + group.skills.length, 0)}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 1}>
          <AgentTabs
            groups={visibleGlobalGroups}
            agent={activeGlobalAgent}
            focused={!shellBusy && !searching && focus === 'agents'}
          />
          {renderBrowsePane(listRows, browseViewportHeight(true), {
            showSource: true,
            showGroup: Boolean(query.trim()),
          })}
        </Box>
      ),
    },
    {
      key: 'collection',
      label: `收藏夹 ${collection.length}`,
      content: (
        <Box flexDirection="column" minHeight={frame.frameHeight - 1}>
          {renderBrowsePane(listRows, browseViewportHeight(false), {
            preferNote: true,
            collection: true,
            showGroup: Boolean(query.trim()),
            updates: updateCheck.updates,
            updatingSkillName,
          })}
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
          if (useMasterDetail) {
            const index = tagOptions.findIndex((option) => option.key === name);
            setTagFilter(name);
            setTagCursor(Math.max(0, index));
            setCursor(0);
            setFocus('list');
          } else {
            setQuery('');
            setCursor(groupRows.findIndex((row) => row.type === 'group' && row.name === name));
            setFocus('list');
          }
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
  const navigationHint = updatingSkillName
    ? `正在${workingAction} · 请稍候`
    : focus === 'tabs'
      ? `←/→ 切换 Tab · ↓ 进入 · / 筛选 · ?`
      : focus === 'agents'
        ? `←/→ 切换 Agent · ↑ 返回 · ↓ 进入 · / 筛选 · ?`
        : focus === 'tags'
          ? useBrowseHome
            ? `↑/↓ 标签 · Space 选中此标签 · → 列表 · / 搜索 · ?`
            : `↑/↓ 标签 · Space 选中此标签 · → 列表 · / 筛选 · ?`
          : useBrowseHome && focus === 'list'
            ? tab === 'collection' && selectedCollection.length
              ? `↑↓ 移动 · Enter 添加 · Space 选中 · d 删除 · / 搜索 · ?`
              : `↑↓ 移动 · Enter 详情 · Space 选中 · d 删除 · / 搜索 · ?`
            : useMasterDetail && canViewWithRightArrow
              ? `← 标签 · Space 选中 · → 全屏详情 · d 删除 · / 筛选 · ?`
              : useMasterDetail && canViewWithEnter
                ? `← 标签 · Space 选中 · Enter 查看 · d 删除 · / 筛选 · ?`
                : useMasterDetail
                  ? `← 标签 · Space 选中 · d 删除 · / 筛选 · ?`
                  : currentRow?.type === 'group'
                    ? `↑/↓ 移动 · Space 选中组 · / 筛选 · ?`
                    : canViewWithRightArrow
                      ? `↑/↓ 移动 · Space 选中 · → 查看 · d 删除 · / 筛选 · ?`
                      : canViewWithEnter
                        ? `↑/↓ 移动 · Space 选中 · Enter 查看 · d 删除 · / 筛选 · ?`
                        : canDelete
                          ? `↑/↓ 移动 · Space 选中 · d 删除 · / 筛选 · ?`
                          : focus === 'list'
                            ? `↑/↓ 移动 · Space 选中 · / 筛选 · ?`
                            : `/ 筛选 · ?`;
  const footerBody = [
    listScrollHint,
    navigationHint,
    selected.size ? `已选 ${selected.size}` : '',
    ...actions,
  ].filter(Boolean).join(' · ');
  const footerHint = footerBody ? `${footerBody} · q 退出` : 'q 退出';
  const statusHint = activity.filter(Boolean).join(' · ');

  return (
    <Box flexDirection="column">
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => setTab(key as BrowserTab)}
        isActive={!shellBusy && !searching && focus === 'tabs'}
        enableArrowNav={false}
        focused={!shellBusy && !searching && focus === 'tabs'}
        width={frame.frameWidth}
        bordered={false}
        chip={useBrowseHome}
        trailing={
          useMasterDetail && !searching ? (
            <Text color={termcnColors.muted}>/ 搜索技能…</Text>
          ) : undefined
        }
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
            {footerHint}
          </Text>
          {statusHint ? (
            <Text
              color={updateCheck.failed ? termcnColors.error : termcnColors.muted}
              wrap="truncate-end"
            >
              {statusHint}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

