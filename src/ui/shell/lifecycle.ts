/**
 * Process-level TUI instance registry without importing OpenTUI.
 * CLI `finally` can tear down without loading the native renderer.
 */

import { setOverlayTuiActive } from '../overlay/bridge.js';

export type TuiDisposer = {
  unmount: () => void;
  cleanup: () => void;
};

let activeInstance: TuiDisposer | undefined;
setOverlayTuiActive(() => Boolean(activeInstance));

export function setActiveTui(instance: TuiDisposer | undefined): void {
  activeInstance = instance;
}

export function getActiveTui(): TuiDisposer | undefined {
  return activeInstance;
}

/** Force-unmount whatever is active (CLI main `finally`). */
export function closeTui(): void {
  if (!activeInstance) return;
  const instance = activeInstance;
  activeInstance = undefined;
  try {
    instance.unmount();
  } catch {
    try {
      instance.cleanup();
    } catch {
      // ignore double teardown
    }
  }
}

