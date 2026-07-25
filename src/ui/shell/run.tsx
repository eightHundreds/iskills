import { render, useApp, type Instance } from 'ink';
import type { ReactNode } from 'react';
import {
  getActiveOverlayHost,
  setOverlayBootstrap,
  type OverlayHostHandle,
} from '../overlay/bridge.js';
import { InterruptError } from './terminal.js';
import { AppShell } from './app-shell.js';

/**
 * Ink UI runtime (shell package): mount registry + session runners + AppShell.
 *
 * - `mountInk` / `closeInk` — process-level active instance
 * - `runScreen` — one-shot Promise screen (`ui/prompts` / `ui/search`)
 * - `startApp` / `runApp` — long-lived tree (`ui/browser`); remount via handle
 * - registers overlay bootstrap so command `confirm` can spin a temporary host
 */

// ─── mount registry ─────────────────────────────────────────────────────────

let activeInstance: Instance | undefined;

/** Mount a root node; replaces the process-level active instance pointer. */
export function mountInk(node: ReactNode): Instance {
  const instance = render(node, { exitOnCtrlC: false });
  activeInstance = instance;
  return instance;
}

/** Cleanup after exit/unmount; clear active if it matches. */
export function releaseInk(instance: Instance): void {
  instance.cleanup();
  if (activeInstance === instance) activeInstance = undefined;
}

/** Unmount + cleanup one instance; clears active if it matches. */
export function unmountInk(instance: Instance): void {
  instance.unmount();
  releaseInk(instance);
}

/** Force-unmount whatever is active (CLI main `finally`). */
export function closeInk(): void {
  if (!activeInstance) return;
  unmountInk(activeInstance);
}

// ─── one-shot screen ────────────────────────────────────────────────────────

function ExitBridge({
  register,
}: {
  register: (exit: (error?: Error | undefined) => void) => void;
}): null {
  const { exit } = useApp();
  register(exit);
  return null;
}

/**
 * One-shot screen: mount → await finish/cancel/interrupt → unmount.
 *
 * - Esc → resolve `cancelledValue` when `cancelOnEscape`
 * - Ctrl+C → reject `InterruptError`
 * - `finish(value)` → resolve value
 */
export function runScreen<T>(
  cancelledValue: T,
  component: (finish: (value: T) => void) => ReactNode,
  cancelOnEscape = true
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let exit: ((error?: Error | undefined) => void) | undefined;
    let instance: Instance;

    const settle = (complete: () => void): void => {
      if (finished) return;
      finished = true;
      const exited = instance.waitUntilExit();
      if (exit) exit();
      else instance.unmount();
      void exited.then(
        () => {
          releaseInk(instance);
          // React runs passive useInput cleanup after Ink resolves its exit promise.
          setTimeout(complete, 10);
        },
        (error: unknown) => {
          releaseInk(instance);
          reject(error);
        }
      );
    };

    const finish = (value: T): void => settle(() => resolve(value));

    instance = mountInk(
      <AppShell
        cancelOnEscape={cancelOnEscape}
        onCancel={() => finish(cancelledValue)}
        onCtrlC={() => settle(() => reject(new InterruptError()))}
      >
        <ExitBridge
          register={(value) => {
            exit = value;
          }}
        />
        {component(finish)}
      </AppShell>
    );
  });
}

// ─── long-lived app ─────────────────────────────────────────────────────────

const CLEAR_SCREEN = '\u001B[2J\u001B[H';
const ENTER_ALTERNATE_SCREEN = '\u001B[?1049h';
const LEAVE_ALTERNATE_SCREEN = '\u001B[?1049l';

export interface RunAppHandle {
  /** Replace the mounted tree (e.g. after suspendForSubprocess). */
  remount: (node: ReactNode) => void;
  waitUntilExit: () => Promise<void>;
  /** Unmount + cleanup (caller owns alternate-screen ANSI). */
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
 * Long-lived Ink app: mount until the tree exits, then cleanup.
 * Prefer `startApp` when the host must remount (e.g. Git TTY handoff).
 */
export async function runApp(
  node: ReactNode,
  options: RunAppOptions = {}
): Promise<void> {
  if (options.alternateScreen) enterAlternateScreen();
  const instance = mountInk(node);
  try {
    await instance.waitUntilExit();
  } finally {
    unmountInk(instance);
    if (options.alternateScreen) leaveAlternateScreen();
  }
}

/**
 * Start a long-lived app and return a handle for remount / wait / dispose.
 * Does not manage alternate screen — browser pairs this with enter/leave helpers.
 */
export function startApp(node: ReactNode): RunAppHandle {
  let instance: Instance = mountInk(node);
  return {
    remount: (next) => {
      unmountInk(instance);
      instance = mountInk(next);
    },
    waitUntilExit: async () => {
      await instance.waitUntilExit();
    },
    dispose: () => {
      unmountInk(instance);
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
 * Temporary AppShell + OverlayHost for imperative confirm when no UI is mounted.
 * Registered for `ui/overlay` withOverlayHost — overlay never imports this module.
 */
setOverlayBootstrap(async () => {
  let finished = false;
  let exit: ((error?: Error | undefined) => void) | undefined;
  let instance: Instance;

  const dispose = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (finished) {
        resolve();
        return;
      }
      finished = true;
      const exited = instance.waitUntilExit();
      if (exit) exit();
      else instance.unmount();
      void exited.then(
        () => {
          releaseInk(instance);
          setTimeout(resolve, 10);
        },
        (error: unknown) => {
          releaseInk(instance);
          reject(error);
        }
      );
    });

  instance = mountInk(
    <AppShell
      cancelOnEscape
      onCancel={() => {
        getActiveOverlayHost()?.modal.destroyAll();
        void dispose();
      }}
      onCtrlC={() => {
        void dispose().finally(() => {
          // Interrupt is surfaced by the caller if needed; tear down the shell.
        });
      }}
    >
      <ExitBridge
        register={(value) => {
          exit = value;
        }}
      />
    </AppShell>
  );

  const host = await waitForOverlayHost();
  return {
    host,
    dispose,
  };
});
