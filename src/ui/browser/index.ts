/** Browser TUI package — fullscreen skill browser. */

export { runBrowserApp, BrowserApp } from './browser-app.js';
export {
  Browser,
  Detail,
  browserFrameDimensions,
  detailFrameDimensions,
  masterDetailLayout,
  type BrowserFrameDimensions,
  type DetailAction,
} from './browser.js';
export {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
  createBrowserAppStore,
  type BrowserNavigationState,
  type BrowserAppStore,
} from './browser-app-store.js';
export type { BrowserFocus, BrowserState, BrowserTab } from '../../contracts/browser.js';
