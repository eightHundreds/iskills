/**
 * Pure footer view resolver (issue #7).
 * Priority: overlay → filter → (suppressed) → working → browse.
 */
import { textWidth, sliceColumns } from '../components/terminal-layout.js';
import type {
  FooterBrowseCapabilities,
  FooterItem,
  FooterResolveInput,
  FooterStatusKind,
  FooterView,
  FooterWorkingState,
} from './types.js';

export function formatFooterItem(item: FooterItem): string {
  return item.key ? `${item.key} ${item.label}` : item.label;
}

export function joinFooterItems(items: FooterItem[]): string {
  return items.map(formatFooterItem).join(' · ');
}

export function confirmFooterItems(defaultValue: boolean): FooterItem[] {
  // Match overlay/dialogs: y confirm, n cancel, Enter → defaultValue, Esc cancel.
  if (defaultValue) {
    return [
      { key: 'Enter', label: '确认' },
      { key: 'n', label: '取消' },
      { key: 'Esc', label: '取消' },
    ];
  }
  return [
    { key: 'y', label: '确认' },
    { key: 'Enter', label: '取消' },
    { key: 'Esc', label: '取消' },
  ];
}

export function infoFooterItems(): FooterItem[] {
  return [{ key: 'Esc', label: '关闭' }];
}

function helpQuit(): FooterItem[] {
  return [
    { key: '?', label: '帮助' },
    { key: 'q', label: '退出' },
  ];
}

/** Browse filter is always available from the browser key handler. */
function filterHelp(): FooterItem[] {
  return [{ key: '/', label: '筛选' }];
}

function browseItems(browse: FooterBrowseCapabilities): FooterItem[] {
  if (browse.focus === 'tabs') {
    return [
      { key: '←→', label: '切换' },
      { key: '↓', label: '进入' },
      ...filterHelp(),
      ...helpQuit(),
    ];
  }
  if (browse.focus === 'agents') {
    return [
      { key: '←→', label: '切换' },
      { key: '↑', label: '返回' },
      { key: '↓', label: '进入' },
      ...filterHelp(),
      ...helpQuit(),
    ];
  }
  if (browse.focus === 'tags') {
    return [
      { key: '↑↓', label: '移动' },
      { key: '→', label: '列表' },
      { key: 'Space', label: '选中' },
      ...filterHelp(),
      ...helpQuit(),
    ];
  }

  // List: lead with selection so next-step is obvious on first glance.
  const items: FooterItem[] = [{ key: 'Space', label: '选中' }];
  if (browse.canDelete) items.push({ key: 'd', label: '删除' });
  if (browse.enterAction === 'add') items.push({ key: 'Enter', label: '添加' });
  else if (browse.enterAction === 'detail') items.push({ key: 'Enter', label: '详情' });
  else if (browse.enterAction === 'view') items.push({ key: 'Enter', label: '查看' });
  if (browse.canImport) items.push({ key: 'i', label: '收藏' });
  if (browse.canMaterialize) items.push({ key: 'm', label: '更多' });
  if (browse.canTag) items.push({ key: 't', label: '标签' });
  if (browse.updateCount > 0) {
    items.push({
      key: 'u',
      label: browse.updateIsSelection && browse.updateCount > 0
        ? `更新(${browse.updateCount})`
        : '更新',
    });
  }
  if (browse.selectionCount > 0) {
    items.push({ label: `已选 ${browse.selectionCount}` });
  }
  items.push(...filterHelp(), ...helpQuit());
  return items;
}

function workingStatus(working: FooterWorkingState): string {
  const progress =
    working.total > 1 || working.action === '转换'
      ? ` ${working.current}/${working.total}`
      : '';
  return `正在${working.action}${progress}`;
}

function rightStatus(input: FooterResolveInput): { text: string; kind: FooterStatusKind } | undefined {
  if (input.working) {
    return { text: workingStatus(input.working), kind: 'progress' };
  }
  if (input.status?.text) {
    return { text: input.status.text, kind: input.status.kind };
  }
  if (input.updateCheck) {
    if (input.updateCheck.failed > 0) {
      return { text: `${input.updateCheck.failed} 个检查失败`, kind: 'error' };
    }
    if (input.updateCheck.checking) {
      return { text: '检查更新中', kind: 'normal' };
    }
  }
  return undefined;
}

/** Drop secondary items first; keep help/quit/selection/primary when possible. */
export function truncateFooterItems(items: FooterItem[], maxWidth: number): FooterItem[] {
  if (maxWidth <= 0) return items;
  let current = items;
  while (current.length > 0 && textWidth(joinFooterItems(current)) > maxWidth) {
    if (current.length === 1) {
      return current;
    }
    // Drop from the left, but never drop trailing help/quit if others remain.
    const last = current[current.length - 1];
    const secondLast = current[current.length - 2];
    const protectTail =
      last?.key === 'q' || last?.key === '?' || secondLast?.key === '?' || secondLast?.key === 'q';
    if (protectTail && current.length > 2) {
      current = current.slice(1);
    } else {
      current = current.slice(0, -1);
    }
  }
  return current;
}

export function resolveFooter(input: FooterResolveInput): FooterView {
  if (input.overlayItems) {
    return { mode: 'keys', items: input.overlayItems };
  }

  if (input.filterOpen) {
    return { mode: 'input', label: '筛选: ', value: input.filterDraft };
  }

  if (input.suppressed) {
    return { mode: 'empty' };
  }

  if (input.working) {
    const items = input.workingItems ?? [];
    const status = rightStatus(input);
    return {
      mode: 'keys',
      items,
      ...(status ? { status: status.text, statusKind: status.kind } : {}),
    };
  }

  if (input.browse) {
    let items = browseItems(input.browse);
    const status = rightStatus(input);
    if (input.columns && input.columns > 0) {
      const statusWidth = status ? textWidth(status.text) + 2 : 0;
      const leftMax = Math.max(8, input.columns - statusWidth);
      items = truncateFooterItems(items, leftMax);
    }
    let statusText = status?.text;
    if (statusText && input.columns && input.columns > 0) {
      const leftWidth = textWidth(joinFooterItems(items));
      const budget = Math.max(4, input.columns - leftWidth - 2);
      if (textWidth(statusText) > budget) {
        statusText = sliceColumns(statusText, 0, budget);
      }
    }
    return {
      mode: 'keys',
      items,
      ...(statusText && status
        ? { status: statusText, statusKind: status.kind }
        : {}),
    };
  }

  return { mode: 'empty' };
}
