import {
  findCollectedByEndpoint,
  mcpAgentIds,
  type CollectedMcp,
  type HttpProbeStatus,
  type McpLocationEntry,
  type McpLoginState,
  type McpRecipe,
} from '../../domain/mcp/index.js';
import type { BrowserFocus, DetailFieldId } from '../browser/types.js';
import { normalizeRemoteUrl } from '../../domain/mcp/identity.js';
import {
  TAG_FILTER_ALL,
  filterTaggedItems,
  peekFieldRows,
  taggedItemGroups,
  taggedTagOptions,
  type BrowseListItem,
  type BrowseTagOption,
  type CollectionDetailRow,
  type ShortcutHelpSection,
} from '../browser/format.js';
import { t } from '../../i18n/index.js';

/** Human-readable launch line — not the `transport:…` identity key. */
export function recipeDisplayLine(recipe: McpRecipe): string {
  if (recipe.transport === 'stdio') {
    const command = recipe.command?.trim() ?? '';
    const args = (recipe.args ?? []).map((arg) => arg.trim()).filter(Boolean).join(' ');
    return [command, args].filter(Boolean).join(' ') || recipe.transport;
  }
  const url = recipe.url?.trim() ?? '';
  return url ? normalizeRemoteUrl(url) : recipe.transport;
}

export function mcpSourceLabel(mcp: CollectedMcp): string {
  const source = mcp.source;
  if (source.type === 'git') return t('common.git');
  if (
    source.type === 'local' ||
    source.type === 'create' ||
    source.type === 'import' ||
    source.type === 'unknown' ||
    source.path
  ) {
    return t('common.local');
  }
  if (source.agent) return source.agent;
  return source.type || t('common.unknown');
}

export function locationKey(entry: McpLocationEntry): string {
  return `${entry.agent}:${entry.scope}:${entry.ownership}:${entry.nativeKey}:${entry.filePath}`;
}

export function locationListItem(entry: McpLocationEntry): BrowseListItem {
  return {
    id: locationKey(entry),
    name: entry.nativeKey,
    summary: recipeDisplayLine(entry.recipe),
    ...(entry.ownership === 'borrowed' ? { mark: `${t('mcp.borrowedMark')} ` } : {}),
  };
}

export function collectedListItem(mcp: CollectedMcp): BrowseListItem {
  const summary = mcp.note.trim() || mcp.description.trim();
  return {
    id: `mcp:${mcp.name}`,
    name: mcp.name,
    summary,
  };
}

export function groupLocationsByAgent(
  entries: McpLocationEntry[]
): { agent: string; entries: McpLocationEntry[] }[] {
  const grouped = new Map<string, McpLocationEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.agent) ?? [];
    list.push(entry);
    grouped.set(entry.agent, list);
  }
  return mcpAgentIds()
    .filter((id) => grouped.has(id))
    .map((id) => ({ agent: id, entries: grouped.get(id) ?? [] }));
}

export type McpTagOption = BrowseTagOption;

function collectedAsTagged(item: CollectedMcp): CollectedMcp & { id: string } {
  return { ...item, id: `mcp:${item.name}` };
}

export function collectedTagGroups(
  items: CollectedMcp[]
): { name: string; items: CollectedMcp[] }[] {
  const byId = new Map<string, CollectedMcp>(
    items.map((item) => [`mcp:${item.name}`, item])
  );
  return taggedItemGroups(items.map(collectedAsTagged)).map((group) => ({
    name: group.name,
    items: group.ids
      .map((id) => byId.get(id))
      .filter((item): item is CollectedMcp => Boolean(item)),
  }));
}

export function collectedTagOptions(items: CollectedMcp[]): BrowseTagOption[] {
  return taggedTagOptions(items.map(collectedAsTagged));
}

export function locationTagOptions(entries: McpLocationEntry[]): BrowseTagOption[] {
  return [
    {
      key: TAG_FILTER_ALL,
      label: t('common.all'),
      ids: entries.map(locationKey),
    },
  ];
}

