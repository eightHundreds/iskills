/**
 * Pure layout geometry for the skill browser.
 * No React TUI — safe to unit-test without a terminal.
 */

export function masterDetailLayout(
  columns: number | undefined,
  rows: number | undefined
): boolean {
  return (columns ?? 80) >= 100 && (rows ?? 24) >= 24;
}

/** Smaller than the 80×24 working size: name-only lists, 1-row minimum viewport. */
export function compactLayout(
  columns: number | undefined,
  rows: number | undefined
): boolean {
  return (columns ?? 80) < 80 || (rows ?? 24) < 16;
}

export function listViewportBudget(
  columns: number | undefined,
  rows: number | undefined
): { compact: boolean; minVisible: number; reservedRows: number } {
  const compact = compactLayout(columns, rows);
  return {
    compact,
    minVisible: compact ? 1 : 3,
    reservedRows: compact ? 5 : 8,
  };
}

export function masterDetailWidths(
  totalWidth: number,
  divided = false
): {
  tagWidth: number;
  peekWidth: number;
  listWidth: number;
} {
  const dividers = divided ? 2 : 0;
  const tagWidth = Math.min(18, Math.max(12, Math.floor(totalWidth * 0.14)));
  const bodyWidth = totalWidth - tagWidth - dividers;
  if (divided) {
    const listWidth = Math.max(24, Math.floor(bodyWidth * 0.6));
    const peekWidth = Math.max(22, bodyWidth - listWidth);
    return { tagWidth, peekWidth, listWidth };
  }
  const peekWidth = Math.min(34, Math.max(22, Math.floor(totalWidth * 0.24)));
  const listWidth = Math.max(24, totalWidth - tagWidth - peekWidth);
  return { tagWidth, peekWidth, listWidth };
}

export function masterDetailViewportHeight(
  rows: number | undefined,
  reservedRows: number
): number {
  return Math.max(3, (rows ?? 24) - reservedRows - 1);
}

export function masterDetailSeparator(
  tagWidth: number,
  listWidth: number,
  peekWidth: number,
  end: 'top' | 'bottom',
  divided = false
): string {
  const left = '─'.repeat(tagWidth);
  const middle = '─'.repeat(listWidth);
  const right = '─'.repeat(peekWidth);
  if (divided) {
    const join = end === 'top' ? '┬' : '┴';
    return `${left}${join}${middle}${join}${right}`;
  }
  return end === 'top'
    ? `${left}┬${middle}┬${right}`
    : `${left}┴${middle}┴${right}`;
}

export function paneHeight(rowCount: number, viewportHeight: number): number {
  const floor = Math.min(3, Math.max(1, viewportHeight));
  const visibleRows = Math.max(floor, Math.min(Math.max(rowCount, 1), viewportHeight));
  return visibleRows + (rowCount > viewportHeight ? 1 : 0);
}

export interface BrowserFrameDimensions {
  frameHeight: number;
  frameWidth: number;
  listViewportHeight: number;
}

export function browserFrameDimensions({
  rows,
  columns,
  projectRows,
  globalRows,
  collectionRows,
  hasProjectAgents,
  hasGlobalAgents,
}: {
  rows: number | undefined;
  columns: number | undefined;
  projectRows: number;
  globalRows: number;
  collectionRows: number;
  hasProjectAgents: boolean;
  hasGlobalAgents: boolean;
}): BrowserFrameDimensions {
  const { minVisible, reservedRows } = listViewportBudget(columns, rows);
  const listViewportHeight = Math.max(minVisible, (rows ?? 24) - reservedRows);
  const tabContentHeight = Math.max(
    paneHeight(projectRows, listViewportHeight) + (hasProjectAgents ? 1 : 0),
    paneHeight(globalRows, listViewportHeight) + (hasGlobalAgents ? 1 : 0),
    paneHeight(collectionRows, listViewportHeight)
  );
  return {
    frameHeight: tabContentHeight + 1,
    frameWidth: columns ?? 80,
    listViewportHeight,
  };
}

export function detailFrameDimensions(
  frameHeight: number,
  frameWidth: number,
  terminalRows: number | undefined
): { height: number; width: number } {
  return {
    height: Math.min(frameHeight, Math.max(5, (terminalRows ?? 24) - 4)),
    width: frameWidth,
  };
}
