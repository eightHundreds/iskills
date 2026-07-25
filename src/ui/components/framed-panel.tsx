import { Box, Text, useInput, useStdout } from 'ink';
import type { ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { padColumns, textWidth, wrapColumns } from './terminal-layout.js';

function framedLines(title: string, content: string[], width: number): string[] {
  const inner = Math.max(1, width - 4);
  const titleWidth = textWidth(title);
  const body = content
    .flatMap((line) => wrapColumns(line, inner))
    .map((line) => padColumns(line, inner));
  return [
    `╭─${title}${'─'.repeat(Math.max(0, width - titleWidth - 3))}╮`,
    ...body.map((line) => `│ ${line} │`),
    `╰${'─'.repeat(Math.max(0, width - 2))}╯`,
  ];
}

/**
 * Framed dialog body for absolute modal overlays.
 * Only paints the box itself — no full-viewport blank fill — so the screen
 * underneath shows through around the frame.
 */
export function FramedPanel({
  title,
  content,
  width: preferredWidth,
  muteLastContent = false,
  onEscape,
  onKey,
}: {
  title: string;
  content: string[];
  width?: number;
  muteLastContent?: boolean;
  onEscape?: () => void;
  onKey?: (input: string, key: { return: boolean; escape: boolean }) => void;
}): ReactNode {
  const { stdout } = useStdout();
  const viewportWidth = stdout.columns ?? 80;
  const width = Math.min(preferredWidth ?? 76, Math.max(36, viewportWidth - 6));
  const lines = framedLines(title, content, width);
  const last = lines.length - 1;

  useInput(
    (input, key) => {
      if (key.escape) {
        onEscape?.();
        return;
      }
      onKey?.(input, key);
    },
    { isActive: true }
  );

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        if (index === 0 || index === last) {
          return (
            <Text key={`frame:${index}`} color={termcnColors.primary}>
              {line}
            </Text>
          );
        }
        const body = line.slice(2, -2);
        return (
          <Text key={`frame:${index}`}>
            <Text color={termcnColors.primary}>│ </Text>
            {muteLastContent && index === last - 1 ? (
              <Text color={termcnColors.muted}>{body}</Text>
            ) : (
              body
            )}
            <Text color={termcnColors.primary}> │</Text>
          </Text>
        );
      })}
    </Box>
  );
}
