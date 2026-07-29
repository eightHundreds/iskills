/**
 * Click / hover target using OpenTUI native mouse handlers.
 * Requires `createCliRenderer({ useMouse: true, enableMouseMovement: true })`.
 */
import { RGBA } from '@opentui/core';
import { useState, type ReactNode } from 'react';
import { Box } from '../../tui/primitives.js';
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
  /** Soft background on mouse over (OpenTUI onMouseOver/Out). */
  hover?: boolean;
}): ReactNode {
  const surface = usePointerSurfaceId();
  const registry = useMouseRegistry();
  const [hovered, setHovered] = useState(false);

  const active = !disabled && (registry?.isTopSurface(surface) ?? true);
  const showHover = hover && active && hovered;

  if (disabled) {
    return <Box>{children}</Box>;
  }

  // Soft primary wash on hover only; leave bg unset so the terminal theme shows through.
  const hoverBg = showHover
    ? { backgroundColor: RGBA.fromValues(0.486, 0.227, 0.929, 0.28) }
    : {};

  return (
    <Box
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
    </Box>
  );
}
