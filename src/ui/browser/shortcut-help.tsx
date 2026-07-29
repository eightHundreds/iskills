import { Box, Text, useModalChrome, useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import { useMemo, useState, type ReactNode } from 'react';
import { termcnColors } from '../components/colors.js';
import { padColumns, textWidth } from '../components/terminal-layout.js';
import {
  shortcutHelpSections,
  type ShortcutHelpSection,
} from './format.js';

type Row =
  | { kind: 'section'; section: ShortcutHelpSection; expanded: boolean }
  | { kind: 'item'; sectionId: string; label: string; keys: string };

function buildRows(
  sections: ShortcutHelpSection[],
  expanded: Set<string>
): Row[] {
  const rows: Row[] = [];
  for (const section of sections) {
    const isOpen = expanded.has(section.id);
    rows.push({ kind: 'section', section, expanded: isOpen });
    if (isOpen) {
      for (const item of section.items) {
        rows.push({
          kind: 'item',
          sectionId: section.id,
          label: item.label,
          keys: item.keys,
        });
      }
    }
  }
  return rows;
}

function formatItemLine(label: string, keys: string, width: number): string {
  const keyWidth = textWidth(keys);
  const gap = 2;
  const labelBudget = Math.max(8, width - keyWidth - gap - 2);
  let text = label;
  if (textWidth(text) > labelBudget) {
    while (text.length > 1 && textWidth(`${text}…`) > labelBudget) {
      text = text.slice(0, -1);
    }
    text = `${text}…`;
  }
  const left = `  ${padColumns(text, labelBudget)}`;
  return padColumns(`${left}${' '.repeat(gap)}${keys}`, width);
}

/**
 * Keyboard shortcuts help — list/tree style:
 * ◆ / › groups, action left, keys right-aligned, expand/collapse, height-capped scroll.
 *
 * Solid panel fill follows terminal light/dark themeMode (neutral, not purple wash).
 */
export function ShortcutHelpPanel({
  onClose,
  width: preferredWidth = 72,
  maxBodyRows = 14,
}: {
  onClose: () => void;
  width?: number;
  maxBodyRows?: number;
}): ReactNode {
  const { stdout } = useStdout();
  const chrome = useModalChrome();
  const sections = useMemo(() => shortcutHelpSections(), []);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(sections.slice(0, 2).map((section) => section.id))
  );
  const [cursor, setCursor] = useState(0);

  const viewportWidth = stdout.columns ?? 80;
  const width = Math.min(preferredWidth, Math.max(40, viewportWidth - 8));
  const inner = Math.max(1, width - 4);
  const rows = buildRows(sections, expanded);
  const maxOffset = Math.max(0, rows.length - maxBodyRows);
  const clampedCursor = Math.min(cursor, Math.max(0, rows.length - 1));
  const start = Math.max(
    0,
    Math.min(clampedCursor - Math.floor(maxBodyRows / 2), maxOffset)
  );
  const painted = rows.slice(start, start + maxBodyRows);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((current) => Math.min(rows.length - 1, current + 1));
      return;
    }
    const row = rows[clampedCursor];
    if (!row) return;
    if (row.kind === 'section') {
      if (key.rightArrow || input === 'e' || input === ' ' || key.return) {
        setExpanded((current) => {
          const next = new Set(current);
          if (next.has(row.section.id)) next.delete(row.section.id);
          else next.add(row.section.id);
          return next;
        });
        return;
      }
      if (key.leftArrow) {
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(row.section.id);
          return next;
        });
      }
      return;
    }
    if (key.leftArrow) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(row.sectionId);
        return next;
      });
      const parent = rows.findIndex(
        (candidate) =>
          candidate.kind === 'section' && candidate.section.id === row.sectionId
      );
      if (parent >= 0) setCursor(parent);
    }
  });

  const title = ' 完整快捷键 ';
  const titleWidth = textWidth(title);
  const top = `╭─${title}${'─'.repeat(Math.max(0, width - titleWidth - 3))}╮`;
  const bottom = `╰${'─'.repeat(Math.max(0, width - 2))}╯`;
  const panelBg = chrome.surface;
  const bodyFg = chrome.body;

  // Manual ╭│╰ frame only — do not also set borderStyle (double border).
  return (
    <Box flexDirection="column" backgroundColor={panelBg} paddingX={0}>
      <Text color={termcnColors.primary} backgroundColor={panelBg} bold>
        {top}
      </Text>
      {painted.map((row, index) => {
        const absolute = start + index;
        const selected = absolute === clampedCursor;
        if (row.kind === 'section') {
          const marker = row.expanded ? '◆' : '›';
          const count = row.expanded ? '' : ` (${row.section.items.length})`;
          const text = padColumns(
            `${marker} ${row.section.title}${count}`,
            inner
          );
          return (
            <Box
              key={`s:${row.section.id}:${absolute}`}
              flexDirection="row"
              backgroundColor={panelBg}
            >
              <Text color={termcnColors.primary} backgroundColor={panelBg}>
                │{' '}
              </Text>
              {selected ? (
                <Text
                  bold
                  color={termcnColors.selectionFg}
                  backgroundColor={termcnColors.selectionBg}
                >
                  {text}
                </Text>
              ) : (
                <Text
                  bold={row.expanded}
                  color={termcnColors.primary}
                  backgroundColor={panelBg}
                >
                  {text}
                </Text>
              )}
              <Text color={termcnColors.primary} backgroundColor={panelBg}>
                {' '}
                │
              </Text>
            </Box>
          );
        }
        const line = formatItemLine(row.label, row.keys, inner);
        return (
          <Box
            key={`i:${row.sectionId}:${row.keys}:${absolute}`}
            flexDirection="row"
            backgroundColor={panelBg}
          >
            <Text color={termcnColors.primary} backgroundColor={panelBg}>
              │{' '}
            </Text>
            <Text
              color={selected ? termcnColors.selectionFg : bodyFg}
              backgroundColor={
                selected ? termcnColors.selectionBg : panelBg
              }
            >
              {line}
            </Text>
            <Text color={termcnColors.primary} backgroundColor={panelBg}>
              {' '}
              │
            </Text>
          </Box>
        );
      })}
      <Text color={termcnColors.primary} backgroundColor={panelBg}>
        {bottom}
      </Text>
      <Text color={chrome.muted} backgroundColor={panelBg}>
        {maxOffset > 0
          ? `↑/↓ 移动 · e/Space 展开/收起 · ← 收起 · Esc 关闭  ${start + 1}–${Math.min(start + maxBodyRows, rows.length)}/${rows.length}`
          : '↑/↓ 移动 · e/Space 展开/收起 · ← 收起 · Esc 关闭'}
      </Text>
    </Box>
  );
}
