import { Box, Text, useInput, useStdout } from 'ink';
import { useState, type ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { padColumns, textWidth, wrapColumns } from './terminal-layout.js';

function framedBorderTop(title: string, width: number): string {
  const titleWidth = textWidth(title);
  return `╭─${title}${'─'.repeat(Math.max(0, width - titleWidth - 3))}╮`;
}

function framedBorderBottom(width: number): string {
  return `╰${'─'.repeat(Math.max(0, width - 2))}╯`;
}

function bodyLines(content: string[], inner: number): string[] {
  return content
    .flatMap((line) => wrapColumns(line, inner))
    .map((line) => padColumns(line, inner));
}

/**
 * Framed dialog body for absolute modal overlays.
 * Only paints the box itself — no full-viewport blank fill — so the screen
 * underneath shows through around the frame.
 *
 * When body content exceeds the height budget, the panel scrolls with ↑/↓.
 */
export function FramedPanel({
  title,
  content,
  width: preferredWidth,
  muteLastContent = false,
  maxHeight,
  onEscape,
  onKey,
}: {
  title: string;
  content: string[];
  width?: number;
  muteLastContent?: boolean;
  /** Total painted rows including borders; defaults from terminal height. */
  maxHeight?: number;
  onEscape?: () => void;
  onKey?: (input: string, key: { return: boolean; escape: boolean }) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const viewportWidth = stdout.columns ?? 80;
  const viewportRows = stdout.rows ?? 24;
  const width = Math.min(preferredWidth ?? 76, Math.max(36, viewportWidth - 6));
  const inner = Math.max(1, width - 4);
  const allBody = bodyLines(content, inner);
  // Leave room for modal chrome / shell footer around the absolute frame.
  const frameBudget = Math.max(
    6,
    Math.min(maxHeight ?? viewportRows - 6, viewportRows - 4)
  );
  const maxBody = Math.max(3, frameBudget - 2);
  const maxOffset = Math.max(0, allBody.length - maxBody);
  const [offset, setOffset] = useState(0);
  const scroll = Math.min(offset, maxOffset);
  const visibleBody = allBody.slice(scroll, scroll + maxBody);
  const lastBodyIndex = visibleBody.length - 1;

  useInput(
    (input, key) => {
      if (key.upArrow && maxOffset > 0) {
        setOffset((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow && maxOffset > 0) {
        setOffset((current) => Math.min(maxOffset, current + 1));
        return;
      }
      if (key.escape) {
        onEscape?.();
        return;
      }
      onKey?.(input, key);
    },
    { isActive: true }
  );

  const top = framedBorderTop(title, width);
  const bottom = framedBorderBottom(width);

  return (
    <Box flexDirection="column">
      <Text color={termcnColors.primary}>{top}</Text>
      {visibleBody.map((body, index) => {
        const absoluteIndex = scroll + index;
        const mute =
          muteLastContent &&
          absoluteIndex === allBody.length - 1 &&
          index === lastBodyIndex;
        return (
          <Text key={`frame-body:${absoluteIndex}`}>
            <Text color={termcnColors.primary}>│ </Text>
            {mute ? (
              <Text color={termcnColors.muted}>{body}</Text>
            ) : (
              body
            )}
            <Text color={termcnColors.primary}> │</Text>
          </Text>
        );
      })}
      <Text color={termcnColors.primary}>{bottom}</Text>
      {maxOffset > 0 ? (
        <Text color={termcnColors.muted}>
          {`↑/↓ 滚动 ${scroll + 1}–${Math.min(scroll + maxBody, allBody.length)} / ${allBody.length}`}
        </Text>
      ) : null}
    </Box>
  );
}
