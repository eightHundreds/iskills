
import { useInput } from '../components/use-input.js';
import {
  consumeFocusedTextInputCtrlC,
  textInputHasFocus,
} from '../components/text-input-ctrl-c.js';
import { useEffect, useState, type ReactNode } from 'react';
import { MouseProvider } from '../components/mouse/index.js';
import {
  OverlayHost,
  useOverlayBusy,
} from '../overlay/host.js';
import { useApp } from '../tui/hooks.js';
import { OverlayOnlyFooter } from './footer.js';
import { InterruptError } from './terminal.js';

/**
 * Pure interactive shell: first-frame visibility + global key callbacks.
 * Composes {@link OverlayHost} for Layer / Modal slots — does not own overlay logic.
 *
 * Hosts may pass `onCtrlC` to abort in-flight work before tearing down.
 * If omitted, Ctrl+C still interrupts the session (`InterruptError` → exit 130).
 *
 * - Ctrl+C → interrupt, except an opt-in text field (collection remote) may
 *   consume the first press to clear; a second press within 1s still interrupts
 * - Esc → `onCancel` when `cancelOnEscape` and overlay is not busy
 * - bottomBar defaults to overlay-only footer (outside Layer replace region)
 */

// Re-export overlay hooks for gradual migration (prefer `ui/overlay`).
export {
  useLayer,
  useModal,
  useOverlayBusy,
} from '../overlay/host.js';
export type {
  AppModalConfirmOptions,
  AppModalInfoOptions,
  AppModalOpenOptions,
  LayerApi,
  LayerOpenOptions,
  ModalApi,
  ModalConfirmOptions,
  ModalInfoOptions,
  ModalOpenOptions,
} from '../overlay/types.js';

export function AppShell({
  cancelOnEscape = false,
  onCancel,
  onCtrlC,
  bottomBar,
  children,
}: {
  cancelOnEscape?: boolean;
  onCancel?: () => void;
  onCtrlC?: () => void;
  /** Footer row outside Layer replace region. Default: overlay-only footer. */
  bottomBar?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Do not show an interactive tree until key listeners are active, or a
    // fast keypress can be echoed by the terminal and lost between screens.
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <MouseProvider>
      <OverlayHost
        bottomBar={
          ready ? (bottomBar ?? <OverlayOnlyFooter />) : null
        }
      >
        <AppShellBody
          ready={ready}
          cancelOnEscape={cancelOnEscape}
          {...(onCancel ? { onCancel } : {})}
          {...(onCtrlC ? { onCtrlC } : {})}
        >
          {children}
        </AppShellBody>
      </OverlayHost>
    </MouseProvider>
  );
}

/** First-frame gate + global Esc/Ctrl+C; must sit under {@link OverlayHost}. */
function AppShellBody({
  ready,
  cancelOnEscape = false,
  onCancel,
  onCtrlC,
  children,
}: {
  ready: boolean;
  cancelOnEscape?: boolean;
  onCancel?: () => void;
  onCtrlC?: () => void;
  children: ReactNode;
}): ReactNode {
  const busy = useOverlayBusy();
  const { exit } = useApp();

  useInput((input, key, event) => {
    if (key.ctrl && input === 'c') {
      if (textInputHasFocus()) {
        if (event.eventType === 'repeat' || event.repeated) return;
        if (consumeFocusedTextInputCtrlC()) return;
      }
      if (onCtrlC) onCtrlC();
      else exit(new InterruptError());
      return;
    }
    if (!busy && cancelOnEscape && key.escape) {
      onCancel?.();
    }
  });

  return (
    <box
      visible={ready}
      flexDirection="column"
      width="100%"
      height="100%"
    >
      {children}
    </box>
  );
}
