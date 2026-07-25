import { Box, useInput, useStdout } from 'ink';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FramedPanel } from './components/framed-panel.js';
import { isReturn } from './components/text.js';

/**
 * Pure Ink interactive root shell: first-frame visibility + global key callbacks
 * + two host slots (antd-style hooks):
 *
 * - {@link useLayer} — full-page replace (`layer ?? children`)
 * - {@link useModal} — absolute centered overlay; children stay mounted so the
 *   list/footer show through around the frame
 *
 * Does **not** own lifecycle — never calls `exit`, never throws InterruptError.
 * Hosts (`runScreen` / browser entry) decide how to settle or tear down.
 *
 * - Ctrl+C → `onCtrlC` only
 * - Esc → `onCancel` when `cancelOnEscape` and neither slot is open
 */

// ─── Layer (replace) ────────────────────────────────────────────────────────

export interface LayerOpenOptions<T> {
  content: (close: (value: T) => void) => ReactNode;
}

export interface LayerApi {
  open: <T>(options: LayerOpenOptions<T>) => Promise<T>;
  destroyAll: () => void;
  readonly isOpen: boolean;
}

// ─── Modal (absolute overlay) ───────────────────────────────────────────────

export interface AppModalConfirmOptions {
  title: string;
  message: string;
  details?: string[];
  /** Default choice when user presses Enter. Default false → y/N. */
  defaultValue?: boolean;
}

export interface AppModalInfoOptions {
  title: string;
  content: string[];
  width?: number;
  muteLastContent?: boolean;
}

export interface AppModalOpenOptions<T> {
  content: (close: (value: T) => void) => ReactNode;
}

export interface ModalApi {
  confirm: (options: AppModalConfirmOptions) => Promise<boolean>;
  info: (options: AppModalInfoOptions) => Promise<void>;
  open: <T>(options: AppModalOpenOptions<T>) => Promise<T>;
  destroyAll: () => void;
  readonly isOpen: boolean;
}

// ─── Shared pending slot ────────────────────────────────────────────────────

interface PendingSlot {
  resolve: (value: unknown) => void;
  destroyValue: unknown;
  /** Help-style overlays: any common dismiss key closes at shell level. */
  dismissKeys?: 'escape' | 'escape-or-soft';
}

const LayerContext = createContext<LayerApi | null>(null);
const ModalContext = createContext<ModalApi | null>(null);
const ShellBusyContext = createContext(false);

/**
 * Full-page host slot. Replaces AppShell children until closed.
 * Use for InstallReview / Select / TextInput and other full-screen flows.
 */
export function useLayer(): LayerApi {
  const api = useContext(LayerContext);
  if (!api) throw new Error('useLayer must be used within AppShell');
  return api;
}

/**
 * Absolute overlay host slot. Children stay mounted; frame is centered on top.
 * Use for confirm / help / more-actions so the list shows through.
 */
export function useModal(): ModalApi {
  const api = useContext(ModalContext);
  if (!api) throw new Error('useModal must be used within AppShell');
  return api;
}

/**
 * True when a layer or modal is open — freeze child `useInput` with
 * `{ isActive: !useShellBusy() && … }`.
 */
