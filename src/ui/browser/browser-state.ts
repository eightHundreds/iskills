/**
 * Compatibility re-exports. Navigation ownership lives in browser-app-store
 * (single Jotai owner for the browser app tree).
 */
export {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
  type BrowserNavigationState,
} from './browser-app-store.js';

export type { BrowserFocus, BrowserState, BrowserTab } from '../../contracts/browser.js';
