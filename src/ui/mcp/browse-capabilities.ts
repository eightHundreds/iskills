import type { FooterBrowseCapabilities, FooterItem } from '../footer/types.js';
import { t } from '../../i18n/index.js';

export interface McpFooterSnapshot {
  browse: FooterBrowseCapabilities;
  extraListItems: FooterItem[];
  extraDetailItems: FooterItem[];
}

export function computeMcpBrowseCapabilities(input: {
  tab: 'project' | 'global' | 'collection';
  focus: FooterBrowseCapabilities['focus'];
  masterDetail: boolean;
  selectionCount: number;
  currentIsItem: boolean;
  canDelete: boolean;
  canImport: boolean;
  canToggle: boolean;
  canUpdate: boolean;
  canTag: boolean;
  canLogin: boolean;
  canRename: boolean;
  hasTagGroups: boolean;
}): McpFooterSnapshot {
  const enterAction = input.tab === 'collection' && input.currentIsItem ? 'add' : null;
  const extraListItems: FooterItem[] = [];
  if (input.canToggle) extraListItems.push({ key: 'x', label: t('mcp.toggle') });
  if (input.canRename) extraListItems.push({ key: 'r', label: t('mcp.rename') });
  if (input.canLogin) extraListItems.push({ key: 'l', label: t('mcp.login') });
  const extraDetailItems: FooterItem[] = [];
  return {
    browse: {
      focus: input.focus,
      canDelete: input.focus === 'list' && input.canDelete,
      enterAction,
      canTag: input.tab === 'collection' && input.canTag,
      canImport: input.canImport,
      canMaterialize: false,
      updateCount: input.tab === 'collection' && input.canUpdate ? 1 : 0,
      updateIsSelection: false,
      selectionCount: input.selectionCount,
      canFocusDetail: false,
      detailEnterAction: null,
      canJumpTag: false,
    },
    extraListItems,
    extraDetailItems,
  };
}

export function selectedOrCurrent<T>(selected: T[], current: T | undefined): T[] {
  if (selected.length) return selected;
  return current ? [current] : [];
}
