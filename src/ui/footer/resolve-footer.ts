/**
 * Pure footer view resolver (issue #7).
 * Priority: overlay → filter → (suppressed) → working → browse.
 */
import { ellipsizeColumns, textWidth } from '../components/terminal-layout.js';
import type {
  FooterBrowseCapabilities,
  FooterItem,
  FooterResolveInput,
  FooterStatusAction,
  FooterStatusKind,
  FooterView,
  FooterWorkingState,
} from './types.js';
import { t } from '../../i18n/index.js';

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
      { key: 'Enter', label: t('common.confirm') },
      { key: 'n', label: t('common.cancel') },
      { key: 'Esc', label: t('common.cancel') },
    ];
  }
  return [
    { key: 'y', label: t('common.confirm') },
    { key: 'Enter', label: t('common.cancel') },
    { key: 'Esc', label: t('common.cancel') },
  ];
}

export function infoFooterItems(): FooterItem[] {
  return [{ key: 'Esc', label: t('common.close') }];
}

function helpQuit(): FooterItem[] {
  return [
    { key: '?', label: t('common.help') },
    { key: 'q', label: t('common.quit') },
  ];
}

/** Browse filter is always available from the browser key handler. */
function filterHelp(): FooterItem[] {
  return [{ key: '/', label: t('common.filter') }];
}

function browseItems(
  browse: FooterBrowseCapabilities,
  extraListItems: FooterItem[] = [],
  extraDetailItems: FooterItem[] = []
): FooterItem[] {
  if (browse.focus === 'tabs') {
    return [
      { key: '←→', label: t('common.switch') },
      { key: '↓', label: t('common.enter') },
      ...filterHelp(),
      ...helpQuit(),
    ];
  }
  if (browse.focus === 'agents') {
    return [
      { key: '←→', label: t('common.switch') },
      { key: '↑', label: t('common.back') },
      { key: '↓', label: t('common.enter') },
      ...filterHelp(),
      ...helpQuit(),
    ];
  }
  if (browse.focus === 'tags') {
    return [
      { key: '↑↓', label: t('common.move') },
      { key: '→', label: t('common.list') },
      { key: 'Space', label: t('common.select') },
      ...filterHelp(),
      ...helpQuit(),
    ];
  }
  if (browse.focus === 'detail') {
    const items: FooterItem[] = [{ key: '↑↓', label: t('common.move') }];
    if (browse.detailEnterAction === 'open') items.push({ key: 'Enter', label: t('common.enter') });
    else if (browse.detailEnterAction === 'edit') items.push({ key: 'Enter', label: t('common.edit') });
    else if (browse.detailEnterAction === 'login') items.push({ key: 'Enter', label: t('mcp.login') });
    items.push(
      ...extraDetailItems,
      { key: '←', label: t('common.list') },
      ...filterHelp(),
      ...helpQuit()
    );
    return items;
  }

  // List: lead with selection so next-step is obvious on first glance.
  const items: FooterItem[] = [{ key: 'Space', label: t('common.select') }];
  if (browse.canDelete) items.push({ key: 'd', label: t('common.delete') });
  if (browse.enterAction === 'add') items.push({ key: 'Enter', label: t('common.add') });
  else if (browse.enterAction === 'detail' && browse.canFocusDetail) {
    // Wide collection: Enter and → both focus the detail column — one footer item.
    items.push({ key: 'Enter/→', label: t('common.detail') });
  } else if (browse.enterAction === 'detail') {
    items.push({ key: 'Enter', label: t('common.detail') });
  } else if (browse.enterAction === 'view') {
    items.push({ key: 'Enter', label: t('common.view') });
  }
  if (browse.canFocusDetail && browse.enterAction !== 'detail') {
    items.push({ key: '→', label: t('common.detail') });
  }
  if (browse.canImport) items.push({ key: 'i', label: t('common.collect') });
  items.push(...extraListItems);
  if (browse.canMaterialize || browse.canInstallToAgents || browse.canMore) {
    items.push({ key: 'm', label: t('common.more') });
  }
  if (browse.canTag) items.push({ key: 't', label: t('common.tags') });
  // `g` jump-to-tags stays as a hidden shortcut (still in ? help); not listed in footer.
  if (browse.canSync) items.push({ key: 's', label: t('common.sync') });
  if (browse.updateCount > 0) {
    items.push({
      key: 'u',
      label: browse.updateIsSelection && browse.updateCount > 0
        ? t('footer.updateWithCount', { count: browse.updateCount })
        : t('common.update'),
    });
  }
  if (browse.selectionCount > 0) {
    items.push({ label: t('footer.selectedCount', { count: browse.selectionCount }) });
  }
  items.push(...filterHelp(), ...helpQuit());
  return items;
}

