export type ElementBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Half-open on the right and bottom edges (x in [left, left+width)). */
export function pointInBounds(
  x: number,
  y: number,
  bounds: ElementBounds
): boolean {
  return (
    x >= bounds.left &&
    x < bounds.left + bounds.width &&
    y >= bounds.top &&
    y < bounds.top + bounds.height
  );
}

/**
 * Legacy Ink DOMElement bounds helper — OpenTUI uses native mouse targets.
 * Always returns null so old hit-test paths no-op cleanly.
 */
export function getElementBounds(_element: unknown): ElementBounds | null {
  return null;
}
