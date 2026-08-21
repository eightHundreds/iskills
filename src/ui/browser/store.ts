import { atom, createStore } from 'jotai';
import type {
  BrowserAppPhase,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
  BrowserState,
  BrowserStatusSnapshot,
  BrowserTab,
  DetailFieldId,
  DetailViewContext,
  WorkingProgressSnapshot,
} from './types.js';
import type { BrowserHealthAlert } from './health.js';

/** Navigation without multi-select — selection is a separate atom. */
export type BrowserNavigationState = Omit<BrowserState, 'selected'>;

export function initialNavigation(
  initialQuery: string,
  initialTab: BrowserTab
): BrowserNavigationState {
  return {
    query: initialQuery,
    tab: initialTab,
    cursor: 0,
    agent: '',
    focus: initialTab === 'collection' ? 'list' : 'tabs',
  };
}

export interface BrowserFilterState {
  open: boolean;
  draft: string;
  queryBefore: string;
  cursorBefore: number;
}

export interface BrowserUpdateCheckState {
  checking: boolean;
  updates: Set<string>;
  failed: number;
  /** Bumped to drop in-flight `checkUpdates` results that would restore stale ↑. */
  generation: number;
}

export const browserDataAtom = atom<BrowserDataSnapshot | null>(null);
export const browserStatusAtom = atom<BrowserStatusSnapshot>({
  kind: 'normal',
  text: '',
  transient: false,
});
export const browserPhaseAtom = atom<BrowserAppPhase>('browse');
/** Single owner for tab/query/cursor/agent/focus across the browser app tree. */
export const browserNavigationAtom = atom<BrowserNavigationState | null>(null);
export const browserSelectionAtom = atom<Set<string>>(new Set<string>());
/** Focused peek field while navigation.focus === 'detail' (footer + chrome). */
export const browserDetailFieldAtom = atom<DetailFieldId | undefined>(undefined);
export const detailContextAtom = atom<DetailViewContext | null>(null);
export const workingProgressAtom = atom<WorkingProgressSnapshot | null>(null);
export const activeAbortAtom = atom<AbortController | null>(null);
export const browserFilterAtom = atom<BrowserFilterState>({
  open: false,
  draft: '',
  queryBefore: '',
  cursorBefore: 0,
});
export const browserGroupJumpAtom = atom(false);
/** Tag sidebar filter key; must match Browser listRows (see TAG_FILTER_ALL). */
export const browserTagFilterAtom = atom<string>('__all__');
export const browserUpdateCheckAtom = atom<BrowserUpdateCheckState>({
  checking: false,
  updates: new Set<string>(),
  failed: 0,
  generation: 0,
});

/** Live health issues for the footer ⚠ entry (async probe; empty until first probe). */
export const browserHealthAtom = atom<BrowserHealthAlert[]>([]);

export type BrowserAppStore = ReturnType<typeof createBrowserAppStore>;

export function createBrowserAppStore(
  initialQuery: string,
  initialTab: BrowserTab
): ReturnType<typeof createStore> {
  const store = createStore();
  store.set(browserNavigationAtom, initialNavigation(initialQuery, initialTab));
  store.set(browserSelectionAtom, new Set());
  return store;
}

/** Test / isolated-store helper — same atoms as the app owner. */
export function createBrowserStore(state: BrowserState): ReturnType<typeof createStore> {
  const store = createStore();
  const { selected, ...navigation } = state;
  store.set(browserNavigationAtom, navigation);
  store.set(browserSelectionAtom, new Set(selected));
  return store;
}

export function setBrowserStatus(
  store: BrowserAppStore,
  text: string,
  transient: boolean,
  kind?: 'normal' | 'error'
): void {
  const resolvedKind =
    kind ?? (text && !transient ? 'error' : 'normal');
  store.set(browserStatusAtom, { text, transient, kind: resolvedKind });
}

export function clearTransientStatus(store: BrowserAppStore): void {
  const status = store.get(browserStatusAtom);
  if (status.transient) {
    store.set(browserStatusAtom, { kind: 'normal', text: '', transient: false });
  }
}

export function invalidateUpdateCheck(store: BrowserAppStore): void {
  const current = store.get(browserUpdateCheckAtom);
  store.set(browserUpdateCheckAtom, {
    checking: false,
    updates: new Set<string>(),
    failed: 0,
    generation: current.generation + 1,
  });
}

/** Keep current ↑ set; ignore in-flight checks. */
export function discardStaleUpdateCheck(store: BrowserAppStore): void {
  const current = store.get(browserUpdateCheckAtom);
  store.set(browserUpdateCheckAtom, {
    ...current,
    checking: false,
    generation: current.generation + 1,
  });
}

/** Drop ↑ for these names. Does not discard in-flight checks. */
export function markSkillsCurrent(store: BrowserAppStore, names: readonly string[]): void {
  if (!names.length) return;
  const current = store.get(browserUpdateCheckAtom);
  const updates = new Set(current.updates);
  let changed = false;
  for (const name of names) {
    if (updates.delete(name)) changed = true;
  }
  if (!changed) return;
  store.set(browserUpdateCheckAtom, { ...current, updates });
}

/** Fire-and-forget health refresh for footer ⚠ (never blocks UI). */
export function scheduleHealthRefresh(store: BrowserAppStore): void {
  void import('./health.js').then(({ loadHealthAlerts }) =>
    loadHealthAlerts().then((alerts) => {
      store.set(browserHealthAtom, alerts);
    })
  );
}

export function readNavigation(store: BrowserAppStore): BrowserNavigationSnapshot {
  const navigation = store.get(browserNavigationAtom);
  if (!navigation) throw new Error('browser navigation is not initialized');
  return {
    ...navigation,
    selected: [...store.get(browserSelectionAtom)],
  };
}

export function writeNavigation(
  store: BrowserAppStore,
  navigation: BrowserNavigationSnapshot
): void {
  const { selected, ...rest } = navigation;
  store.set(browserNavigationAtom, rest);
  store.set(browserSelectionAtom, new Set(selected));
}
