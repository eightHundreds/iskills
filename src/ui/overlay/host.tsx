import { Box, useInput, useStdout } from 'ink';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { registerOverlayHost } from './bridge.js';
import { renderConfirmPanel, renderInfoPanel } from './dialogs.js';
import { usePromiseSlot } from './slot.js';
import type {
  LayerApi,
  LayerOpenOptions,
  ModalApi,
  ModalConfirmOptions,
  ModalInfoOptions,
  ModalOpenOptions,
} from './types.js';

const LayerContext = createContext<LayerApi | null>(null);
const ModalContext = createContext<ModalApi | null>(null);
const BusyContext = createContext(false);

/**
 * Full-page host slot. Replaces OverlayHost children until closed.
 */
export function useLayer(): LayerApi {
  const api = useContext(LayerContext);
  if (!api) throw new Error('useLayer must be used within OverlayHost');
  return api;
}

/**
 * Absolute overlay host slot. Children stay mounted; frame is centered on top.
 */
export function useModal(): ModalApi {
  const api = useContext(ModalContext);
  if (!api) throw new Error('useModal must be used within OverlayHost');
  return api;
}

/**
 * True when a layer or modal is open — freeze child `useInput` with
 * `{ isActive: !useOverlayBusy() && … }`.
 */
export function useOverlayBusy(): boolean {
  return useContext(BusyContext);
}

/** @deprecated Prefer useOverlayBusy */
export const useShellBusy = useOverlayBusy;

/**
 * Independent overlay root: Layer + Modal promise slots.
 * Does not own process lifecycle, Ctrl+C, or first-frame gating — compose under AppShell (or any host).
 */
export function OverlayHost({ children }: { children: ReactNode }): ReactNode {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  const layerSlot = usePromiseSlot();
  const modalSlot = usePromiseSlot();

  const layerOpen = layerSlot.isOpen;
  const modalOpen = modalSlot.isOpen;
  const busy = layerOpen || modalOpen;

  const destroyModal = modalSlot.destroy;
  const destroyLayer = layerSlot.destroy;
  const openLayerSlot = layerSlot.open;
  const openModalSlot = modalSlot.open;

  const openLayer = useCallback(
    <T,>(options: LayerOpenOptions<T>): Promise<T> => {
      // Layer replaces the tree — drop any overlay first.
      destroyModal();
      return openLayerSlot(options.content, undefined as T);
    },
    [destroyModal, openLayerSlot]
  );

  const openModal = useCallback(
    <T,>(
      destroyValue: T,
      render: (close: (value: T) => void) => ReactNode,
      dismissKeys: 'escape' | 'escape-or-soft' = 'escape'
    ): Promise<T> =>
      openModalSlot(render, destroyValue, { dismissKeys }),
    [openModalSlot]
  );

  const confirm = useCallback(
    (options: ModalConfirmOptions): Promise<boolean> =>
      openModal(false, (close) => renderConfirmPanel(options, close)),
    [openModal]
  );

  const info = useCallback(
    (options: ModalInfoOptions): Promise<void> =>
      openModal(
        undefined,
        (close) => renderInfoPanel(options, () => close(undefined)),
        'escape-or-soft'
      ),
    [openModal]
  );

  const openModalContent = useCallback(
    <T,>(options: ModalOpenOptions<T>): Promise<T> =>
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

  useEffect(() => {
    registerOverlayHost({ layer: layerApi, modal: modalApi });
    return () => {
      registerOverlayHost(null);
    };
  }, [layerApi, modalApi]);

  // Host-level dismiss for absolute overlays (child useInput can miss keys).
  useInput((input, key) => {
    if (!modalSlot.isOpen) return;
    const meta = modalSlot.peekMeta();
    if (key.escape) {
      modalSlot.destroy();
      return;
    }
    if (
      meta?.dismissKeys === 'escape-or-soft' &&
      (key.return || input === ' ' || input === 'q')
    ) {
      modalSlot.destroy();
    }
  });

  return (
    <LayerContext.Provider value={layerApi}>
      <ModalContext.Provider value={modalApi}>
        <BusyContext.Provider value={busy}>
          <Box
            flexDirection="column"
            {...(modalOpen
              ? {
                  position: 'relative' as const,
                  width: cols,
                  height: rows,
                  overflow: 'hidden' as const,
                }
              : {})}
          >
            {layerOpen ? (
              layerSlot.node
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
                    {modalSlot.node}
                  </Box>
                ) : null}
              </>
            )}
          </Box>
        </BusyContext.Provider>
      </ModalContext.Provider>
    </LayerContext.Provider>
  );
}
