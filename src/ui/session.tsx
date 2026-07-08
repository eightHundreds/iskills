import { Box, render, useApp, useInput, type Instance } from 'ink';
import { useEffect, useState, type ReactNode } from 'react';

export class InterruptError extends Error {
  readonly exitCode = 130;

  constructor() {
    super('操作已中断');
    this.name = 'InterruptError';
  }
}

function CancelBoundary({
  cancel,
  interrupt,
  cancelOnEscape,
  registerExit,
  children,
}: {
  cancel: () => void;
  interrupt: () => void;
  cancelOnEscape: boolean;
  registerExit: (exit: () => void) => void;
  children: ReactNode;
}) {
  const { exit } = useApp();
  const [ready, setReady] = useState(false);
  registerExit(exit);
  useInput((input, key) => {
    if (key.ctrl && input === 'c') interrupt();
    else if (cancelOnEscape && key.escape) cancel();
  });
  useEffect(() => {
    // Ink installs useInput listeners in passive effects. Do not show an
    // interactive prompt until those listeners and raw mode are active, or a
    // fast keypress can be echoed by the terminal and lost between screens.
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  return <Box display={ready ? 'flex' : 'none'}>{children}</Box>;
}

export class InkSession {
  private instance: Instance | undefined;
  private screen = 0;

  constructor(private readonly persistent = false) {}

  show<T>(
    cancelledValue: T,
    component: (finish: (value: T) => void) => ReactNode,
    cancelOnEscape = true
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let finished = false;
      let instance: Instance;
      let exit: (() => void) | undefined;
      const settle = (complete: () => void, close = false) => {
        if (finished) return;
        finished = true;
        if (this.persistent && !close) {
          instance.rerender(null);
          setTimeout(complete, 10);
          return;
        }
        const exited = instance.waitUntilExit();
        if (exit) exit();
        else instance.unmount();
        void exited.then(
          () => {
            instance.cleanup();
            if (this.instance === instance) this.instance = undefined;
            // React runs passive useInput cleanup after Ink resolves its exit promise.
            setTimeout(complete, 10);
          },
          (error: unknown) => {
            instance.cleanup();
            if (this.instance === instance) this.instance = undefined;
            reject(error);
          }
        );
      };
      const finish = (value: T) => settle(() => resolve(value));
      const child = component(finish);
      const node = (
        <CancelBoundary
          key={this.screen++}
          cancel={() => finish(cancelledValue)}
          interrupt={() => settle(() => reject(new InterruptError()), true)}
          cancelOnEscape={cancelOnEscape}
          registerExit={(value) => {
            exit = value;
          }}
        >
          {child}
        </CancelBoundary>
      );
      if (this.instance) {
        instance = this.instance;
        instance.rerender(node);
      } else {
        instance = render(node, { exitOnCtrlC: false });
      }
      this.instance = instance;
    });
  }

  close(): void {
    this.instance?.unmount();
    this.instance?.cleanup();
    this.instance = undefined;
  }
}
