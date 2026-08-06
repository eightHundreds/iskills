import type { MouseEvent } from '@opentui/core';
import { Text, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useAtom, useAtomValue, useStore } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  BrowserFocus,
  BrowserResult,
  BrowserTab,
  BrowserViewInput,
  SkillGroup,
} from './types.js';
import type { CollectedSkill, Skill } from '../../domain/types.js';
import {
  browserFilterAtom,
  browserGroupJumpAtom,
  browserNavigationAtom,
  browserSelectionAtom,
  browserTagFilterAtom,
  browserUpdateCheckAtom,
} from './store.js';
import {
  browserFrameDimensions,
  masterDetailLayout,
  masterDetailSeparator,
  masterDetailViewportHeight,
  masterDetailWidths,
} from './layout.js';
import { isCrossAgentInstallable } from '../../domain/cross-agent-install.js';
import {
  browseSelectionSets,
  projectActionSkills,
} from './browse-capabilities.js';
import {
  TAG_FILTER_ALL,
  browseDetailRows,
  collectionCategoryLines,
  collectionListColumnLines,
  detailEditableFields,
  detailLabelWidth,
  flatRows,
  focusAfterDownFromAgents,
  focusAfterDownFromTabs,
  focusAfterUpFromList,
  focusAfterUpFromTags,
  groupedRows,
  listSkillSummary,
  nextAgent,
  nextMainTab,
  selectableSkills,
  skillGroups,
  skillsForTagFilter,
  tagFilterOptions,
  type CollectionDetailRow,
  type SkillRow,
  visibleAgentGroups,
} from './format.js';
import type { DetailFieldId } from './types.js';
import { t } from '../../i18n/index.js';
import { useModal, useOverlayBusy } from '../overlay/host.js';
import { FramedPanel } from '../components/framed-panel.js';
import {
  Select,
  Tabs,
  termcnColors,
  WorkingSpinner,
  useSpinnerFrame,
} from '../components/termcn.js';
import { Clickable } from '../components/mouse/clickable.js';
import { padColumns, sliceColumns } from '../components/terminal-layout.js';
import { ShortcutHelpPanel } from './shortcut-help.js';

type MoreActionId = 'materialize' | 'installToAgents';

