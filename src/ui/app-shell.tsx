import { Box, useApp, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import { InterruptError } from '../contracts/terminal.js';

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
  const { exit } = useApp();
  const [ready, setReady] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      exit(new InterruptError());
    } else if (cancelOnEscape && key.escape) onCancel?.();
  });

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return <Box display={ready ? 'flex' : 'none'}>{children}</Box>;
}