export function filterCollected(
  items: CollectedMcp[],
  tag: string,
  query: string
): CollectedMcp[] {
  const next = filterTaggedItems(items.map(collectedAsTagged), tag);
  const needle = query.trim().toLowerCase();
  if (!needle) return next;
  return next.filter((item) => {
    const haystack = [
      item.name,
      item.description,
      item.note,
      ...item.tags,
      recipeDisplayLine(item.recipe),
    ];
    return haystack.some((part) => part.toLowerCase().includes(needle));
  });
}

export function filterLocations(
  entries: McpLocationEntry[],
  query: string
): McpLocationEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => {
    const haystack = [entry.nativeKey, entry.agent, recipeDisplayLine(entry.recipe)];
    return haystack.some((part) => part.toLowerCase().includes(needle));
  });
}

/** Right column peeks the current row only while the list or detail column is focused. */
export function mcpPeekCurrent<T>(
  focus: BrowserFocus,
  current: T | undefined
): T | undefined {
  return focus === 'list' || focus === 'detail' ? current : undefined;
}

export function mcpDetailEditableFields(
  collection: boolean,
  secrets: McpLoginState,
  login: McpLoginState
): DetailFieldId[] {
  if (!collection) return [];
  const fields: DetailFieldId[] = ['name'];
  if (login !== 'none') fields.push('login');
  if (secrets !== 'none') fields.push('secrets');
  fields.push('tags', 'note');
  return fields;
}

export function mcpCollectionDetailRows(
  mcp: CollectedMcp | undefined,
  width: number,
  viewportHeight: number,
  options: {
    probe?: HttpProbeStatus;
    secrets?: McpLoginState;
    login?: McpLoginState;
  } = {}
): CollectionDetailRow[] {
  if (!mcp) return [{ text: t('mcp.selectToView'), muted: true }];
  const secrets = options.secrets ?? 'none';
  const login = options.login ?? 'none';
  const probe = options.probe;
  const rows: CollectionDetailRow[] = [
    { text: mcp.name, bold: true, field: 'name' },
    ...peekFieldRows(t('common.source'), mcpSourceLabel(mcp), width, 1),
    ...peekFieldRows(t('mcp.transport'), mcp.recipe.transport, width, 1),
    ...peekFieldRows(t('mcp.endpoint'), recipeDisplayLine(mcp.recipe), width, 2),
  ];
  if (login !== 'none') {
    rows.push(
      ...peekFieldRows(
        t('mcp.login'),
        login === 'signed-in' ? t('mcp.signedIn') : t('mcp.signedOut'),
        width,
        1,
        { field: 'login' }
      )
    );
  }
  if (secrets !== 'none') {
    rows.push(
      ...peekFieldRows(
        t('mcp.secrets'),
        secrets === 'signed-in' ? t('mcp.secretsSet') : t('mcp.secretsUnset'),
        width,
        1,
        { field: 'secrets' }
      )
    );
  }
  rows.push(
    ...peekFieldRows(
      t('common.tags'),
      mcp.tags.length ? mcp.tags.map((tag) => `[${tag}]`).join(' ') : '--',
      width,
      2,
      { field: 'tags' }
    ),
    ...peekFieldRows(t('common.note'), mcp.note.trim() || t('common.none'), width, 2, {
      field: 'note',
    })
  );
  if (probe) {
    const label =
      probe === 'reachable'
        ? t('mcp.probeReachable')
        : probe === 'needs-auth'
          ? t('mcp.probeNeedsAuth')
          : t('mcp.probeFailed');
    rows.push(...peekFieldRows(t('mcp.probe'), label, width, 1));
  }
  const descriptionBudget = Math.max(2, Math.floor(viewportHeight * 0.35));
  return [
    ...rows,
    { text: '' },
    ...peekFieldRows(
      t('common.description'),
      mcp.description || t('common.noDescription'),
      width,
      descriptionBudget,
      { mutedValue: true }
    ),
  ].slice(0, viewportHeight);
}

