import { Box } from 'ink';
import { useInput } from '../components/use-input.js';
import { useEffect, useState, type ReactNode } from 'react';
import { MouseProvider } from '../components/mouse/index.js';
import {
  OverlayHost,
  useOverlayBusy,
} from '../overlay/host.js';
import { OverlayOnlyFooter } from './footer.js';

/**
 * Pure Ink interactive shell: first-frame visibility + global key callbacks.
 * Composes {@link OverlayHost} for Layer / Modal slots — does not own overlay logic.
 *
 * Does **not** call `exit` or throw InterruptError.
 * Hosts (`runScreen` / browser entry) decide how to settle or tear down.
 *
 * - Ctrl+C → `onCtrlC` only
 * - Esc → `onCancel` when `cancelOnEscape` and overlay is not busy
 * - bottomChrome defaults to overlay-only footer (outside Layer replace region)
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
  bottomChrome,
  children,
}: {
  cancelOnEscape?: boolean;
  onCancel?: () => void;
  onCtrlC?: () => void;
  /** Footer row outside Layer replace region. Default: overlay-only footer. */
  bottomChrome?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Ink installs useInput listeners in passive effects. Do not show an
    // interactive tree until those listeners and raw mode are active, or a
    // fast keypress can be echoed by the terminal and lost between screens.
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <MouseProvider>
      <OverlayHost
        bottomChrome={
          ready ? (bottomChrome ?? <OverlayOnlyFooter />) : null
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

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    if (!busy && cancelOnEscape && key.escape) {
      onCancel?.();
    }
  });

  return (
    <Box display={ready ? 'flex' : 'none'} flexDirection="column">
      {children}
    </Box>
  );
}
