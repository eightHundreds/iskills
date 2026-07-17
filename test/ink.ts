import { render } from 'ink-testing-library';
import type { ReactElement } from 'react';

const keySequences = {
  enter: '\r',
  escape: '\u001B',
  tab: '\t',
  shiftTab: '\u001B[Z',
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  backspace: '\u007F',
  delete: '\u001B[3~',
} as const;

export type InkKey = keyof typeof keySequences;

export interface InkScreen {
  frame(): string;
  write(input: string): Promise<void>;
  press(key: InkKey): Promise<void>;
}

function settleInk(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

// Keeps the third-party renderer, effect timing, stdin protocol, and teardown
// behind one test-only Interface. UI tests describe observable terminal actions.
export async function withInk<T>(
  tree: ReactElement,
  exercise: (screen: InkScreen) => Promise<T> | T
): Promise<T> {
  const instance = render(tree);
  const write = async (input: string): Promise<void> => {
    instance.stdin.write(input);
    await settleInk();
  };
  const screen: InkScreen = {
    frame: () => instance.lastFrame() ?? '',
    write,
    press: async (key) => write(keySequences[key]),
  };

  await settleInk();
  try {
    return await exercise(screen);
  } finally {
    instance.unmount();
    instance.cleanup();
  }
}
