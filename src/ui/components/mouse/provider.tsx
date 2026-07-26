import { useStdin, useStdout, type DOMElement } from 'ink';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { getElementBounds, pointInBounds } from './bounds.js';
import { parseLeftPresses } from './parse.js';

/** xterm button tracking + SGR coords (clicks only, no all-motion). */
const ENABLE = '\u001B[?1000h\u001B[?1006h';
const DISABLE = '\u001B[?1000l\u001B[?1006l';

/** Root surface: main chrome (tabs, list hit targets). Always at stack bottom. */
export const POINTER_SURFACE_BASE = 'base';

type ClickHandler = () => void;

type Registration = {
  ref: RefObject<DOMElement | null>;
  onClick: ClickHandler;
  /** Which interaction surface this target belongs to. */
  surface: string;
};

type MouseRegistry = {
  register: (id: string, registration: Registration) => () => void;
  /** Push exclusive surface (modal / filter). Only top receives hits. */
  pushSurface: (surface: string) => void;
  popSurface: (surface: string) => void;
};

const MouseRegistryContext = createContext<MouseRegistry | null>(null);
/** Nearest {@link PointerSurface} id; registrations inherit this. */
const PointerSurfaceIdContext = createContext<string>(POINTER_SURFACE_BASE);

/**
 * Owns terminal mouse mode + stdin parse + hit-test dispatch.
 * Pattern from @ink-tools/ink-mouse; copy-owned, left-click only.
 *
 * **Interaction surfaces** (stack, not z-index): only the top surface's
 * targets receive clicks. Exclusive UI (modal, filter) pushes a surface so
 * base chrome does not need per-component `mouseActive` flags.
 */
export function MouseProvider({
  children,
  autoEnable = true,
}: {
  children: ReactNode;
  autoEnable?: boolean;
}): ReactNode {
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const targets = useRef(new Map<string, Registration>());
  /** Bottom = base; higher exclusive contexts on top. */
  const surfaceStack = useRef<string[]>([POINTER_SURFACE_BASE]);

  const register = useCallback((id: string, registration: Registration) => {
    targets.current.set(id, registration);
    return () => {
      targets.current.delete(id);
    };
  }, []);

  const pushSurface = useCallback((surface: string) => {
    if (surface === POINTER_SURFACE_BASE) return;
    surfaceStack.current.push(surface);
  }, []);

  const popSurface = useCallback((surface: string) => {
    if (surface === POINTER_SURFACE_BASE) return;
    const stack = surfaceStack.current;
    const index = stack.lastIndexOf(surface);
    if (index > 0) stack.splice(index, 1);
  }, []);

  const registry = useMemo<MouseRegistry>(
    () => ({ register, pushSurface, popSurface }),
    [register, pushSurface, popSurface]
  );

  useEffect(() => {
    const tty = Boolean(stdin?.isTTY && stdout?.isTTY);
    if (autoEnable && tty) {
      stdout.write(ENABLE);
    }

    const onData = (chunk: Buffer | string): void => {
      const input = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const presses = parseLeftPresses(input);
      if (!presses.length) return;
      const top =
        surfaceStack.current[surfaceStack.current.length - 1] ?? POINTER_SURFACE_BASE;
      for (const press of presses) {
        for (const { ref, onClick, surface } of targets.current.values()) {
          if (surface !== top) continue;
          const bounds = getElementBounds(ref.current);
          if (bounds && pointInBounds(press.x, press.y, bounds)) {
            onClick();
            return;
          }
        }
      }
    };

    stdin?.on('data', onData);
    return () => {
      stdin?.off('data', onData);
      if (autoEnable && tty) {
        stdout.write(DISABLE);
      }
    };
  }, [autoEnable, stdin, stdout]);

  return (
    <MouseRegistryContext.Provider value={registry}>{children}</MouseRegistryContext.Provider>
  );
}

/**
 * Push an exclusive interaction surface while mounted.
 * Children register clicks on this surface; base chrome is muted until unmount.
 */
export function PointerSurface({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}): ReactNode {
  const registry = useContext(MouseRegistryContext);

  useEffect(() => {
    if (!registry) return undefined;
    registry.pushSurface(id);
    return () => {
      registry.popSurface(id);
    };
  }, [registry, id]);

  return (
    <PointerSurfaceIdContext.Provider value={id}>{children}</PointerSurfaceIdContext.Provider>
  );
}

/**
 * Register a left-click hit target on the nearest surface.
 * No-op outside {@link MouseProvider}.
 */
export function useOnClick(
  ref: RefObject<DOMElement | null>,
  onClick: ClickHandler | null | undefined
): void {
  const registry = useContext(MouseRegistryContext);
  const surface = useContext(PointerSurfaceIdContext);
  const idRef = useRef(`click-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!registry || !onClick) return undefined;
    return registry.register(idRef.current, { ref, onClick, surface });
  }, [registry, ref, onClick, surface]);
}
