/** Browser TUI package — fullscreen skill browser. */

export { runBrowserApp, BrowserApp } from './browser-app.js';
export {
  Browser,
  Detail,
  type DetailAction,
} from './browser.js';
export {
  browserFrameDimensions,
  detailFrameDimensions,
  masterDetailLayout,
  type BrowserFrameDimensions,
} from './browser-layout.js';
export {
  browserNavigationAtom,
  browserSelectionAtom,
  createBrowserStore,
  createBrowserAppStore,
  type BrowserNavigationState,
  type BrowserAppStore,
} from './browser-app-store.js';
