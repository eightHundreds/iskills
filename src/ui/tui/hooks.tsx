/**
 * Session hooks: useApp / useStdout for product UI.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  useOnResize,
  useRenderer,
  useTerminalDimensions,
} from '@opentui/react';
import type { ThemeMode } from '@opentui/core';
import {
  panelColors,
  type PanelColors,
  type ThemeModeName,
} from '../components/colors.js';

export type AppExit = (error?: Error | undefined) => void;

const ExitContext = createContext<AppExit | null>(null);

export function ExitProvider({
  exit,
  children,
}: {
  exit: AppExit;
  children: ReactNode;
}): ReactNode {
  return <ExitContext.Provider value={exit}>{children}</ExitContext.Provider>;
}

/** Session: `{ exit }` to tear down the active OpenTUI session. */
export function useApp(): { exit: AppExit } {
  const exit = useContext(ExitContext);
  if (!exit) {
    throw new Error('useApp must be used within an OpenTUI ExitProvider');
  }
  return { exit };
}

type StdoutLike = {
  columns: number;
  rows: number;
  write: (chunk: string) => boolean;
};

/** Terminal size + write sink (OpenTUI dimensions + process.stdout). */
export function useStdout(): { stdout: StdoutLike } {
  const { width, height } = useTerminalDimensions();
  const [size, setSize] = useState({ width, height });
  useOnResize(
    useCallback((w: number, h: number) => {
      setSize({ width: w, height: h });
    }, [])
  );
  const stdout = useMemo<StdoutLike>(
    () => ({
      columns: size.width || process.stdout.columns || 80,
      rows: size.height || process.stdout.rows || 24,
      write: (chunk: string) => process.stdout.write(chunk),
    }),
    [size.height, size.width]
  );
  return { stdout };
}

/**
 * Terminal light/dark preference from OpenTUI (`renderer.themeMode`).
 * Falls back to dark until detection completes.
 */
export function useThemeMode(): ThemeModeName {
  const renderer = useRenderer() as {
    themeMode: ThemeMode | null;
    waitForThemeMode?: (timeoutMs?: number) => Promise<ThemeMode | null>;
    on: (event: string, listener: (mode: ThemeMode) => void) => void;
    off: (event: string, listener: (mode: ThemeMode) => void) => void;
  };
  const [mode, setMode] = useState<ThemeModeName>(
    () => (renderer.themeMode === 'light' ? 'light' : 'dark')
  );

  useEffect(() => {
    let cancelled = false;
    if (renderer.themeMode === 'light' || renderer.themeMode === 'dark') {
      setMode(renderer.themeMode);
    }
    const onTheme = (next: ThemeMode): void => {
      if (next === 'light' || next === 'dark') setMode(next);
    };
    renderer.on('theme_mode', onTheme);
    void renderer.waitForThemeMode?.(800).then((detected) => {
      if (cancelled) return;
      if (detected === 'light' || detected === 'dark') setMode(detected);
    });
    return () => {
      cancelled = true;
      renderer.off('theme_mode', onTheme);
    };
  }, [renderer]);

  return mode;
}

/** Modal panel fill/body/muted for the current terminal theme. */
export function usePanelColors(): PanelColors & { mode: ThemeModeName } {
  const mode = useThemeMode();
  return useMemo(() => ({ mode, ...panelColors(mode) }), [mode]);
}
