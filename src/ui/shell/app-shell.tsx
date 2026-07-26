import { Box, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import {
  OverlayHost,
  useOverlayBusy,
} from '../overlay/host.js';

/**
 * Pure Ink interactive shell: first-frame visibility + global key callbacks.
 * Composes {@link OverlayHost} for Layer / Modal slots — does not own overlay logic.
 *
 * Does **not** call `exit` or throw InterruptError.
 * Hosts (`runScreen` / browser entry) decide how to settle or tear down.
 *
 * - Ctrl+C → `onCtrlC` only
 * - Esc → `onCancel` when `cancelOnEscape` and overlay is not busy
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

/** First-frame gate + global Esc/Ctrl+C; must sit under {@link OverlayHost}. */
function AppShellBody({
  cancelOnEscape = false,
  onCancel,
  onCtrlC,
  children,
}: {
  cancelOnEscape?: boolean;
  onCancel?: () => void;
  onCtrlC?: () => void;
  children: ReactNode;
}): ReactNode {
  const busy = useOverlayBusy();
  const [ready, setReady] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    if (!busy && cancelOnEscape && key.escape) {
      onCancel?.();
    }
  });

  useEffect(() => {
    // Ink installs useInput listeners in passive effects. Do not show an
    // interactive tree until those listeners and raw mode are active, or a
    // fast keypress can be echoed by the terminal and lost between screens.
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Box display={ready ? 'flex' : 'none'} flexDirection="column">
      {children}
    </Box>
  );
}

export function AppShell({
  cancelOnEscape = false,
  onCancel,
  onCtrlC,
  children,
}: {
  cancelOnEscape?: boolean;
  onCancel?: () => void;
  onCtrlC?: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <OverlayHost>
      <AppShellBody
        cancelOnEscape={cancelOnEscape}
        {...(onCancel ? { onCancel } : {})}
        {...(onCtrlC ? { onCtrlC } : {})}
      >
        {children}
      </AppShellBody>
    </OverlayHost>
  );
}
