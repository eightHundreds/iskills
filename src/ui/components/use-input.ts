import { useInput as useInkInput, type Key } from 'ink';
import { isMouseInput } from './mouse/parse.js';

export type { Key };

/**
 * App-level keyboard hook: Ink `useInput` that never delivers terminal mouse reports.
 * Mouse hits go through {@link MouseProvider} / {@link Clickable}; key handlers stay clean.
 */
export function useInput(
  inputHandler: (input: string, key: Key) => void,
  options?: { isActive?: boolean }
): void {
  useInkInput((input, key) => {
    if (isMouseInput(input)) return;
    inputHandler(input, key);
  }, options);
}
