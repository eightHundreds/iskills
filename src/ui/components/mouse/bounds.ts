import type { DOMElement } from 'ink';

export type ElementBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Absolute terminal cell bounds (1-based, same as mouse reports).
 * Walks yoga parents — Ink only stores relative layout.
 */
export function getElementBounds(node: DOMElement | null | undefined): ElementBounds | null {
  if (!node?.yogaNode) return null;
  let left = 1;
  let top = 1;
  let current: DOMElement | undefined = node;
  while (current?.yogaNode) {
    const layout = current.yogaNode.getComputedLayout();
    left += layout.left;
    top += layout.top;
    current = current.parentNode;
  }
  const width = node.yogaNode.getComputedWidth();
  const height = node.yogaNode.getComputedHeight();
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

export function pointInBounds(x: number, y: number, bounds: ElementBounds): boolean {
  return (
    x >= bounds.left &&
    x < bounds.left + bounds.width &&
    y >= bounds.top &&
    y < bounds.top + bounds.height
  );
}
