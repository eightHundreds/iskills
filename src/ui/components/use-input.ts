import { useKeyboard } from '@opentui/react';
import type { KeyEvent } from '@opentui/core';
import { useCallback, useRef } from 'react';
import { isMouseInput } from './mouse/parse.js';

/** Ink-shaped key flags so existing product handlers stay readable. */
export type Key = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  home: boolean;
  end: boolean;
  pageUp: boolean;
  pageDown: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

function mapKey(event: KeyEvent): { input: string; key: Key } {
  const name = event.name || '';
  const key: Key = {
    upArrow: name === 'up',
    downArrow: name === 'down',
    leftArrow: name === 'left',
    rightArrow: name === 'right',
    return: name === 'return' || name === 'enter',
    escape: name === 'escape',
    tab: name === 'tab',
    backspace: name === 'backspace',
    delete: name === 'delete',
    home: name === 'home',
    end: name === 'end',
    pageUp: name === 'pageup',
    pageDown: name === 'pagedown',
    ctrl: Boolean(event.ctrl),
    meta: Boolean(event.meta || event.option),
    shift: Boolean(event.shift),
  };

  // Printable input: prefer sequence when it is a single grapheme / short insert.
  let input = '';
  if (
    !key.return &&
    !key.escape &&
    !key.tab &&
    !key.upArrow &&
    !key.downArrow &&
    !key.leftArrow &&
    !key.rightArrow &&
    !key.backspace &&
    !key.delete &&
    !key.home &&
    !key.end &&
    !key.pageUp &&
    !key.pageDown
  ) {
    if (event.ctrl && name.length === 1) {
      input = name;
    } else if (event.sequence && !event.sequence.startsWith('\u001b')) {
      input = event.sequence;
    } else if (name.length === 1) {
      input = event.shift ? name.toUpperCase() : name;
    }
  }

  return { input, key };
}

/**
 * App-level keyboard hook over OpenTUI `useKeyboard`.
 * Filters terminal mouse reports; keeps handler in a ref so listeners stay stable.
 */
export function useInput(
  inputHandler: (input: string, key: Key) => void,
  options?: { isActive?: boolean }
): void {
  const handlerRef = useRef(inputHandler);
  handlerRef.current = inputHandler;
  const active = options?.isActive ?? true;
  const activeRef = useRef(active);
  activeRef.current = active;

  const stableHandler = useCallback((event: KeyEvent) => {
    if (!activeRef.current) return;
    if (event.eventType === 'release') return;
    const { input, key } = mapKey(event);
    if (input && isMouseInput(input)) return;
    handlerRef.current(input, key);
  }, []);

  useKeyboard(stableHandler);
}
