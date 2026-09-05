import type { LayerApi, ModalApi } from './types.js';

/** Imperative handle registered by the mounted OverlayHost. */
export interface OverlayHostHandle {
  layer: LayerApi;
  modal: ModalApi;
}

export interface OverlayBootstrapSession {
  host: OverlayHostHandle;
  dispose: () => Promise<void>;
  /**
   * Rejects with InterruptError when the temporary shell receives Ctrl+C.
   * Raced against `work` so CLI one-shots exit 130 on Ctrl+C.
   */
  interrupted: Promise<never>;
}

type OverlayBootstrap = () => Promise<OverlayBootstrapSession>;

let activeHost: OverlayHostHandle | null = null;
let bootstrap: OverlayBootstrap | null = null;
let isTuiActive: () => boolean = () => false;

/** Shell supplies terminal ownership without a static overlay → shell dependency. */
export function setOverlayTuiActive(query: () => boolean): void {
  isTuiActive = query;
}

/** Called by OverlayHost on mount / update / unmount. */
export function registerOverlayHost(handle: OverlayHostHandle | null): void {
  activeHost = handle;
}

export function getActiveOverlayHost(): OverlayHostHandle | null {
  return activeHost;
}

/**
 * Shell registers how to spin up a temporary OverlayHost when none is active
 * (CLI Modal/Layer). Overlay never imports AppShell.
 */
export function setOverlayBootstrap(fn: OverlayBootstrap | null): void {
  bootstrap = fn;
}

/** Wait until OverlayHost registers (child useEffect can run before parent effect). */
async function waitForActiveOverlayHost(
  timeoutMs = 5000
): Promise<OverlayHostHandle> {
  const started = Date.now();
  for (;;) {
    if (activeHost) return activeHost;
    if (Date.now() - started > timeoutMs) {
      throw new Error('OverlayHost bootstrap timed out');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Run work against the active host, or bootstrap a temporary one.
 *
 * If a TUI already owns stdin, never create a second CliRenderer — wait for
 * OverlayHost registration instead (avoids "stdin is already used").
 */
export async function withOverlayHost<T>(
  work: (host: OverlayHostHandle) => Promise<T>
): Promise<T> {
  if (activeHost) return work(activeHost);
  // Long-lived shell already mounted (e.g. browser); host may register one tick later.
  if (isTuiActive()) {
    return work(await waitForActiveOverlayHost());
  }
  if (!bootstrap) {
    // Side-effect: shell registers temporary AppShell bootstrap (lazy OpenTUI).
    await import('../shell/run.js');
  }
  if (!bootstrap) {
    throw new Error(
      'No OverlayHost is mounted and no bootstrap is registered (import ui/shell/run first)'
    );
  }
  const session = await bootstrap();
  try {
    return await Promise.race([work(session.host), session.interrupted]);
  } finally {
    await session.dispose();
  }
}
