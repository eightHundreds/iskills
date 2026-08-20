import type { DetailFieldId } from '../browser/types.js';
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
  hasTagGroups: boolean;
  detailField?: DetailFieldId;
}): McpFooterSnapshot {
  const enterAction = input.tab === 'collection' && input.currentIsItem ? 'add' : null;
  const extraListItems: FooterItem[] = [];
  if (input.canToggle) extraListItems.push({ key: 'x', label: t('mcp.toggle') });
  const extraDetailItems: FooterItem[] = [];
  const detailEnterAction: FooterBrowseCapabilities['detailEnterAction'] =
    input.focus === 'detail' && input.tab === 'collection'
      ? input.detailField === 'login'
        ? 'login'
        : 'edit'
      : null;
  return {
    browse: {
      focus: input.focus,
      canDelete: input.focus === 'list' && input.canDelete,
      enterAction,
      canTag: input.tab === 'collection' && input.canTag,
      canImport: input.canImport,
      canMaterialize: false,
      canMore: input.focus === 'list',
      updateCount: input.tab === 'collection' && input.canUpdate ? 1 : 0,
      updateIsSelection: false,
      selectionCount: input.selectionCount,
      canFocusDetail:
        input.focus === 'list' &&
        input.masterDetail &&
        input.tab === 'collection' &&
        input.currentIsItem,
      detailEnterAction,
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
