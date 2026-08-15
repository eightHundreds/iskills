/**
 * Opt-in Ctrl+C for one focused field (collection remote URL).
 * AppShell consults this before interrupting because its useKeyboard
 * listener is registered before the input (tree order).
 */

/** Second Ctrl+C within this window interrupts; later presses clear again. */
export const TEXT_INPUT_CTRL_C_WINDOW_MS = 1000;

let focusedCount = 0;
let lastClearAt = 0;

/** Register a focused clear-on-Ctrl+C field. Call the return on blur/unmount. */
export function registerTextInputFocus(): () => void {
  focusedCount += 1;
  return () => {
    focusedCount = Math.max(0, focusedCount - 1);
    if (focusedCount === 0) lastClearAt = 0;
  };
}

export function textInputHasFocus(): boolean {
  return focusedCount > 0;
}

/**
 * First Ctrl+C while registered: consume (clear, do not exit).
 * Second within the window: do not consume (interrupt).
 * No registered field: do not consume.
 */
export function consumeFocusedTextInputCtrlC(now = Date.now()): boolean {
  if (focusedCount <= 0) return false;
  if (lastClearAt > 0 && now - lastClearAt <= TEXT_INPUT_CTRL_C_WINDOW_MS) {
    lastClearAt = 0;
    return false;
  }
  lastClearAt = now;
  return true;
}

/** Reset module state between unit tests. */
export function resetTextInputCtrlCState(): void {
  focusedCount = 0;
  lastClearAt = 0;
}
