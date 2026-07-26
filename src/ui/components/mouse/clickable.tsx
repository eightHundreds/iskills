import { Box, type DOMElement } from 'ink';
import { useRef, type ReactNode } from 'react';
import { useOnClick } from './provider.js';

/**
 * Non-invasive click target: wrap existing UI, no keyboard/layout logic.
 * Requires an ancestor {@link MouseProvider} (AppShell) for clicks to fire.
 */
export function Clickable({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<DOMElement>(null);
  useOnClick(ref, disabled ? null : onClick);
  return <Box ref={ref}>{children}</Box>;
}
