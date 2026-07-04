import { render, useInput, type Instance } from 'ink';
import type { ReactNode } from 'react';

function CancelBoundary({ cancel, children }: { cancel: () => void; children: ReactNode }) {
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) cancel();
  });
  return children;
}

export class InkSession {
  private instance: Instance | undefined;

  show<T>(
    cancelledValue: T,
    component: (finish: (value: T) => void) => ReactNode,
    cancelOnEscape = true
  ): Promise<T> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value: T) => {
        if (finished) return;
        finished = true;
        resolve(value);
      };
      const child = component(finish);
      const node = cancelOnEscape ? (
        <CancelBoundary cancel={() => finish(cancelledValue)}>{child}</CancelBoundary>
      ) : child;
      if (this.instance) this.instance.rerender(node);
      else this.instance = render(node, { exitOnCtrlC: false });
    });
  }

  close(): void {
    this.instance?.unmount();
    this.instance?.cleanup();
    this.instance = undefined;
  }
}
