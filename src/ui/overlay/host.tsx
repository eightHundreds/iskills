import { useStdout } from '../tui/index.js';
import { useInput } from '../components/use-input.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { PointerSurface } from '../components/mouse/index.js';
import {
  confirmFooterItems,
  infoFooterItems,
} from '../footer/resolve-footer.js';
import type { FooterItem } from '../footer/types.js';
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
/** modal > layer footer items; null when no overlay. */
const OverlayFooterContext = createContext<FooterItem[] | null>(null);

/**
 * Full-page host slot. Replaces OverlayHost main region until closed.
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

/**
 * Footer items for the top overlay (modal > layer), or null when none.
 */
export function useOverlayFooterItems(): FooterItem[] | null {
  return useContext(OverlayFooterContext);
}

/**
 * Independent overlay root: Layer + Modal promise slots.
 * Does not own process lifecycle, Ctrl+C, or first-frame gating — compose under AppShell (or any host).
 *
 * @param bottomChrome — rendered below the Layer replace region (always visible).
 */
export function OverlayHost({
  children,
  bottomChrome,
}: {
  children: ReactNode;
  bottomChrome?: ReactNode;
}): ReactNode {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  const layerSlot = usePromiseSlot();
  const modalSlot = usePromiseSlot();

  // Bump when slots open/close so footer items re-read meta.
  const [footerEpoch, setFooterEpoch] = useState(0);
  const bumpFooter = useCallback(() => setFooterEpoch((n) => n + 1), []);

  const layerOpen = layerSlot.isOpen;
  const modalOpen = modalSlot.isOpen;
  const busy = layerOpen || modalOpen;

  const destroyModal = modalSlot.destroy;
  const destroyLayer = layerSlot.destroy;
  const openLayerSlot = layerSlot.open;
  const openModalSlot = modalSlot.open;

  const openLayer = useCallback(
    <T,>(options: LayerOpenOptions<T>): Promise<T> => {
      destroyModal();
      bumpFooter();
      const destroyValue = ('destroyValue' in options
        ? options.destroyValue
        : undefined) as T;
      const resolvedMeta = {
        footerItems:
          options.footerItems !== undefined
            ? options.footerItems
            : infoFooterItems(),
      };
      return openLayerSlot(options.content, destroyValue, resolvedMeta).finally(bumpFooter);
    },
    [bumpFooter, destroyModal, openLayerSlot]
  );

  const openModal = useCallback(
    <T,>(
      destroyValue: T,
      render: (close: (value: T) => void) => ReactNode,
      dismissKeys: 'escape' | 'escape-or-soft' = 'escape',
      footerItems?: FooterItem[]
    ): Promise<T> => {
      bumpFooter();
      return openModalSlot(render, destroyValue, {
        dismissKeys,
        footerItems: footerItems ?? infoFooterItems(),
      }).finally(bumpFooter);
    },
    [bumpFooter, openModalSlot]
  );

  const confirm = useCallback(
    (options: ModalConfirmOptions): Promise<boolean> => {
      const defaultValue = options.defaultValue ?? false;
      const footerItems = options.footerItems ?? confirmFooterItems(defaultValue);
      return openModal(
        false,
        (close) => renderConfirmPanel(options, close),
        'escape',
        footerItems
      );
    },
    [openModal]
  );

  const info = useCallback(
    (options: ModalInfoOptions): Promise<void> =>
      openModal(
        undefined,
        (close) => renderInfoPanel(options, () => close(undefined)),
        'escape-or-soft',
        options.footerItems ?? infoFooterItems()
      ),
    [openModal]
  );

  const openModalContent = useCallback(
    <T,>(options: ModalOpenOptions<T>): Promise<T> => {
      const destroyValue = ('destroyValue' in options
        ? options.destroyValue
        : undefined) as T;
      return openModal(
        destroyValue,
        options.content,
        'escape',
        options.footerItems ?? infoFooterItems()
      );
    },
    [openModal]
  );

  const layerApi = useMemo(
    (): LayerApi => ({
      open: openLayer,
      destroyAll: () => {
        destroyLayer();
        bumpFooter();
      },
      isOpen: layerOpen,
    }),
    [openLayer, destroyLayer, layerOpen, bumpFooter]
  );

  const modalApi = useMemo(
    (): ModalApi => ({
      confirm,
      info,
      open: openModalContent,
      destroyAll: () => {
        destroyModal();
        bumpFooter();
      },
      isOpen: modalOpen,
    }),
    [confirm, info, openModalContent, destroyModal, modalOpen, bumpFooter]
  );

  // Register during render so static Modal/Layer works from child useEffects.
  // (Child effects run before parent effects; waiting until useEffect left a window
  // where withOverlayHost saw no host and tried a second createCliRenderer.)
  registerOverlayHost({ layer: layerApi, modal: modalApi });
  useEffect(() => {
    registerOverlayHost({ layer: layerApi, modal: modalApi });
    return () => {
      registerOverlayHost(null);
    };
  }, [layerApi, modalApi]);

  // Host-level dismiss for absolute overlays (child useInput can miss keys).
  // Layer Esc is left to the content (nested screens use Esc to go back).
  useInput((input, key) => {
    if (!modalSlot.isOpen) return;
    const meta = modalSlot.peekMeta();
    if (key.escape) {
      modalSlot.destroy();
      bumpFooter();
      return;
    }
    if (
      meta?.dismissKeys === 'escape-or-soft' &&
      (key.return || input === ' ' || input === 'q')
    ) {
      modalSlot.destroy();
      bumpFooter();
    }
  });

  // modal > layer; recompute when epoch/open flags change.
  const overlayFooterItems = useMemo((): FooterItem[] | null => {
    void footerEpoch;
    if (modalOpen) {
      return modalSlot.peekMeta()?.footerItems ?? infoFooterItems();
    }
    if (layerOpen) {
      return layerSlot.peekMeta()?.footerItems ?? infoFooterItems();
    }
    return null;
  }, [footerEpoch, modalOpen, layerOpen, modalSlot, layerSlot]);

  // Keep `children` mounted while a layer is open so AppShell (Ctrl+C,
  // first-frame gating) and long-lived trees (Browser) stay alive. Layer content
  // is a full-page visual replace of the *main* region only — bottomChrome stays.
  return (
    <LayerContext.Provider value={layerApi}>
      <ModalContext.Provider value={modalApi}>
        <BusyContext.Provider value={busy}>
          <OverlayFooterContext.Provider value={overlayFooterItems}>
            <box
              flexDirection="column"
              width="100%"
              height="100%"
              {...(modalOpen || layerOpen
                ? {
                    position: 'relative' as const,
                    width: cols,
                    height: rows,
                    overflow: 'hidden' as const,
                  }
                : {})}
            >
              <box flexDirection="column" flexGrow={1} minHeight={0}>
                <box
                  flexDirection="column"
                  visible={!layerOpen}
                  flexGrow={1}
                >
                  {children}
                </box>
                {layerOpen ? (
                  <PointerSurface id="layer">{layerSlot.node}</PointerSurface>
                ) : null}
              </box>
              {bottomChrome}
              {modalOpen ? (
                <PointerSurface id="modal">
                  {/*
                    Transparent full-screen host (no scrim wash). Dialogs paint
                    their own theme-aware solid panel via useModalChrome().
                  */}
                  <box
                    position="absolute"
                    width={cols}
                    height={rows}
                    flexDirection="column"
                    justifyContent="center"
                    alignItems="center"
                    zIndex={100}
                  >
                    {modalSlot.node}
                  </box>
                </PointerSurface>
              ) : null}
            </box>
          </OverlayFooterContext.Provider>
        </BusyContext.Provider>
      </ModalContext.Provider>
    </LayerContext.Provider>
  );
}
