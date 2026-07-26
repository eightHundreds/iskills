/**
 * Overlay package: Layer / Modal host slots independent of AppShell.
 * AppShell only composes {@link OverlayHost} (first-frame gate + global keys).
 *
 * Imperative entry (antd-style): {@link Modal} / {@link Layer} static APIs.
 * In-tree hooks: {@link useModal} / {@link useLayer}.
 */
export {
  OverlayHost,
  useLayer,
  useModal,
  useOverlayBusy,
  useOverlayFooterItems,
} from './host.js';
export { Layer, Modal } from './static.js';
export {
  getActiveOverlayHost,
  registerOverlayHost,
  setOverlayBootstrap,
  withOverlayHost,
  type OverlayBootstrapSession,
  type OverlayHostHandle,
} from './bridge.js';
export type {
  AppModalConfirmOptions,
  AppModalInfoOptions,
  AppModalOpenOptions,
  LayerApi,
  LayerOpenOptions,
  ModalApi,
  ModalConfirmOptions,
  ModalDismissKeys,
  ModalInfoOptions,
  ModalOpenOptions,
} from './types.js';
