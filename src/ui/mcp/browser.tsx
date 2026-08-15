import { Text, useApp, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  CollectedMcp,
  HttpProbeStatus,
  McpLocationEntry,
  McpScope,
} from '../../domain/mcp/index.js';
import { mcpAgentIds, recipeEndpoint } from '../../domain/mcp/index.js';
import { t } from '../../i18n/index.js';
import { Tabs, termcnColors } from '../components/termcn.js';
import { padColumns, sliceColumns } from '../components/terminal-layout.js';
import { masterDetailLayout } from '../browser/layout.js';
import type { McpBrowserData } from './index.js';

type TabId = 'project' | 'global' | 'collection';

export function McpBrowser({
  data,
  status,
  probe,
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
}: {
  data: McpBrowserData;
  status: string;
  probe?: HttpProbeStatus;
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
}): ReactNode {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;
  const master = masterDetailLayout(width, rows);
  const [tab, setTab] = useState<TabId>('collection');
  const [agent, setAgent] = useState('claude');
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const locationRows = tab === 'project' ? data.project : tab === 'global' ? data.global : [];
  const agents = useMemo(() => {
    const present = new Set(locationRows.map((entry) => entry.agent));
    const ordered = mcpAgentIds().filter((id) => present.has(id));
    return ordered.length ? ordered : mcpAgentIds();
  }, [locationRows]);

  const activeAgent = agents.includes(agent as (typeof agents)[number])
    ? agent
    : (agents[0] ?? 'claude');
  useEffect(() => {
    if (agent !== activeAgent) setAgent(activeAgent);
  }, [agent, activeAgent]);
  const visibleLocations = locationRows
    .filter((entry) => entry.agent === activeAgent)
    .filter((entry) => matchesQuery(`${entry.nativeKey} ${entry.agent}`, query));

  const visibleCollection = data.collection.filter((item) =>
    matchesQuery(`${item.name} ${item.recipe.url ?? ''} ${item.tags.join(' ')}`, query)
  );

  const listCount = tab === 'collection' ? visibleCollection.length : visibleLocations.length;
  const currentIndex = Math.min(cursor, Math.max(0, listCount - 1));
  const currentLocation = tab === 'collection' ? undefined : visibleLocations[currentIndex];
  const currentCollected = tab === 'collection' ? visibleCollection[currentIndex] : undefined;

  useInput((input, key) => {
    if (filterOpen) {
      if (key.escape) {
        setFilterOpen(false);
        setFilterDraft(query);
        return;
      }
      if (key.return) {
        setQuery(filterDraft);
        setFilterOpen(false);
        setCursor(0);
        return;
      }
      if (key.backspace || key.delete) {
        setFilterDraft((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setFilterDraft((value) => value + input);
      return;
    }
    if (input === 'q') {
      exit();
      return;
    }
    if (input === '/') {
      setFilterOpen(true);
      setFilterDraft(query);
      return;
    }
    if (key.leftArrow || key.rightArrow) {
      const order: TabId[] = ['project', 'global', 'collection'];
      const index = order.indexOf(tab);
      const next = order[(index + (key.rightArrow ? 1 : order.length - 1)) % order.length];
      if (next) {
        setTab(next);
        setCursor(0);
        setSelected(new Set());
      }
      return;
    }
    if (input === '[' || input === ']') {
      const index = Math.max(0, agents.indexOf(agent as typeof agents[number]));
      const next = agents[(index + (input === ']' ? 1 : agents.length - 1)) % agents.length];
      if (next) {
        setAgent(next);
        setCursor(0);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((value) => Math.min(Math.max(0, listCount - 1), value + 1));
      return;
    }
    if (input === ' ') {
      const id =
        tab === 'collection' ? currentCollected?.name : currentLocation ? locationKey(currentLocation) : undefined;
      if (!id) return;
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    if (input === 'i' && tab !== 'collection') {
      const picked = selectedLocations(visibleLocations, selected, currentLocation);
      if (picked.length) void onImport(picked);
      return;
    }
    if (key.return && tab === 'collection') {
      const names = selectedCollection(visibleCollection, selected, currentCollected).map((item) => item.name);
      if (names.length) void onAdd(names, 'project', [...mcpAgentIds()]);
      return;
    }
    if (input === 'd') {
      if (tab === 'collection') {
        void onDelete({
          collection: selectedCollection(visibleCollection, selected, currentCollected),
        });
      } else {
        void onDelete({
          locations: selectedLocations(visibleLocations, selected, currentLocation),
        });
      }
      return;
    }
    if (input === 'x' && currentLocation) {
      void onToggle(currentLocation);
      return;
    }
    if (input === 'u' && tab === 'collection') {
      void onUpdate(selectedCollection(visibleCollection, selected, currentCollected));
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
  });

  const listWidth = master ? Math.max(24, Math.floor(width * 0.58)) : Math.max(20, width - 2);
  const detailWidth = Math.max(20, width - listWidth - 3);

  const listPane = (
    <box flexDirection="column" width={listWidth}>
      {listCount === 0 ? (
        <Text color={termcnColors.muted}>
          {tab === 'collection' ? t('mcp.emptyCollection') : t('mcp.emptyLocations')}
        </Text>
      ) : tab === 'collection' ? (
        visibleCollection.map((item, index) => (
          <Text
            key={item.name}
            {...(index === currentIndex
              ? { color: termcnColors.selectionFg, backgroundColor: termcnColors.selectionBg }
              : {})}
          >
            {`${index === currentIndex ? '›' : ' '} ${selected.has(item.name) ? '•' : ' '} ${sliceColumns(item.name, 0, listWidth - 6)}`}
          </Text>
        ))
      ) : (
        visibleLocations.map((entry, index) => (
          <Text
            key={locationKey(entry)}
            {...(index === currentIndex
              ? { color: termcnColors.selectionFg, backgroundColor: termcnColors.selectionBg }
              : {})}
          >
            {formatLocationLine(
              entry,
              selected.has(locationKey(entry)),
              index === currentIndex,
              listWidth
            )}
          </Text>
        ))
      )}
    </box>
  );

  const detailPane = master ? (
    <box flexDirection="column" width={detailWidth}>
      {detailLines(currentCollected, currentLocation, probe).map((line) => (
        <Text key={line} color={termcnColors.muted}>
          {sliceColumns(line, 0, detailWidth)}
        </Text>
      ))}
    </box>
  ) : null;

  const body = (
    <box flexDirection="column" minHeight={Math.max(8, rows - 4)}>
      {tab !== 'collection' ? (
        <Text color={termcnColors.muted}>
          {agents.map((id) => (id === activeAgent ? `‹${id}›` : id)).join('  ')}
        </Text>
      ) : null}
      <box flexDirection="row" flexGrow={1}>
        {listPane}
        {detailPane}
      </box>
    </box>
  );

  return (
    <box flexDirection="column" flexGrow={1}>
      <Tabs
        tabs={[
          {
            key: 'project',
            label: t('browser.tabProject', { count: data.project.length }),
            content: tab === 'project' ? body : <Text />,
          },
          {
            key: 'global',
            label: t('browser.tabGlobal', { count: data.global.length }),
            content: tab === 'global' ? body : <Text />,
          },
          {
            key: 'collection',
            label: t('browser.tabCollection', { count: data.collection.length }),
            content: tab === 'collection' ? body : <Text />,
          },
        ]}
        activeTab={tab}
        onTabChange={(key) => {
          setTab(key as TabId);
          setCursor(0);
          setSelected(new Set());
        }}
        enableArrowNav={false}
        bordered={false}
        width={width}
      />
      <Text color={termcnColors.muted}>
        {filterOpen
          ? `${t('common.filterLabel')}${filterDraft}`
          : padColumns(
              `${footerKeys(tab, Boolean(currentLocation), Boolean(currentCollected))}  ${status}`,
              width
            )}
      </Text>
    </box>
  );
}

function matchesQuery(text: string, query: string): boolean {
  if (!query.trim()) return true;
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

function locationKey(entry: McpLocationEntry): string {
  return `${entry.agent}|${entry.scope}|${entry.ownership}|${entry.nativeKey}|${entry.filePath}`;
}

function formatLocationLine(
  entry: McpLocationEntry,
  selected: boolean,
  current: boolean,
  width: number
): string {
  const mark = entry.ownership === 'borrowed' ? `${t('mcp.borrowedMark')} ` : '';
  const on = entry.enabled ? '' : ` ${t('mcp.disabled')}`;
  return sliceColumns(
    `${current ? '›' : ' '} ${selected ? '•' : ' '} ${mark}${entry.nativeKey}${on}`,
    0,
    width
  );
}

function selectedLocations(
  rows: McpLocationEntry[],
  selected: Set<string>,
  current: McpLocationEntry | undefined
): McpLocationEntry[] {
  const picked = rows.filter((row) => selected.has(locationKey(row)));
  if (picked.length) return picked;
  return current ? [current] : [];
}

function selectedCollection(
  rows: CollectedMcp[],
  selected: Set<string>,
  current: CollectedMcp | undefined
): CollectedMcp[] {
  const picked = rows.filter((row) => selected.has(row.name));
  if (picked.length) return picked;
  return current ? [current] : [];
}

function detailLines(
  collected: CollectedMcp | undefined,
  location: McpLocationEntry | undefined,
  probe?: HttpProbeStatus
): string[] {
  if (collected) {
    const lines = [
      collected.name,
      `${t('mcp.transport')}  ${collected.recipe.transport}`,
      `${t('mcp.endpoint')}  ${recipeEndpoint(collected.recipe)}`,
      `${t('common.tags')}  ${collected.tags.join(', ') || t('common.none')}`,
      `${t('common.note')}  ${collected.note || t('common.none')}`,
    ];
    if (probe) {
      const label =
        probe === 'reachable'
          ? t('mcp.probeReachable')
          : probe === 'needs-auth'
            ? t('mcp.probeNeedsAuth')
            : t('mcp.probeFailed');
      lines.push(`${t('mcp.probe')}  ${label}`);
    }
    return lines;
  }
  if (location) {
    const lines = [
      `${location.ownership === 'borrowed' ? t('mcp.borrowedMark') + ' ' : ''}${location.nativeKey}`,
      `${t('mcp.nativeKey')}  ${location.nativeKey}`,
      `${t('mcp.transport')}  ${location.recipe.transport}`,
      `${t('mcp.endpoint')}  ${recipeEndpoint(location.recipe)}`,
      location.enabled ? t('mcp.enabled') : t('mcp.disabled'),
    ];
    if (location.borrowedFrom) {
      lines.push(t('mcp.fromSource', { source: location.borrowedFrom }));
    }
    return lines;
  }
  return [];
}

function footerKeys(tab: TabId, hasLocation: boolean, hasCollected: boolean): string {
  const items = ['q ' + t('common.quit'), '/ ' + t('common.filter')];
  if (tab !== 'collection') {
    items.push('i ' + t('common.collect'));
    if (hasLocation) items.push('x ' + t('mcp.toggle'));
    items.push('d ' + t('common.delete'));
  } else {
    items.push('Enter ' + t('common.add'));
    items.push('u ' + t('common.update'));
    items.push('d ' + t('common.delete'));
    if (hasCollected) {
      items.push('t ' + t('common.tags'));
      items.push('r ' + t('mcp.rename'));
      items.push('l ' + t('mcp.login'));
    }
  }
  return items.join('  ');
}
