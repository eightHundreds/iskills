import { atom, createStore } from 'jotai';
import type { BrowserState } from '../contracts/browser.js';

export type { BrowserFocus, BrowserState, BrowserTab } from '../contracts/browser.js';

export type BrowserNavigationState = Omit<BrowserState, 'selected'>;

export const browserNavigationAtom = atom<BrowserNavigationState>({
  tab: 'project',
  query: '',
  cursor: 0,
  agent: '',
  focus: 'tabs',
});

export const browserSelectionAtom = atom<Set<string>>(new Set<string>());

export function createBrowserStore(state: BrowserState): ReturnType<typeof createStore> {
  const store = createStore();
  const { selected, ...navigation } = state;
  store.set(browserNavigationAtom, navigation);
  store.set(browserSelectionAtom, new Set(selected));
  return store;
}
