/**
 * Shared browse session: focus ladder, header arrows, tag sidebar, list column.
 * Product actions (import / delete / login / …) stay at each host.
 */
import { useEffect, useRef, type MutableRefObject, type SetStateAction } from 'react';
import type { BrowserFocus, BrowserTab } from './types.js';
import {
  TAG_FILTER_ALL,
  type BrowseTagOption,
} from './format.js';
import {
  arrowFromKeys,
  clampBrowseCursor,
  correctBrowseFocus,
  focusAfterUpFromList,
  focusAfterUpFromTags,
  reduceBrowseHeaderArrow,
  type BrowseArrow,
} from './browse-nav.js';

export interface BrowseSessionNav {
  tab: BrowserTab;
  focus: BrowserFocus;
  agent: string;
  cursor: number;
}

export interface BrowseSessionSnapshot<T extends BrowseSessionNav = BrowseSessionNav> {
  nav: T;
  tagFilter: string;
  tagCursor: number;
  selected: Set<string>;
  detailFieldIndex: number;
}

export interface BrowseSessionContext {
  hasAgents: boolean;
  masterDetail: boolean;
  projectAgentNames: string[];
  globalAgentNames: string[];
  tagOptions: BrowseTagOption[];
  listLength: number;
  /** Ids to toggle when Space is pressed on the current list row. */
  currentItemIds: string[];
  currentIsItem: boolean;
  allowNarrowGroupJump: boolean;
  detailFieldCount: number;
}

function agentNamesFor(tab: BrowserTab, ctx: BrowseSessionContext): string[] {
  if (tab === 'project') return ctx.projectAgentNames;
  if (tab === 'global') return ctx.globalAgentNames;
  return [];
}

export interface BrowseSessionPatch<T extends BrowseSessionNav = BrowseSessionNav> {
  nav?: T;
  tagFilter?: string;
  tagCursor?: number;
  selected?: Set<string>;
  detailFieldIndex?: number;
  choosingGroup?: boolean;
}

export type BrowseSessionKeyResult<T extends BrowseSessionNav = BrowseSessionNav> =
  | { handled: true; patch: BrowseSessionPatch<T> }
  | { handled: false };

export function toggleSelectedIds(selected: Set<string>, ids: string[]): Set<string> {
  if (!ids.length) return selected;
  const next = new Set(selected);
  const allSelected = ids.every((id) => selected.has(id));
  for (const id of ids) allSelected ? next.delete(id) : next.add(id);
  return next;
}

export function browseTagOffset(
  tagCursor: number,
  tagCount: number,
  viewportHeight: number
): number {
  const active = Math.max(0, Math.min(tagCursor, Math.max(0, tagCount - 1)));
  return Math.max(
    0,
    Math.min(active - Math.floor(viewportHeight / 2), Math.max(0, tagCount - viewportHeight))
  );
}

export function browseListIndexFromLine(
  visibleIndex: number,
  skillOffset: number,
  listLength: number
): number | undefined {
  const index = skillOffset + Math.floor(visibleIndex / 2);
  if (index < 0 || index >= listLength) return undefined;
  return index;
}

function isEnter(input: string, key: { return?: boolean }): boolean {
  return Boolean(key.return || input.includes('\r') || input.includes('\n'));
}

function applyTagSelect<T extends BrowseSessionNav>(
  nav: T,
  tagOptions: BrowseTagOption[],
  index: number,
  extra: Partial<BrowseSessionPatch<T>> = {}
): BrowseSessionPatch<T> {
  const option = tagOptions[index];
  if (!option) return extra;
  const base = extra.nav ?? nav;
  return {
    ...extra,
    nav: { ...base, cursor: 0 },
    tagFilter: option.key,
    tagCursor: index,
  };
}

/**
 * Consume header / tag / list / detail-field keys.
 * Returns handled:false for product keys (Enter add, i/d/u, login, …).
 */
