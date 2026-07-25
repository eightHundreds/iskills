import { Box, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Pure Ink interactive root shell: first-frame visibility + global key callbacks.
 *
 * Does **not** own lifecycle — never calls `exit`, never throws InterruptError.
 * Hosts (`runScreen` / `BrowserApp`) decide how to settle or tear down.
 *
 * - Ctrl+C → `onCtrlC` only
 * - Esc → `onCancel` when `cancelOnEscape`
 * - First frame hidden until useInput / raw mode are ready
 */
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

  return <Box display={ready ? 'flex' : 'none'}>{children}</Box>;
}
