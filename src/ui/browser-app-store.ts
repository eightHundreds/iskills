import { atom, createStore, type PrimitiveAtom } from 'jotai';
import type { BrowserTab } from '../contracts/browser.js';
import type {
  BrowserAppPhase,
  BrowserDataSnapshot,
  BrowserNavigationSnapshot,
  BrowserStatusSnapshot,
  DetailViewContext,
  InAppPromptRequest,
  WorkingProgressSnapshot,
} from '../contracts/browser-app.js';

export function initialNavigation(
  initialQuery: string,
  initialTab: BrowserTab
): BrowserNavigationSnapshot {
  return {
    query: initialQuery,
    tab: initialTab,
    cursor: 0,
    selected: [],
    agent: '',
    focus: initialTab === 'collection' ? 'list' : 'tabs',
  };
}

export const browserDataAtom = atom<BrowserDataSnapshot | null>(null);
export const browserStatusAtom = atom<BrowserStatusSnapshot>({ text: '', transient: false });
export const browserPhaseAtom = atom<BrowserAppPhase>('browse');
export const browserNavigationAtom = atom<BrowserNavigationSnapshot | null>(null);
export const detailContextAtom = atom<DetailViewContext | null>(null);
export const workingProgressAtom = atom<WorkingProgressSnapshot | null>(null);
export const browserScreenKeyAtom = atom(0);
export const inAppPromptAtom = atom<InAppPromptRequest | null>(null);
export const activeAbortAtom = atom<AbortController | null>(null);

export type BrowserAppStore = ReturnType<typeof createBrowserAppStore>;

export function createBrowserAppStore(
  initialQuery: string,
  initialTab: BrowserTab
): ReturnType<typeof createStore> {
  const store = createStore();
  store.set(browserNavigationAtom, initialNavigation(initialQuery, initialTab));
  return store;
}

export function bumpBrowserScreen(store: BrowserAppStore): void {
  store.set(browserScreenKeyAtom, store.get(browserScreenKeyAtom) + 1);
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
  return navigation;
}

export function writeNavigation(
  store: BrowserAppStore,
  navigation: BrowserNavigationSnapshot
): void {
  store.set(browserNavigationAtom, navigation);
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
