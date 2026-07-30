/**
 * Solid themed panel for Modal.open content (forms that are not FramedPanel).
 * Matches light/dark terminal themeMode via useModalChrome.
 * Optional `title` uses OpenTUI box border title (top-left by default).
 */
import type { ReactNode } from 'react';
import { useModalChrome } from '../tui/index.js';
import { termcnColors } from './colors.js';

export function ModalPanel({
  children,
  width,
  title,
}: {
  children: ReactNode;
  width?: number | `${number}%`;
  /** Drawn into the top border (left-aligned), same corner as confirm frames. */
  title?: string;
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
      {...(title !== undefined
        ? {
            title,
            titleColor: termcnColors.primary,
            titleAlignment: 'left' as const,
          }
        : {})}
      {...(width !== undefined ? { width } : {})}
    >
      {children}
    </box>
  );
}
