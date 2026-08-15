import { useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useAtom, useAtomValue, useStore } from 'jotai';
import {
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
} from './types.js';
import type { CollectedSkill, Skill } from '../../domain/types.js';
import { presentHealthAlerts } from './health.js';
import {
  browserFilterAtom,
  browserGroupJumpAtom,
  browserHealthAtom,
  browserNavigationAtom,
  browserSelectionAtom,
  browserTagFilterAtom,
  browserUpdateCheckAtom,
} from './store.js';
import {
  browserFrameDimensions,
  masterDetailLayout,
  masterDetailViewportHeight,
  masterDetailWidths,
} from './layout.js';
import { isCrossAgentInstallable } from '../../domain/cross-agent-install.js';
import {
  browseSelectionSets,
  projectActionSkills,
} from './browse-capabilities.js';
import {
  browseDetailRows,
  collectionListColumnLines,
  detailEditableFields,
  flatRows,
  groupedRows,
  selectableSkills,
  skillsForTagFilter,
  tagFilterOptions,
  type SkillRow,
  visibleAgentGroups,
} from './format.js';
import { t } from '../../i18n/index.js';
import { useModal, useOverlayBusy } from '../overlay/host.js';
import { FramedPanel } from '../components/framed-panel.js';
import {
  Select,
  Tabs,
  useSpinnerFrame,
} from '../components/termcn.js';
import { ShortcutHelpPanel } from './shortcut-help.js';
import { AgentTabs, BrowseHomePane, SkillPane } from './panes.js';
import {
  applyBrowseSessionPatch,
  browseSessionClickDetail,
  browseSessionClickList,
  browseSessionClickTag,
  browseSessionScrollList,
  reduceBrowseSessionKey,
  useBrowseSessionEffects,
  type BrowseSessionPatch,
} from './browse-session.js';
import type { BrowserNavigationState } from './store.js';

type MoreActionId = 'materialize' | 'installToAgents';

const EMPTY_SKILLS: Skill[] = [];

