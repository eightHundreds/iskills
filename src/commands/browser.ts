import type { BrowserTab } from '../contracts/browser.js';
import { runBrowserApp } from '../ui/browser/index.js';

export async function interactiveList(
  initialQuery = '',
  initialTab: BrowserTab = 'project'
): Promise<void> {
  await runBrowserApp(initialQuery, initialTab);
}
