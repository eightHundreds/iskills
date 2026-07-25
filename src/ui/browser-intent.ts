import type { BrowserFocus, BrowserTab } from '../contracts/browser.js';

/**
 * Pure focus-ladder helpers for the skill browser.
 * Key → next focus decisions live here; Ink input wiring stays in the view.
 */

export type BrowseFocusLevel = BrowserFocus;

export function focusAfterDownFromTabs(hasAgentTabs: boolean, useMasterDetail: boolean): BrowserFocus {
  if (hasAgentTabs) return 'agents';
  if (useMasterDetail) return 'tags';
  return 'list';
}

export function focusAfterUpFromList(useMasterDetail: boolean, hasAgentTabs: boolean): BrowserFocus {
  if (useMasterDetail) return 'tags';
  return hasAgentTabs ? 'agents' : 'tabs';
}

export function focusAfterUpFromTags(hasAgentTabs: boolean): BrowserFocus {
  return hasAgentTabs ? 'agents' : 'tabs';
}

export function focusAfterDownFromAgents(useMasterDetail: boolean): BrowserFocus {
  return useMasterDetail ? 'tags' : 'list';
}

export function nextMainTab(tab: BrowserTab, direction: -1 | 1): BrowserTab | undefined {
  const order: BrowserTab[] = ['project', 'global', 'collection'];
  const index = order.indexOf(tab);
  return order[index + direction];
}

export function nextAgent(
  agents: string[],
  current: string,
  direction: -1 | 1
): string | undefined {
  const index = agents.indexOf(current);
  if (index < 0) return agents[0];
  return agents[index + direction];
}
