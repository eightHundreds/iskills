import { useApp, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import type {
  CollectedMcp,
  HttpProbeStatus,
  McpLocationEntry,
  McpScope,
} from '../../domain/mcp/index.js';
import { findCollectedByEndpoint, mcpAgentIds } from '../../domain/mcp/index.js';
import { t } from '../../i18n/index.js';
import { Tabs } from '../components/termcn.js';
import { useModal, useOverlayBusy } from '../overlay/host.js';
import { ShortcutHelpPanel } from '../browser/shortcut-help.js';
import { AgentTabs, BrowseHomePane, BrowseListPane } from '../browser/panes.js';
import type { BrowserFocus, BrowserTab } from '../browser/types.js';
import { TAG_FILTER_ALL, browseListColumnLines } from '../browser/format.js';
import {
  applyBrowseSessionPatch,
  browseSessionClickList,
  browseSessionClickTag,
  browseSessionScrollList,
  reduceBrowseSessionKey,
  useBrowseSessionEffects,
  type BrowseSessionNav,
  type BrowseSessionPatch,
} from '../browser/browse-session.js';
import { wrapAgent } from '../browser/browse-nav.js';
import {
  browserFrameDimensions,
  compactLayout,
  masterDetailLayout,
  masterDetailViewportHeight,
  masterDetailWidths,
} from '../browser/layout.js';
import { computeMcpBrowseCapabilities, selectedOrCurrent } from './browse-capabilities.js';
import type { McpFooterSnapshot } from './browse-capabilities.js';
import {
  collectedListItem,
  collectedTagOptions,
  filterCollected,
  filterLocations,
  groupLocationsByAgent,
  locationKey,
  locationListItem,
  locationTagOptions,
  mcpCollectionDetailRows,
  mcpLocationDetailRows,
  mcpShortcutHelpSections,
} from './format.js';
import type { McpBrowserData } from './index.js';

export function McpBrowser({
  data,
  probe,
  onCapabilities,
  onImport,
  onAdd,
  onDelete,
  onToggle,
  onUpdate,
  onRename,
  onTags,
  onNote,
  onLogin,
  onProbe,
  filterOpen,
  query,
  onOpenFilter,
}: {
  data: McpBrowserData;
  probe?: HttpProbeStatus;
  onCapabilities: (snapshot: McpFooterSnapshot) => void;
  onImport: (entries: McpLocationEntry[]) => Promise<void>;
  onAdd: (names: string[], scope: McpScope, agents: string[]) => Promise<void>;
  onDelete: (target: {
    collection?: CollectedMcp[];
    locations?: McpLocationEntry[];
  }) => Promise<void>;
  onToggle: (entry: McpLocationEntry) => Promise<void>;
  onUpdate: (items: CollectedMcp[]) => Promise<void>;
  onRename: (item: CollectedMcp) => Promise<void>;
  onTags: (item: CollectedMcp) => Promise<void>;
  onNote: (item: CollectedMcp) => Promise<void>;
  onLogin: (item: CollectedMcp) => Promise<void>;
  onProbe: (item: CollectedMcp) => Promise<void>;
  filterOpen: boolean;
  query: string;
  onOpenFilter: () => void;
}): ReactNode {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const modal = useModal();
  const overlayBusy = useOverlayBusy();
  const [nav, setNavState] = useState<BrowseSessionNav>({
    tab: 'collection',
    focus: 'list',
    agent: '',
    cursor: 0,
  });
  const navRef = useRef(nav);
  const setNav = (value: SetStateAction<BrowseSessionNav>): void => {
    setNavState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      navRef.current = next;
      return next;
    });
  };
  const tab = nav.tab;
  const focus = nav.focus;
  const agent = nav.agent;
  const cursor = nav.cursor;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagFilter, setTagFilter] = useState(TAG_FILTER_ALL);
  const [tagCursor, setTagCursor] = useState(0);
  const tagCursorRef = useRef(0);
  tagCursorRef.current = tagCursor;
  const [detailFieldIndex, setDetailFieldIndex] = useState(0);
  const detailFieldIndexRef = useRef(0);

  const setTab = (value: BrowserTab): void => {
    setNav((current) => ({ ...current, tab: value }));
  };
  const setFocus = (value: BrowserFocus): void => {
    setNav((current) => ({ ...current, focus: value }));
  };
  const setAgent = (value: string): void => {
    setNav((current) => ({ ...current, agent: value }));
  };
  const setCursor = (value: SetStateAction<number>): void => {
    setNav((current) => {
      const nextCursor = typeof value === 'function' ? value(current.cursor) : value;
      cursorRef.current = nextCursor;
      return { ...current, cursor: nextCursor };
    });
  };

  const projectGroups = useMemo(() => groupLocationsByAgent(data.project), [data.project]);
  const globalGroups = useMemo(() => groupLocationsByAgent(data.global), [data.global]);
  const currentAgentGroups =
    tab === 'project' ? projectGroups : tab === 'global' ? globalGroups : [];
  const agentNames = currentAgentGroups.map((group) => group.agent);
  const activeAgent = agentNames.includes(agent) ? agent : agentNames[0] ?? '';
  const currentLocations =
    currentAgentGroups.find((group) => group.agent === activeAgent)?.entries ?? [];
  const visibleCollected = useMemo(
    () => filterCollected(data.collection, tagFilter, query),
    [data.collection, tagFilter, query]
  );
  const visibleLocations = useMemo(
    () => filterLocations(currentLocations, query),
    [currentLocations, query]
  );
  const listItems = useMemo(
    () =>
      tab === 'collection'
        ? visibleCollected.map(collectedListItem)
        : visibleLocations.map(locationListItem),
    [tab, visibleCollected, visibleLocations]
  );
  const listCount = listItems.length;
  const currentCollected = tab === 'collection' ? visibleCollected[cursor] : undefined;
  const currentLocation = tab !== 'collection' ? visibleLocations[cursor] : undefined;
  const selectedCollected = selectedOrCurrent(
    data.collection.filter((item) => selected.has(`mcp:${item.name}`)),
    currentCollected
  );
  const selectedLocations = selectedOrCurrent(
    currentLocations.filter((entry) => selected.has(locationKey(entry))),
    currentLocation
  );
  const selectedImportable = selectedLocations.filter(
    (entry) => !findCollectedByEndpoint(data.collection, entry.recipe)
  );
  const useBrowseHome = masterDetailLayout(stdout.columns, stdout.rows);
  const useCompact = compactLayout(stdout.columns, stdout.rows);
  const tagOptions =
    tab === 'collection' ? collectedTagOptions(data.collection) : locationTagOptions(currentLocations);

  useBrowseSessionEffects({
    tab,
    agent,
    focus,
    cursor,
    listLength: listCount,
    hasAgents: agentNames.length > 0,
    masterDetail: useBrowseHome,
    currentIsItem: Boolean(listItems[cursor]),
    setFocus,
    setCursor,
    setSelected,
    setTagFilter,
    setTagCursor,
  });

  useEffect(() => {
    if (agent !== activeAgent) setAgent(activeAgent);
  }, [agent, activeAgent]);

  const applySession = (patch: BrowseSessionPatch<BrowseSessionNav>): void => {
    applyBrowseSessionPatch(patch, {
      setNav,
      setTagFilter,
      setTagCursor,
      setSelected,
      setDetailFieldIndex,
      tagCursorRef,
      detailFieldIndexRef,
      cursorRef,
    });
  };

  const footerSnapshot = computeMcpBrowseCapabilities({
    tab,
    focus,
    masterDetail: useBrowseHome,
    selectionCount: selected.size,
    currentIsItem: Boolean(listItems[cursor]),
    canDelete: selectedCollected.length + selectedLocations.length > 0,
    canImport: tab !== 'collection' && selectedImportable.length > 0,
    canToggle: Boolean(currentLocation),
    canUpdate: tab === 'collection' && selectedCollected.length > 0,
    canTag: tab === 'collection' && Boolean(currentCollected),
    canLogin: tab === 'collection' && Boolean(currentCollected),
    canRename: tab === 'collection' && Boolean(currentCollected),
    hasTagGroups: false,
  });
  const browseKey = JSON.stringify(footerSnapshot);
  useEffect(() => {
    onCapabilities(footerSnapshot);
  }, [browseKey, onCapabilities]);

  const frame = browserFrameDimensions({
    rows: stdout.rows,
    columns: stdout.columns,
    projectRows: data.project.length,
    globalRows: data.global.length,
    collectionRows: data.collection.length,
    hasProjectAgents: projectGroups.length > 0,
    hasGlobalAgents: globalGroups.length > 0,
  });
  const masterDetailColumns = masterDetailWidths(Math.max(40, frame.frameWidth - 2), useBrowseHome);
  const browseViewportHeight = (withAgents: boolean): number =>
    useBrowseHome
      ? masterDetailViewportHeight(stdout.rows, 1 + 2 + 3 + (withAgents ? 1 : 0))
      : Math.max(useCompact ? 1 : 3, frame.frameHeight - (withAgents ? 3 : 2));
  const tabBodyMinHeight = useBrowseHome
    ? Math.max(8, (stdout.rows ?? 24) - 2)
    : frame.frameHeight - 1;

  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        exit();
        return;
      }
      if (input === '?') {
        void modal.open({
          footerItems: [
            { key: '↑↓', label: t('common.move') },
            { key: 'e', label: t('common.expand') },
            { key: 'Esc', label: t('common.close') },
          ],
          content: (close) => (
            <ShortcutHelpPanel
              onClose={() => close(undefined)}
              maxBodyRows={14}
              sections={mcpShortcutHelpSections()}
            />
          ),
        });
        return;
      }
      if (input === '/') {
        onOpenFilter();
        return;
      }
      const live = navRef.current;
      if (input === '[' || input === ']') {
        const next = wrapAgent(agentNames, activeAgent || agentNames[0] || '', input === ']' ? 1 : -1);
        if (next) {
          setAgent(next);
          setCursor(0);
          setFocus('agents');
        }
        return;
      }
      if (
        (key.return || input.includes('\r') || input.includes('\n')) &&
        live.focus === 'list' &&
        tab === 'collection' &&
        selectedCollected.length
      ) {
        void onAdd(
          selectedCollected.map((item) => item.name),
          'project',
          [...mcpAgentIds()]
        );
        return;
      }
      if (key.rightArrow && live.focus === 'list' && tab === 'collection' && useBrowseHome) {
        return;
      }
      const currentId = listItems[live.cursor]?.id;
      const session = reduceBrowseSessionKey(
        {
          nav: live,
          tagFilter,
          tagCursor: tagCursorRef.current,
          selected,
          detailFieldIndex: detailFieldIndexRef.current,
        },
        input,
        key,
        {
          hasAgents: agentNames.length > 0,
          masterDetail: useBrowseHome,
          projectAgentNames: projectGroups.map((group) => group.agent),
          globalAgentNames: globalGroups.map((group) => group.agent),
          tagOptions,
          listLength: listItems.length,
          currentItemIds: currentId ? [currentId] : [],
          currentIsItem: Boolean(currentId),
          allowNarrowGroupJump: false,
          detailFieldCount: 0,
        }
      );
      if (session.handled) {
        applySession(session.patch);
        return;
      }
      if (live.focus !== 'list') return;
      if (input === 'i' && tab !== 'collection' && selectedImportable.length) {
        void onImport(selectedImportable);
        return;
      }
      if (input === 'd') {
        if (tab === 'collection') {
          if (selectedCollected.length) void onDelete({ collection: selectedCollected });
        } else if (selectedLocations.length) {
          void onDelete({ locations: selectedLocations });
        }
        return;
      }
      if (input === 'x' && currentLocation) {
        void onToggle(currentLocation);
        return;
      }
      if (input === 'u' && tab === 'collection' && selectedCollected.length) {
        void onUpdate(selectedCollected);
        return;
      }
      if (input === 'r' && currentCollected) {
        void onRename(currentCollected);
        return;
      }
      if (input === 't' && currentCollected) {
        void onTags(currentCollected);
        return;
      }
      if (input === 'n' && currentCollected) {
        void onNote(currentCollected);
        return;
      }
      if (input === 'l' && currentCollected) {
        void onLogin(currentCollected);
        return;
      }
      if (input === 'p' && currentCollected) {
        void onProbe(currentCollected);
      }
    },
    { isActive: !overlayBusy && !filterOpen }
  );

  const renderBrowsePane = (viewportHeight: number, collection: boolean): ReactNode => {
    if (useBrowseHome) {
      const { tagWidth, listWidth, peekWidth } = masterDetailColumns;
      const {
        lines: listLines,
        skillOffset,
        activeLineIndexes: listActiveLineIndexes,
        selectedLineIndexes: listSelectedLineIndexes,
      } = browseListColumnLines(
        listItems,
        cursor,
        focus === 'list',
        listWidth,
        viewportHeight,
        selected
      );
      const detailRows = collection
        ? mcpCollectionDetailRows(currentCollected, peekWidth, viewportHeight, probe)
        : mcpLocationDetailRows(currentLocation, data.collection, peekWidth, viewportHeight);
      return (
        <BrowseHomePane
          tagOptions={tagOptions}
          tagCursor={tagCursor}
          listLines={listLines}
          skillOffset={skillOffset}
          listLength={listItems.length}
          {...(listActiveLineIndexes ? { listActiveLineIndexes } : {})}
          {...(listSelectedLineIndexes ? { listSelectedLineIndexes } : {})}
          detailRows={detailRows}
          tagWidth={tagWidth}
          listWidth={listWidth}
          peekWidth={peekWidth}
          viewportHeight={viewportHeight}
          tagActive={focus === 'tags'}
          listActive={focus === 'list'}
          detailActive={focus === 'detail'}
          onTagIndex={(index) => {
            const patch = browseSessionClickTag(navRef.current, tagOptions, index);
            if (patch) applySession(patch);
          }}
          onListIndex={(index) => applySession(browseSessionClickList(navRef.current, index))}
          onDetailLine={() => undefined}
          onListScroll={(delta) =>
            applySession(browseSessionScrollList(navRef.current, delta, listItems.length))
          }
        />
      );
    }
    return (
      <BrowseListPane
        items={listItems}
        cursor={cursor}
        isActive={focus === 'list'}
        selected={selected}
        compact={useCompact}
        viewportHeight={viewportHeight}
        onRowClick={(index) => applySession(browseSessionClickList(navRef.current, index))}
        onCursorDelta={(delta) =>
          applySession(browseSessionScrollList(navRef.current, delta, listItems.length))
        }
      />
    );
  };

  const tabs = [
    {
      key: 'project',
      label: t('browser.tabProject', { count: data.project.length }),
      content: (
        <box flexDirection="column" minHeight={tabBodyMinHeight}>
          <AgentTabs
            groups={projectGroups.map((group) => ({
              agent: group.agent,
              count: group.entries.length,
            }))}
            agent={tab === 'project' ? activeAgent : projectGroups[0]?.agent ?? ''}
            focused={!overlayBusy && !filterOpen && focus === 'agents'}
            onSelect={(name) => {
              setAgent(name);
              setCursor(0);
              setFocus('agents');
            }}
          />
          {renderBrowsePane(browseViewportHeight(true), false)}
        </box>
      ),
    },
    {
      key: 'global',
      label: t('browser.tabGlobal', { count: data.global.length }),
      content: (
        <box flexDirection="column" minHeight={tabBodyMinHeight}>
          <AgentTabs
            groups={globalGroups.map((group) => ({
              agent: group.agent,
              count: group.entries.length,
            }))}
            agent={tab === 'global' ? activeAgent : globalGroups[0]?.agent ?? ''}
            focused={!overlayBusy && !filterOpen && focus === 'agents'}
            onSelect={(name) => {
              setAgent(name);
              setCursor(0);
              setFocus('agents');
            }}
          />
          {renderBrowsePane(browseViewportHeight(true), false)}
        </box>
      ),
    },
    {
      key: 'collection',
      label: t('browser.tabCollection', { count: data.collection.length }),
      content: (
        <box flexDirection="column" minHeight={tabBodyMinHeight}>
          {renderBrowsePane(browseViewportHeight(false), true)}
        </box>
      ),
    },
  ];

  return (
    <box flexDirection="column">
      <Tabs
        tabs={tabs}
        activeTab={tab}
        onTabChange={(key) => {
          setTab(key as BrowserTab);
          setCursor(0);
          setSelected(new Set());
          setFocus('tabs');
        }}
        isActive={!overlayBusy && !filterOpen && focus === 'tabs'}
        enableArrowNav={false}
        focused={!overlayBusy && !filterOpen && focus === 'tabs'}
        width={frame.frameWidth}
        bordered={false}
        chip={useBrowseHome}
      />
    </box>
  );
}
