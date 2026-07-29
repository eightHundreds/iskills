import { Text, useModalChrome, useStdout } from '../tui/index.js';
import type { ReactNode } from 'react';
import { termcnColors } from '../components/colors.js';
import {
  formatFooterItem,
  resolveFooter,
} from '../footer/resolve-footer.js';
import type { FooterItem, FooterView } from '../footer/types.js';
import { useOverlayFooterItems } from '../overlay/host.js';

export function FooterPaint({ view }: { view: FooterView }): ReactNode {
  const chrome = useModalChrome();
  if (view.mode === 'empty') return null;
  if (view.mode === 'input') return null;
  if (view.items.length === 0 && !view.status) return null;

  const left = view.items.map(formatFooterItem).join(' · ');
  const statusFg =
    view.statusKind === 'error' ? termcnColors.error : chrome.muted;
  return (
    <box flexDirection="row" justifyContent="space-between" width="100%">
      <box flexDirection="row" flexGrow={1} flexShrink={1} marginRight={1}>
        <Text color={chrome.muted} wrap="truncate-end">
          {left}
        </Text>
      </box>
      {view.status ? (
        <Text color={statusFg} wrap="truncate-end">
          {view.status}
        </Text>
      ) : null}
    </box>
  );
}

/** Overlay-only footer (no browser jotai Provider). */
export function OverlayOnlyFooter(): ReactNode {
  const overlayItems = useOverlayFooterItems();
  const { stdout } = useStdout();
  const view = resolveFooter({
    overlayItems,
    suppressed: false,
    filterOpen: false,
    filterDraft: '',
    working: null,
    browse: null,
    status: null,
    updateCheck: null,
    columns: stdout.columns ?? 80,
  });
  return <FooterPaint view={view} />;
}