export function reduceBrowseSessionKey<T extends BrowseSessionNav>(
  snapshot: BrowseSessionSnapshot<T>,
  input: string,
  key: {
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    return?: boolean;
  },
  ctx: BrowseSessionContext
): BrowseSessionKeyResult<T> {
  const { nav, tagFilter, tagCursor, selected, detailFieldIndex } = snapshot;
  const liveFocus = nav.focus;
  const tagOptions = ctx.tagOptions;
  const hasAgents = agentNamesFor(nav.tab, ctx).length > 0;

  if (input === 'g') {
    if (ctx.masterDetail && tagOptions.length > 0) {
      const index = Math.max(
        0,
        tagOptions.findIndex((option) => option.key === tagFilter)
      );
      return {
        handled: true,
        patch: { nav: { ...nav, focus: 'tags' }, tagCursor: index },
      };
    }
    if (ctx.allowNarrowGroupJump) {
      return { handled: true, patch: { choosingGroup: true } };
    }
    return { handled: true, patch: {} };
  }

  if (key.downArrow || key.upArrow || key.leftArrow || key.rightArrow) {
    if (liveFocus === 'tabs' || liveFocus === 'agents' || liveFocus === 'tags') {
      const arrow = arrowFromKeys(key) as BrowseArrow | undefined;
      if (arrow) {
        const next = reduceBrowseHeaderArrow(nav, arrow, {
          hasAgents,
          masterDetail: ctx.masterDetail,
          agentNames: agentNamesFor(nav.tab, ctx),
        });
        if (next) return { handled: true, patch: { nav: next } };
      }
      if (liveFocus !== 'tags' || key.leftArrow || key.rightArrow) {
        return { handled: true, patch: {} };
      }
    }
  }

  if (liveFocus === 'tabs' || liveFocus === 'agents') {
    return { handled: true, patch: {} };
  }

  if (liveFocus === 'tags') {
    if (key.upArrow) {
      if (tagCursor === 0) {
        return {
          handled: true,
          patch: { nav: { ...nav, focus: focusAfterUpFromTags(hasAgents) } },
        };
      }
      return { handled: true, patch: applyTagSelect(nav, tagOptions, tagCursor - 1) };
    }
    if (key.downArrow) {
      if (tagCursor >= tagOptions.length - 1) {
        return { handled: true, patch: { nav: { ...nav, focus: 'list' } } };
      }
      return { handled: true, patch: applyTagSelect(nav, tagOptions, tagCursor + 1) };
    }
    if (key.leftArrow) {
      return {
        handled: true,
        patch: { nav: { ...nav, focus: focusAfterUpFromTags(hasAgents) } },
      };
    }
    if (key.rightArrow) {
      return {
        handled: true,
        patch: applyTagSelect(nav, tagOptions, tagCursor, {
          nav: { ...nav, focus: 'list', cursor: 0 },
        }),
      };
    }
    const tagOption = tagOptions[tagCursor];
    if (input === ' ' && tagOption) {
      return {
        handled: true,
        patch: { selected: toggleSelectedIds(selected, tagOption.ids) },
      };
    }
    if (isEnter(input, key)) {
      return {
        handled: true,
        patch: applyTagSelect(nav, tagOptions, tagCursor, {
          nav: { ...nav, focus: 'list', cursor: 0 },
        }),
      };
    }
    return { handled: true, patch: {} };
  }

  if (liveFocus === 'detail') {
    if (key.leftArrow) {
      return { handled: true, patch: { nav: { ...nav, focus: 'list' } } };
    }
    if (key.upArrow) {
      if (!ctx.detailFieldCount) return { handled: true, patch: {} };
      return {
        handled: true,
        patch: { detailFieldIndex: Math.max(0, detailFieldIndex - 1) },
      };
    }
    if (key.downArrow) {
      if (!ctx.detailFieldCount) return { handled: true, patch: {} };
      return {
        handled: true,
        patch: {
          detailFieldIndex: Math.min(ctx.detailFieldCount - 1, detailFieldIndex + 1),
        },
      };
    }
    if (key.rightArrow) return { handled: true, patch: {} };
    return { handled: false };
  }

  if (liveFocus !== 'list') return { handled: false };

  if (key.leftArrow && ctx.masterDetail) {
    return { handled: true, patch: { nav: { ...nav, focus: 'tags' } } };
  }
  if (key.upArrow) {
    if (nav.cursor === 0) {
      return {
        handled: true,
        patch: {
          nav: { ...nav, focus: focusAfterUpFromList(ctx.masterDetail, hasAgents) },
        },
      };
    }
    return { handled: true, patch: { nav: { ...nav, cursor: nav.cursor - 1 } } };
  }
  if (key.downArrow) {
    return {
      handled: true,
      patch: {
        nav: {
          ...nav,
          cursor: Math.min(Math.max(0, ctx.listLength - 1), nav.cursor + 1),
        },
      },
    };
  }
  if (input === ' ' && ctx.currentItemIds.length) {
    return {
      handled: true,
      patch: { selected: toggleSelectedIds(selected, ctx.currentItemIds) },
    };
  }
  if (key.rightArrow && ctx.currentIsItem && nav.tab === 'collection' && ctx.masterDetail) {
    return {
      handled: true,
      patch: { nav: { ...nav, focus: 'detail' }, detailFieldIndex: 0 },
    };
  }
  if (isEnter(input, key) && ctx.masterDetail) {
    if (nav.tab === 'collection' && ctx.currentIsItem) {
      return {
        handled: true,
        patch: { nav: { ...nav, focus: 'detail' }, detailFieldIndex: 0 },
      };
    }
    return { handled: true, patch: {} };
  }
  return { handled: false };
}

