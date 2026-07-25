/**
 * Overlay package: Layer / Modal host slots independent of AppShell.
 * AppShell is only a common chrome that composes {@link OverlayHost}.
 */
export { OverlayHost, useLayer, useModal, useOverlayBusy, useShellBusy } from './host.js';
export { confirm } from './confirm.js';
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
