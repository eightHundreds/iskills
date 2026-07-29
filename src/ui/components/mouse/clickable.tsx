/**
 * Click / hover target using OpenTUI native mouse handlers.
 * Requires `createCliRenderer({ useMouse: true, enableMouseMovement: true })`.
 */
import { useState, type ReactNode } from 'react';

import { useModalChrome } from '../../tui/hooks.js';
import {
  useMouseRegistry,
  usePointerSurfaceId,
} from './provider.js';

export function Clickable({
  onClick,
  disabled = false,
  children,
  hover = true,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** Soft solid background on mouse over (theme-aware; no alpha-on-black). */
  hover?: boolean;
}): ReactNode {
  const surface = usePointerSurfaceId();
  const registry = useMouseRegistry();
  const chrome = useModalChrome();
  const [hovered, setHovered] = useState(false);

  const active = !disabled && (registry?.isTopSurface(surface) ?? true);
  const showHover = hover && active && hovered;

  if (disabled) {
    return <box flexDirection="row">{children}</box>;
  }

  // Solid theme hover — low-alpha purple composites against black clear to #1b0d34.
  const hoverBg = showHover ? { backgroundColor: chrome.hover } : {};

  return (
    <box flexDirection="row"
      {...hoverBg}
      onMouseOver={() => {
        if (active) setHovered(true);
      }}
      onMouseOut={() => setHovered(false)}
      onMouseDown={() => {
        if (!active) return;
        onClick();
      }}
    >
      {children}
    </box>
  );
}
