/** Terminal-session error shared by CLI and TUI runners (value module). */

export class InterruptError extends Error {
  readonly exitCode = 130;

  constructor() {
    super('操作已中断');
    this.name = 'InterruptError';
  }
}
