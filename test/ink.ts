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
export type FrameMatcher = string | RegExp | ((frame: string) => boolean);

export interface InkScreen {
  frame(): string;
  write(input: string): Promise<void>;
  press(key: InkKey): Promise<void>;
  waitForFrame(matcher: FrameMatcher, description?: string): Promise<string>;
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function flushPassiveEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function matchesFrame(frame: string, matcher: FrameMatcher): boolean {
  if (typeof matcher === 'string') return frame.includes(matcher);
  if (matcher instanceof RegExp) return matcher.test(frame);
  return matcher(frame);
}

// Keeps the third-party renderer, effect timing, stdin protocol, and teardown
// behind one test-only Interface. UI tests describe terminal actions and
// observable frame assertions without knowing Ink's effect timing.
export async function withInk<T>(
  tree: ReactElement,
  exercise: (screen: InkScreen) => Promise<T> | T
): Promise<T> {
  const instance = render(tree);
  const waitForFrame = async (
    matcher: FrameMatcher,
    description = 'expected terminal frame'
  ): Promise<string> => {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const frame = instance.lastFrame() ?? '';
      if (matchesFrame(frame, matcher)) {
        return frame;
      }
      await nextTurn();
    }
    throw new Error(`${description} was not rendered. Last frame:\n${instance.lastFrame() ?? ''}`);
  };
  const screen: InkScreen = {
    frame: () => instance.lastFrame() ?? '',
    write: async (input) => {
      instance.stdin.write(input);
      await flushPassiveEffects();
    },
    press: async (key) => {
      instance.stdin.write(keySequences[key]);
      await flushPassiveEffects();
    },
    waitForFrame,
  };

  await flushPassiveEffects();
  try {
    return await exercise(screen);
  } finally {
    instance.unmount();
    instance.cleanup();
  }
}
