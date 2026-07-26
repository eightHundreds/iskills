import { useInput as useInkInput, type Key } from 'ink';
import { useCallback, useRef } from 'react';
import { isMouseInput } from './mouse/parse.js';

export type { Key };

/**
 * App-level keyboard hook: Ink `useInput` that never delivers terminal mouse reports.
 * Mouse hits go through {@link MouseProvider} / {@link Clickable}; key handlers stay clean.
 *
 * Handler is kept in a ref so Ink does not tear down the stdin listener every render
 * (which drops keys under load / on slow CI).
 */
export function useInput(
  inputHandler: (input: string, key: Key) => void,
  options?: { isActive?: boolean }
): void {
  const handlerRef = useRef(inputHandler);
  handlerRef.current = inputHandler;

  const stableHandler = useCallback((input: string, key: Key) => {
    if (isMouseInput(input)) return;
    handlerRef.current(input, key);
  }, []);

  useInkInput(stableHandler, options);
}