function sameNavigation(
  left: BrowserNavigationState | null | undefined,
  right: BrowserNavigationState | null | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.tab === right.tab &&
    left.focus === right.focus &&
    left.agent === right.agent &&
    left.cursor === right.cursor &&
    left.query === right.query
  );
}

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
  workingAction,
  finish,
}: BrowserProps) {
  const modal = useModal();
  const shellBusy = useOverlayBusy();
  const store = useStore();
  // Block list input while a long action runs (update/materialize skill row or collection sync).
  const actionBusy = Boolean(updatingSkillName) || workingAction === 'sync';
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
      if (sameNavigation(current, next)) return current;
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
    setNavigation((current) => (current && current.tab !== value ? { ...current, tab: value } : current));
  };
  const setQuery = (value: string): void => {
    setNavigation((current) =>
      current && current.query !== value ? { ...current, query: value } : current
    );
  };
  const setAgent = (value: string): void => {
    setNavigation((current) =>
      current && current.agent !== value ? { ...current, agent: value } : current
    );
  };
  const setFocus = (value: BrowserFocus): void => {
    setNavigation((current) =>
      current && current.focus !== value ? { ...current, focus: value } : current
    );
  };
  const setCursor = (value: SetStateAction<number>): void => {
    setNavigation((current) => {
      if (!current) return current;
      const nextCursor = typeof value === 'function' ? value(current.cursor) : value;
      if (nextCursor === current.cursor) return current;
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
  // Wide terminals keep the 3-column master-detail panes even while filtering;
  // list rows still apply `query` inside the skill column.
  const useBrowseHome = masterDetailLayout(stdout.columns, stdout.rows);
  const useMasterDetail = useBrowseHome;
  // Scope for list + tag sidebar + g-jump: current agent (or full collection),
  // never the whole project/global flat list.
  const tabSkills =
    tab === 'collection'
      ? collection
      : tab === 'project'
        ? projectGroup?.skills ?? EMPTY_SKILLS
        : tab === 'global'
          ? globalGroup?.skills ?? EMPTY_SKILLS
          : EMPTY_SKILLS;
  const groupRows = useMemo(
    () => groupedRows(tabSkills, ''),
    [tabSkills]
  );
  const groups = useMemo(
    () =>
      groupRows.filter(
        (row): row is Extract<SkillRow, { type: 'group' }> => row.type === 'group'
      ),
    [groupRows]
  );
  const tagOptions = useMemo(
    () => tagFilterOptions(tabSkills, groups),
    [groups, tabSkills]
  );
  const [tagFilter, setTagFilterState] = useAtom(browserTagFilterAtom);
  const setTagFilter = (value: string): void => {
    setTagFilterState((current) => (current === value ? current : value));
  };
  const setSelectedIfChanged = (next: Set<string>): void => {
    setSelected((current) => {
      if (current === next) return current;
      if (current.size === next.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  };
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
    !actionBusy &&
    focus === 'list' &&
    tab === 'project' &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => skill.isReference);
  const canInstallToAgents =
    !actionBusy &&
    focus === 'list' &&
    (tab === 'project' || tab === 'global') &&
    actionSkills.length > 0 &&
    actionSkills.every((skill) => isCrossAgentInstallable(skill));
  const canOpenActions = canMaterialize || canInstallToAgents;
  useBrowseSessionEffects({
    tab,
    agent,
    focus,
    cursor,
    listLength: listRows.length,
    hasAgents: hasAgentTabs,
    masterDetail: useMasterDetail,
    currentIsItem: currentRow?.type === 'skill',
    setFocus,
    setCursor,
    setSelected: setSelectedIfChanged,
    setTagFilter,
    setTagCursor,
  });

  const applySession = (patch: BrowseSessionPatch<BrowserNavigationState>): void => {
    applyBrowseSessionPatch(patch, {
      setNav: (nav) => setNavigation(nav),
      setTagFilter,
      setTagCursor,
      setSelected: setSelectedIfChanged,
      setDetailFieldIndex,
      setChoosingGroup,
      tagCursorRef,
      detailFieldIndexRef,
      cursorRef,
    });
  };
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
    // Master-detail panes fills the terminal; browserFrameDimensions still
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
  const tabBodyMinHeight = useMasterDetail
    ? Math.max(8, (stdout.rows ?? 24) - 2)
    : frame.frameHeight - 1;
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
      // Health alerts panel (demo seed via browserHealthAtom).
      if (input === '!') {
        void presentHealthAlerts(store.get(browserHealthAtom));
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
      if (input === 's' && liveTab === 'collection' && canSync) {
        return finish({ type: 'sync' });
      }
      if (
        (key.return || input.includes('\r') || input.includes('\n')) &&
        liveFocus === 'list' &&
        liveTab === 'collection' &&
        selectedCollection.length
      ) {
        return finish({ type: 'add', skills: selectedCollection });
      }
      const liveNav: BrowserNavigationState = live ?? {
        tab: liveTab,
        focus: liveFocus,
        agent,
        cursor: cursorRef.current,
        query,
      };
      const liveRow = listRows[liveNav.cursor];
      const session = reduceBrowseSessionKey(
        {
          nav: liveNav,
          tagFilter,
          tagCursor: tagCursorRef.current,
          selected,
          detailFieldIndex: detailFieldIndexRef.current,
        },
        input,
        key,
        {
          hasAgents: hasAgentTabs,
          masterDetail: useMasterDetail,
          projectAgentNames: visibleProjectGroups.map((group) => group.agent),
          globalAgentNames: visibleGlobalGroups.map((group) => group.agent),
          tagOptions,
          listLength: listRows.length,
          currentItemIds: liveRow ? selectableSkills(liveRow).map((skill) => skill.path) : [],
          currentIsItem: liveRow?.type === 'skill',
          allowNarrowGroupJump: groups.length > 0,
          detailFieldCount: detailEditableFields(liveNav.tab === 'collection').length,
        }
      );
      if (session.handled) {
        applySession(session.patch);
        return;
      }
      if (liveNav.focus === 'detail') {
        const detailRow = listRows[cursorRef.current];
        const skill = detailRow?.type === 'skill' ? detailRow.skill : undefined;
        const fields = detailEditableFields(liveNav.tab === 'collection');
        const field = fields[detailFieldIndexRef.current] ?? fields[0];
        if (skill && field && (key.return || input.includes('\r') || input.includes('\n'))) {
          if (field === 'tags') return finish({ type: 'editTags', skill });
          if (field === 'note') return finish({ type: 'editNote', skill });
        }
        if (skill && liveNav.tab === 'collection') {
          if (input === 't') return finish({ type: 'editTags', skill });
          if (input === 'n') return finish({ type: 'editNote', skill });
        }
        return;
      }
      if (liveNav.focus !== 'list') return;
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
      if (key.rightArrow && row?.type === 'skill' && tab === 'collection' && !useMasterDetail) {
        return openDetail(row.skill, true);
      }
      if (key.return || input.includes('\r') || input.includes('\n')) {
        if (row?.type === 'skill') {
          return openDetail(row.skill, tab === 'collection');
        }
      }
    },
    {
      isActive: !shellBusy && !searching && !choosingGroup && !actionBusy,
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
        selected,
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
      return (
        <BrowseHomePane
          tagOptions={tagOptions}
          tagCursor={tagCursor}
          listLines={listLines}
          skillOffset={skillOffset}
          listLength={paneRows.length}
          {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
          {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
          detailRows={detailRows}
          {...(activeDetailField ? { detailActiveField: activeDetailField } : {})}
          tagWidth={tagWidth}
          listWidth={listWidth}
          peekWidth={peekWidth}
          viewportHeight={viewportHeight}
          tagActive={focus === 'tags'}
          listActive={focus === 'list'}
          detailActive={focus === 'detail'}
          onTagIndex={(index) => {
            const liveNav = navigationRef.current;
            if (!liveNav) return;
            const patch = browseSessionClickTag(liveNav, tagOptions, index);
            if (patch) applySession(patch);
          }}
          onListIndex={(index) => {
            const liveNav = navigationRef.current;
            if (!liveNav) return;
            applySession(browseSessionClickList(liveNav, index));
          }}
          onDetailLine={(visibleIndex) => {
            const row = detailRows[visibleIndex];
            if (!row?.field) return;
            const index = detailFields.indexOf(row.field);
            if (index < 0) return;
            const liveNav = navigationRef.current;
            if (!liveNav) return;
            applySession(browseSessionClickDetail(liveNav, index));
          }}
          onListScroll={(delta) => {
            const liveNav = navigationRef.current;
            if (!liveNav) return;
            applySession(browseSessionScrollList(liveNav, delta, paneRows.length));
          }}
        />
      );
    }
    return (
      <SkillPane
        rows={paneRows}
        cursor={cursor}
        isActive={focus === 'list'}
        selected={selected}
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

  const activeBrowsePane =
    tab === 'collection'
      ? renderBrowsePane(listRows, browseViewportHeight(false), {
          preferNote: true,
          collection: true,
          showGroup: Boolean(query.trim()),
          updates: updateCheck.updates,
          updatingSkillName,
        })
      : renderBrowsePane(listRows, browseViewportHeight(true), {
          showSource: true,
          showReferences: tab === 'project',
          showGroup: Boolean(query.trim()),
        });
  const tabs = [
    {
      key: 'project',
      label: t('browser.tabProject', { count: project.length }),
      content:
        tab === 'project' ? (
          <box flexDirection="column" minHeight={tabBodyMinHeight}>
            <AgentTabs
              groups={visibleProjectGroups.map((group) => ({
                agent: group.agent,
                count: group.skills.length,
              }))}
              agent={activeProjectAgent}
              focused={!shellBusy && !searching && focus === 'agents'}
              onSelect={(name) => {
                setAgent(name);
                setCursor(0);
              }}
            />
            {activeBrowsePane}
          </box>
        ) : null,
    },
    {
      key: 'global',
      label: t('browser.tabGlobal', { count: globalGroups.reduce((count, group) => count + group.skills.length, 0) }),
      content:
        tab === 'global' ? (
          <box flexDirection="column" minHeight={tabBodyMinHeight}>
            <AgentTabs
              groups={visibleGlobalGroups.map((group) => ({
                agent: group.agent,
                count: group.skills.length,
              }))}
              agent={activeGlobalAgent}
              focused={!shellBusy && !searching && focus === 'agents'}
              onSelect={(name) => {
                setAgent(name);
                setCursor(0);
              }}
            />
            {activeBrowsePane}
          </box>
        ) : null,
    },
    {
      key: 'collection',
      label: t('browser.tabCollection', { count: collection.length }),
      content:
        tab === 'collection' ? (
          <box flexDirection="column" minHeight={tabBodyMinHeight}>
            {activeBrowsePane}
          </box>
        ) : null,
    },
  ];

  // Narrow layout only — wide layout focuses the tag column instead of this Select.
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
          setQuery('');
          setCursor(groupRows.findIndex((row) => row.type === 'group' && row.name === name));
          setFocus('list');
          setChoosingGroup(false);
        }}
        onCancel={() => setChoosingGroup(false)}
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
