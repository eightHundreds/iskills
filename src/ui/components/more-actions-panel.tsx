import { useState, type ReactNode } from 'react';
import { t } from '../../i18n/index.js';
import { FramedPanel } from './framed-panel.js';

/** Framed more-actions picker (skill browser and MCP browser). */
export function MoreActionsPanel<T extends string>({
  scope,
  items,
  onSelect,
  onCancel,
}: {
  scope?: string;
  items: Array<{ id: T; label: string }>;
  onSelect: (id: T) => void;
  onCancel: () => void;
}): ReactNode {
  const [cursor, setCursor] = useState(0);
  const clamped = Math.max(0, Math.min(cursor, Math.max(0, items.length - 1)));
  const lines = [
    ...(scope ? [scope, ''] : []),
    ...items.map((item, index) => (index === clamped ? `› ${item.label}` : `  ${item.label}`)),
    t('browser.moreActionsFooter'),
  ];
  return (
    <FramedPanel
      title={t('browser.moreActionsTitle')}
      content={lines}
      width={64}
      muteLastContent
      scrollWithArrows={false}
      onEscape={onCancel}
      onKey={(input, key) => {
        if (key.upArrow) {
          setCursor((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow) {
          setCursor((current) => Math.min(items.length - 1, current + 1));
          return;
        }
        if (key.return || input.includes('\r') || input.includes('\n')) {
          const item = items[clamped];
          if (item) onSelect(item.id);
        }
      }}
    />
  );
}
