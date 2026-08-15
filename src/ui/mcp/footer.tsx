import { useStdout } from '../tui/index.js';
import type { ReactNode } from 'react';
import { PointerSurface } from '../components/mouse/index.js';
import { TextInput } from '../components/text-input.js';
import { resolveFooter } from '../footer/resolve-footer.js';
import type { FooterItem } from '../footer/types.js';
import { useOverlayFooterItems } from '../overlay/host.js';
import { FooterPaint } from '../shell/footer.js';
import type { McpFooterSnapshot } from './browse-capabilities.js';

export function McpShellFooter({
  snapshot,
  filterOpen,
  filterDraft,
  status,
  onFilterChange,
  onFilterCancel,
  onFilterSubmit,
}: {
  snapshot: McpFooterSnapshot | null;
  filterOpen: boolean;
  filterDraft: string;
  status: { kind: 'normal' | 'error'; text: string } | null;
  onFilterChange: (draft: string) => void;
  onFilterCancel: () => void;
  onFilterSubmit: (value: string) => void;
}): ReactNode {
  const overlayItems = useOverlayFooterItems();
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 80;
  const view = resolveFooter({
    overlayItems,
    suppressed: false,
    filterOpen,
    filterDraft,
    working: null,
    browse: filterOpen || overlayItems ? null : snapshot?.browse ?? null,
    extraListItems: snapshot?.extraListItems ?? [],
    extraDetailItems: snapshot?.extraDetailItems ?? [],
    status,
    updateCheck: null,
    columns,
  });

  if (view.mode === 'input') {
    return (
      <PointerSurface id="filter">
        <TextInput
          variant="inline"
          label={view.label}
          initialValue={view.value}
          onChange={onFilterChange}
          onCancel={onFilterCancel}
          onSubmit={onFilterSubmit}
        />
      </PointerSurface>
    );
  }

  return <FooterPaint view={view} />;
}

export type { FooterItem };
