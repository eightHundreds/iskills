import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
  type RefObject,
} from 'react';

/** Root surface: main chrome (tabs, list hit targets). Always at stack bottom. */
export const POINTER_SURFACE_BASE = 'base';

type ClickHandler = () => void;

type Registration = {
  ref: RefObject<unknown>;
  onClick: ClickHandler;
  surface: string;
};

type MouseRegistry = {
  /** True when `surface` is the exclusive top of the stack (modal/filter). */
  isTopSurface: (surface: string) => boolean;
  pushSurface: (surface: string) => void;
  popSurface: (surface: string) => void;
};

const MouseRegistryContext = createContext<MouseRegistry | null>(null);
const PointerSurfaceIdContext = createContext<string>(POINTER_SURFACE_BASE);

/**
 * Tracks exclusive pointer surfaces (modal / filter). Hit testing itself is
 * OpenTUI-native (`onMouse*` on boxes); this only gates product Clickable so
 * base chrome does not steal clicks while a modal is open.
 */
export function MouseProvider({
  children,
}: {
  children: ReactNode;
  /** @deprecated OpenTUI enables mouse on the renderer; ignored. */
  autoEnable?: boolean;
}): ReactNode {
  const surfaceStack = useMemo(
    () => ({ current: [POINTER_SURFACE_BASE] as string[] }),
    []
  );

  const isTopSurface = useCallback(
    (surface: string) => {
      const stack = surfaceStack.current;
      return stack[stack.length - 1] === surface;
    },
    [surfaceStack]
  );

  const pushSurface = useCallback(
    (surface: string) => {
      if (surface === POINTER_SURFACE_BASE) return;
      surfaceStack.current.push(surface);
    },
    [surfaceStack]
  );

  const popSurface = useCallback(
    (surface: string) => {
      if (surface === POINTER_SURFACE_BASE) return;
      const stack = surfaceStack.current;
      const index = stack.lastIndexOf(surface);
      if (index > 0) stack.splice(index, 1);
    },
    [surfaceStack]
  );

  const registry = useMemo(
    () => ({ isTopSurface, pushSurface, popSurface }),
    [isTopSurface, popSurface, pushSurface]
  );

  return (
    <MouseRegistryContext.Provider value={registry}>
      {children}
    </MouseRegistryContext.Provider>
  );
}

/**
 * Marks an exclusive interaction surface (modal / filter). While mounted,
 * {@link Clickable} under base chrome will not fire.
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
    if (!registry || id === POINTER_SURFACE_BASE) return;
    registry.pushSurface(id);
    return () => registry.popSurface(id);
  }, [id, registry]);

  return (
    <PointerSurfaceIdContext.Provider value={id}>
      {children}
    </PointerSurfaceIdContext.Provider>
  );
}

export function usePointerSurfaceId(): string {
  return useContext(PointerSurfaceIdContext);
}

export function useMouseRegistry(): MouseRegistry | null {
  return useContext(MouseRegistryContext);
}

/** @deprecated Prefer {@link Clickable}; kept for API stability. */
export function useOnClick(
  _ref: RefObject<unknown>,
  _onClick: ClickHandler | null
): void {
  // no-op — OpenTUI hit-testing replaces ref registration
}
