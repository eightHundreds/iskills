/**
 * Pure layout geometry for the skill browser.
 * No Ink/React — safe to unit-test without a terminal.
 */

export function masterDetailLayout(
  columns: number | undefined,
  rows: number | undefined
): boolean {
  return (columns ?? 80) >= 100 && (rows ?? 24) >= 24;
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
  const visibleRows = Math.max(3, Math.min(rowCount, viewportHeight));
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
  const listViewportHeight = Math.max(3, (rows ?? 24) - 8);
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