export function useShellBusy(): boolean {
  return useContext(ShellBusyContext);
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
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  const [ready, setReady] = useState(false);
  const [layerNode, setLayerNode] = useState<ReactNode>(null);
  const [modalNode, setModalNode] = useState<ReactNode>(null);
  const layerPending = useRef<PendingSlot | null>(null);
  const modalPending = useRef<PendingSlot | null>(null);
  /** Latest open flags for useInput (avoids stale closures on Esc). */
  const modalOpenRef = useRef(false);
  const layerOpenRef = useRef(false);

  const layerOpen = layerNode !== null;
  const modalOpen = modalNode !== null;
  layerOpenRef.current = layerOpen;
  modalOpenRef.current = modalOpen;
  const busy = layerOpen || modalOpen;

  const settleLayer = useCallback((value: unknown) => {
    const pending = layerPending.current;
    layerPending.current = null;
    setLayerNode(null);
    pending?.resolve(value);
  }, []);

  const settleModal = useCallback((value: unknown) => {
    const pending = modalPending.current;
    modalPending.current = null;
    setModalNode(null);
    pending?.resolve(value);
  }, []);

  const destroyLayer = useCallback(() => {
    const pending = layerPending.current;
    if (!pending) {
      setLayerNode(null);
      return;
    }
    settleLayer(pending.destroyValue);
  }, [settleLayer]);

  const destroyModal = useCallback(() => {
    const pending = modalPending.current;
    if (!pending) {
      setModalNode(null);
      return;
    }
    settleModal(pending.destroyValue);
  }, [settleModal]);

  const openLayer = useCallback(
    <T,>(options: LayerOpenOptions<T>): Promise<T> => {
      // Layer replaces the tree — drop any overlay first.
      destroyModal();
      if (layerPending.current) {
        const previous = layerPending.current;
        layerPending.current = null;
        previous.resolve(previous.destroyValue);
      }
      return new Promise<T>((resolve) => {
        layerPending.current = {
          resolve: (value) => resolve(value as T),
          destroyValue: undefined as T,
        };
        setLayerNode(options.content((value) => settleLayer(value)));
      });
    },
    [destroyModal, settleLayer]
  );

  const openModal = useCallback(
    <T,>(
      destroyValue: T,
      render: (close: (value: T) => void) => ReactNode,
      dismissKeys: PendingSlot['dismissKeys'] = 'escape'
    ): Promise<T> => {
      if (modalPending.current) {
        const previous = modalPending.current;
        modalPending.current = null;
        previous.resolve(previous.destroyValue);
      }
      return new Promise<T>((resolve) => {
        modalPending.current = {
          resolve: (value) => resolve(value as T),
          destroyValue,
          dismissKeys,
        };
        setModalNode(render((value) => settleModal(value)));
      });
    },
    [settleModal]
  );

  const confirm = useCallback(
    (options: AppModalConfirmOptions): Promise<boolean> => {
      const defaultValue = options.defaultValue ?? false;
      const details = options.details ?? [];
      const content = [
        options.message,
        ...details,
        defaultValue ? '(Y/n)' : '(y/N)',
      ];
      return openModal(false, (close) => (
        <FramedPanel
          title={` ${options.title} `}
          content={content}
          width={76}
          muteLastContent
          onEscape={() => close(false)}
          onKey={(input, key) => {
            const choice = input.trim().toLowerCase();
            if (choice === 'y') return close(true);
            if (choice === 'n') return close(false);
            if (isReturn(input, key.return)) return close(defaultValue);
          }}
        />
      ));
    },
    [openModal]
  );

  const info = useCallback(
    (options: AppModalInfoOptions): Promise<void> =>
      openModal(
        undefined,
        (close) => (
          <FramedPanel
            title={options.title}
            content={options.content}
            width={options.width ?? 76}
            muteLastContent={options.muteLastContent ?? false}
            onEscape={() => close(undefined)}
            onKey={(input, key) => {
              if (key.return || input === 'q' || input === ' ') close(undefined);
            }}
          />
        ),
        'escape-or-soft'
      ),
    [openModal]
  );

  const openModalContent = useCallback(
    <T,>(options: AppModalOpenOptions<T>): Promise<T> =>
      openModal(undefined as T, options.content),
    [openModal]
  );

  const layerApi = useMemo(
    (): LayerApi => ({
      open: openLayer,
      destroyAll: destroyLayer,
      isOpen: layerOpen,
    }),
    [openLayer, destroyLayer, layerOpen]
  );

  const modalApi = useMemo(
    (): ModalApi => ({
      confirm,
      info,
      open: openModalContent,
      destroyAll: destroyModal,
      isOpen: modalOpen,
    }),
    [confirm, info, openModalContent, destroyModal, modalOpen]
  );

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC?.();
      return;
    }
    // Shell-level dismiss for absolute overlays (child useInput can miss keys).
    const pending = modalPending.current;
    if (pending) {
      if (key.escape) {
        destroyModal();
        return;
      }
      if (
        pending.dismissKeys === 'escape-or-soft' &&
        (key.return || input === ' ' || input === 'q')
      ) {
        destroyModal();
        return;
      }
    }
    if (!layerOpenRef.current && !modalOpenRef.current && cancelOnEscape && key.escape) {
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
    <LayerContext.Provider value={layerApi}>
      <ModalContext.Provider value={modalApi}>
        <ShellBusyContext.Provider value={busy}>
          <Box
            display={ready ? 'flex' : 'none'}
            flexDirection="column"
            {...(modalOpen
              ? {
                  position: 'relative' as const,
                  width: cols,
                  // Explicit canvas so absolute children can center without
                  // stretching the live browser layout when closed.
                  height: rows,
                  overflow: 'hidden' as const,
                }
              : {})}
          >
            {layerOpen ? (
              layerNode
            ) : (
              <>
                {children}
                {modalOpen ? (
                  <Box
                    position="absolute"
                    width={cols}
                    height={rows}
                    justifyContent="center"
                    alignItems="center"
                  >
                    {modalNode}
                  </Box>
                ) : null}
              </>
            )}
          </Box>
        </ShellBusyContext.Provider>
      </ModalContext.Provider>
    </LayerContext.Provider>
  );
}
