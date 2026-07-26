import type { ReactNode } from 'react';
import type { FooterItem } from '../footer/types.js';

/** Full-page replace slot options. */
export interface LayerOpenOptions<T> {
  content: (close: (value: T) => void) => ReactNode;
  /**
   * Settled when the slot is destroyed without `close` (e.g. host teardown).
   * Defaults to `undefined as T` — pass `[]` for multi-select cancel semantics.
   */
  destroyValue?: T;
  /** Left footer items while this layer is top-most (no modal). */
  footerItems?: FooterItem[];
}

export interface LayerApi {
  open: <T>(options: LayerOpenOptions<T>) => Promise<T>;
  destroyAll: () => void;
  readonly isOpen: boolean;
}

export interface ModalConfirmOptions {
  title: string;
  message: string;
  details?: string[];
  /** Default choice when user presses Enter. Default false → y/N. */
  defaultValue?: boolean;
  /** Override default footer items for this confirm. */
  footerItems?: FooterItem[];
}

export interface ModalInfoOptions {
  title: string;
  content: string[];
  width?: number;
  /** Total framed rows including borders; FramedPanel defaults from terminal height. */
  maxHeight?: number;
  muteLastContent?: boolean;
  footerItems?: FooterItem[];
}

export interface ModalOpenOptions<T> {
  content: (close: (value: T) => void) => ReactNode;
  /** Settled when the slot is destroyed without `close`. Default: `undefined as T`. */
  destroyValue?: T;
  footerItems?: FooterItem[];
}

export interface ModalApi {
  confirm: (options: ModalConfirmOptions) => Promise<boolean>;
  info: (options: ModalInfoOptions) => Promise<void>;
  open: <T>(options: ModalOpenOptions<T>) => Promise<T>;
  destroyAll: () => void;
  readonly isOpen: boolean;
}

/** Shell-level dismiss policy for absolute overlays. */
export type ModalDismissKeys = 'escape' | 'escape-or-soft';

/** @deprecated Prefer ModalConfirmOptions — alias for older call sites. */
export type AppModalConfirmOptions = ModalConfirmOptions;
/** @deprecated Prefer ModalInfoOptions */
export type AppModalInfoOptions = ModalInfoOptions;
/** @deprecated Prefer ModalOpenOptions */
export type AppModalOpenOptions<T> = ModalOpenOptions<T>;
