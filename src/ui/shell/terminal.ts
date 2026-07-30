/** Terminal-session error shared by CLI and TUI runners (value module). */
import { t } from '../../i18n/index.js';

export class InterruptError extends Error {
  readonly exitCode = 130;

  constructor() {
    super(t('common.interrupted'));
    this.name = 'InterruptError';
  }
}