export function mcpLocationDetailRows(
  entry: McpLocationEntry | undefined,
  collection: CollectedMcp[],
  width: number,
  viewportHeight: number
): CollectionDetailRow[] {
  if (!entry) return [{ text: t('mcp.selectToView'), muted: true }];
  const match = findCollectedByEndpoint(collection, entry.recipe);
  const title =
    entry.ownership === 'borrowed'
      ? `${t('mcp.borrowedMark')} ${entry.nativeKey}`
      : entry.nativeKey;
  const rows: CollectionDetailRow[] = [
    { text: title, bold: true },
    ...peekFieldRows(
      t('common.location'),
      `${entry.agent} · ${entry.scope === 'project' ? t('common.project') : t('common.global')}`,
      width,
      2
    ),
    ...peekFieldRows(
      t('common.collectionStatus'),
      match ? t('browser.inCollection') : t('browser.notInCollection'),
      width,
      1
    ),
    ...peekFieldRows(
      t('mcp.toggle'),
      entry.enabled ? t('mcp.enabled') : t('mcp.disabled'),
      width,
      1
    ),
  ];
  if (entry.borrowedFrom) {
    rows.push(
      ...peekFieldRows(
        t('common.source'),
        t('mcp.fromSource', { source: entry.borrowedFrom }),
        width,
        1
      )
    );
  }
  rows.push(
    ...peekFieldRows(t('mcp.endpoint'), recipeDisplayLine(entry.recipe), width, 2)
  );
  const description = match?.description?.trim();
  if (!description) return rows.slice(0, viewportHeight);
  return [
    ...rows,
    { text: '' },
    ...peekFieldRows(t('common.description'), description, width, Math.max(2, Math.floor(viewportHeight * 0.35)), {
      mutedValue: true,
    }),
  ].slice(0, viewportHeight);
}

export function mcpShortcutHelpSections(): ShortcutHelpSection[] {
  return [
    {
      id: 'nav',
      title: t('browser.helpNav'),
      items: [
        { label: t('mcp.helpNavMove'), keys: '↑/↓' },
        { label: t('mcp.helpNavTab'), keys: '←/→' },
        { label: t('mcp.helpNavAgent'), keys: '[ / ]' },
        { label: t('browser.helpNavGroup'), keys: 'g' },
        { label: t('mcp.helpNavFilter'), keys: '/' },
        { label: t('mcp.helpNavDetail'), keys: '→' },
      ],
    },
    {
      id: 'select',
      title: t('browser.helpSelect'),
      items: [
        { label: t('mcp.helpSelectToggle'), keys: 'Space' },
        { label: t('mcp.helpSelectEnter'), keys: 'Enter' },
      ],
    },
    {
      id: 'collect',
      title: t('browser.helpCollect'),
      items: [
        { label: t('mcp.helpCollectImport'), keys: 'i' },
        { label: t('mcp.helpMore'), keys: 'm' },
      ],
    },
    {
      id: 'maintain',
      title: t('browser.helpMaintain'),
      items: [
        { label: t('common.tags'), keys: 't' },
        { label: t('common.note'), keys: 'n' },
        { label: t('common.update'), keys: 'u' },
        { label: t('mcp.toggle'), keys: 'x' },
        { label: t('mcp.helpProbe'), keys: 'p' },
        { label: t('common.delete'), keys: 'd' },
      ],
    },
    {
      id: 'global',
      title: t('browser.helpGlobal'),
      items: [
        { label: t('browser.helpGlobalHelp'), keys: '?' },
        { label: t('browser.helpGlobalQuit'), keys: 'q' },
        { label: t('browser.helpGlobalEsc'), keys: 'Esc' },
      ],
    },
  ];
}
