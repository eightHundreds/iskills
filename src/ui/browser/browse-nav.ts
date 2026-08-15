/**
 * Shared header navigation (tabs / agents / tags).
 * List and detail keys stay with each product surface.
 */
import type { BrowserFocus, BrowserTab } from './types.js';

export type BrowseArrow = 'up' | 'down' | 'left' | 'right';

export interface BrowseHeaderNav {
  tab: BrowserTab;
  focus: BrowserFocus;
  agent: string;
}

export interface BrowseHeaderContext {
  hasAgents: boolean;
  masterDetail: boolean;
  agentNames: string[];
}

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

export function wrapMainTab(tab: BrowserTab, direction: -1 | 1): BrowserTab {
  const order: BrowserTab[] = ['project', 'global', 'collection'];
  const index = Math.max(0, order.indexOf(tab));
  return order[(index + direction + order.length) % order.length] ?? tab;
}

export function wrapAgent(
  agents: string[],
  current: string,
  direction: -1 | 1
): string | undefined {
  if (!agents.length) return undefined;
  const index = agents.indexOf(current);
  const from = index < 0 ? 0 : index;
  return agents[(from + direction + agents.length) % agents.length];
}

export function arrowFromKeys(key: {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
}): BrowseArrow | undefined {
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  return undefined;
}

/**
 * Apply a header-row arrow. Returns null when the key belongs to the tag list
 * (↑/↓ on tags) or is not a header-row event.
 */
export function reduceBrowseHeaderArrow<T extends BrowseHeaderNav>(
  nav: T,
  arrow: BrowseArrow,
  ctx: BrowseHeaderContext
): T | null {
  if (nav.focus !== 'tabs' && nav.focus !== 'agents' && nav.focus !== 'tags') {
    return null;
  }
  const direction: -1 | 1 = arrow === 'left' ? -1 : 1;
  if (nav.focus === 'tabs') {
    if (arrow === 'down') {
      return { ...nav, focus: focusAfterDownFromTabs(ctx.hasAgents, ctx.masterDetail) };
    }
    if (arrow === 'left' || arrow === 'right') {
      const next = nextMainTab(nav.tab, direction);
      return next ? { ...nav, tab: next } : nav;
    }
    return nav;
  }
  if (nav.focus === 'agents') {
    if (arrow === 'up') return { ...nav, focus: 'tabs' };
    if (arrow === 'down') {
      return { ...nav, focus: focusAfterDownFromAgents(ctx.masterDetail) };
    }
    if (arrow === 'left' || arrow === 'right') {
      const next = nextAgent(ctx.agentNames, nav.agent || ctx.agentNames[0] || '', direction);
      return next ? { ...nav, agent: next } : nav;
    }
    return nav;
  }
  if (arrow === 'left') return { ...nav, focus: focusAfterUpFromTags(ctx.hasAgents) };
  if (arrow === 'right') return { ...nav, focus: 'list' };
  return null;
}

export function correctBrowseFocus(
  focus: BrowserFocus,
  ctx: {
    hasAgents: boolean;
    masterDetail: boolean;
    tab: BrowserTab;
    currentIsItem: boolean;
  }
): BrowserFocus {
  if (focus === 'agents' && !ctx.hasAgents) return ctx.masterDetail ? 'tags' : 'list';
  if ((focus === 'detail' || focus === 'tags') && !ctx.masterDetail) return 'list';
  if (focus === 'detail' && !ctx.currentIsItem) return 'list';
  if (focus === 'detail' && ctx.tab !== 'collection') return 'list';
  return focus;
}

export function clampBrowseCursor(cursor: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, cursor));
}
