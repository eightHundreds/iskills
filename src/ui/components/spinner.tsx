/**
 * Terminal spinner frames for in-row “working” indicators.
 * Only ticks while `active` so idle screens stay quiet.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Text } from '../tui/index.js';
import { termcnColors } from './colors.js';

/** Braille dots — compact next to skill names. */
export const SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const;

const DEFAULT_INTERVAL_MS = 80;

/** Current spinner glyph; advances only when `active`. */
export function useSpinnerFrame(
  active: boolean,
  intervalMs = DEFAULT_INTERVAL_MS
): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER_FRAMES.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return SPINNER_FRAMES[frame] ?? SPINNER_FRAMES[0];
}

/** In-list / detail badge: spinning glyph (replaces static “更新中”). */
export function WorkingSpinner({
  active = true,
  color = termcnColors.primary,
  prefix = ' ',
}: {
  active?: boolean;
  color?: string;
  /** Leading space so it sits off the skill name. */
  prefix?: string;
}): ReactNode {
  const glyph = useSpinnerFrame(active);
  if (!active) return null;
  return (
    <Text color={color}>
      {prefix}
      {glyph}
    </Text>
  );
}
