/**
 * Ant Design–style static APIs over the active OverlayHost.
 *
 * - Reuses the mounted host when a tree is already up (Browser / long-lived shell).
 * - Bootstraps a temporary AppShell via {@link withOverlayHost} for bare CLI calls.
 *
 * Prefer these from command modules. Components still use {@link useModal} / {@link useLayer}.
 */
import { getActiveOverlayHost, withOverlayHost } from './bridge.js';
import type {
  LayerOpenOptions,
  ModalConfirmOptions,
  ModalInfoOptions,
  ModalOpenOptions,
} from './types.js';

/** Absolute overlay slot (confirm / info / small forms). */
export const Modal = {
  confirm(options: ModalConfirmOptions): Promise<boolean> {
    return withOverlayHost((host) => host.modal.confirm(options));
  },

  info(options: ModalInfoOptions): Promise<void> {
    return withOverlayHost((host) => host.modal.info(options));
  },

  open<T>(options: ModalOpenOptions<T>): Promise<T> {
    return withOverlayHost((host) => host.modal.open(options));
  },

  destroyAll(): void {
    getActiveOverlayHost()?.modal.destroyAll();
  },
} as const;

/** Full-page replace slot (lists, review screens, multi-step editors). */
export const Layer = {
  open<T>(options: LayerOpenOptions<T>): Promise<T> {
    return withOverlayHost((host) => host.layer.open(options));
  },

  destroyAll(): void {
    getActiveOverlayHost()?.layer.destroyAll();
  },
} as const;
