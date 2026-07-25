import { atom, createStore, type PrimitiveAtom } from 'jotai';
import type { BrowserState, BrowserTab } from '../../contracts/browser.js';
import type {
  BrowserAppPhase,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
  BrowserStatusSnapshot,
  DetailViewContext,
  InAppPromptRequest,
  WorkingProgressSnapshot,
} from '../../contracts/browser-app.js';

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

export const browserDataAtom = atom<BrowserDataSnapshot | null>(null);
export const browserStatusAtom = atom<BrowserStatusSnapshot>({ text: '', transient: false });
export const browserPhaseAtom = atom<BrowserAppPhase>('browse');
/** Single owner for tab/query/cursor/agent/focus across the browser app tree. */
export const browserNavigationAtom = atom<BrowserNavigationState | null>(null);
export const browserSelectionAtom = atom<Set<string>>(new Set<string>());
export const detailContextAtom = atom<DetailViewContext | null>(null);
export const workingProgressAtom = atom<WorkingProgressSnapshot | null>(null);
export const inAppPromptAtom = atom<InAppPromptRequest | null>(null);
export const activeAbortAtom = atom<AbortController | null>(null);

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
  transient: boolean
): void {
  store.set(browserStatusAtom, { text, transient });
}

export function clearTransientStatus(store: BrowserAppStore): void {
  const status = store.get(browserStatusAtom);
  if (status.transient) store.set(browserStatusAtom, { text: '', transient: false });
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

export function requestInAppPrompt<T>(
  store: BrowserAppStore,
  promptAtom: PrimitiveAtom<InAppPromptRequest | null>,
  build: (resolve: (value: T) => void) => InAppPromptRequest
): Promise<T> {
  return new Promise((resolve) => {
    store.set(promptAtom, build((value) => {
      store.set(promptAtom, null);
      resolve(value);
    }));
  });
}
