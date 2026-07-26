import type { ReactNode } from 'react';
import { FramedPanel } from '../components/framed-panel.js';
import { isReturn } from '../components/text.js';
import type { ModalConfirmOptions, ModalInfoOptions } from './types.js';

/** Confirm panel content for ModalApi.confirm (single presentation path). */
export function renderConfirmPanel(
  options: ModalConfirmOptions,
  close: (value: boolean) => void
): ReactNode {
  const defaultValue = options.defaultValue ?? false;
  const details = options.details ?? [];
  const content = [
    options.message,
    ...details,
    defaultValue ? '(Y/n)' : '(y/N)',
  ];
  return (
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
  );
}

/** Info / help panel content for ModalApi.info. */
export function renderInfoPanel(
  options: ModalInfoOptions,
  close: () => void
): ReactNode {
  return (
    <FramedPanel
      title={options.title}
      content={options.content}
      width={options.width ?? 76}
      muteLastContent={options.muteLastContent ?? false}
      // Cap height so long help (grouped shortcuts) scrolls instead of overflowing.
      {...(options.maxHeight !== undefined ? { maxHeight: options.maxHeight } : {})}
      onEscape={() => close()}
      onKey={(input, key) => {
        // ↑/↓ reserved for FramedPanel scroll when content overflows.
        if (key.return || input === 'q' || input === ' ') close();
      }}
    />
  );
}
