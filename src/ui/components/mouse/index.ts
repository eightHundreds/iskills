export { getElementBounds, pointInBounds, type ElementBounds } from './bounds.js';
export { Clickable } from './clickable.js';
export { isMouseInput, parseLeftPresses, type ParsedMousePress } from './parse.js';
export {
  MouseProvider,
  PointerSurface,
  POINTER_SURFACE_BASE,
  useOnClick,
  useMouseRegistry,
  usePointerSurfaceId,
} from './provider.js';
