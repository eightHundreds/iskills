import type { ReactNode } from 'react';
import {
  getActiveOverlayHost,
  setOverlayBootstrap,
  type OverlayHostHandle,
} from '../overlay/bridge.js';
import { InterruptError } from './terminal.js';
import {
  getActiveTui,
  setActiveTui,
  closeTui,
  type TuiDisposer,
} from './lifecycle.js';

export { closeTui } from './lifecycle.js';

/**
 * OpenTUI UI runtime (shell package): mount registry + session runners + AppShell.
 *
 * OpenTUI is loaded lazily so non-interactive CLI paths never touch the native core.
 *
 * - `mountTui` / `closeTui` — process-level active instance
 * - `startApp` / `runApp` — long-lived tree (`ui/browser`); remount via handle
 * - registers overlay bootstrap so static Modal/Layer work without a pre-mounted tree
 */

export type TuiInstance = TuiDisposer & {
  renderer: { destroy: () => void };
  root: { render: (node: ReactNode) => void; unmount: () => void };
  waitUntilExit: () => Promise<void>;
  settle: (error?: Error) => void;
};

type AppExit = (error?: Error | undefined) => void;

async function loadOpenTui(): Promise<{
  createCliRenderer: (config?: Record<string, unknown>) => Promise<{
    destroy: () => void;
  }>;
  createRoot: (renderer: { destroy: () => void }) => {
    render: (node: ReactNode) => void;
    unmount: () => void;
  };
  ExitProvider: (props: { exit: AppExit; children: ReactNode }) => ReactNode;
  AppShell: (props: {
    cancelOnEscape?: boolean;
    onCancel?: () => void;
    onCtrlC?: () => void;
    bottomChrome?: ReactNode;
    children: ReactNode;
  }) => ReactNode;
  createElement: typeof import('react').createElement;
}> {
  const [{ createCliRenderer }, { createRoot }, hooks, appShell, react] =
    await Promise.all([
      import('@opentui/core'),
      import('@opentui/react'),
      import('../tui/hooks.js'),
      import('./app-shell.js'),
      import('react'),
    ]);
  return {
    createCliRenderer: createCliRenderer as never,
    createRoot: createRoot as never,
    ExitProvider: hooks.ExitProvider,
    AppShell: appShell.AppShell,
    createElement: react.createElement,
  };
}

function createExitController(): {
  exit: AppExit;
  waitUntilExit: () => Promise<void>;
  settle: (error?: Error) => void;
} {
  let settled = false;
  let resolveExit!: () => void;
  let rejectExit!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  void promise.catch(() => undefined);

  const settle = (error?: Error): void => {
    if (settled) return;
    settled = true;
    if (error) rejectExit(error);
    else resolveExit();
  };

  const exit: AppExit = (error) => {
    settle(error);
  };

  return {
    exit,
    waitUntilExit: () => promise,
    settle,
  };
}

/** Mount a root node; replaces the process-level active instance pointer. */
export async function mountTui(
  node: ReactNode,
  options: { alternateScreen?: boolean; useMouse?: boolean } = {}
): Promise<TuiInstance> {
  const { createCliRenderer, createRoot, ExitProvider, createElement } =
    await loadOpenTui();
  const controller = createExitController();
  let renderer: { destroy: () => void };
  try {
    const useMouse = options.useMouse ?? true;
    renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useMouse,
      // Hover (onMouseOver/Out) needs movement reports, not just button clicks.
      enableMouseMovement: useMouse,
      // Do NOT force backgroundColor — inherit the terminal's default bg (user theme).
      screenMode: options.alternateScreen ? 'alternate-screen' : 'main-screen',
      clearOnShutdown: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/native FFI|not available for this runtime/i.test(message)) {
      throw new Error(
        'OpenTUI native renderer is unavailable in this runtime. ' +
          'Interactive TUI requires Bun on PATH (bin/iskills.js re-execs to bun when Node lacks node:ffi) ' +
          'or a Node build with node:ffi. Install: https://bun.sh — then re-run `iskills`. ' +
          `Underlying error: ${message}`
      );
    }
    throw error;
  }

  const root = createRoot(renderer);
  let disposed = false;

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      root.unmount();
    } catch {
      // ignore double-unmount
    }
    try {
      renderer.destroy();
    } catch {
      // ignore double-destroy
    }
    if (getActiveTui() === instance) {
      setActiveTui(undefined);
    }
  };

  const instance: TuiInstance = {
    renderer,
    root,
    waitUntilExit: controller.waitUntilExit,
    unmount: () => {
      controller.settle();
      cleanup();
    },
    cleanup,
    settle: controller.settle,
  };

  setActiveTui(instance);

  const exit: AppExit = (error) => {
    controller.settle(error);
    cleanup();
  };

  root.render(createElement(ExitProvider, { exit, children: node }));
  return instance;
}