/** Framed more-actions picker when multiple m-actions are available. */
function MoreActionsPanel({
  scope,
  items,
  onSelect,
  onCancel,
}: {
  scope: string;
  items: Array<{ id: MoreActionId; label: string }>;
  onSelect: (id: MoreActionId) => void;
  onCancel: () => void;
}): ReactNode {
  const [cursor, setCursor] = useState(0);
  const clamped = Math.max(0, Math.min(cursor, items.length - 1));
  const lines = [
    scope,
    '',
    ...items.map((item, index) =>
      index === clamped ? `› ${item.label}` : `  ${item.label}`
    ),
    t('browser.moreActionsFooter'),
  ];
  return (
    <FramedPanel
      title={t('browser.moreActionsTitle')}
      content={lines}
      width={64}
      muteLastContent
      scrollWithArrows={false}
      onEscape={onCancel}
      onKey={(input, key) => {
        if (key.upArrow) {
          setCursor((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow) {
          setCursor((current) => Math.min(items.length - 1, current + 1));
          return;
        }
        if (key.return || input.includes('\r') || input.includes('\n')) {
          const item = items[clamped];
          if (item) onSelect(item.id);
        }
      }}
    />
  );
}

function masterDetailBlankRow(
  tagWidth: number,
  listWidth: number,
  peekWidth: number
): ReactNode {
  const divider = '│';
  return (
    <box flexDirection="row">
      <box width={tagWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', tagWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </box>
      <box width={listWidth + 1} flexDirection="row">
        <Text wrap="truncate-end">{padColumns('', listWidth)}</Text>
        <Text color={termcnColors.border}>{divider}</Text>
      </box>
      <box flexDirection="row" width={peekWidth}>
        <Text wrap="truncate-end">{padColumns('', peekWidth)}</Text>
      </box>
    </box>
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
  onRowClick,
  onCursorDelta,
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
  /** Click a visible row (absolute index). */
  onRowClick?: (index: number) => void;
  /** Mouse wheel: delta rows (negative = up). */
  onCursorDelta?: (delta: number) => void;
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
  const onMouseScroll = useCallback(
    (event: MouseEvent) => {
      const info = event.scroll;
      if (!info || !onCursorDelta) return;
      const steps = Math.max(1, Math.abs(info.delta) || 1);
      if (info.direction === 'up') onCursorDelta(-steps);
      else if (info.direction === 'down') onCursorDelta(steps);
      event.stopPropagation();
    },
    [onCursorDelta]
  );
  const renderRow = (row: SkillRow, index: number) => {
    if (row.type === 'group') {
      const groupSkills = row.skills;
      const count = groupSkills.filter((skill) => selected.has(skill.path)).length;
      const marker =
        count === 0 ? '○' : count === groupSkills.length && groupSkills.length ? '●' : '◐';
      const body = (
        <Text
          bold
          {...(isActive && index === active ? { color: termcnColors.primary } : {})}
        >
          {`${isActive && index === active ? '›' : ' '} ${marker} ${row.name} (${row.skills.length})`}
        </Text>
      );
      if (!onRowClick) return <box key={`group:${row.name}:${index}`} flexDirection="row">{body}</box>;
      return (
        <Clickable key={`group:${row.name}:${index}`} onClick={() => onRowClick(index)}>
          {body}
        </Clickable>
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
            <Text color={termcnColors.muted}>{t('browser.referencePrefix')}</Text>
            <Text bold={current}>{skill.name}</Text>
          </>
        ) : showSource && !skill.fromCollection ? (
          t('browser.localSkill', { name: skill.name })
        ) : (
          <Text bold={current}>{skill.name}</Text>
        )}
        {updatingSkillName === skill.name ? (
          <WorkingSpinner />
        ) : updates.has(skill.name) ? (
          <Text color={termcnColors.primary}> ↑</Text>
        ) : null}
        {inlineSummary && (
          <Text color={termcnColors.muted}> — {inlineSummary}</Text>
        )}
      </>
    );
    const body = (
      <Text
        wrap="truncate-end"
        // Active: primary. Idle skill name: omit color → terminal default fg.
        {...(current
          ? {
              color: termcnColors.selectionFg,
              backgroundColor: termcnColors.selectionBg,
              bold: true,
            }
          : {})}
      >
        {nameLine}
      </Text>
    );
    if (!onRowClick) {
      return (
        <box key={`${row.group}:${skill.path}:${index}`} flexDirection="row">
          {body}
        </box>
      );
    }
    return (
      <Clickable
        key={`${row.group}:${skill.path}:${index}`}
        onClick={() => onRowClick(index)}
      >
        {body}
      </Clickable>
    );
  };
  return (
    <box flexDirection="column" minHeight={3} onMouseScroll={onMouseScroll}>
      {rows.length ? (
        visible.map((row, visibleIndex) => renderRow(row, offset + visibleIndex))
      ) : (
        <Text color={termcnColors.muted}>{t('browser.noMatchingSkills')}</Text>
      )}
      {showPagination && rows.length > height && (
        <Text color={termcnColors.muted}>
          {offset + 1}–{Math.min(offset + height, rows.length)} / {rows.length}
        </Text>
      )}
    </box>
  );
}

function AgentTabs({
  groups,
  agent,
  focused,
  onSelect,
}: {
  groups: SkillGroup[];
  agent: string;
  focused: boolean;
  onSelect: (agent: string) => void;
}) {
  return (
    <box flexDirection="row" paddingLeft={1} gap={2}>
      {groups.map((group) => {
        const active = group.agent === agent;
        // Current agent always uses primary (visible after mouse click without
        // forcing keyboard focus onto the agents row). Keyboard-on-agents adds
        // selection chrome so the focus ladder is still obvious.
        const keyboardHere = focused && active;
        return (
          <Clickable key={group.agent} onClick={() => onSelect(group.agent)}>
            <Text
              color={
                keyboardHere
                  ? termcnColors.selectionFg
                  : active
                    ? termcnColors.primary
                    : termcnColors.muted
              }
              {...(keyboardHere
                ? { backgroundColor: termcnColors.selectionBg, bold: true }
                : active
                  ? { bold: true, underline: true }
                  : {})}
            >
              {`${group.agent} ${group.skills.length}`}
            </Text>
          </Clickable>
        );
      })}
    </box>
  );
}

function masterDetailColumnText(
  line: string,
  width: number,
  options: {
    color?: string;
    bold?: boolean;
    /** Focused cursor row — explicit selection colors (never ANSI inverse). */
    selected?: boolean;
    muted?: boolean;
  } = {}
): ReactNode {
  const padded = padColumns(sliceColumns(line, 0, width), width);
  if (options.selected) {
    return (
      <Text
        wrap="truncate-end"
        color={termcnColors.selectionFg}
        backgroundColor={termcnColors.selectionBg}
        bold
      >
        {padded}
      </Text>
    );
  }
  return (
    <Text
      wrap="truncate-end"
      {...(options.muted
        ? { color: termcnColors.muted }
        : options.color
          ? { color: options.color }
          : {})}
      {...(options.bold ? { bold: true } : {})}
    >
      {padded}
    </Text>
  );
}

/** Right-pane detail row: muted labels, normal/muted values, optional bold title. */
function DetailColumnRow({
  row,
  width,
  selected = false,
}: {
  row: CollectionDetailRow;
  width: number;
  /** Field under detail-column keyboard focus. */
  selected?: boolean;
}): ReactNode {
  if (selected) {
    return (
      <Text
        wrap="truncate-end"
        color={termcnColors.selectionFg}
        backgroundColor={termcnColors.selectionBg}
        bold
      >
        {padColumns(
          sliceColumns(
            row.label !== undefined
              ? `${padColumns(row.label, detailLabelWidth())}${row.text}`
              : row.text,
            0,
            width
          ),
          width
        )}
      </Text>
    );
  }
  if (row.label !== undefined) {
    const valueWidth = Math.max(1, width - detailLabelWidth());
    return (
      <Text wrap="truncate-end">
        <Text color={termcnColors.muted}>{padColumns(row.label, detailLabelWidth())}</Text>
        <Text
          {...(row.muted ? { color: termcnColors.muted } : {})}
          {...(row.bold ? { bold: true } : {})}
          {...(row.primary ? { color: termcnColors.primary } : {})}
        >
          {padColumns(sliceColumns(row.text, 0, valueWidth), valueWidth)}
        </Text>
      </Text>
    );
  }
  return (
    <Text
      wrap="truncate-end"
      {...(row.primary ? { color: termcnColors.primary } : {})}
      {...(row.muted ? { color: termcnColors.muted } : {})}
      {...(row.bold ? { bold: true } : {})}
    >
      {padColumns(sliceColumns(row.text, 0, width), width)}
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
  detailActive = false,
  detailActiveField,
  collectionHome = false,
  listActiveLineIndexes,
  listSelectedLineIndexes,
  detailRows,
  onTagLineClick,
  onListLineClick,
  onDetailLineClick,
  onListScroll,
}: {
  tagLines: string[];
  listLines: string[];
  peekLines: string[];
  tagWidth: number;
  listWidth: number;
  peekWidth: number;
  tagActive: boolean;
  listActive: boolean;
  detailActive?: boolean;
  detailActiveField?: DetailFieldId;
  collectionHome?: boolean;
  listActiveLineIndexes?: Set<number>;
  listSelectedLineIndexes?: Set<number>;
  detailRows?: CollectionDetailRow[];
  onTagLineClick?: (visibleIndex: number) => void;
  onListLineClick?: (visibleIndex: number) => void;
  onDetailLineClick?: (visibleIndex: number) => void;
  onListScroll?: (delta: number) => void;
}): ReactNode {
  const rows = Math.max(tagLines.length, listLines.length, peekLines.length, detailRows?.length ?? 0);
  const divided = collectionHome;
  const divider = divided ? '│' : '';
  const tagColumnWidth = tagWidth + (divider ? 1 : 0);
  const listColumnWidth = listWidth + (divider ? 1 : 0);
  // Only the skill column (2nd) owns list wheel scrolling. Detail (3rd) must not
  // move the list when the pointer is over it — attach scroll handler only there.
  const onListColumnScroll = useCallback(
    (event: MouseEvent) => {
      const info = event.scroll;
      if (!info || !onListScroll) return;
      const steps = Math.max(1, Math.abs(info.delta) || 1);
      if (info.direction === 'up') onListScroll(-steps);
      else if (info.direction === 'down') onListScroll(steps);
      event.stopPropagation();
    },
    [onListScroll]
  );
  const swallowScroll = useCallback((event: MouseEvent) => {
    // Keep wheel over detail/tag from bubbling to a parent list scroller.
    if (event.scroll) event.stopPropagation();
  }, []);
  return (
    <box flexDirection="column">
      {Array.from({ length: rows }, (_, index) => {
        const tagCell = masterDetailColumnText(tagLines[index] ?? '', tagWidth, {
          ...(tagActive && tagLines[index]?.startsWith('›')
            ? collectionHome
              ? { selected: true }
              : { color: termcnColors.primary, bold: true }
            : {}),
        });
        const listCell = masterDetailColumnText(listLines[index] ?? '', listWidth, {
          ...(listActiveLineIndexes?.has(index)
            ? { selected: true }
            : listSelectedLineIndexes?.has(index)
              ? { color: termcnColors.primary, bold: true }
              : listActive && listLines[index]?.startsWith('›')
                ? { color: termcnColors.primary, bold: true }
                : index % 2 === 1 && listLines[index]?.trim()
                  ? { muted: true }
                  : {}),
        });
        const tagInteractive =
          onTagLineClick && (tagLines[index] ?? '').trim().length > 0;
        const listInteractive =
          onListLineClick && (listLines[index] ?? '').trim().length > 0;
        return (
          <box key={`master-detail-row:${index}`} flexDirection="row">
            <box
              width={tagColumnWidth}
              flexDirection="row"
              onMouseScroll={swallowScroll}
            >
              {tagInteractive ? (
                <Clickable onClick={() => onTagLineClick(index)}>{tagCell}</Clickable>
              ) : (
                tagCell
              )}
              {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
            </box>
            <box
              width={listColumnWidth}
              flexDirection="row"
              onMouseScroll={onListColumnScroll}
            >
              {listInteractive ? (
                <Clickable onClick={() => onListLineClick(index)}>{listCell}</Clickable>
              ) : (
                listCell
              )}
              {divider ? <Text color={termcnColors.border}>{divider}</Text> : null}
            </box>
            <box
              flexDirection="row"
              width={peekWidth}
              onMouseScroll={swallowScroll}
            >
              {detailRows?.[index] ? (
                (() => {
                  const detailRow = detailRows[index]!;
                  const fieldSelected =
                    detailActive &&
                    detailRow.field !== undefined &&
                    detailRow.field === detailActiveField;
                  const cell = (
                    <DetailColumnRow
                      row={detailRow}
                      width={peekWidth}
                      selected={fieldSelected}
                    />
                  );
                  return onDetailLineClick && detailRow.field ? (
                    <Clickable onClick={() => onDetailLineClick(index)}>{cell}</Clickable>
                  ) : (
                    cell
                  );
                })()
              ) : (
                <Text
                  wrap="truncate-end"
                  color={index === 0 && peekLines[index] !== t('browser.selectSkillToView') ? termcnColors.primary : termcnColors.muted}
                  bold={index === 0 && peekLines[index] !== t('browser.selectSkillToView')}
                >
                  {padColumns(sliceColumns(peekLines[index] ?? '', 0, peekWidth), peekWidth)}
                </Text>
              )}
            </box>
          </box>
        );
      })}
    </box>
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
  checkUpdates,
  updatingSkillName,
  finish,
}: BrowserProps) {
  const modal = useModal();
  const shellBusy = useOverlayBusy();
  const store = useStore();
  // Local braille spinner only while a skill is updating (not a global busy overlay).
  const updatingFrame = useSpinnerFrame(Boolean(updatingSkillName));
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
  const [filter, setFilter] = useAtom(browserFilterAtom);
  const [choosingGroup, setChoosingGroup] = useAtom(browserGroupJumpAtom);
  const [updateCheck, setUpdateCheck] = useAtom(browserUpdateCheckAtom);
  const searching = filter.open;
  const {
    selectedCollection,
    selectedProject,
    selectedGlobal,
    selectedProjectLocal,
    selectedGlobalLocal,
  } = browseSelectionSets(selected, { collection, projectGroups, globalGroups });
  const selectedUpdates = selectedCollection.filter((skill) => updateCheck.updates.has(skill.name));
  const { stdout } = useStdout();
  // Wide terminals keep the 3-column master-detail chrome even while filtering;
  // list rows still apply `query` inside the skill column.
  const useBrowseHome = masterDetailLayout(stdout.columns, stdout.rows);
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
  const [tagFilter, setTagFilter] = useAtom(browserTagFilterAtom);
  const [tagCursor, setTagCursor] = useState(0);
  const tagCursorRef = useRef(tagCursor);
  tagCursorRef.current = tagCursor;
  /** Index into detailEditableFields(collection) while focus === 'detail'. */
  const [detailFieldIndex, setDetailFieldIndex] = useState(0);
  const detailFieldIndexRef = useRef(detailFieldIndex);
  detailFieldIndexRef.current = detailFieldIndex;
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
  const actionSkills = projectActionSkills(
    tab,
    tab === 'global' ? selectedGlobal : selectedProject,
    currentRow?.type === 'skill' ? currentRow.skill : undefined
  );
  const canMaterialize =
    !updatingSkillName &&
    focus === 'list' &&
    tab === 'project' &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => skill.isReference);
  const canInstallToAgents =
    !updatingSkillName &&
    focus === 'list' &&
    (tab === 'project' || tab === 'global') &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => isCrossAgentInstallable(skill));
  const canOpenActions = canMaterialize || canInstallToAgents;
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
  useEffect(() => {
    if (tab !== 'collection') return;
    let active = true;
    setUpdateCheck((current: { checking: boolean; updates: Set<string>; failed: number }) => ({
      ...current,
      checking: true,
    }));
    void checkUpdates(collection)
      .then(({ updates, failed }) => {
        if (active) setUpdateCheck({ checking: false, updates, failed });
      })
      .catch(() => {
        if (active) {
          setUpdateCheck({
            checking: false,
            updates: new Set(),
            failed: collection.length,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [checkUpdates, collection, tab, setUpdateCheck]);

  const frame = browserFrameDimensions({
    rows: stdout.rows,
    columns: stdout.columns,
    projectRows: projectRows.length,
    globalRows: globalRows.length,
    collectionRows: collectionRows.length,
    hasProjectAgents: visibleProjectGroups.length > 0,
    hasGlobalAgents: visibleGlobalGroups.length > 0,
  });
  const openDetail = (skill: Skill, collection: boolean) => {
    // Master-detail chrome fills the terminal; browserFrameDimensions still
    // sizes by list row count and can be only a few lines on a short list.
    // Full-screen detail must use the terminal viewport, not that stub height.
    const frameHeight = useBrowseHome
      ? Math.max(5, (stdout.rows ?? 24) - 4)
      : frame.frameHeight;
    finish({
      type: 'open',
      skill,
      collection,
      frameHeight,
      frameWidth: frame.frameWidth,
    });
  };
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
  const peekSkill =
    (focus === 'list' || focus === 'detail') && currentRow?.type === 'skill'
      ? currentRow.skill
      : undefined;
  const detailFields = detailEditableFields(tab === 'collection');
  const activeDetailField =
    focus === 'detail' && detailFields.length
      ? detailFields[Math.max(0, Math.min(detailFieldIndex, detailFields.length - 1))]
      : undefined;
  useEffect(() => {
    if ((focus === 'detail' || focus === 'tags') && !useMasterDetail) setFocus('list');
  }, [focus, useMasterDetail, setFocus]);
  useEffect(() => {
    if (focus === 'detail' && currentRow?.type !== 'skill') setFocus('list');
  }, [focus, currentRow, setFocus]);
  // Project / global never own detail-column focus (preview only).
  useEffect(() => {
    if (focus === 'detail' && tab !== 'collection') setFocus('list');
  }, [focus, tab, setFocus]);
  useEffect(() => {
    if (detailFieldIndex >= detailFields.length && detailFields.length > 0) {
      setDetailFieldIndex(detailFields.length - 1);
    }
  }, [detailFieldIndex, detailFields.length]);
  useInput(
    (input, key) => {
      const live = navigationRef.current;
      const liveFocus = live?.focus ?? 'tabs';
      const liveTab = live?.tab ?? 'project';
      if (input === '?') {
        void modal.open({
          footerItems: [
            { key: '↑↓', label: t('common.move') },
            { key: 'e', label: t('common.expand') },
            { key: 'Esc', label: t('common.close') },
          ],
          content: (close) => (
            <ShortcutHelpPanel onClose={() => close(undefined)} maxBodyRows={14} />
          ),
        });
        return;
      }
      if (key.escape || input === 'q') return finish({ type: 'quit' });
      if (input === '/') {
        setFilter({
          open: true,
          draft: query,
          queryBefore: query,
          cursorBefore: cursorRef.current,
        });
        return;
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
          tagCursorRef.current = index;
          setTagCursor(index);
          setCursor(0);
        };
        const liveTagCursor = tagCursorRef.current;
        if (key.upArrow) {
          if (liveTagCursor === 0) return setFocus(focusAfterUpFromTags(hasAgentTabs));
          selectTag(liveTagCursor - 1);
          return;
        }
        if (key.downArrow) {
          if (liveTagCursor >= tagOptions.length - 1) return setFocus('list');
          selectTag(liveTagCursor + 1);
          return;
        }
        if (key.leftArrow) return setFocus(focusAfterUpFromTags(hasAgentTabs));
        if (key.rightArrow) {
          selectTag(liveTagCursor);
          return setFocus('list');
        }
        const tagOption = tagOptions[liveTagCursor];
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
          selectTag(liveTagCursor);
          return setFocus('list');
        }
        return;
      }
      // Right column: move among editable fields (标签 / 备注); Enter opens editor.
      if (liveFocus === 'detail' || focus === 'detail') {
        const detailRow = listRows[cursorRef.current];
        const skill = detailRow?.type === 'skill' ? detailRow.skill : undefined;
        const fields = detailEditableFields(tab === 'collection');
        if (key.leftArrow) return setFocus('list');
        if (key.upArrow) {
          if (!fields.length) return;
          setDetailFieldIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow) {
          if (!fields.length) return;
          setDetailFieldIndex((index) => Math.min(fields.length - 1, index + 1));
          return;
        }
        if (key.rightArrow) return;
        const field = fields[detailFieldIndexRef.current] ?? fields[0];
        if (skill && field && (key.return || input.includes('\r') || input.includes('\n'))) {
          if (field === 'tags') return finish({ type: 'editTags', skill });
          if (field === 'note') return finish({ type: 'editNote', skill });
        }
        if (skill && tab === 'collection') {
          if (input === 't') return finish({ type: 'editTags', skill });
          if (input === 'n') return finish({ type: 'editNote', skill });
        }
        return;
      }
      if ((navigationRef.current?.focus ?? focus) !== 'list') return;
      const row = listRows[cursorRef.current];
      if (input === 'm' && canOpenActions) {
        const skills = actionSkills;
        const moreItems: Array<{ id: MoreActionId; label: string }> = [];
        if (canMaterialize) {
          moreItems.push({ id: 'materialize', label: t('browser.materializeAction') });
        }
        if (canInstallToAgents) {
          moreItems.push({
            id: 'installToAgents',
            label: t('browser.installToAgentsAction'),
          });
        }
        const runMore = (id: MoreActionId): void => {
          if (id === 'materialize') finish({ type: 'materialize', skills });
          else if (tab === 'project' || tab === 'global') {
            finish({ type: 'installToAgents', skills, scope: tab });
          }
        };
        // Single available action: enter its flow directly (no intermediate menu).
        if (moreItems.length === 1) {
          const only = moreItems[0];
          if (only) runMore(only.id);
          return;
        }
        const selectedAtTab =
          tab === 'global' ? selectedGlobal.length : selectedProject.length;
        const scope = selectedAtTab
          ? t('browser.selectedSkills', { count: skills.length })
          : t('browser.skillLine', { names: skills[0]?.name ?? '' });
        void modal
          .open<MoreActionId | null>({
            footerItems: [
              { key: 'Enter', label: t('common.confirm') },
              { key: 'Esc', label: t('common.cancel') },
            ],
            content: (close) => (
              <MoreActionsPanel
                scope={scope}
                items={moreItems}
                onSelect={(id) => close(id)}
                onCancel={() => close(null)}
              />
            ),
          })
          .then((id) => {
            if (id) runMore(id);
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
            title: t('browser.removeCollectionTitle'),
            message:
              skills.length === 1
                ? t('browser.removeCollectionOne', { name: skills[0]?.name ?? '' })
                : t('browser.removeCollectionMany', { count: skills.length }),
            ...(skills.length > 1
              ? { details: [t('browser.skillLine', { names: skills.map((skill) => skill.name).join(', ') })] }
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
            title: t('browser.removeLocationsTitle'),
            message:
              skills.length === 1
                ? t('browser.removeLocationOne', { name: skills[0]?.name ?? '' })
                : t('browser.removeLocationsMany', { count: skills.length }),
            details: [
              t('browser.removeLocationsHint'),
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
        const skills = selectedLocal;
        void modal
          .confirm({
            title: t('browser.importCollectionTitle'),
            message:
              skills.length === 1
                ? t('browser.importCollectionOne', { name: skills[0]?.name ?? '' })
                : t('browser.importCollectionMany', { count: skills.length }),
            ...(skills.length > 1
              ? { details: [t('browser.skillLine', { names: skills.map((skill) => skill.name).join(', ') })] }
              : {}),
          })
          .then((ok) => {
            if (ok) finish({ type: 'import', skills });
          });
        return;
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
      // Collection only: wide → focuses detail column; narrow → opens fullscreen detail.
      // Project / global: right pane is preview only — no → focus/open detail.
      if (key.rightArrow && row?.type === 'skill' && tab === 'collection') {
        if (useMasterDetail) {
          setDetailFieldIndex(0);
          return setFocus('detail');
        }
        if (!useBrowseHome) {
          return openDetail(row.skill, true);
        }
      }
      if (key.return || input.includes('\r') || input.includes('\n')) {
        if (tab === 'collection' && selectedCollection.length) {
          return finish({ type: 'add', skills: selectedCollection });
        }
        // Master-detail collection: Enter focuses detail column (never silent no-op).
        // Project/global master-detail: peek-only — no Enter open.
        if (useMasterDetail) {
          if (tab === 'collection' && row?.type === 'skill') {
            setDetailFieldIndex(0);
            return setFocus('detail');
          }
          return;
        }
        if (tab === 'collection' && row?.type === 'skill') {
          return openDetail(row.skill, true);
        }
        if (tab !== 'collection' && row?.type === 'skill') {
          return openDetail(row.skill, false);
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
  // Backup filter cancel: TextInput also handles Esc; this covers focus edge cases.
  useInput(
    (_input, key) => {
      if (!key.escape) return;
      const prior = store.get(browserFilterAtom);
      setFilter({
        open: false,
        draft: '',
        queryBefore: '',
        cursorBefore: 0,
      });
      setNavigation((current) =>
        current
          ? {
              ...current,
              query: prior.queryBefore,
              cursor: prior.cursorBefore,
            }
          : current
      );
    },
    { isActive: !shellBusy && searching }
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
      const tagActiveIndex = Math.max(0, Math.min(tagCursor, tagOptions.length - 1));
      const tagOffset = Math.max(
        0,
        Math.min(
          tagActiveIndex - Math.floor(viewportHeight / 2),
          Math.max(0, tagOptions.length - viewportHeight)
        )
      );
      const tagLines = collectionCategoryLines(
        tagOptions,
        tagCursor,
        focus === 'tags',
        tagWidth,
        viewportHeight
      );
      const {
        lines: listLines,
        skillOffset,
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
        options.updatingSkillName,
        updatingFrame
      );
      const detailRows = browseDetailRows(
        peekSkill,
        peekWidth,
        viewportHeight,
        options.collection ?? false,
        options.updates ?? new Set<string>(),
        options.updatingSkillName,
        updatingFrame
      );
      const headerLine = (left: string, middle: string, right: string): ReactNode => (
        <box flexDirection="row">
          <box width={tagWidth + 1} flexDirection="row">
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(left, tagWidth)}
            </Text>
            <Text color={termcnColors.border}>│</Text>
          </box>
          <box width={listWidth + 1} flexDirection="row">
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(middle, listWidth)}
            </Text>
            <Text color={termcnColors.border}>│</Text>
          </box>
          <box flexDirection="row" width={peekWidth}>
            <Text bold color={termcnColors.muted} wrap="truncate-end">
              {padColumns(right, peekWidth)}
            </Text>
          </box>
        </box>
      );
      return (
        <box flexDirection="column">
          <Text color={termcnColors.border} wrap="truncate-end">
            {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'top', true)}
          </Text>
          {headerLine(t('common.tags'), t('common.skill'), t('common.detail'))}
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
            detailActive={focus === 'detail'}
            {...(activeDetailField ? { detailActiveField: activeDetailField } : {})}
            collectionHome
            {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
            {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
            detailRows={detailRows}
            onTagLineClick={(visibleIndex) => {
              const absolute = tagOffset + visibleIndex;
              if (absolute < 0 || absolute >= tagOptions.length) return;
              const option = tagOptions[absolute];
              if (!option) return;
              setTagFilter(option.key);
              setTagCursor(absolute);
              setCursor(0);
              setFocus('tags');
            }}
            onListLineClick={(visibleIndex) => {
              // Paired name/summary lines → skill index.
              // Click focuses the row only; Space toggles multi-select.
              const skillIndex = skillOffset + Math.floor(visibleIndex / 2);
              if (skillIndex < 0 || skillIndex >= paneRows.length) return;
              setCursor(skillIndex);
              setFocus('list');
            }}
            onDetailLineClick={(visibleIndex) => {
              const row = detailRows[visibleIndex];
              if (!row?.field) return;
              const index = detailFields.indexOf(row.field);
              if (index < 0) return;
              setDetailFieldIndex(index);
              setFocus('detail');
            }}
            onListScroll={(delta) => {
              setFocus('list');
              setCursor((index) =>
                Math.max(0, Math.min(Math.max(0, paneRows.length - 1), index + delta))
              );
            }}
          />
          <Text color={termcnColors.border} wrap="truncate-end">
            {masterDetailSeparator(tagWidth, listWidth, peekWidth, 'bottom', true)}
          </Text>
        </box>
      );
    }
    return (
      <SkillPane
        rows={paneRows}
        cursor={cursor}
        isActive={focus === 'list'}
        viewportHeight={viewportHeight}
        onRowClick={(index) => {
          // Click focuses the row only; Space toggles multi-select.
          setCursor(index);
          setFocus('list');
        }}
        onCursorDelta={(delta) => {
          setFocus('list');
          setCursor((index) =>
            Math.max(0, Math.min(Math.max(0, paneRows.length - 1), index + delta))
          );
        }}
        {...options}
      />
    );
  };

  const tabs = [
    {
      key: 'project',
      label: t('browser.tabProject', { count: project.length }),
      content: (
        <box flexDirection="column" minHeight={frame.frameHeight - 1}>
          <AgentTabs
            groups={visibleProjectGroups}
            agent={activeProjectAgent}
            focused={!shellBusy && !searching && focus === 'agents'}
            onSelect={(name) => {
              setAgent(name);
              setCursor(0);
            }}
          />
          {renderBrowsePane(listRows, browseViewportHeight(true), {
            showSource: true,
            showReferences: true,
            showGroup: Boolean(query.trim()),
          })}
        </box>
      ),
    },
    {
      key: 'global',
      label: t('browser.tabGlobal', { count: globalGroups.reduce((count, group) => count + group.skills.length, 0) }),
      content: (
        <box flexDirection="column" minHeight={frame.frameHeight - 1}>
          <AgentTabs
            groups={visibleGlobalGroups}
            agent={activeGlobalAgent}
            focused={!shellBusy && !searching && focus === 'agents'}
            onSelect={(name) => {
              setAgent(name);
              setCursor(0);
            }}
          />
          {renderBrowsePane(listRows, browseViewportHeight(true), {
            showSource: true,
            showGroup: Boolean(query.trim()),
          })}
        </box>
      ),
    },
    {
      key: 'collection',
      label: t('browser.tabCollection', { count: collection.length }),
      content: (
        <box flexDirection="column" minHeight={frame.frameHeight - 1}>
          {renderBrowsePane(listRows, browseViewportHeight(false), {
            preferNote: true,
            collection: true,
            showGroup: Boolean(query.trim()),
            updates: updateCheck.updates,
            updatingSkillName,
          })}
        </box>
      ),
    },
  ];

  if (choosingGroup) {
    return (
      <Select
        label={t('browser.jumpToGroup')}
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

  return (
    <box flexDirection="column">
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
      />
    </box>
  );
}
