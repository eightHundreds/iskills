import { Text } from 'ink';
import { useInput } from './use-input.js';
import type { ReactNode } from 'react';
import { termcnColors } from './colors.js';
import { padColumns, sliceColumns, textWidth, wrapColumns } from './terminal-layout.js';

export interface ModalBackgroundLine {
  text: string;
  content: ReactNode;
}

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

function ModalLine({
  line,
  index,
  last,
  muteLastContent,
}: {
  line: string;
  index: number;
  last: number;
  muteLastContent: boolean;
}): ReactNode {
  if (index === 0 || index === last) {
    return <Text color={termcnColors.primary}>{line}</Text>;
  }
  const content = line.slice(2, -2);
  return (
    <Text>
      <Text color={termcnColors.primary}>│ </Text>
      {muteLastContent && index === last - 1 ? (
        <Text color={termcnColors.muted}>{content}</Text>
      ) : (
        content
      )}
      <Text color={termcnColors.primary}> │</Text>
    </Text>
  );
}

export function Modal({
  open,
  title,
  content,
  width,
  viewportWidth,
  viewportHeight,
  backgroundLines,
  onEscape,
  muteLastContent = false,
}: {
  open: boolean;
  title: string;
  content: string[];
  width: number;
  viewportWidth: number;
  viewportHeight: number;
  backgroundLines: ModalBackgroundLine[];
  onEscape?: () => void;
  muteLastContent?: boolean;
}): ReactNode {
  useInput(
    (_input, key) => {
      if (key.escape) onEscape?.();
    },
    { isActive: open }
  );
  if (!open) return null;

  const lines = framedLines(title, content, Math.max(4, width));
  const modalHeight = lines.length;
  const compositeHeight = Math.max(viewportHeight, modalHeight);
  const modalTop = Math.max(0, Math.floor((compositeHeight - modalHeight) / 2));
  const modalWidth = textWidth(lines[0] ?? '');
  const modalLeft = Math.max(0, Math.floor((viewportWidth - modalWidth) / 2));

  // Every row is painted to full viewport width so Ink's differential
  // redraw cannot leave previous-frame glyphs (list rows, footer) showing
  // through empty modal margins.
  return (
    <>
      {Array.from({ length: compositeHeight }, (_, index) => {
        const background = backgroundLines[index];
        const modalIndex = index - modalTop;
        const line = lines[modalIndex];
        const base = background?.text ?? '';
        if (line === undefined) {
          if (background?.content && textWidth(base) >= viewportWidth) {
            return background.content;
          }
          return (
            <Text key={`modal-empty:${index}`} wrap="truncate-end">
              {padColumns(base, viewportWidth)}
            </Text>
          );
        }
        const rightWidth = Math.max(0, viewportWidth - modalLeft - modalWidth);
        const prefix = padColumns(sliceColumns(base, 0, modalLeft), modalLeft);
        const suffix = padColumns(
          sliceColumns(base, modalLeft + modalWidth, viewportWidth),
          rightWidth
        );
        return (
          <Text key={`modal:${index}`} wrap="truncate-end">
            {prefix}
            <ModalLine
              line={line}
              index={modalIndex}
              last={modalHeight - 1}
              muteLastContent={muteLastContent}
            />
            {suffix}
          </Text>
        );
      })}
    </>
  );
}
