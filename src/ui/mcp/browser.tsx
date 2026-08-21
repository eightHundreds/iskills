import { useApp, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useEffect, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import type {
  CollectedMcp,
  HttpProbeStatus,
  McpLocationEntry,
  McpLoginState,
} from '../../domain/mcp/index.js';
import { findCollectedByEndpoint, mcpProtocolLoginState } from '../../domain/mcp/index.js';
import { t } from '../../i18n/index.js';
import { Tabs } from '../components/termcn.js';
import { MoreActionsPanel } from '../components/more-actions-panel.js';
import { isReturn } from '../components/text.js';
import { useModal, useOverlayBusy } from '../overlay/host.js';
import { ShortcutHelpPanel } from '../browser/shortcut-help.js';
import { AgentTabs, BrowseHomePane, BrowseListPane } from '../browser/panes.js';
import type { BrowserFocus, BrowserTab } from '../browser/types.js';
import { TAG_FILTER_ALL, browseListColumnLines } from '../browser/format.js';
import {
  applyBrowseSessionPatch,
  browseSessionClickDetail,
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
  mcpDetailEditableFields,
  mcpLocationDetailRows,
  mcpPeekCurrent,
  mcpShortcutHelpSections,
} from './format.js';
import type { McpBrowserData } from './index.js';

export function McpBrowser({
  data,
  onCapabilities,
  onImport,
  onImportJson,
  onAdd,
  onDelete,
  onToggle,
  onUpdate,
  onRename,
  onTags,
  onNote,
  onLogin,
  onFillSecrets,
  onProbe,
  filterOpen,
  query,
  onOpenFilter,
}: {
  data: McpBrowserData;
  onCapabilities: (snapshot: McpFooterSnapshot) => void;
  onImport: (entries: McpLocationEntry[]) => Promise<void>;
  onImportJson: () => Promise<void>;
  onAdd: (names: string[]) => Promise<void>;
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
  onFillSecrets: (item: CollectedMcp) => Promise<void>;
  onProbe: (item: CollectedMcp) => Promise<HttpProbeStatus>;
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
  const [probes, setProbes] = useState<Record<string, HttpProbeStatus>>({});

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
  const peekCollected = mcpPeekCurrent(focus, currentCollected);
  const peekLocation = mcpPeekCurrent(focus, currentLocation);
  const probe = currentCollected ? probes[currentCollected.name] : undefined;
  const currentSecrets: McpLoginState = currentCollected
    ? (data.secrets[currentCollected.name] ?? 'none')
    : 'none';
  const currentLogin: McpLoginState = currentCollected
    ? mcpProtocolLoginState(
        currentCollected.recipe.transport,
        {
          env: {},
          headers: data.accessToken[currentCollected.name] ? { Authorization: '1' } : {},
        },
        probe
      )
    : 'none';
  const detailFields = mcpDetailEditableFields(tab === 'collection', currentSecrets, currentLogin);
  const activeDetailField =
    focus === 'detail' && detailFields.length
      ? detailFields[Math.max(0, Math.min(detailFieldIndex, detailFields.length - 1))]
      : undefined;
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
  useEffect(() => {
    if (detailFieldIndex >= detailFields.length && detailFields.length > 0) {
      setDetailFieldIndex(detailFields.length - 1);
    }
  }, [detailFieldIndex, detailFields.length]);
  useEffect(() => {
    if (focus !== 'detail' || tab !== 'collection' || !currentCollected) return;
    const transport = currentCollected.recipe.transport;
    if (transport !== 'http' && transport !== 'sse') return;
    const name = currentCollected.name;
    if (probes[name]) return;
    void onProbe(currentCollected).then((status) => {
      setProbes((current) => ({ ...current, [name]: status }));
    });
  }, [focus, tab, currentCollected?.name]);

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
    hasTagGroups: false,
    ...(activeDetailField ? { detailField: activeDetailField } : {}),
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
        isReturn(input, key.return) &&
        live.focus === 'list' &&
        tab === 'collection' &&
        selectedCollected.length
      ) {
        void onAdd(selectedCollected.map((item) => item.name));
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
          detailFieldCount: detailFields.length,
          detailEntryFieldIndex: 0,
        }
      );
      if (session.handled) {
        applySession(session.patch);
        return;
      }
      if (live.focus === 'detail' && tab === 'collection' && currentCollected) {
        const field = detailFields[detailFieldIndexRef.current] ?? detailFields[0];
        if (isReturn(input, key.return) && field) {
          if (field === 'name') void onRename(currentCollected);
          else if (field === 'login') {
            void onLogin(currentCollected).then(() =>
              onProbe(currentCollected).then((status) => {
                setProbes((current) => ({ ...current, [currentCollected.name]: status }));
              })
            );
          } else if (field === 'secrets') void onFillSecrets(currentCollected);
          else if (field === 'tags') void onTags(currentCollected);
          else if (field === 'note') void onNote(currentCollected);
        }
        if (input === 't') void onTags(currentCollected);
        if (input === 'n') void onNote(currentCollected);
        return;
      }
      if (live.focus !== 'list') return;
      if (input === 'm') {
        void modal
          .open<'importJson' | null>({
            footerItems: [
              { key: 'Enter', label: t('common.confirm') },
              { key: 'Esc', label: t('common.cancel') },
            ],
            content: (close) => (
              <MoreActionsPanel
                items={[{ id: 'importJson', label: t('mcp.importFromJson') }]}
                onSelect={(id) => close(id)}
                onCancel={() => close(null)}
              />
            ),
          })
          .then((id) => {
            if (id === 'importJson') void onImportJson();
          });
        return;
      }
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
      if (input === 't' && currentCollected) {
        void onTags(currentCollected);
        return;
      }
      if (input === 'n' && currentCollected) {
        void onNote(currentCollected);
        return;
      }
      if (input === 'p' && currentCollected) {
        void onProbe(currentCollected).then((status) => {
          setProbes((current) => ({ ...current, [currentCollected.name]: status }));
        });
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
        ? mcpCollectionDetailRows(peekCollected, peekWidth, viewportHeight, {
            secrets: currentSecrets,
            login: currentLogin,
            ...(probe ? { probe } : {}),
          })
        : mcpLocationDetailRows(peekLocation, data.collection, peekWidth, viewportHeight);
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
          {...(activeDetailField ? { detailActiveField: activeDetailField } : {})}
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
          onDetailLine={(visibleIndex) => {
            const row = detailRows[visibleIndex];
            if (!row?.field) return;
            const index = detailFields.indexOf(row.field);
            if (index < 0) return;
            if (row.field === 'login' && currentCollected) {
              void onLogin(currentCollected).then(() =>
                onProbe(currentCollected).then((status) => {
                  setProbes((current) => ({ ...current, [currentCollected.name]: status }));
                })
              );
              return;
            }
            applySession(browseSessionClickDetail(navRef.current, index));
          }}
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
