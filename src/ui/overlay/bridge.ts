import type { LayerApi, ModalApi } from './types.js';

/** Imperative handle registered by the mounted OverlayHost. */
export interface OverlayHostHandle {
  layer: LayerApi;
  modal: ModalApi;
}

export interface OverlayBootstrapSession {
  host: OverlayHostHandle;
  dispose: () => Promise<void>;
}

type OverlayBootstrap = () => Promise<OverlayBootstrapSession>;

let activeHost: OverlayHostHandle | null = null;
let bootstrap: OverlayBootstrap | null = null;

/** Called by OverlayHost on mount / update / unmount. */
export function registerOverlayHost(handle: OverlayHostHandle | null): void {
  activeHost = handle;
}

export function getActiveOverlayHost(): OverlayHostHandle | null {
  return activeHost;
}

/**
 * Shell registers how to spin up a temporary OverlayHost when none is active
 * (CLI one-shot confirm). Overlay never imports AppShell.
 */
export function setOverlayBootstrap(fn: OverlayBootstrap | null): void {
  bootstrap = fn;
}

/**
 * Run work against the active host, or bootstrap a temporary one.
 */
export async function withOverlayHost<T>(
  work: (host: OverlayHostHandle) => Promise<T>
): Promise<T> {
  if (activeHost) return work(activeHost);
  if (!bootstrap) {
    throw new Error(
      'No OverlayHost is mounted and no bootstrap is registered (import ui/shell/run first)'
    );
  }
  const session = await bootstrap();
  try {
    return await work(session.host);
  } finally {
    await session.dispose();
  }
}
