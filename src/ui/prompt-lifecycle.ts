let close: (() => void) | undefined;

export function registerPromptCloser(value: () => void): void {
  close = value;
}

export function closeActivePrompts(): void {
  close?.();
}