function workingActionLabel(action: FooterWorkingState['action']): string {
  if (action === 'materialize') return t('common.materialize');
  if (action === 'sync') return t('common.sync');
  if (action === 'openSource') return t('common.openSource');
  return t('common.update');
}

function workingStatus(working: FooterWorkingState): string {
  const progress =
    working.total > 1 || working.action === 'materialize'
      ? t('footer.workingProgress', { current: working.current, total: working.total })
      : '';
  return t('footer.working', { action: workingActionLabel(working.action), progress });
}

function rightStatus(
  input: FooterResolveInput
): { text: string; kind: FooterStatusKind; action?: FooterStatusAction } | undefined {
  if (input.working) {
    return { text: workingStatus(input.working), kind: 'progress' };
  }
  if (input.status?.text) {
    return { text: input.status.text, kind: input.status.kind };
  }
  // Sticky health entry (⚠ N) — VS Code–style problems indicator; click/! opens details.
  if (input.health && input.health.count > 0) {
    return {
      text: t('footer.healthCount', { count: input.health.count }),
      kind: 'error',
      action: 'health',
    };
  }
  if (input.updateCheck) {
    if (input.updateCheck.failed > 0) {
      return { text: t('footer.checkFailed', { count: input.updateCheck.failed }), kind: 'error' };
    }
    if (input.updateCheck.checking) {
      return { text: t('footer.checkingUpdates'), kind: 'normal' };
    }
  }
  return undefined;
}

/** Right-slot budget: leftover after keys, but at most ~40% of the row. */
export function footerStatusBudget(columns: number, leftWidth: number): number {
  const remaining = Math.max(0, columns - leftWidth - 2);
  const cap = Math.max(12, Math.floor(columns * 0.4));
  return Math.max(4, Math.min(remaining, cap));
}

function fitStatus(
  status: { text: string; kind: FooterStatusKind; action?: FooterStatusAction },
  columns: number | undefined,
  leftWidth: number
): { text: string; action?: FooterStatusAction } {
  if (!columns || columns <= 0) return { text: status.text, ...(status.action ? { action: status.action } : {}) };
  const budget = footerStatusBudget(columns, leftWidth);
  const text = ellipsizeColumns(status.text, budget);
  const truncated = text !== status.text;
  const action =
    status.action ??
    (truncated && status.kind === 'error' ? 'error' : undefined);
  return { text, ...(action ? { action } : {}) };
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
    return { mode: 'input', label: t('common.filterLabel'), value: input.filterDraft };
  }

  if (input.suppressed) {
    return { mode: 'empty' };
  }

  if (input.working) {
    const items = input.workingItems ?? [];
    const status = rightStatus(input);
    const fitted = status
      ? fitStatus(status, input.columns, textWidth(joinFooterItems(items)))
      : undefined;
    return {
      mode: 'keys',
      items,
      ...(status && fitted
        ? {
            status: fitted.text,
            statusKind: status.kind,
            ...(fitted.action ? { statusAction: fitted.action } : {}),
          }
        : {}),
    };
  }

  if (input.browse) {
    let items = browseItems(
      input.browse,
      input.extraListItems ?? [],
      input.extraDetailItems ?? []
    );
    const status = rightStatus(input);
    if (input.columns && input.columns > 0) {
      const reserve = status
        ? Math.min(textWidth(status.text) + 2, footerStatusBudget(input.columns, 0) + 2)
        : 0;
      items = truncateFooterItems(items, Math.max(8, input.columns - reserve));
    }
    const fitted = status
      ? fitStatus(status, input.columns, textWidth(joinFooterItems(items)))
      : undefined;
    return {
      mode: 'keys',
      items,
      ...(status && fitted
        ? {
            status: fitted.text,
            statusKind: status.kind,
            ...(fitted.action ? { statusAction: fitted.action } : {}),
          }
        : {}),
    };
  }

  return { mode: 'empty' };
}
