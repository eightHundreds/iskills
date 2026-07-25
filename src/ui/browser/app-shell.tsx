import { Box, useApp, useInput } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';
import { InterruptError } from '../../contracts/terminal.js';

/**
 * Ink 全屏应用的根壳层：统一全局按键与首帧可见性。
 *
 * - Ctrl+C：先调用 `onCtrlC`（例如中止进行中的请求），再以 InterruptError 退出命令（cli-tui 规范）。
 * - Esc：仅在 `cancelOnEscape` 为 true 时调用 `onCancel`；具体取消语义由调用方决定。
 * - 首帧延迟显示：Ink 的 useInput 在 passive effect 里注册，挂载完成前隐藏子树，避免首击被终端 echo 并丢失。
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
  const { exit } = useApp();
  const [ready, setReady] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      exit(new InterruptError());
    } else if (cancelOnEscape && key.escape) onCancel?.();
  });

  useEffect(() => {
    // 与 session.tsx CancelBoundary 相同：等 raw mode 与 input listener 就绪后再展示交互内容。
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return <Box display={ready ? 'flex' : 'none'}>{children}</Box>;
}
