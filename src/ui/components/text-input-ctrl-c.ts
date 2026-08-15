/**
 * Text-input Ctrl+C: first press clears; second within the window interrupts.
 * AppShell consults this before exiting; TextInput registers while focused.
 */

/** Second Ctrl+C within this window interrupts; later presses clear again. */
export const TEXT_INPUT_CTRL_C_WINDOW_MS = 1000;

let focusedCount = 0;
let lastClearAt = 0;
let interruptHandler: (() => void) | undefined;

/** AppShell registers the process interrupt used on a second focused Ctrl+C. */
export function setTextInputCtrlCInterrupt(handler: () => void): () => void {
  interruptHandler = handler;
  return () => {
    if (interruptHandler === handler) interruptHandler = undefined;
  };
}

/** Second focused Ctrl+C: interrupt even if the key never reaches AppShell. */
export function interruptFromTextInputCtrlC(): void {
  interruptHandler?.();
}

/** Register a focused text field. Returns unregister (call on blur/unmount). */
export function registerTextInputFocus(): () => void {
  focusedCount += 1;
  return () => {
    focusedCount = Math.max(0, focusedCount - 1);
    // Modal content may remount the same field in this tick; keep the
    // double-press window until we know nothing re-registered.
    if (focusedCount === 0) {
      queueMicrotask(() => {
        if (focusedCount === 0) lastClearAt = 0;
      });
    }
  };
}

export function textInputHasFocus(): boolean {
  return focusedCount > 0;
}

/**
 * First Ctrl+C while a text input is focused: consume (clear, do not exit).
 * Second within {@link TEXT_INPUT_CTRL_C_WINDOW_MS}: do not consume (interrupt).
 * No focused input: do not consume.
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
  interruptHandler = undefined;
}
