import { Box, useInput } from 'ink';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Pure Ink interactive root shell: first-frame visibility + global key callbacks
 * + a generic layer slot that descendants can open via {@link useAppShellLayer}.
 *
 * Does **not** own lifecycle — never calls `exit`, never throws InterruptError.
 * Hosts (`runScreen` / browser entry) decide how to settle or tear down.
 *
 * - Ctrl+C → `onCtrlC` only
 * - Esc → `onCancel` when `cancelOnEscape`
 * - Layer → when open, replaces `children` (same tree, host-level mount point)
 */

export interface AppShellLayerApi {
  /** Present content at the shell mount point (replaces children until closed). */
  open: (node: ReactNode) => void;
  /** Dismiss the layer and show children again. */
  close: () => void;
  /** Whether a layer is currently open. */
  isOpen: boolean;
}

const AppShellLayerContext = createContext<AppShellLayerApi | null>(null);

/**
 * Descendants of {@link AppShell} can open host-level content (dialogs / prompts)
 * without prop-drilling. Throws if used outside AppShell.
 */
export function useAppShellLayer(): AppShellLayerApi {
  const api = useContext(AppShellLayerContext);
  if (!api) {
    throw new Error('useAppShellLayer must be used within AppShell');
  }
  return api;
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
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<ReactNode>(null);

  const open = useCallback((node: ReactNode) => {
    setLayer(node);
  }, []);

  const close = useCallback(() => {
    setLayer(null);
  }, []);

  const api = useMemo(
    (): AppShellLayerApi => ({
      open,
      close,
      isOpen: layer !== null,
    }),
    [open, close, layer]
  );

  useInput((input, key) => {
    if (key.ctrl && input === 'c') onCtrlC?.();
    else if (cancelOnEscape && key.escape) onCancel?.();
  });

  useEffect(() => {
    // Ink installs useInput listeners in passive effects. Do not show an
    // interactive tree until those listeners and raw mode are active, or a
    // fast keypress can be echoed by the terminal and lost between screens.
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AppShellLayerContext.Provider value={api}>
      <Box display={ready ? 'flex' : 'none'} flexDirection="column">
        {layer ?? children}
      </Box>
    </AppShellLayerContext.Provider>
  );
}
