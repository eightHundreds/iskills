import { Box, Text, useStdout } from '../tui/index.js';
import type { ReactNode } from 'react';
import { termcnColors } from '../components/colors.js';
import {
  formatFooterItem,
  resolveFooter,
} from '../footer/resolve-footer.js';
import type { FooterItem, FooterView } from '../footer/types.js';
import { useOverlayFooterItems } from '../overlay/host.js';

function statusColor(kind: 'normal' | 'error' | 'progress' | undefined): string {
  if (kind === 'error') return termcnColors.error;
  return termcnColors.muted;
}

export function FooterPaint({ view }: { view: FooterView }): ReactNode {
  if (view.mode === 'empty') return null;
  if (view.mode === 'input') return null;
  if (view.items.length === 0 && !view.status) return null;

  const left = view.items.map(formatFooterItem).join(' · ');
  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexGrow={1} flexShrink={1} marginRight={1}>
        <Text color={termcnColors.muted} wrap="truncate-end">
          {left}
        </Text>
      </Box>
      {view.status ? (
        <Text color={statusColor(view.statusKind)} wrap="truncate-end">
          {view.status}
        </Text>
      ) : null}
    </Box>
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
