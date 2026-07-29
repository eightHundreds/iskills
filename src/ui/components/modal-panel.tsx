/**
 * Solid themed panel for Modal.open content (forms that are not FramedPanel).
 * Matches light/dark terminal themeMode via useModalChrome.
 */
import type { ReactNode } from 'react';
import { useModalChrome } from '../tui/index.js';
import { termcnColors } from './colors.js';

export function ModalPanel({
  children,
  width,
}: {
  children: ReactNode;
  width?: number | `${number}%`;
}): ReactNode {
  const chrome = useModalChrome();
  return (
    <box
      border
      flexDirection="column"
      backgroundColor={chrome.surface}
      borderStyle="rounded"
      borderColor={termcnColors.primary}
      paddingX={1}
      paddingY={1}
      {...(width !== undefined ? { width } : {})}
    >
      {children}
    </box>
  );
}
