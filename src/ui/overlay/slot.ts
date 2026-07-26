import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FooterItem } from '../footer/types.js';
import type { ModalDismissKeys } from './types.js';

export interface SlotPendingMeta {
  dismissKeys?: ModalDismissKeys;
  footerItems?: FooterItem[];
}

interface PendingSlot {
  resolve: (value: unknown) => void;
  destroyValue: unknown;
  meta?: SlotPendingMeta;
}

/**
 * Promise + React node host slot (shared by Layer and Modal).
 * One open at a time: a new open settles the previous with destroyValue.
 */
export function usePromiseSlot(): {
  open: <T>(
    render: (close: (value: T) => void) => ReactNode,
    destroyValue: T,
    meta?: SlotPendingMeta
  ) => Promise<T>;
  settle: (value: unknown) => void;
  destroy: () => void;
  readonly isOpen: boolean;
  readonly node: ReactNode;
  /** Latest pending meta (for host-level key routing). */
  peekMeta: () => SlotPendingMeta | undefined;
} {
  const [node, setNode] = useState<ReactNode>(null);
  const pending = useRef<PendingSlot | null>(null);
  const openRef = useRef(false);
  openRef.current = node !== null;

  const settle = useCallback((value: unknown) => {
    const current = pending.current;
    pending.current = null;
    setNode(null);
    current?.resolve(value);
  }, []);

  const destroy = useCallback(() => {
    const current = pending.current;
    if (!current) {
      setNode(null);
      return;
    }
    settle(current.destroyValue);
  }, [settle]);

  const open = useCallback(
    <T,>(
      render: (close: (value: T) => void) => ReactNode,
      destroyValue: T,
      meta?: SlotPendingMeta
    ): Promise<T> => {
      if (pending.current) {
        const previous = pending.current;
        pending.current = null;
        previous.resolve(previous.destroyValue);
      }
      return new Promise<T>((resolve) => {
        pending.current = {
          resolve: (value) => resolve(value as T),
          destroyValue,
          ...(meta ? { meta } : {}),
        };
        setNode(render((value) => settle(value)));
      });
    },
    [settle]
  );

  const peekMeta = useCallback(
    (): SlotPendingMeta | undefined => pending.current?.meta,
    []
  );

  return {
    open,
    settle,
    destroy,
    isOpen: node !== null,
    node,
    peekMeta,
  };
}