export function applyBrowseSessionPatch<T extends BrowseSessionNav>(
  patch: BrowseSessionPatch<T>,
  io: {
    setNav: (nav: T) => void;
    setTagFilter: (key: string) => void;
    setTagCursor: (index: number) => void;
    setSelected: (selected: Set<string>) => void;
    setDetailFieldIndex: (index: number) => void;
    setChoosingGroup?: (open: boolean) => void;
    tagCursorRef?: MutableRefObject<number>;
    detailFieldIndexRef?: MutableRefObject<number>;
    cursorRef?: MutableRefObject<number>;
  }
): void {
  if (patch.nav) {
    if (io.cursorRef && patch.nav.cursor !== undefined) io.cursorRef.current = patch.nav.cursor;
    io.setNav(patch.nav);
  }
  if (patch.tagFilter !== undefined) io.setTagFilter(patch.tagFilter);
  if (patch.tagCursor !== undefined) {
    if (io.tagCursorRef) io.tagCursorRef.current = patch.tagCursor;
    io.setTagCursor(patch.tagCursor);
  }
  if (patch.selected) io.setSelected(patch.selected);
  if (patch.detailFieldIndex !== undefined) {
    if (io.detailFieldIndexRef) io.detailFieldIndexRef.current = patch.detailFieldIndex;
    io.setDetailFieldIndex(patch.detailFieldIndex);
  }
  if (patch.choosingGroup && io.setChoosingGroup) io.setChoosingGroup(true);
}

export function browseSessionClickTag<T extends BrowseSessionNav>(
  nav: T,
  tagOptions: BrowseTagOption[],
  absoluteIndex: number
): BrowseSessionPatch<T> | undefined {
  const option = tagOptions[absoluteIndex];
  if (!option) return undefined;
  return {
    nav: { ...nav, focus: 'tags', cursor: 0 },
    tagFilter: option.key,
    tagCursor: absoluteIndex,
  };
}

export function browseSessionClickList<T extends BrowseSessionNav>(
  nav: T,
  index: number
): BrowseSessionPatch<T> {
  return { nav: { ...nav, focus: 'list', cursor: index } };
}

export function browseSessionScrollList<T extends BrowseSessionNav>(
  nav: T,
  delta: number,
  listLength: number
): BrowseSessionPatch<T> {
  const cursor = Math.max(0, Math.min(Math.max(0, listLength - 1), nav.cursor + delta));
  return { nav: { ...nav, focus: 'list', cursor } };
}

export function browseSessionClickDetail<T extends BrowseSessionNav>(
  nav: T,
  fieldIndex: number
): BrowseSessionPatch<T> {
  return { nav: { ...nav, focus: 'detail' }, detailFieldIndex: fieldIndex };
}

/** Reset cursor/selection/tags on tab or agent change; keep focus/cursor legal. */
export function useBrowseSessionEffects(input: {
  tab: BrowserTab;
  agent: string;
  focus: BrowserFocus;
  cursor: number;
  listLength: number;
  hasAgents: boolean;
  masterDetail: boolean;
  currentIsItem: boolean;
  setFocus: (focus: BrowserFocus) => void;
  setCursor: (value: SetStateAction<number>) => void;
  setSelected: (selected: Set<string>) => void;
  setTagFilter: (key: string) => void;
  setTagCursor: (index: number) => void;
}): void {
  const previousTab = useRef(input.tab);
  const previousAgent = useRef(input.agent);
  const setters = useRef(input);
  setters.current = input;

  useEffect(() => {
    if (previousTab.current === input.tab) return;
    previousTab.current = input.tab;
    const io = setters.current;
    io.setCursor(0);
    io.setSelected(new Set());
    io.setTagFilter(TAG_FILTER_ALL);
    io.setTagCursor(0);
  }, [input.tab]);
  useEffect(() => {
    if (previousAgent.current === input.agent) return;
    previousAgent.current = input.agent;
    const io = setters.current;
    io.setCursor(0);
    io.setTagFilter(TAG_FILTER_ALL);
    io.setTagCursor(0);
  }, [input.agent]);
  useEffect(() => {
    const next = correctBrowseFocus(input.focus, {
      hasAgents: input.hasAgents,
      masterDetail: input.masterDetail,
      tab: input.tab,
      currentIsItem: input.currentIsItem,
    });
    if (next !== input.focus) setters.current.setFocus(next);
  }, [
    input.focus,
    input.hasAgents,
    input.masterDetail,
    input.tab,
    input.currentIsItem,
  ]);
  useEffect(() => {
    const next = clampBrowseCursor(input.cursor, input.listLength);
    if (next !== input.cursor) setters.current.setCursor(next);
  }, [input.cursor, input.listLength]);
}