/** Cleanup after exit/unmount; clear active if it matches. */
export function releaseTui(instance: TuiInstance): void {
  instance.cleanup();
  if (getActiveTui() === instance) setActiveTui(undefined);
}

/** Unmount + cleanup one instance; clears active if it matches. */
export function unmountTui(instance: TuiInstance): void {
  instance.unmount();
  releaseTui(instance);
}

// ─── long-lived app ─────────────────────────────────────────────────────────

const CLEAR_SCREEN = '\u001B[2J\u001B[H';
const ENTER_ALTERNATE_SCREEN = '\u001B[?1049h';
const LEAVE_ALTERNATE_SCREEN = '\u001B[?1049l';

export interface RunAppHandle {
  /** Replace the mounted tree (e.g. after suspendForSubprocess). */
  remount: (node: ReactNode) => void;
  waitUntilExit: () => Promise<void>;
  /** Unmount + cleanup. */
  dispose: () => void;
}

export interface RunAppOptions {
  /** Enter/leave xterm alternate screen around the app lifetime. */
  alternateScreen?: boolean;
}

export function enterAlternateScreen(): void {
  process.stdout.write(`${ENTER_ALTERNATE_SCREEN}${CLEAR_SCREEN}`);
}

export function leaveAlternateScreen(): void {
  process.stdout.write(LEAVE_ALTERNATE_SCREEN);
}

/**
 * Long-lived OpenTUI app: mount until the tree exits, then cleanup.
 * Prefer `startApp` when the host must remount (e.g. Git TTY handoff).
 */
export async function runApp(
  node: ReactNode,
  options: RunAppOptions = {}
): Promise<void> {
  const mountOptions =
    options.alternateScreen === undefined
      ? {}
      : { alternateScreen: options.alternateScreen };
  const instance = await mountTui(node, mountOptions);
  try {
    await instance.waitUntilExit();
  } finally {
    instance.cleanup();
  }
}

/**
 * Start a long-lived app and return a handle for remount / wait / dispose.
 * Uses OpenTUI alternate-screen mode when `alternateScreen` is true.
 */
export async function startApp(
  node: ReactNode,
  options: RunAppOptions = {}
): Promise<RunAppHandle> {
  const mountOptions =
    options.alternateScreen === undefined
      ? {}
      : { alternateScreen: options.alternateScreen };
  const instance: TuiInstance = await mountTui(node, mountOptions);
  const { ExitProvider, createElement } = await loadOpenTui();

  return {
    remount: (next) => {
      const exit: AppExit = (error) => {
        instance.settle(error);
        instance.cleanup();
      };
      instance.root.render(createElement(ExitProvider, { exit, children: next }));
    },
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
    dispose: () => {
      instance.unmount();
    },
  };
}

// ─── overlay bootstrap (CLI confirm without a pre-mounted tree) ─────────────

function waitForOverlayHost(timeoutMs = 5000): Promise<OverlayHostHandle> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      const host = getActiveOverlayHost();
      if (host) {
        resolve(host);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('OverlayHost bootstrap timed out'));
        return;
      }
      setTimeout(tick, 0);
    };
    tick();
  });
}

/**
 * Temporary AppShell + OverlayHost when no UI is mounted (CLI Modal/Layer).
 * Registered for `ui/overlay` withOverlayHost — overlay never imports this module.
 */
setOverlayBootstrap(async () => {
  const { AppShell, createElement } = await loadOpenTui();
  let finished = false;
  let instance: TuiInstance | undefined;
  let rejectInterrupt: ((error: InterruptError) => void) | undefined;

  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupt = reject;
  });
  void interrupted.catch(() => undefined);

  const dispose = async (): Promise<void> => {
    if (finished) return;
    finished = true;
    if (instance) {
      instance.settle();
      instance.cleanup();
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  };

  const settleOverlays = (): void => {
    const host = getActiveOverlayHost();
    host?.modal.destroyAll();
    host?.layer.destroyAll();
  };

  instance = await mountTui(
    createElement(AppShell, {
      cancelOnEscape: true,
      onCancel: () => {
        settleOverlays();
        void dispose();
      },
      onCtrlC: () => {
        rejectInterrupt?.(new InterruptError());
        void dispose();
      },
      children: null,
    })
  );

  const host = await waitForOverlayHost();
  return {
    host,
    dispose,
    interrupted,
  };
});
